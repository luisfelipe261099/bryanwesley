"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Clock, Loader2, Plus, Power, X } from "lucide-react";
import type { Settings } from "@/db/schema";
import { saveSettings, addBlock, removeBlock } from "../actions";
import {
  Card,
  Feedback,
  SelectInput,
  TextInput,
  Toggle,
  type Msg,
} from "@/components/admin/Feedback";
import { minutesToHHMM } from "@/lib/time";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ADVANCE = [0, 1, 2, 4, 12, 24, 48];

function hhmmToMinutes(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export function AgendaSettings({ settings }: { settings: Settings }) {
  const [form, setForm] = useState(settings);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function patch(p: Partial<Settings>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveSettings({
        acceptingBookings: form.acceptingBookings,
        minAdvanceHours: form.minAdvanceHours,
        slotMinutes: form.slotMinutes,
        openMinute: form.openMinute,
        closeMinute: form.closeMinute,
        closedWeekdays: form.closedWeekdays,
        maxAdvanceDays: form.maxAdvanceDays,
        defaultBarberPct: form.defaultBarberPct,
      });
      setMsg(
        res.ok
          ? { ok: true, text: res.message ?? "Salvo." }
          : { ok: false, text: res.error }
      );
    });
  }

  return (
    <Card
      title="Regras da agenda"
      desc="Vale na hora para todos os clientes."
      icon={CalendarOff}
    >
      <div className="space-y-5">
        <Toggle
          checked={form.acceptingBookings}
          onChange={(v) => patch({ acceptingBookings: v })}
          label="Aceitar novos agendamentos"
          hint={form.acceptingBookings ? "Agenda aberta" : "Agenda pausada"}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Abertura"
            type="time"
            value={minutesToHHMM(form.openMinute)}
            onChange={(e) => patch({ openMinute: hhmmToMinutes(e.target.value) })}
          />
          <TextInput
            label="Fechamento"
            type="time"
            value={minutesToHHMM(form.closeMinute)}
            onChange={(e) => patch({ closeMinute: hhmmToMinutes(e.target.value) })}
          />
        </div>

        <div>
          <span className="label mb-2 block text-steel-400">
            Dias fechados
          </span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d, i) => {
              const off = form.closedWeekdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={off}
                  onClick={() =>
                    patch({
                      closedWeekdays: off
                        ? form.closedWeekdays.filter((w) => w !== i)
                        : [...form.closedWeekdays, i].sort(),
                    })
                  }
                  className={`label rounded-full px-4 py-2.5 transition-colors ${
                    off
                      ? "border border-amber-400/40 bg-amber-400/10 text-amber-200"
                      : "border border-white/12 text-steel-300 hover:border-electric/40"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="label mb-2 flex items-center gap-2 text-steel-400">
            <Clock className="h-3.5 w-3.5" />
            Antecedência mínima
          </span>
          <div className="flex flex-wrap gap-2">
            {ADVANCE.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => patch({ minAdvanceHours: h })}
                className={`label rounded-full px-4 py-2.5 transition-colors ${
                  form.minAdvanceHours === h
                    ? "btn-royal text-white"
                    : "border border-white/12 text-steel-300 hover:border-electric/40"
                }`}
              >
                {h === 0 ? "Sem mínimo" : `${h}h`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SelectInput
            label="Intervalo entre horários"
            value={form.slotMinutes}
            onChange={(e) => patch({ slotMinutes: Number(e.target.value) })}
          >
            {[10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Janela de agendamento (dias)"
            type="number"
            min={1}
            max={365}
            value={form.maxAdvanceDays}
            onChange={(e) => patch({ maxAdvanceDays: Number(e.target.value) })}
          />
          <TextInput
            label="Comissão padrão (%)"
            type="number"
            min={0}
            max={100}
            value={form.defaultBarberPct}
            onChange={(e) => patch({ defaultBarberPct: Number(e.target.value) })}
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar regras
        </button>
        <Feedback msg={msg} />
      </div>
    </Card>
  );
}

export function BlocksManager({
  blocks,
  team,
  today,
}: {
  blocks: {
    id: number;
    barberId: number | null;
    label: string;
    reason: string | null;
  }[];
  team: { id: number; shortName: string }[];
  today: string;
}) {
  const [dateKey, setDateKey] = useState(today);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("13:00");
  const [barberId, setBarberId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function create() {
    setMsg(null);
    start(async () => {
      const res = await addBlock({
        dateKey,
        startMinute: hhmmToMinutes(from),
        endMinute: hhmmToMinutes(to),
        barberId: barberId ? Number(barberId) : null,
        reason,
      });
      setMsg(
        res.ok
          ? { ok: true, text: res.message ?? "Criado." }
          : { ok: false, text: res.error }
      );
      if (res.ok) setReason("");
    });
  }

  function drop(id: number) {
    start(async () => {
      const res = await removeBlock(id);
      if (!res.ok) setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <Card
      title="Bloqueios"
      desc="Folga, feriado, almoço ou manutenção. O horário some da agenda do cliente."
      icon={Power}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <TextInput
          label="Dia"
          type="date"
          min={today}
          value={dateKey}
          onChange={(e) => setDateKey(e.target.value)}
        />
        <TextInput
          label="Das"
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextInput
          label="Até"
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <SelectInput
          label="Quem"
          value={barberId}
          onChange={(e) => setBarberId(e.target.value)}
        >
          <option value="">Barbearia toda</option>
          {team.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Motivo (opcional)"
          value={reason}
          placeholder="Ex.: almoço"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="btn-royal label mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        Bloquear
      </button>
      <Feedback msg={msg} />

      <div className="mt-5 border-t border-white/8 pt-5">
        {blocks.length === 0 ? (
          <p className="text-sm text-steel-400">Nenhum bloqueio ativo.</p>
        ) : (
          <ul className="space-y-2">
            {blocks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-amber-100">
                    {b.label}
                  </p>
                  <p className="text-xs text-amber-200/70">
                    {b.barberId
                      ? team.find((t) => t.id === b.barberId)?.shortName
                      : "Barbearia toda"}
                    {b.reason ? ` · ${b.reason}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => drop(b.id)}
                  aria-label="Remover bloqueio"
                  className="flex-none text-amber-200/70 transition-colors hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
