"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Lock, Clock, Ban, Plus, X, Power } from "lucide-react";
import {
  readAgenda,
  writeAgenda,
  toDateKey,
  defaultAgenda,
  type AgendaSettings,
} from "@/lib/agendaStore";
import { timeSlots, closedWeekdays } from "@/lib/data";

const minHoursOptions = [0, 1, 2, 4, 12, 24];

function labelForDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function GerenciarAgenda() {
  const [settings, setSettings] = useState<AgendaSettings>(defaultAgenda);
  const [mounted, setMounted] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [slotDay, setSlotDay] = useState("");

  useEffect(() => {
    setSettings(readAgenda());
    setMounted(true);
  }, []);

  const todayKey = mounted ? toDateKey(new Date()) : "";

  // Próximos dias abertos para o bloqueio de horários
  const openDays = useMemo(() => {
    if (!mounted) return [] as { key: string; label: string }[];
    const out: { key: string; label: string }[] = [];
    for (let i = 0; i < 30 && out.length < 10; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      if (closedWeekdays.includes(d.getDay())) continue;
      const key = toDateKey(d);
      out.push({ key, label: labelForDate(key) });
    }
    return out;
  }, [mounted]);

  function update(patch: Partial<AgendaSettings>) {
    const nextVal = { ...settings, ...patch };
    setSettings(nextVal);
    writeAgenda(nextVal);
  }

  function addBlockedDate() {
    if (!newDate || settings.blockedDates.includes(newDate)) return;
    update({ blockedDates: [...settings.blockedDates, newDate].sort() });
    setNewDate("");
  }
  function removeBlockedDate(key: string) {
    update({ blockedDates: settings.blockedDates.filter((d) => d !== key) });
  }
  function toggleSlot(time: string) {
    if (!slotDay) return;
    const cur = settings.blockedSlots[slotDay] ?? [];
    const arr = cur.includes(time)
      ? cur.filter((t) => t !== time)
      : [...cur, time];
    const blockedSlots = { ...settings.blockedSlots, [slotDay]: arr };
    if (arr.length === 0) delete blockedSlots[slotDay];
    update({ blockedSlots });
  }

  const blockedForDay = slotDay ? settings.blockedSlots[slotDay] ?? [] : [];

  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex items-center gap-2">
        <CalendarOff className="h-5 w-5 text-electric" />
        <h2 className="text-lg font-semibold text-white">Gerenciar agenda</h2>
      </div>
      <p className="mt-1 text-sm text-steel-400">
        Bloqueie dias e horários, pause a agenda e defina regras. Vale na hora
        para os clientes.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Coluna 1: regras gerais + bloqueio de dia */}
        <div className="space-y-5">
          {/* Aceitar agendamentos */}
          <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-3">
              <span
                className={`grid h-10 w-10 place-items-center rounded-xl ${
                  settings.acceptingBookings
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-amber-400/10 text-amber-300"
                }`}
              >
                <Power className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">
                  Aceitar novos agendamentos
                </p>
                <p className="text-xs text-steel-400">
                  {settings.acceptingBookings
                    ? "Agenda aberta"
                    : "Agenda pausada"}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.acceptingBookings}
              onClick={() =>
                update({ acceptingBookings: !settings.acceptingBookings })
              }
              className={`relative h-7 w-12 flex-none rounded-full transition-colors ${
                settings.acceptingBookings ? "bg-royal-grad" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                  settings.acceptingBookings ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          {/* Antecedência mínima */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-electric" />
              <p className="text-sm font-semibold text-white">
                Antecedência mínima
              </p>
            </div>
            <p className="mt-1 text-xs text-steel-400">
              Tempo mínimo para reservar um horário.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {minHoursOptions.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => update({ minHours: h })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    settings.minHours === h
                      ? "bg-royal-grad text-white"
                      : "border border-white/12 text-steel-300 hover:border-white/30"
                  }`}
                >
                  {h === 0 ? "Sem mínimo" : `${h}h`}
                </button>
              ))}
            </div>
          </div>

          {/* Bloquear dia inteiro */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-electric" />
              <p className="text-sm font-semibold text-white">
                Bloquear um dia (folga / feriado)
              </p>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="date"
                min={todayKey}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark] focus:border-electric/60"
              />
              <button
                type="button"
                onClick={addBlockedDate}
                disabled={!newDate}
                className="btn-royal inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Bloquear
              </button>
            </div>

            {settings.blockedDates.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {settings.blockedDates.map((key) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold capitalize text-amber-200"
                  >
                    {labelForDate(key)}
                    <button
                      type="button"
                      onClick={() => removeBlockedDate(key)}
                      aria-label={`Desbloquear ${key}`}
                      className="text-amber-200/70 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-steel-400">
                Nenhum dia bloqueado.
              </p>
            )}
          </div>
        </div>

        {/* Coluna 2: bloquear horários de um dia */}
        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-electric" />
            <p className="text-sm font-semibold text-white">
              Bloquear horários específicos
            </p>
          </div>
          <p className="mt-1 text-xs text-steel-400">
            Escolha o dia e toque nos horários que ficam indisponíveis.
          </p>

          <select
            value={slotDay}
            onChange={(e) => setSlotDay(e.target.value)}
            className="mt-3 w-full rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark] focus:border-electric/60"
          >
            <option value="">Selecione um dia…</option>
            {openDays.map((d) => (
              <option key={d.key} value={d.key} className="capitalize">
                {d.label}
              </option>
            ))}
          </select>

          {slotDay ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {timeSlots.map((slot) => {
                  const blocked = blockedForDay.includes(slot.time);
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => toggleSlot(slot.time)}
                      className={`rounded-lg border py-2.5 text-center text-xs font-semibold tabular-nums transition-all ${
                        blocked
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-200 line-through"
                          : "border-white/10 bg-white/[0.02] text-white hover:border-white/30"
                      }`}
                    >
                      {slot.time}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-steel-400">
                {blockedForDay.length} horário(s) bloqueado(s) neste dia.
              </p>
            </>
          ) : (
            <p className="mt-4 text-xs text-steel-400">
              Selecione um dia para liberar/bloquear horários.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
