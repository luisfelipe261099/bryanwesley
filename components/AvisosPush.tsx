"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Bell, BellOff, BellRing, Loader2, Smartphone, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { testarAvisoPush } from "@/app/conta/actions";

type Papel = "ADMIN" | "BARBER" | "CLIENT";

type Estado =
  | "carregando"
  /** O navegador tem push, mas não deu para conferir agora (sem rede, sw.js barrado). */
  | "erro"
  /** Navegador sem push (ou iOS antigo). Nada a fazer. */
  | "sem-suporte"
  /** iPhone/iPad no Safari comum: o push só existe com o site instalado. */
  | "ios-sem-app"
  /** A pessoa negou a permissão; só o navegador desfaz. */
  | "negado"
  | "desligado"
  | "ligado";

const TEXTO: Record<Papel, string> = {
  ADMIN:
    "Agendamento novo, cancelamento, pedido de plano e WhatsApp fora do ar chegam no seu celular — com o site fechado.",
  BARBER:
    "Cada horário novo, cancelado ou remarcado na sua agenda chega no seu celular — com o site fechado.",
  CLIENT: "Confirmação e lembretes do seu horário chegam no seu celular — com o site fechado.",
};

/** Por quanto tempo "Agora não" esconde o convite. */
const SONECA_MS = 7 * 86400_000;
const CHAVE_SONECA = "avisos-push:agora-nao";
const CHAVE_SYNC = "avisos-push:sincronizado";
/**
 * Quem ligou os avisos neste aparelho. Num tablet do balcão, o barbeiro
 * que entra depois do admin não herda a inscrição sem querer: para ele a
 * tela mostra "desligados" até ele mesmo ligar — e aí o aparelho passa
 * a ser dele.
 */
export const CHAVE_DONO = "avisos-push:dono";

/** A chave VAPID (base64url) no formato que o navegador quer. */
function chaveParaBytes(b64url: string) {
  const padding = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesParaChave(buf: ArrayBuffer | null | undefined) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of Array.from(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sem o "=" do fim: a chave pode vir com ou sem ele, e é a mesma. */
const semPadding = (s: string) => s.replace(/=+$/, "");

/** A chave da inscrição deste navegador é a chave atual do site? */
function mesmaChave(sub: PushSubscription, chavePublica: string) {
  const daInscricao = bytesParaChave(sub.options.applicationServerKey);
  return !daInscricao || daInscricao === semPadding(chavePublica);
}

function ehIos() {
  const ua = navigator.userAgent;
  // iPadOS se apresenta como Mac; o toque entrega.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function instalado() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function suporta() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** localStorage pode não existir (modo privado, dados bloqueados). */
function guardar(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {}
}
function ler(chave: string) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

async function registrar() {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  // `ready` espera o worker ativar: antes disso, subscribe falha.
  await navigator.serviceWorker.ready;
  return reg;
}

async function enviarInscricao(sub: PushSubscription) {
  const r = await fetch("/api/push/inscricao", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inscricao: sub.toJSON() }),
  });
  if (!r.ok) throw new Error(`O site não aceitou a inscrição (${r.status}).`);
  return (await r.json()) as { ok: boolean; aparelhos: number; lembretes: number };
}

/**
 * O botão de ligar os avisos no celular — e o estado real deles neste
 * aparelho, lido do navegador toda vez que a tela abre.
 *
 * "card": bloco completo (Minha conta, Mensagens). "banner": convite
 * discreto no topo do painel; some quando já está ligado, quando o
 * navegador não tem push ou quando a pessoa pediu "agora não".
 */
export function AvisosPush({
  chavePublica,
  papel,
  usuarioId,
  variante = "card",
}: {
  chavePublica: string;
  papel: Papel;
  /** Conta logada: a inscrição deste aparelho só vale "ligada" para quem a ligou. */
  usuarioId: number;
  variante?: "card" | "banner";
}) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [ocupado, setOcupado] = useState(false);
  const [soneca, setSoneca] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [testando, startTeste] = useTransition();

  // Lê a situação deste aparelho: inscrito? permissão? chave atual?
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (variante === "banner") {
        const ate = Number(ler(CHAVE_SONECA) ?? 0);
        if (ate > Date.now()) setSoneca(true);
      }
      if (!suporta()) {
        setEstado(ehIos() && !instalado() ? "ios-sem-app" : "sem-suporte");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("negado");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const sub = await reg.pushManager.getSubscription();
        if (!vivo) return;
        if (!sub || Notification.permission !== "granted") {
          setEstado("desligado");
          return;
        }
        // Chave do site mudou: a inscrição antiga não recebe mais nada.
        // Desfaz para a pessoa religar com a chave nova.
        if (!mesmaChave(sub, chavePublica)) {
          await sub.unsubscribe().catch(() => {});
          setEstado("desligado");
          return;
        }
        // Inscrição de outra pessoa neste aparelho: para esta conta, está
        // desligado. Ligar aqui passa o aparelho para ela.
        if (ler(CHAVE_DONO) !== String(usuarioId)) {
          setEstado("desligado");
          return;
        }
        setEstado("ligado");
        // Mantém o site em dia com o navegador (uma vez por sessão da aba).
        try {
          if (sessionStorage.getItem(CHAVE_SYNC) !== "1") {
            sessionStorage.setItem(CHAVE_SYNC, "1");
            await enviarInscricao(sub);
          }
        } catch {}
      } catch {
        // O navegador até tem push, mas não deu para conferir (sem rede,
        // sw.js barrado): não é "sem suporte" — é "tente de novo".
        if (vivo) setEstado("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [chavePublica, variante, usuarioId, tentativa]);

  // A lista de aparelhos (em Conta) removeu justamente este: a tela
  // acompanha, em vez de seguir dizendo "ligados".
  useEffect(() => {
    const aoRemover = () => {
      guardar(CHAVE_DONO, null);
      setEstado((e) => (e === "ligado" ? "desligado" : e));
    };
    window.addEventListener("avisos-push:removido", aoRemover);
    return () => window.removeEventListener("avisos-push:removido", aoRemover);
  }, []);

  const ligar = useCallback(async () => {
    setOcupado(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setEstado(permissao === "denied" ? "negado" : "desligado");
        if (permissao === "denied") toast("Permissão negada. Libere as notificações nas configurações do navegador.", "erro");
        return;
      }
      const reg = await registrar();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !mesmaChave(sub, chavePublica)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: chaveParaBytes(chavePublica),
        });
      }
      const r = await enviarInscricao(sub);
      try {
        sessionStorage.setItem(CHAVE_SYNC, "1");
      } catch {}
      guardar(CHAVE_SONECA, null);
      guardar(CHAVE_DONO, String(usuarioId));
      setEstado("ligado");
      toast(
        r.lembretes > 0
          ? "Avisos ligados neste aparelho. Os lembretes dos seus horários já vêm por aqui."
          : "Avisos ligados neste aparelho."
      );
    } catch (e) {
      // A mensagem do navegador vem em inglês e não ajuda quem lê; o que
      // importa fica no console para quem for investigar.
      console.error("Avisos no celular:", e);
      toast("Não deu para ligar os avisos neste navegador agora. Tente de novo ou use outro navegador.", "erro");
      setEstado(Notification.permission === "denied" ? "negado" : "desligado");
    } finally {
      setOcupado(false);
    }
  }, [chavePublica, usuarioId]);

  const desligar = useCallback(async () => {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/inscricao", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      try {
        sessionStorage.removeItem(CHAVE_SYNC);
      } catch {}
      guardar(CHAVE_DONO, null);
      setEstado("desligado");
      toast("Avisos desligados neste aparelho.");
    } catch {
      toast("Não deu para desligar agora. Tente de novo.", "erro");
    } finally {
      setOcupado(false);
    }
  }, []);

  const testar = () =>
    startTeste(async () => {
      const r = await testarAvisoPush();
      if (r.ok) toast(`Aviso de teste enviado para ${r.enviadas} aparelho(s). Confira a barra de notificações.`);
      else toast(r.error, "erro");
    });

  const agoraNao = () => {
    guardar(CHAVE_SONECA, String(Date.now() + SONECA_MS));
    setSoneca(true);
  };

  // ───────────── banner ─────────────
  if (variante === "banner") {
    if (soneca || estado === "carregando" || estado === "ligado" || estado === "sem-suporte" || estado === "erro") return null;
    return (
      <div
        data-testid="avisos-push-banner"
        className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-electric/25 bg-electric/[0.07] px-4 py-3.5 text-sm text-steel-200"
      >
        <Bell className="h-5 w-5 flex-none text-electric" />
        <span className="min-w-0 flex-1">
          {estado === "ios-sem-app" ? (
            <>
              <strong className="text-white">Avisos no iPhone:</strong> toque em Compartilhar →{" "}
              <strong className="text-white">Adicionar à Tela de Início</strong> e abra o site pelo ícone. Lá
              dentro dá para ligar os avisos.
            </>
          ) : estado === "negado" ? (
            <>
              As notificações estão <strong className="text-white">bloqueadas</strong> neste navegador. Libere em
              Configurações do site → Notificações para receber os avisos.
            </>
          ) : (
            TEXTO[papel]
          )}
        </span>
        {estado === "desligado" && (
          <button
            type="button"
            onClick={ligar}
            disabled={ocupado}
            className="btn-royal inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Ligar avisos
          </button>
        )}
        <button
          type="button"
          onClick={agoraNao}
          aria-label="Agora não"
          title="Agora não"
          className="rounded-full p-1.5 text-steel-400 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // ───────────── card ─────────────
  return (
    <div data-testid="avisos-push" data-estado={estado} className="space-y-4">
      <p className="text-sm text-steel-300">{TEXTO[papel]}</p>

      {estado === "carregando" && (
        <p className="inline-flex items-center gap-2 text-sm text-steel-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Conferindo este aparelho…
        </p>
      )}

      {estado === "erro" && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
          Não deu para conferir este aparelho agora (sem conexão?).
          <button
            type="button"
            onClick={() => {
              setEstado("carregando");
              setTentativa((t) => t + 1);
            }}
            className="rounded-full border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/10"
          >
            Tentar de novo
          </button>
        </p>
      )}

      {estado === "sem-suporte" && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-steel-400">
          Este navegador não recebe avisos no celular. No Android, use o Chrome; no iPhone, o Safari com o
          site instalado (iOS 16.4 ou mais novo).
        </p>
      )}

      {estado === "ios-sem-app" && (
        <div className="rounded-xl border border-electric/25 bg-electric/[0.06] px-3.5 py-3 text-sm text-steel-200">
          <p className="flex items-center gap-2 font-semibold text-white">
            <Smartphone className="h-4 w-4 text-electric" /> No iPhone, primeiro instale o site
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-steel-300">
            <li>No Safari, toque em Compartilhar (o quadrado com a seta).</li>
            <li>
              Escolha <strong className="text-white">Adicionar à Tela de Início</strong>.
            </li>
            <li>Abra o site pelo ícone novo e volte aqui para ligar os avisos.</li>
          </ol>
        </div>
      )}

      {estado === "negado" && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
          As notificações estão bloqueadas para este site. Libere nas configurações do navegador
          (cadeado ao lado do endereço → Notificações) e recarregue a página.
        </p>
      )}

      {(estado === "desligado" || estado === "ligado") && (
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`label inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
              estado === "ligado" ? "bg-neon/10 text-neon" : "bg-white/5 text-steel-400"
            }`}
          >
            {estado === "ligado" ? <BellRing className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            {estado === "ligado" ? "Ligados neste aparelho" : "Desligados neste aparelho"}
          </span>
          {estado === "desligado" ? (
            <button
              type="button"
              onClick={ligar}
              disabled={ocupado}
              className="btn-royal inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Ligar avisos neste aparelho
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={testar}
                disabled={testando}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2.5 text-sm font-medium text-steel-200 transition-colors hover:border-electric/40 hover:text-white disabled:opacity-60"
              >
                {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                Enviar aviso de teste
              </button>
              <button
                type="button"
                onClick={desligar}
                disabled={ocupado}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2.5 text-sm text-steel-400 transition-colors hover:text-white disabled:opacity-60"
              >
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
                Desligar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
