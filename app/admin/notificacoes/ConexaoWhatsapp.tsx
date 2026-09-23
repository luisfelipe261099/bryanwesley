"use client";

// O WhatsApp da barbearia: qual está ligado, se está conectado e como
// conectar — o QR code aparece aqui mesmo, sem abrir outro sistema.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Check,
  Copy,
  Link2,
  PauseCircle,
  QrCode,
  RefreshCw,
  Server,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Card, Feedback, notify, type Msg } from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import {
  conectarWhatsapp,
  codigoDoWhatsapp,
  retomarConversaWhatsapp,
  gerarComandoDaPonte,
  desconectarNumeroWhatsapp,
  desligarServidorWhatsapp,
} from "../actions";

export type ConexaoProps = {
  provedor: "ponte" | "waha" | "meta" | null;
  ponte: {
    status: string | null;
    numero: string | null;
    nome: string | null;
    qr: string | null;
    codigoWhatsapp: string | null;
    /** "há 2 min" — último sinal do servidor. */
    vistoHa: string | null;
    foraDoAr: boolean;
  };
  waha: {
    falta: string[];
    status: string | null;
    numero: string | null;
    nome: string | null;
    webhookCerto: boolean | null;
    erro: string | null;
  };
  meta: { falta: string[] };
  ia: { ligada: boolean; modelo: string };
  pausadas: { phone: string; rotulo: string; ate: string }[];
};

const STATUS: Record<string, string> = {
  WORKING: "Conectado",
  SCAN_QR_CODE: "Esperando o QR code",
  STARTING: "Ligando…",
  INSTALANDO: "Instalando…",
  STOPPED: "Desligado",
  FAILED: "Caiu — aperte Conectar",
  NAO_EXISTE: "Ainda não conectado",
  FORA_DO_AR: "O servidor do WAHA não respondeu",
  WAHA_FORA_DO_AR: "O WAHA não respondeu no servidor",
  SEM_ACESSO: "O WAHA recusou a chave",
  PASSKEY_REQUIRED: "O WhatsApp pediu a chave de acesso no celular",
  PASSKEY_CONFIRMATION_REQUIRED: "Confirme o acesso no celular",
};

const inputCls =
  "min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60";
const btnSec =
  "label inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-3 text-steel-300 transition-colors hover:border-electric/40 hover:text-white disabled:opacity-50";

export function ConexaoWhatsapp(p: ConexaoProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [qrVersao, setQrVersao] = useState(0);

  const statusAtual = p.provedor === "ponte" ? p.ponte.status : p.provedor === "waha" ? p.waha.status : null;
  const esperando =
    (p.provedor === "ponte" || p.provedor === "waha") && statusAtual !== "WORKING";

  // Enquanto espera o QR (ou o servidor ligar), o painel se atualiza
  // sozinho: o código troca a cada ~20s e, depois de escanear, o
  // "Conectado" aparece sem recarregar.
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => {
      setQrVersao((v) => v + 1);
      router.refresh();
    }, p.provedor === "ponte" ? 3000 : 8000);
    return () => clearInterval(t);
  }, [esperando, p.provedor, router]);

  function acao(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, ok?: string) {
    setMsg(null);
    start(async () => {
      setMsg(notify(await fn(), ok));
      router.refresh();
    });
  }

  return (
    <Card
      title="WhatsApp da barbearia"
      desc="Quem manda mensagem marca o horário ali mesmo: escolhe serviço, dia e hora, e o agendamento cai na agenda."
      icon={<Bot className="h-5 w-5" />}
    >
      {p.provedor === null && <Instalar meta={p.meta} waha={p.waha} />}

      {p.provedor === "ponte" && (
        <PelaPonte
          ponte={p.ponte}
          pending={pending}
          onConectar={() => acao(conectarWhatsapp)}
          onDesconectar={() => {
            if (confirm("Desconectar o número do WhatsApp deste servidor? Para voltar, é preciso escanear o QR code de novo.")) {
              acao(desconectarNumeroWhatsapp);
            }
          }}
          onDesligar={() => {
            if (confirm("Desligar o servidor do WhatsApp? O atendente para de responder até instalar de novo.")) {
              acao(desligarServidorWhatsapp);
            }
          }}
          setMsg={setMsg}
        />
      )}

      {p.provedor === "waha" && (
        <WahaDireto
          waha={p.waha}
          qrVersao={qrVersao}
          pending={pending}
          onConectar={() => acao(conectarWhatsapp, "Conectando…")}
          setMsg={setMsg}
        />
      )}

      {p.provedor === "meta" && (
        <Linha ok titulo="Cloud API da Meta (oficial)">
          Respondendo pelo número aprovado na Meta, com listas e botões.
        </Linha>
      )}

      <Ia ia={p.ia} />

      {p.pausadas.length > 0 && (
        <Pausadas
          pausadas={p.pausadas}
          pending={pending}
          onRetomar={(phone) => acao(() => retomarConversaWhatsapp(phone))}
        />
      )}

      <Feedback msg={msg} />
    </Card>
  );
}

// ───────────────────── Instalar (nada ligado) ─────────────────────

function Instalar({ meta, waha }: Pick<ConexaoProps, "meta" | "waha">) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-electric/25 bg-electric/[0.05] p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-white">
          <Server className="h-4 w-4 text-electric" /> Grátis — no número de sempre
        </p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          O WhatsApp da barbearia roda num servidor grátis (Google Cloud) e conversa com
          este site. Sem domínio, sem configurar nada na Vercel: é colar um comando e
          escanear o QR code.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-steel-300">
          <li>Crie o servidor grátis (passo a passo logo abaixo).</li>
          <li>Gere o comando e cole na janela do servidor.</li>
          <li>O QR code aparece aqui — escaneie com o celular da barbearia.</li>
        </ol>
        <ComandoDeInstalacao />
        <GuiaGoogleCloud />
        <p className="mt-3 text-xs text-steel-400">
          Não é oficial: o WhatsApp pode bloquear número que pareça robô de spam. O
          atendente só responde quem escreveu, como gente — mas nada de disparo em massa
          por esse número.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <p className="font-semibold text-white">Oficial — Cloud API da Meta</p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          Roda direto na Vercel, com listas e botões. Responder quem escreveu é grátis;
          lembrete é cobrado por mensagem (uns centavos). Exige um número aprovado pela Meta.
        </p>
        <p className="mt-2 text-xs text-steel-400">Falta na Vercel: {meta.falta.join(", ")}.</p>
      </div>

      <p className="px-1 text-xs text-steel-400">
        Já tem um WAHA com HTTPS próprio? Configure {waha.falta.join(", ")} na Vercel.
      </p>
    </div>
  );
}

function ComandoDeInstalacao({ reinstalar = false }: { reinstalar?: boolean }) {
  const [pending, start] = useTransition();
  const [comando, setComando] = useState<string | null>(null);
  const [expira, setExpira] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  function gerar() {
    setErro(null);
    start(async () => {
      const r = await gerarComandoDaPonte();
      if (!r.ok) return setErro(r.error);
      setComando(r.comando);
      setExpira(
        new Date(r.expira).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        })
      );
    });
  }

  async function copiar() {
    if (!comando) return;
    try {
      await navigator.clipboard.writeText(comando);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={gerar}
        disabled={pending}
        className={
          reinstalar
            ? btnSec
            : "btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-3 text-white disabled:opacity-60"
        }
      >
        <Server className="h-4 w-4" />
        {comando ? "Gerar outro comando" : reinstalar ? "Reinstalar / atualizar o servidor" : "Gerar comando de instalação"}
      </button>
      {comando && (
        <div className="space-y-2">
          <p className="break-all rounded-xl border border-white/8 bg-black/40 px-3.5 py-3 font-mono text-xs leading-relaxed text-neon">
            {comando}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copiar} className={btnSec}>
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiado ? "Copiado" : "Copiar comando"}
            </button>
            <span className="text-xs text-steel-400">
              Vale até {expira}, uma vez. Cole na janela do servidor e aperte Enter.
            </span>
          </div>
        </div>
      )}
      {erro && <p className="text-sm text-amber-200">{erro}</p>}
    </div>
  );
}

function GuiaGoogleCloud() {
  return (
    <details className="mt-4 rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-steel-300">
      <summary className="cursor-pointer font-semibold text-white">
        Como criar o servidor grátis (Google Cloud)
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
        <li>
          Entre em <strong>console.cloud.google.com</strong> com uma conta Google e ative o
          faturamento (pede cartão, mas esta máquina é do plano <em>Always Free</em> — não é cobrada).
        </li>
        <li>
          Menu → <strong>Compute Engine → Instâncias de VM → Criar instância</strong>.
        </li>
        <li>
          Região: <strong>us-central1 (Iowa)</strong>, us-east1 ou us-west1 — só essas são grátis.
          Tipo de máquina: <strong>e2-micro</strong>.
        </li>
        <li>
          Disco de inicialização: <strong>Ubuntu 24.04 LTS</strong>, tipo{" "}
          <strong>Disco permanente padrão</strong> (o &quot;equilibrado&quot; é cobrado), 30 GB.
        </li>
        <li>Não precisa liberar HTTP nem HTTPS no firewall. Clique em <strong>Criar</strong>.</li>
        <li>
          Na lista de instâncias, clique em <strong>SSH</strong>: abre uma janela preta. Cole o
          comando gerado aqui e aperte Enter.
        </li>
      </ol>
      <p className="mt-3 text-xs text-steel-400">
        Dica: em Faturamento → Orçamentos, crie um alerta de R$ 1 para saber se algo sair do grátis.
      </p>
    </details>
  );
}

// ───────────────────── Pela ponte ─────────────────────

function PelaPonte({
  ponte,
  pending,
  onConectar,
  onDesconectar,
  onDesligar,
  setMsg,
}: {
  ponte: ConexaoProps["ponte"];
  pending: boolean;
  onConectar: () => void;
  onDesconectar: () => void;
  onDesligar: () => void;
  setMsg: (m: Msg) => void;
}) {
  const s = ponte.status;
  const conectado = s === "WORKING" && !ponte.foraDoAr;

  return (
    <div className="space-y-4">
      {ponte.foraDoAr ? (
        <Linha ok={false} titulo="O servidor não dá sinal">
          Último sinal {ponte.vistoHa ?? "—"}. A máquina pode estar desligada. No servidor:{" "}
          <code className="rounded bg-black/30 px-1">cd /opt/whatsapp-barbearia &amp;&amp; sudo docker compose up -d</code>
        </Linha>
      ) : conectado ? (
        <Linha ok titulo="Conectado">
          Respondendo pelo número{" "}
          <strong className="whitespace-nowrap text-white">
            {ponte.numero ? formatPhone(ponte.numero) : "—"}
          </strong>
          {ponte.nome ? ` (${ponte.nome})` : ""}. Os menus saem numerados — o cliente responde
          &quot;1&quot;, &quot;2&quot;… ou escreve.
        </Linha>
      ) : (
        <Linha ok={false} titulo={`Servidor instalado · ${STATUS[s ?? ""] ?? s ?? "esperando o primeiro sinal"}`}>
          {s === "SCAN_QR_CODE"
            ? "Falta conectar o número: escaneie o QR code."
            : s === "INSTALANDO" || !s
              ? "O servidor está subindo — leva uns minutos na primeira vez."
              : "Aperte Conectar para ligar o número de novo."}
        </Linha>
      )}

      {!ponte.foraDoAr && s === "SCAN_QR_CODE" && (
        <ParearNumero qr={ponte.qr} codigo={ponte.codigoWhatsapp} pending={pending} setMsg={setMsg} />
      )}

      <div className="flex flex-wrap gap-2">
        {!conectado && !ponte.foraDoAr && s !== "SCAN_QR_CODE" && (
          <button
            type="button"
            onClick={onConectar}
            disabled={pending}
            className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-3 text-white disabled:opacity-60"
          >
            <Link2 className="h-4 w-4" /> Conectar
          </button>
        )}
      </div>

      <details className="rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-steel-300">
        <summary className="cursor-pointer font-semibold text-white">Servidor</summary>
        <p className="mt-2 text-xs text-steel-400">
          Último sinal {ponte.vistoHa ?? "—"}. Rodar o comando de novo atualiza o servidor sem
          desconectar o número.
        </p>
        <ComandoDeInstalacao reinstalar />
        <div className="mt-3 flex flex-wrap gap-2">
          {conectado && (
            <button type="button" onClick={onDesconectar} disabled={pending} className={btnSec}>
              Desconectar número
            </button>
          )}
          <button type="button" onClick={onConectar} disabled={pending} className={btnSec}>
            <RefreshCw className="h-4 w-4" /> Reconfigurar
          </button>
          <button type="button" onClick={onDesligar} disabled={pending} className={btnSec}>
            Desligar servidor
          </button>
        </div>
      </details>
    </div>
  );
}

function ParearNumero({
  qr,
  codigo,
  pending,
  setMsg,
}: {
  qr: string | null;
  codigo: string | null;
  pending: boolean;
  setMsg: (m: Msg) => void;
}) {
  const [fone, setFone] = useState("");
  const [pedindo, startPedido] = useTransition();
  const erroNoCodigo = codigo?.startsWith("erro:");

  function pedirCodigo() {
    setMsg(null);
    startPedido(async () => {
      const r = await codigoDoWhatsapp(fone);
      if (!r.ok) setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="mx-auto w-full max-w-[240px] rounded-2xl bg-white p-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR code para conectar o WhatsApp da barbearia" className="aspect-square w-full" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center text-center text-xs text-black/60">
            Gerando o QR code…
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-3 text-sm text-steel-300">
        <p className="flex items-center gap-2 font-semibold text-white">
          <QrCode className="h-4 w-4 text-electric" /> Conectar pelo QR code
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>No celular da barbearia, abra o WhatsApp.</li>
          <li>
            Toque em <strong>⋮</strong> (ou Configurações) → <strong>Aparelhos conectados</strong> →{" "}
            <strong>Conectar aparelho</strong>.
          </li>
          <li>Aponte a câmera para o QR code.</li>
        </ol>
        <p className="flex items-center gap-2 pt-2 font-semibold text-white">
          <Smartphone className="h-4 w-4 text-electric" /> Está no próprio celular?
        </p>
        <p>Peça um código e digite no WhatsApp em &quot;Conectar com número de telefone&quot;.</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={fone}
            onChange={(e) => setFone(e.target.value)}
            inputMode="tel"
            placeholder="(41) 9 9999-0000"
            aria-label="Número do WhatsApp da barbearia"
            className={inputCls}
          />
          <button
            type="button"
            onClick={pedirCodigo}
            disabled={pending || pedindo || fone.replace(/\D/g, "").length < 10}
            className="btn-outline label rounded-full px-4 py-3 text-electric disabled:opacity-50"
          >
            {pedindo ? "Pedindo…" : "Gerar código"}
          </button>
        </div>
        {codigo && !erroNoCodigo && (
          <p className="rounded-xl border border-neon/30 bg-neon/10 px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] text-neon">
            {codigo}
          </p>
        )}
        {erroNoCodigo && (
          <p className="text-sm text-amber-200">
            O WhatsApp não liberou o código agora ({codigo!.slice(5)}). Use o QR code.
          </p>
        )}
      </div>
    </div>
  );
}

// ───────────────────── WAHA direto (HTTPS próprio) ─────────────────────

function WahaDireto({
  waha,
  qrVersao,
  pending,
  onConectar,
  setMsg,
}: {
  waha: ConexaoProps["waha"];
  qrVersao: number;
  pending: boolean;
  onConectar: () => void;
  setMsg: (m: Msg) => void;
}) {
  const status = waha.status;
  const [fone, setFone] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [pedindo, startPedido] = useTransition();

  function pedirCodigo() {
    setMsg(null);
    setCodigo(null);
    startPedido(async () => {
      const r = await codigoDoWhatsapp(fone);
      if (r.ok) setCodigo(r.codigo);
      else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <div className="space-y-4">
      <Linha ok={status === "WORKING"} titulo={`WAHA · ${STATUS[status ?? ""] ?? status ?? "—"}`}>
        {status === "WORKING" ? (
          <>
            Respondendo pelo número{" "}
            <strong className="whitespace-nowrap text-white">
              {waha.numero ? formatPhone(waha.numero) : "—"}
            </strong>
            {waha.nome ? ` (${waha.nome})` : ""}. Os menus saem numerados — o cliente responde
            &quot;1&quot;, &quot;2&quot;… ou escreve.
          </>
        ) : (
          (waha.erro ?? "Conecte o número da barbearia para o atendente começar a responder.")
        )}
      </Linha>

      {status === "WORKING" && waha.webhookCerto === false && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
          O WAHA está conectado, mas não está mandando as mensagens para este site. Aperte{" "}
          <strong>Conectar / atualizar</strong> para acertar.
        </p>
      )}

      {status === "SCAN_QR_CODE" && (
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          <div className="mx-auto w-full max-w-[240px] rounded-2xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/waha/qr?v=${qrVersao}`}
              alt="QR code para conectar o WhatsApp da barbearia"
              className="aspect-square w-full"
            />
          </div>
          <div className="min-w-0 space-y-3 text-sm text-steel-300">
            <p className="flex items-center gap-2 font-semibold text-white">
              <QrCode className="h-4 w-4 text-electric" /> Conectar pelo QR code
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>No celular da barbearia, abra o WhatsApp.</li>
              <li>
                Toque em <strong>⋮</strong> (ou Configurações) → <strong>Aparelhos conectados</strong> →{" "}
                <strong>Conectar aparelho</strong>.
              </li>
              <li>Aponte a câmera para o QR code ao lado.</li>
            </ol>
            <p className="flex items-center gap-2 pt-2 font-semibold text-white">
              <Smartphone className="h-4 w-4 text-electric" /> Está no próprio celular?
            </p>
            <p>Peça um código e digite no WhatsApp em &quot;Conectar com número de telefone&quot;.</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={fone}
                onChange={(e) => setFone(e.target.value)}
                inputMode="tel"
                placeholder="(41) 9 9999-0000"
                aria-label="Número do WhatsApp da barbearia"
                className={inputCls}
              />
              <button
                type="button"
                onClick={pedirCodigo}
                disabled={pending || pedindo || fone.replace(/\D/g, "").length < 10}
                className="btn-outline label rounded-full px-4 py-3 text-electric disabled:opacity-50"
              >
                Gerar código
              </button>
            </div>
            {codigo && (
              <p className="rounded-xl border border-neon/30 bg-neon/10 px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] text-neon">
                {codigo}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConectar}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-3 text-white disabled:opacity-60"
        >
          <Link2 className="h-4 w-4" />
          {status === "WORKING" ? "Conectar / atualizar" : "Conectar"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────── Apoio ─────────────────────

function Ia({ ia }: { ia: ConexaoProps["ia"] }) {
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-white">
        <Sparkles className={`h-4 w-4 ${ia.ligada ? "text-neon" : "text-steel-400"}`} />
        {ia.ligada ? `Entende frases livres (Gemini · ${ia.modelo})` : "Frases livres: só o básico"}
      </p>
      <p className="mt-1.5 leading-relaxed text-steel-300">
        {ia.ligada
          ? 'O cliente pode escrever "quero cortar sábado de tarde" e o atendente entende — sempre confirmando antes de marcar.'
          : 'Sem IA, o atendente já entende número, "sábado", "15h" e "corte". Com uma chave grátis do Google AI Studio (GEMINI_API_KEY), entende frases inteiras.'}
      </p>
    </div>
  );
}

function Pausadas({
  pausadas,
  pending,
  onRetomar,
}: {
  pausadas: ConexaoProps["pausadas"];
  pending: boolean;
  onRetomar: (phone: string) => void;
}) {
  return (
    <div className="mt-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <PauseCircle className="h-4 w-4 text-amber-300" /> Conversas com gente da barbearia
      </p>
      <p className="mt-1 text-xs text-steel-400">
        Alguém respondeu pelo celular, então o atendente ficou quieto nessas conversas.
      </p>
      <ul className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/8">
        {pausadas.map((c) => (
          <li key={c.phone} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="min-w-0 text-steel-300">
              <span className="text-white">{c.rotulo}</span> · quieto até {c.ate}
            </span>
            <button
              type="button"
              onClick={() => onRetomar(c.phone)}
              disabled={pending}
              className="label rounded-full border border-white/12 px-3 py-2 text-xs text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
            >
              Devolver ao atendente
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Linha({ ok, titulo, children }: { ok: boolean; titulo: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-2xl border p-4 text-sm ${
        ok ? "border-neon/25 bg-neon/[0.06]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <p className={`font-semibold ${ok ? "text-neon" : "text-white"}`}>{titulo}</p>
      <p className="mt-1.5 leading-relaxed text-steel-300">{children}</p>
    </div>
  );
}
