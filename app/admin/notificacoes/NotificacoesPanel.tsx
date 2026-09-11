"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, Send, MessageCircle } from "lucide-react";
import { Card,
  notify,
  Feedback,
  type Msg,
} from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import { resendNotification, flushNotifications } from "../actions";

const KIND_LABEL: Record<string, string> = {
  AGENDAMENTO_CRIADO: "Confirmação",
  LEMBRETE_24H: "Lembrete 24h",
  LEMBRETE_2H: "Lembrete 2h",
  AGENDAMENTO_CANCELADO: "Cancelamento",
  AGENDAMENTO_REMARCADO: "Remarcação",
  ASSINATURA_RENOVADA: "Assinatura renovada",
  ASSINATURA_FALHOU: "Falha na assinatura",
};

const STATUS_STYLE: Record<string, string> = {
  PENDENTE: "bg-amber-400/10 text-amber-300",
  ENVIADA: "bg-neon/10 text-neon",
  ERRO: "bg-red-400/10 text-red-200",
  CANCELADA: "bg-white/5 text-steel-400",
};

export type NotifRow = {
  id: number;
  phone: string;
  kind: string;
  status: string;
  body: string;
  quando: string;
  error: string | null;
  attempts: number;
};

export function NotificacoesPanel({
  stats,
  rows,
  configured,
}: {
  stats: { pendentes: number; enviadas: number; erros: number; canceladas: number };
  rows: NotifRow[];
  configured: boolean;
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-5">
      {!configured && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-200">
          <p className="font-semibold">WhatsApp ainda não configurado</p>
          <p className="mt-1.5 leading-relaxed text-amber-200/85">
            O sistema continua funcionando: as mensagens ficam gravadas na fila
            e são enviadas assim que as variáveis{" "}
            <code className="rounded bg-black/30 px-1">WHATSAPP_TOKEN</code> e{" "}
            <code className="rounded bg-black/30 px-1">
              WHATSAPP_PHONE_NUMBER_ID
            </code>{" "}
            forem preenchidas. Nenhuma mensagem se perde.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Na fila" value={stats.pendentes} tone="amber" />
        <Stat label="Enviadas" value={stats.enviadas} tone="neon" />
        <Stat label="Com erro" value={stats.erros} tone="red" />
        <Stat label="Canceladas" value={stats.canceladas} tone="steel" />
      </div>

      <Card
        title="Fila de mensagens"
        desc="Confirmações e lembretes de cada agendamento."
        icon={<MessageCircle className="h-5 w-5" />}
      >
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMsg(null);
            start(async () => {
              const r = await flushNotifications();
              setMsg(notify(r, "Enviado."));
            });
          }}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar agora ({stats.pendentes})
        </button>
        <Feedback msg={msg} />

        {rows.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhuma mensagem ainda.
          </p>
        ) : (
          <ul className="mt-5 space-y-2">
            {rows.map((n) => (
              <li
                key={n.id}
                className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="label text-steel-200">
                      {KIND_LABEL[n.kind] ?? n.kind}
                    </span>
                    <span className="text-xs text-steel-400">
                      {formatPhone(n.phone)}
                    </span>
                    <span className="text-xs text-steel-400/70">{n.quando}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`label rounded-full px-2.5 py-1.5 ${
                        STATUS_STYLE[n.status] ?? ""
                      }`}
                    >
                      {n.status.toLowerCase()}
                    </span>
                    {n.status === "ERRO" && <Resend id={n.id} />}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-steel-300">
                  {n.body}
                </p>
                {n.error && (
                  <p className="mt-1.5 text-xs text-red-200/80">
                    {n.attempts} tentativa(s) · {n.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Resend({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => resendNotification(id).then(() => {}))}
      className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-electric/45 hover:text-white disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      Reenviar
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "neon" | "red" | "steel";
}) {
  const color = {
    amber: "text-amber-300",
    neon: "text-neon",
    red: "text-red-200",
    steel: "text-steel-400",
  }[tone];
  return (
    <div className="glass rounded-2xl p-5">
      <div className={`font-display text-2xl ${color}`}>{value}</div>
      <div className="mt-1 text-sm text-steel-400">{label}</div>
    </div>
  );
}
