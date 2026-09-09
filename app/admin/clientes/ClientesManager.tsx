"use client";

import { useState, useTransition } from "react";
import { Crown, Loader2, Phone, Upload, UserCheck, X } from "lucide-react";
import {
  Card,
  Feedback,
  SelectInput,
  type Msg,
} from "@/components/admin/Feedback";
import { formatPhone } from "@/lib/phone";
import { importClients, subscribeClient, cancelSubscription } from "../actions";

type ClientRow = {
  id: number;
  name: string;
  phone: string;
  plan: string | null;
  visits: number;
  lastVisit: string | null;
  hasAccount: boolean;
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
      setMsg(
        res.ok
          ? { ok: true, text: res.message ?? "Ativada." }
          : { ok: false, text: res.error }
      );
      if (res.ok) setOpen(false);
    });
  }

  function cancelar() {
    start(async () => {
      const res = await cancelSubscription(client.id);
      if (!res.ok) setMsg({ ok: false, text: res.error });
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
          {client.plan ? (
            <button
              type="button"
              onClick={cancelar}
              disabled={pending}
              className="label rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Cancelar plano"
              )}
            </button>
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
      icon={Upload}
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
