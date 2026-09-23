"use client";

// O WhatsApp da barbearia: qual está ligado, se está conectado e — no
// WAHA — o QR code para conectar sem sair do painel.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Link2, PauseCircle, QrCode, RefreshCw, Smartphone, Sparkles } from "lucide-react";
import { Card, Feedback, notify, type Msg } from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import {
  conectarWhatsapp,
  codigoDoWhatsapp,
  retomarConversaWhatsapp,
} from "../actions";

export type ConexaoProps = {
  provedor: "waha" | "meta" | null;
  waha: {
    configurado: boolean;
    falta: string[];
    status: string | null;
    numero: string | null;
    nome: string | null;
    webhookCerto: boolean | null;
    erro: string | null;
    webhook: string;
  };
  meta: { configurado: boolean; falta: string[] };
  ia: { ligada: boolean; modelo: string };
  pausadas: { phone: string; rotulo: string; ate: string }[];
};

const STATUS: Record<string, string> = {
  WORKING: "Conectado",
  SCAN_QR_CODE: "Esperando o QR code",
  STARTING: "Ligando…",
  STOPPED: "Desligado",
  FAILED: "Caiu — aperte Conectar",
  NAO_EXISTE: "Ainda não conectado",
  FORA_DO_AR: "O servidor do WAHA não respondeu",
  SEM_ACESSO: "O WAHA recusou a chave",
  PASSKEY_REQUIRED: "O WhatsApp pediu a chave de acesso no celular",
  PASSKEY_CONFIRMATION_REQUIRED: "Confirme o acesso no celular",
};

export function ConexaoWhatsapp(p: ConexaoProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [fone, setFone] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [qrVersao, setQrVersao] = useState(0);

  const status = p.waha.status;
  const esperando = status === "SCAN_QR_CODE" || status === "STARTING" || status?.startsWith("PASSKEY");

  // Enquanto espera o QR, o painel se atualiza sozinho: o código troca a
  // cada ~20s e, depois de escanear, o "Conectado" aparece sem recarregar.
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(() => {
      setQrVersao((v) => v + 1);
      router.refresh();
    }, 8000);
    return () => clearInterval(t);
  }, [esperando, router]);

  function conectar() {
    setMsg(null);
    start(async () => {
      setMsg(notify(await conectarWhatsapp(), "Conectando…"));
      router.refresh();
    });
  }

  function pedirCodigo() {
    setMsg(null);
    setCodigo(null);
    start(async () => {
      const r = await codigoDoWhatsapp(fone);
      if (r.ok) setCodigo(r.codigo);
      else setMsg({ ok: false, text: r.error });
    });
  }

  function retomar(phone: string) {
    start(async () => {
      setMsg(notify(await retomarConversaWhatsapp(phone)));
      router.refresh();
    });
  }

  return (
    <Card
      title="WhatsApp da barbearia"
      desc="Quem manda mensagem marca o horário ali mesmo: escolhe serviço, dia e hora, e o agendamento cai na agenda."
      icon={<Bot className="h-5 w-5" />}
    >
      {p.provedor === null && <SemProvedor waha={p.waha} meta={p.meta} />}

      {p.provedor === "meta" && (
        <Linha ok titulo="Cloud API da Meta (oficial)">
          Respondendo pelo número aprovado na Meta, com listas e botões.
        </Linha>
      )}

      {p.provedor === "waha" && (
        <div className="space-y-4">
          <Linha
            ok={status === "WORKING"}
            titulo={`WAHA · ${STATUS[status ?? ""] ?? status ?? "—"}`}
          >
            {status === "WORKING" ? (
              <>
                Respondendo pelo número{" "}
                <strong className="whitespace-nowrap text-white">{p.waha.numero ? formatPhone(p.waha.numero) : "—"}</strong>
                {p.waha.nome ? ` (${p.waha.nome})` : ""}. Os menus saem numerados — o
                cliente responde &quot;1&quot;, &quot;2&quot;… ou escreve.
              </>
            ) : (
              (p.waha.erro ?? "Conecte o número da barbearia para o atendente começar a responder.")
            )}
          </Linha>

          {status === "WORKING" && p.waha.webhookCerto === false && (
            <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
              O WAHA está conectado, mas não está mandando as mensagens para este
              site. Aperte <strong>Conectar / atualizar</strong> para acertar.
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
                    Toque em <strong>⋮</strong> (ou Configurações) →{" "}
                    <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong>.
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
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
                  />
                  <button
                    type="button"
                    onClick={pedirCodigo}
                    disabled={pending || fone.replace(/\D/g, "").length < 10}
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
              onClick={conectar}
              disabled={pending}
              className="btn-royal label inline-flex items-center gap-2 rounded-full px-4 py-3 text-white disabled:opacity-60"
            >
              <Link2 className="h-4 w-4" />
              {status === "WORKING" ? "Conectar / atualizar" : "Conectar"}
            </button>
            <button
              type="button"
              onClick={() => router.refresh()}
              disabled={pending}
              className="label inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-3 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" /> Ver situação
            </button>
          </div>
        </div>
      )}

      {/* O intérprete de frases livres */}
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-white">
          <Sparkles className={`h-4 w-4 ${p.ia.ligada ? "text-neon" : "text-steel-400"}`} />
          {p.ia.ligada ? `Entende frases livres (Gemini · ${p.ia.modelo})` : "Frases livres: só o básico"}
        </p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          {p.ia.ligada
            ? 'O cliente pode escrever "quero cortar sábado de tarde" e o atendente entende — sempre confirmando antes de marcar.'
            : 'Sem IA, o atendente já entende número, "sábado", "15h" e "corte". Com uma chave grátis do Google AI Studio (GEMINI_API_KEY), entende frases inteiras.'}
        </p>
      </div>

      {p.pausadas.length > 0 && (
        <div className="mt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <PauseCircle className="h-4 w-4 text-amber-300" /> Conversas com gente da barbearia
          </p>
          <p className="mt-1 text-xs text-steel-400">
            Alguém respondeu pelo celular, então o atendente ficou quieto nessas conversas.
          </p>
          <ul className="mt-3 divide-y divide-white/5 rounded-2xl border border-white/8">
            {p.pausadas.map((c) => (
              <li key={c.phone} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 text-steel-300">
                  <span className="text-white">{c.rotulo}</span> · quieto até {c.ate}
                </span>
                <button
                  type="button"
                  onClick={() => retomar(c.phone)}
                  disabled={pending}
                  className="label rounded-full border border-white/12 px-3 py-2 text-xs text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
                >
                  Devolver ao atendente
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Feedback msg={msg} />
    </Card>
  );
}

function SemProvedor({ waha, meta }: Pick<ConexaoProps, "waha" | "meta">) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-electric/25 bg-electric/[0.05] p-4 text-sm">
        <p className="font-semibold text-white">Grátis — WAHA</p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          Usa o número de sempre, conectado por QR code num servidor da barbearia.
          Sem custo por mensagem. Não é oficial: evite disparos em massa.
        </p>
        <p className="mt-2 text-xs text-steel-400">
          Falta na Vercel: {waha.falta.join(", ")}. Passo a passo em{" "}
          <code className="rounded bg-black/30 px-1">deploy/waha</code>.
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
        <p className="font-semibold text-white">Oficial — Cloud API da Meta</p>
        <p className="mt-1.5 leading-relaxed text-steel-300">
          Número aprovado pela Meta, com listas e botões. Responder quem escreveu é
          grátis; lembrete é cobrado por mensagem.
        </p>
        <p className="mt-2 text-xs text-steel-400">Falta na Vercel: {meta.falta.join(", ")}.</p>
      </div>
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
