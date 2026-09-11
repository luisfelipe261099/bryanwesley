"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertCircle, CalendarClock, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { toast } from "@/lib/toast";
import { fetchAvailability } from "@/app/agendar/actions";
import { rescheduleMyAppointment } from "./actions";
import type { Slot } from "@/lib/schedule";
import type { DayOption } from "@/lib/schedule";

export function Remarcar({
  appointmentId,
  durationMin,
  barberId,
  days,
  team,
}: {
  appointmentId: number;
  durationMin: number;
  barberId: number;
  days: DayOption[];
  team: { id: number; shortName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [dateKey, setDateKey] = useState(days[0]?.dateKey ?? null);
  const [who, setWho] = useState<number>(barberId);
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !dateKey) return;
    let cancelled = false;
    setLoading(true);
    fetchAvailability({ dateKey, durationMin, barberId: who })
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        setTime(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, dateKey, who, durationMin]);

  function submit() {
    if (!dateKey || !time) return;
    setError(null);
    start(async () => {
      const res = await rescheduleMyAppointment({
        appointmentId,
        dateKey,
        time,
        barberId: who,
      });
      if (res.ok) {
        toast("Horário remarcado.", "ok");
        setOpen(false);
      } else setError(res.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-electric/45 hover:text-white"
      >
        <CalendarClock className="h-3 w-3" />
        Remarcar
      </button>

      <Modal open={open} onClose={() => setOpen(false)} label="Remarcar horário">
        <div>
          <span className="label mb-2 block text-steel-400">Barbeiro</span>
          <div className="flex flex-wrap gap-2">
            {team.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setWho(b.id)}
                aria-pressed={who === b.id}
                className={`label rounded-full px-3.5 py-2.5 transition-all ${
                  who === b.id
                    ? "btn-royal text-white"
                    : "border border-white/12 text-steel-300"
                }`}
              >
                {b.shortName}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button
              key={d.dateKey}
              type="button"
              onClick={() => setDateKey(d.dateKey)}
              className={`flex min-w-[84px] flex-none flex-col items-center gap-1 rounded-2xl border px-3 py-2.5 transition-all ${
                dateKey === d.dateKey
                  ? "border-electric/60 bg-electric/[0.07]"
                  : "border-white/8 bg-surface/70"
              }`}
            >
              <span className="label capitalize text-steel-400">{d.weekday}</span>
              <span className="font-display text-sm text-white">{d.dayLabel}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-steel-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando a agenda…
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  disabled={!s.available}
                  onClick={() => setTime(s.time)}
                  className={`rounded-xl border py-2.5 text-center text-sm font-semibold tabular-nums transition-all ${
                    !s.available
                      ? "cursor-not-allowed border-white/5 bg-white/[0.01] text-steel-400/40 line-through"
                      : time === s.time
                        ? "btn-royal border-transparent text-white"
                        : "border-white/8 bg-surface/70 text-white hover:border-electric/45"
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
          {!loading && slots.length > 0 && slots.every((s) => !s.available) && (
            <p className="py-4 text-center text-sm text-steel-400">
              Nenhum horário livre nesse dia.
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!time || pending}
          className="btn-royal label mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-40"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar remarcação
        </button>
      </Modal>
    </>
  );
}
