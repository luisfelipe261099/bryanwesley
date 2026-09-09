"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Loader2, Save, X } from "lucide-react";
import { saveRecurringSlot, cancelRecurringSlot } from "./actions";

const WEEKDAYS = [
  { i: 0, l: "Dom" },
  { i: 1, l: "Seg" },
  { i: 2, l: "Ter" },
  { i: 3, l: "Qua" },
  { i: 4, l: "Qui" },
  { i: 5, l: "Sex" },
  { i: 6, l: "Sáb" },
];

type Existing = {
  frequency: string;
  weekday: number | null;
  dayOfMonth: number | null;
  minutesOfDay: number;
  barberId: number;
  serviceIds: number[];
} | null;

function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}

export function HorarioFixo({
  team,
  services,
  existing,
  closedWeekdays,
}: {
  team: { id: number; name: string }[];
  services: { id: number; name: string }[];
  existing: Existing;
  closedWeekdays: number[];
}) {
  const [open, setOpen] = useState(false);
  const [freq, setFreq] = useState<"SEMANAL" | "MENSAL">(
    (existing?.frequency as "SEMANAL" | "MENSAL") ?? "SEMANAL"
  );
  const [weekday, setWeekday] = useState(existing?.weekday ?? 4);
  const [dayOfMonth, setDayOfMonth] = useState(existing?.dayOfMonth ?? 5);
  const [time, setTime] = useState(hhmm(existing?.minutesOfDay ?? 600));
  const [barberId, setBarberId] = useState(existing?.barberId ?? team[0]?.id);
  const [picked, setPicked] = useState<number[]>(
    existing?.serviceIds ?? (services[0] ? [services[0].id] : [])
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await saveRecurringSlot({
        barberId,
        frequency: freq,
        weekday: freq === "SEMANAL" ? weekday : null,
        dayOfMonth: freq === "MENSAL" ? dayOfMonth : null,
        minutesOfDay: toMin(time),
        serviceIds: picked,
      });
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  }

  const resumo = existing
    ? existing.frequency === "MENSAL"
      ? `Todo dia ${existing.dayOfMonth} às ${hhmm(existing.minutesOfDay)}`
      : `Toda ${WEEKDAYS.find((w) => w.i === existing.weekday)?.l ?? ""}. às ${hhmm(
          existing.minutesOfDay
        )}`
    : null;

  return (
    <div className="glass rounded-3xl p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-electric" />
          <h3 className="font-display text-lg text-white">Seu horário fixo</h3>
        </div>
        {existing && (
          <span className="label rounded-full bg-neon/10 px-2.5 py-1.5 text-neon">
            Reservado
          </span>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-steel-400">
        {existing
          ? `${resumo} — já reservado nas próximas semanas. Você continua livre para marcar outros horários além dele.`
          : "Reserve o mesmo dia e hora todo mês (ou toda semana) e não dependa mais da agenda estar livre."}
      </p>

      {!open ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-outline label inline-flex items-center gap-2 rounded-full px-5 py-3 text-electric"
          >
            {existing ? "Alterar horário fixo" : "Definir horário fixo"}
          </button>
          {existing && <CancelFixo />}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex gap-2">
            {(["SEMANAL", "MENSAL"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFreq(f)}
                aria-pressed={freq === f}
                className={`label flex-1 rounded-full py-3 transition-all ${
                  freq === f
                    ? "btn-royal text-white"
                    : "border border-white/12 text-steel-300"
                }`}
              >
                {f === "SEMANAL" ? "Toda semana" : "Todo mês"}
              </button>
            ))}
          </div>

          {freq === "SEMANAL" ? (
            <div>
              <span className="label mb-2 block text-steel-400">Dia da semana</span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.filter((w) => !closedWeekdays.includes(w.i)).map((w) => (
                  <button
                    key={w.i}
                    type="button"
                    onClick={() => setWeekday(w.i)}
                    aria-pressed={weekday === w.i}
                    className={`label rounded-full px-4 py-2.5 transition-all ${
                      weekday === w.i
                        ? "btn-royal text-white"
                        : "border border-white/12 text-steel-300"
                    }`}
                  >
                    {w.l}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="label mb-2 block text-steel-400">Dia do mês</span>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none focus:border-electric/60"
              />
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-2 block text-steel-400">Horário</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
              />
            </label>
            <label className="block">
              <span className="label mb-2 block text-steel-400">Barbeiro</span>
              <select
                value={barberId}
                onChange={(e) => setBarberId(Number(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none [color-scheme:dark] focus:border-electric/60"
              >
                {team.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="label mb-2 block text-steel-400">Serviços</span>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      setPicked(
                        on
                          ? picked.filter((x) => x !== s.id)
                          : [...picked, s.id]
                      )
                    }
                    aria-pressed={on}
                    className={`label rounded-full px-3.5 py-2.5 transition-all ${
                      on
                        ? "border border-electric/50 bg-electric/10 text-electric"
                        : "border border-white/12 text-steel-400"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || picked.length === 0}
              className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-white disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Reservar
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="label rounded-full border border-white/12 px-5 py-3.5 text-steel-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CancelFixo() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => cancelRecurringSlot().then(() => {}))}
      className="label inline-flex items-center gap-2 rounded-full border border-white/12 px-5 py-3 text-steel-300 transition-colors hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <X className="h-3.5 w-3.5" />
      )}
      Abrir mão do fixo
    </button>
  );
}
