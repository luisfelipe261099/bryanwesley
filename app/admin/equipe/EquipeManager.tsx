"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Target, UserPlus, X } from "lucide-react";
import {
  Card,
  notify,
  Feedback,
  SelectInput,
  TextInput,
  Toggle,
  type Msg,
} from "@/components/admin/Feedback";
import { formatBRL } from "@/lib/money";
import { resetUserPassword } from "../actions";
import {
  createBarber,
  updateBarber,
  upsertCommissionTier,
  removeCommissionTier,
  setBarberHours,
} from "../actions";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type BarberRow = {
  id: number;
  name: string;
  shortName: string;
  title: string;
  commissionPct: number;
  monthlyGoalCents: number;
  active: boolean;
  baseCents: number;
  barberCents: number;
  atendimentos: number;
  hours: { weekday: number; openMinute: number; closeMinute: number }[];
};

function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export function EquipeManager({
  team,
  tiers,
}: {
  team: BarberRow[];
  tiers: {
    id: number;
    barberId: number | null;
    minRevenueCents: number;
    barberPct: number;
    label: string | null;
  }[];
}) {
  return (
    <div className="space-y-5">
      {team.map((b) => (
        <BarberCard key={b.id} barber={b} />
      ))}
      <NewBarber />
      <Tiers tiers={tiers} team={team} />
    </div>
  );
}

function BarberCard({ barber }: { barber: BarberRow }) {
  const [form, setForm] = useState(barber);
  const [goal, setGoal] = useState(
    (barber.monthlyGoalCents / 100).toFixed(2).replace(".", ",")
  );
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateBarber({
        id: barber.id,
        shortName: form.shortName,
        title: form.title,
        commissionPct: form.commissionPct,
        monthlyGoalCents: Math.round(Number(goal.replace(/\./g, "").replace(",", ".")) * 100) || 0,
        active: form.active,
      });
      setMsg(notify(res, "Salvo."));
    });
  }

  return (
    <Card title={barber.name} desc={`${barber.atendimentos} atendimento(s) no mês`}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput
          label="Nome curto"
          value={form.shortName}
          onChange={(e) => setForm({ ...form, shortName: e.target.value })}
        />
        <TextInput
          label="Cargo"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <TextInput
          label="Comissão base (%)"
          type="number"
          min={0}
          max={100}
          value={form.commissionPct}
          onChange={(e) =>
            setForm({ ...form, commissionPct: Number(e.target.value) })
          }
        />
        <TextInput
          label="Meta de comissão no mês (R$)"
          inputMode="decimal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <Toggle
          checked={form.active}
          onChange={(v) => setForm({ ...form, active: v })}
          label="Ativo na agenda"
          hint={
            form.active
              ? "Aparece para os clientes"
              : "Some da escolha de barbeiro"
          }
        />
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-white">Resultado do mês</p>
        </div>
        <p className="text-sm text-steel-300">
          Gerou{" "}
          <span className="font-semibold text-white">
            {formatBRL(form.baseCents)}
          </span>
        </p>
        <p className="text-sm text-steel-300">
          Comissão{" "}
          <span className="font-semibold text-electric">
            {formatBRL(form.barberCents)}
          </span>
        </p>
      </div>

      <BarberHours barberId={barber.id} hours={barber.hours} />

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="btn-royal label mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Salvar
      </button>
      <Feedback msg={msg} />
    </Card>
  );
}

function BarberHours({
  barberId,
  hours,
}: {
  barberId: number;
  hours: { weekday: number; openMinute: number; closeMinute: number }[];
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const map = new Map(hours.map((h) => [h.weekday, h]));

  function save(weekday: number, open: string, close: string, clear = false) {
    setMsg(null);
    start(async () => {
      const res = await setBarberHours({
        barberId,
        weekday,
        openMinute: clear ? null : toMin(open),
        closeMinute: clear ? null : toMin(close),
      });
      setMsg(notify(res, "Salvo."));
    });
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <p className="text-sm font-semibold text-white">Jornada própria</p>
      <p className="mt-1 text-xs text-steel-400">
        Deixe em branco para seguir o horário geral da loja.
      </p>
      <div className="mt-3 space-y-2">
        {WEEKDAYS.map((d, i) => {
          const h = map.get(i);
          return (
            <div key={d} className="flex flex-wrap items-center gap-2">
              <span className="label w-10 flex-none text-steel-400">{d}</span>
              <input
                type="time"
                defaultValue={h ? hhmm(h.openMinute) : ""}
                id={`o-${barberId}-${i}`}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
              />
              <span className="text-steel-400">—</span>
              <input
                type="time"
                defaultValue={h ? hhmm(h.closeMinute) : ""}
                id={`c-${barberId}-${i}`}
                className="rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-electric/60"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const o = (
                    document.getElementById(`o-${barberId}-${i}`) as HTMLInputElement
                  ).value;
                  const c = (
                    document.getElementById(`c-${barberId}-${i}`) as HTMLInputElement
                  ).value;
                  save(i, o, c, !o || !c);
                }}
                className="label rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-electric/40 hover:text-white disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
          );
        })}
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

function NewBarber() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: "",
    shortName: "",
    title: "Barbeiro",
    phone: "",
    email: "",
    password: "",
    commissionPct: 50,
    isAdmin: false,
  });

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await createBarber(f);
      setMsg(notify(res, "Cadastrado."));
      if (res.ok) {
        setF({ ...f, name: "", shortName: "", phone: "", email: "", password: "" });
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline label inline-flex w-full items-center justify-center gap-2 rounded-2xl py-5 text-electric"
      >
        <UserPlus className="h-4 w-4" />
        Cadastrar barbeiro
      </button>
    );
  }

  return (
    <Card title="Novo barbeiro" icon={<UserPlus className="h-5 w-5" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Nome completo"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <TextInput
          label="Nome curto"
          value={f.shortName}
          placeholder="Ex.: Lucas S."
          onChange={(e) => setF({ ...f, shortName: e.target.value })}
        />
        <TextInput
          label="Cargo"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <TextInput
          label="WhatsApp"
          value={f.phone}
          placeholder="(11) 9 0000-0000"
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
        <TextInput
          label="E-mail (login)"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <TextInput
          label="Senha inicial"
          type="password"
          value={f.password}
          onChange={(e) => setF({ ...f, password: e.target.value })}
        />
        <TextInput
          label="Comissão (%)"
          type="number"
          min={0}
          max={100}
          value={f.commissionPct}
          onChange={(e) => setF({ ...f, commissionPct: Number(e.target.value) })}
        />
      </div>
      <div className="mt-4">
        <Toggle
          checked={f.isAdmin}
          onChange={(v) => setF({ ...f, isAdmin: v })}
          label="Também é administrador"
          hint="Dá acesso ao painel de gestão"
        />
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Cadastrar
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="label rounded-full border border-white/12 px-5 py-3 text-steel-300"
        >
          Cancelar
        </button>
      </div>
      <Feedback msg={msg} />
    </Card>
  );
}

function Tiers({
  tiers,
  team,
}: {
  tiers: {
    id: number;
    barberId: number | null;
    minRevenueCents: number;
    barberPct: number;
    label: string | null;
  }[];
  team: BarberRow[];
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ barberId: "", meta: "", pct: 60, label: "" });

  function add() {
    setMsg(null);
    start(async () => {
      const res = await upsertCommissionTier({
        barberId: f.barberId ? Number(f.barberId) : null,
        minRevenueCents: Math.round(Number(f.meta.replace(",", ".")) * 100),
        barberPct: f.pct,
        label: f.label,
      });
      setMsg(notify(res, "Salvo."));
      if (res.ok) setF({ ...f, meta: "", label: "" });
    });
  }

  return (
    <Card
      title="Faixas de meta"
      desc="Quando o barbeiro passa do valor gerado no mês, o percentual dele sobe. Sem faixa, vale a comissão base."
      icon={<Target className="h-5 w-5" />}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <SelectInput
          label="Quem"
          value={f.barberId}
          onChange={(e) => setF({ ...f, barberId: e.target.value })}
        >
          <option value="">Todos</option>
          {team.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="A partir de (R$ gerados)"
          inputMode="decimal"
          value={f.meta}
          placeholder="8000"
          onChange={(e) => setF({ ...f, meta: e.target.value })}
        />
        <TextInput
          label="Comissão (%)"
          type="number"
          min={0}
          max={100}
          value={f.pct}
          onChange={(e) => setF({ ...f, pct: Number(e.target.value) })}
        />
        <TextInput
          label="Rótulo"
          value={f.label}
          placeholder="Ex.: Meta ouro"
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
      </div>
      <button
        type="button"
        onClick={add}
        disabled={pending || !f.meta}
        className="btn-royal label mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        Adicionar faixa
      </button>
      <Feedback msg={msg} />

      <ul className="mt-5 space-y-2 border-t border-white/8 pt-5">
        {tiers.length === 0 ? (
          <p className="text-sm text-steel-400">
            Nenhuma faixa. Todos seguem a comissão base.
          </p>
        ) : (
          tiers.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  {t.label || "Faixa"} · {t.barberPct}%
                </p>
                <p className="text-xs text-steel-400">
                  {t.barberId
                    ? team.find((b) => b.id === t.barberId)?.shortName
                    : "Todos"}{" "}
                  · a partir de {formatBRL(t.minRevenueCents)}
                </p>
              </div>
              <TierRemove id={t.id} />
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

function TierRemove({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => removeCommissionTier(id).then(() => {}))}
      aria-label="Remover faixa"
      className="flex-none text-steel-400 transition-colors hover:text-red-200 disabled:opacity-40"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <X className="h-4 w-4" />
      )}
    </button>
  );
}
