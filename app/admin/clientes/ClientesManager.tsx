"use client";

import { useState, useTransition } from "react";
import {
  CalendarClock,
  Crown,
  Download,
  KeyRound,
  Link2,
  Loader2,
  Phone,
  RefreshCw,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import {
  Card,
  notify,
  Feedback,
  SelectInput,
  type Msg,
} from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import {
  createSubscriptionCharge,
  importClients,
  subscribeClient,
  cancelSubscription,
  renewSubscription,
  resetUserPassword,
} from "../actions";

type ClientRow = {
  id: number;
  name: string;
  phone: string;
  plan: string | null;
  overduePlan: string | null;
  renewsAt: string | null;
  visits: number;
  lastVisit: string | null;
  hasAccount: boolean;
  hasFixedSlot: boolean;
};

export function ClientesManager({
  clients,
  plans,
}: {
  clients: ClientRow[];
  plans: { id: number; name: string }[];
}) {
  const [q, setQ] = useState("");
  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.phone.includes(q.replace(/\D/g, ""))
  );

  return (
    <div className="space-y-5">
      <ImportBox />

      <Card title="Clientes" desc={`${clients.length} cadastrado(s)`}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          aria-label="Buscar cliente"
          className="mb-4 w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
        />

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhum cliente encontrado.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((c) => (
              <ClientRowItem key={c.id} client={c} plans={plans} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ClientRowItem({
  client,
  plans,
}: {
  client: ClientRow;
  plans: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(String(plans[0]?.id ?? ""));
  const [cycle, setCycle] = useState<"MENSAL" | "ANUAL">("MENSAL");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function assinar() {
    setMsg(null);
    start(async () => {
      const res = await subscribeClient({
        userId: client.id,
        planId: Number(planId),
        cycle,
      });
      setMsg(notify(res, "Ativada."));
      if (res.ok) setOpen(false);
    });
  }

  function cancelar() {
    start(async () => {
      const res = await cancelSubscription(client.id);
      if (!res.ok) setMsg({ ok: false, text: res.error });
    });
  }

  function renovar() {
    setMsg(null);
    start(async () => {
      const res = await renewSubscription(client.id);
      setMsg(notify(res, "Renovada."));
    });
  }

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  function redefinir() {
    setMsg(null);
    start(async () => {
      const res = await resetUserPassword({ userId: client.id, password: pw });
      setMsg(notify(res, "Senha redefinida."));
      if (res.ok) {
        setPw("");
        setPwOpen(false);
      }
    });
  }

  return (
    <li className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
          {client.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-white">{client.name}</span>
            {client.hasFixedSlot && (
              <span
                className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2 py-1 text-electric"
                title="Tem horário fixo reservado"
              >
                <CalendarClock className="h-3 w-3" />
                Fixo
              </span>
            )}
            {client.hasAccount && (
              <span
                className="label inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-steel-400"
                title="Já criou senha no app"
              >
                <UserCheck className="h-3 w-3" />
                Conta
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-steel-400">
            <Phone className="h-3 w-3 flex-none" />
            <span className="truncate">{formatPhone(client.phone)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {client.plan ? (
              <span className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2.5 py-1.5 text-electric">
                <Crown className="h-3 w-3" />
                {client.plan.replace("Plano ", "")}
                {client.renewsAt && (
                  <span className="text-electric/70"> · renova {client.renewsAt}</span>
                )}
              </span>
            ) : client.overduePlan ? (
              <span className="label inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1.5 text-amber-300">
                <Crown className="h-3 w-3" />
                {client.overduePlan.replace("Plano ", "")} · vencido
              </span>
            ) : (
              <span className="label rounded-full bg-white/5 px-2.5 py-1.5 text-steel-300">
                Avulso
              </span>
            )}
            <span className="text-xs text-steel-400">
              {client.visits} visita(s)
              {client.lastVisit ? ` · última em ${client.lastVisit}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => setPwOpen((v) => !v)}
            aria-label="Redefinir senha"
            title="Redefinir senha"
            className="grid h-8 w-8 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-electric/40 hover:text-electric"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </button>
          {client.plan || client.overduePlan ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={renovar}
                disabled={pending}
                title="Registrar pagamento e renovar"
                className="label inline-flex items-center gap-1 rounded-full border border-electric/40 bg-electric/10 px-3 py-2 text-electric disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Renovar
              </button>
              <Cobrar userId={client.id} />
              {client.plan && (
                <button
                  type="button"
                  onClick={cancelar}
                  disabled={pending}
                  aria-label="Cancelar plano"
                  title="Cancelar plano"
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="label rounded-full border border-electric/40 bg-electric/10 px-3 py-2 text-electric"
            >
              {open ? "Fechar" : "Assinar"}
            </button>
          )}
        </div>
      </div>

      {pwOpen && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-white/8 pt-3">
          <input
            type="text"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Nova senha (mínimo 6)"
            aria-label="Nova senha"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
          <button
            type="button"
            onClick={redefinir}
            disabled={pending || pw.trim().length < 6}
            className="btn-royal label rounded-xl px-4 py-3 text-white disabled:opacity-40"
          >
            Definir senha
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3 grid gap-3 border-t border-white/8 pt-3 sm:grid-cols-3">
          <SelectInput
            label="Plano"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Ciclo"
            value={cycle}
            onChange={(e) => setCycle(e.target.value as "MENSAL" | "ANUAL")}
          >
            <option value="MENSAL">Mensal</option>
            <option value="ANUAL">Anual</option>
          </SelectInput>
          <div className="flex items-end">
            <button
              type="button"
              onClick={assinar}
              disabled={pending}
              className="btn-royal label inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-white disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ativar assinatura
            </button>
          </div>
        </div>
      )}
      <Feedback msg={msg} />
    </li>
  );
}

function Cobrar({ userId }: { userId: number }) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="label inline-flex items-center gap-1.5 rounded-full border border-neon/40 bg-neon/10 px-3 py-2 text-neon"
      >
        <Link2 className="h-3 w-3" />
        Abrir cobrança
      </a>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        title="Gerar link de pagamento do próximo ciclo"
        onClick={() => {
          setErr(null);
          start(async () => {
            const r = await createSubscriptionCharge(userId);
            if (r.ok) setUrl(r.url);
            else setErr(r.error);
          });
        }}
        className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-electric/45 hover:text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Link2 className="h-3 w-3" />
        )}
        Cobrar
      </button>
      {err && (
        <span className="max-w-[220px] text-right text-xs text-amber-200">{err}</span>
      )}
    </span>
  );
}

function ImportBox() {
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pending, start] = useTransition();

  function run() {
    setMsg(null);
    setSkipped([]);
    start(async () => {
      const res = await importClients(csv);
      if (res.ok) {
        setMsg({ ok: true, text: res.message ?? "Importado." });
        setSkipped(res.skipped ?? []);
        setCsv("");
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  return (
    <Card
      title="Importar clientes do sistema antigo"
      desc="CSV com as colunas nome, telefone e (opcional) e-mail. Quem já existe é atualizado pelo telefone, sem duplicar."
      icon={<Upload className="h-5 w-5" />}
    >
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        onChange={onFile}
        aria-label="Arquivo CSV"
        className="mb-3 block w-full text-sm text-steel-300 file:mr-4 file:rounded-full file:border-0 file:bg-electric/15 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:uppercase file:tracking-widest file:text-electric hover:file:bg-electric/25"
      />
      <textarea
        rows={5}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={"nome,telefone,email\nJoão Silva,(11) 99999-0000,joao@email.com"}
        className="w-full resize-none rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <button
        type="button"
        onClick={run}
        disabled={pending || csv.trim().length === 0}
        className="btn-royal label mt-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-40"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Importar
      </button>
      <a
        href="/api/relatorios/clientes"
        className="btn-outline label ml-3 inline-flex items-center gap-2 rounded-full px-5 py-3 text-electric"
      >
        <Download className="h-4 w-4" />
        Exportar
      </a>
      <Feedback msg={msg} />

      {skipped.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5">
          <p className="label flex items-center gap-2 text-amber-200">
            <X className="h-3.5 w-3.5" />
            {skipped.length} linha(s) ignorada(s)
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-200/80">
            {skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
