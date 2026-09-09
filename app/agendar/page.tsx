"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  CalendarDays,
  Sparkles,
  PartyPopper,
  Crown,
  Lock,
  Ban,
  Zap,
} from "lucide-react";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { serviceIcons } from "@/components/serviceIcons";
import {
  services,
  barbers,
  timeSlots,
  closedWeekdays,
  getPlan,
  formatBRL,
  formatDuration,
} from "@/lib/data";
import {
  readAgenda,
  onAgendaChange,
  toDateKey,
  isSlotBlocked,
  defaultAgenda,
  type AgendaSettings,
} from "@/lib/agendaStore";

type Day = {
  key: string;
  date: Date;
  weekday: string;
  dayLabel: string; // "24 Out"
  blocked: boolean;
};

const periods = [
  { label: "Manhã", test: (t: string) => t < "12:00" },
  { label: "Tarde", test: (t: string) => t >= "12:00" && t < "18:00" },
  { label: "Noite", test: (t: string) => t >= "18:00" },
];

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-ink" />}>
      <Agendar />
    </Suspense>
  );
}

function Agendar() {
  const searchParams = useSearchParams();
  const plan = getPlan(searchParams.get("plano"));
  const isSub = !!plan;

  const availableServices = useMemo(
    () =>
      isSub
        ? services.filter((s) => plan!.includedServices.includes(s.id))
        : services,
    [isSub, plan]
  );

  const [settings, setSettings] = useState<AgendaSettings>(defaultAgenda);
  const [days, setDays] = useState<Day[]>([]);

  const [selected, setSelected] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string | null>(null); // null = mais rápido
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState(isSub ? "Ricardo Mendes" : "");
  const [phone, setPhone] = useState(isSub ? "(11) 9 8812-2031" : "");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);

  // Lê as configurações do admin e re-lê quando elas mudam.
  useEffect(() => {
    setSettings(readAgenda());
    return onAgendaChange(() => setSettings(readAgenda()));
  }, []);

  // Gera os próximos dias abertos, marcando os bloqueados pelo admin.
  useEffect(() => {
    const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
    const dayFmt = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
    });
    const todayKey = toDateKey(new Date());
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    const tmrKey = toDateKey(tmr);

    const list: Day[] = [];
    for (let i = 0; i < 45 && list.length < 10; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      if (closedWeekdays.includes(d.getDay())) continue; // pula Seg/Dom
      const key = toDateKey(d);
      const weekday =
        key === todayKey
          ? "Hoje"
          : key === tmrKey
            ? "Amanhã"
            : weekdayFmt.format(d).replace(".", "");
      list.push({
        key,
        date: d,
        weekday,
        dayLabel: dayFmt.format(d).replace(".", ""),
        blocked: settings.blockedDates.includes(key),
      });
    }
    setDays(list);
  }, [settings.blockedDates]);

  const chosen = availableServices.filter((s) => selected.includes(s.id));
  const total = chosen.reduce((acc, s) => acc + s.price, 0);
  const totalMin = chosen.reduce((acc, s) => acc + s.durationMin, 0);
  const selectedDay = days.find((d) => d.key === day);
  const barber = barbers.find((b) => b.id === barberId);

  // Estado de cada horário no dia escolhido (reservado/bloqueado/antecedência).
  function slotDisabled(t: string): { off: boolean; why?: string } {
    const base = timeSlots.find((s) => s.time === t);
    if (!base?.free) return { off: true, why: "reservado" };
    if (selectedDay && isSlotBlocked(settings, selectedDay.key, t))
      return { off: true, why: "bloqueado" };
    if (selectedDay) {
      const [h, m] = t.split(":").map(Number);
      const dt = new Date(selectedDay.date);
      dt.setHours(h, m, 0, 0);
      if (dt.getTime() < Date.now() + settings.minHours * 3600_000)
        return { off: true, why: "tarde" };
    }
    return { off: false };
  }

  const canConfirm =
    settings.acceptingBookings &&
    selected.length > 0 &&
    !!day &&
    !!time &&
    name.trim().length > 1 &&
    phone.trim().length >= 8;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (done) {
    return (
      <>
        <Background />
        <TopBar isSub={isSub} planName={plan?.name} />
        <main className="mx-auto max-w-5xl px-5 pb-32 pt-24 lg:px-8">
          <Success
            name={name}
            day={selectedDay}
            time={time}
            chosen={chosen}
            total={total}
            isSub={isSub}
            planName={plan?.name}
            barberName={barber?.name ?? "Primeiro disponível"}
          />
        </main>
        <BottomNav active="inicio" />
      </>
    );
  }

  return (
    <>
      <Background />
      <TopBar isSub={isSub} planName={plan?.name} />

      <main className="mx-auto max-w-5xl px-5 pb-32 pt-24 lg:px-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl text-white sm:text-4xl">
            {isSub ? "Agendamento VIP" : "Agendamento Rápido"}
          </h1>
          <p className="mt-2 text-sm text-steel-400">
            {isSub
              ? `Seu ${plan!.name} cobre estes serviços — escolha o que quer hoje.`
              : "Apenas nome e WhatsApp para confirmar. Sem cadastro, sem senha."}
          </p>
        </div>

        {!settings.acceptingBookings && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3.5 text-sm text-amber-200">
            <Ban className="h-5 w-5 flex-none" />
            A agenda está temporariamente fechada para novos agendamentos. Tente
            novamente mais tarde.
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 space-y-10">
            {/* ── 1. Serviço ─────────────────────────────── */}
            <section>
              <StepTitle n={1} title="Escolha o serviço" />
              <div className="mt-4 space-y-2.5">
                {availableServices.map((s) => {
                  const Icon = serviceIcons[s.id] ?? serviceIcons.corte;
                  const active = selected.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? "border-electric/60 bg-electric/[0.07] shadow-glow-sm"
                          : "border-white/8 bg-surface/70 hover:border-white/20"
                      }`}
                    >
                      <span
                        className={`grid h-11 w-11 flex-none place-items-center rounded-xl transition-colors ${
                          active
                            ? "bg-royal-grad text-white"
                            : "border border-white/10 bg-white/5 text-steel-300"
                        }`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold leading-snug text-white">
                          {s.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-steel-400">
                          <span className="text-steel-300">
                            {formatDuration(s.durationMin)}
                          </span>
                          {/* A descrição só cabe a partir do tablet */}
                          <span className="hidden sm:inline">
                            {" "}
                            · {s.description}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-none items-center gap-3">
                        <span
                          className={`font-display text-base tabular-nums ${
                            isSub ? "text-electric" : "text-white"
                          }`}
                        >
                          {isSub ? "Incluso" : formatBRL(s.price)}
                        </span>
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full border transition-colors ${
                            active
                              ? "border-electric bg-electric text-ink"
                              : "border-white/20"
                          }`}
                        >
                          {active && (
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── 2. Barbeiro & horário ──────────────────── */}
            <section>
              <StepTitle n={2} title="Barbeiro & horário" />

              {/* Barbeiro */}
              <div className="mt-4 flex flex-wrap gap-2">
                <ChipButton
                  active={barberId === null}
                  onClick={() => setBarberId(null)}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Mais rápido
                </ChipButton>
                {barbers.map((b) => (
                  <ChipButton
                    key={b.id}
                    active={barberId === b.id}
                    onClick={() => setBarberId(b.id)}
                  >
                    {b.short}
                  </ChipButton>
                ))}
              </div>

              {/* Dia */}
              <div className="mt-5 flex gap-2.5 overflow-x-auto pb-1">
                {days.map((d) => {
                  const active = day === d.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={d.blocked}
                      onClick={() => {
                        setDay(d.key);
                        setTime(null);
                      }}
                      className={`flex min-w-[92px] flex-none flex-col items-center gap-1 rounded-2xl border px-4 py-3 transition-all ${
                        d.blocked
                          ? "cursor-not-allowed border-white/5 bg-white/[0.01]"
                          : active
                            ? "border-electric/60 bg-electric/[0.07] shadow-glow-sm"
                            : "border-white/8 bg-surface/70 hover:border-white/20"
                      }`}
                    >
                      <span
                        className={`label capitalize ${
                          d.blocked
                            ? "text-steel-400/40"
                            : active
                              ? "text-electric"
                              : "text-steel-400"
                        }`}
                      >
                        {d.weekday}
                      </span>
                      <span
                        className={`font-display text-sm ${
                          d.blocked ? "text-steel-400/30" : "text-white"
                        }`}
                      >
                        {d.dayLabel}
                      </span>
                      {d.blocked && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/80">
                          <Lock className="h-2.5 w-2.5" />
                          Bloqueado
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Horário */}
              {day ? (
                <div className="mt-5 space-y-5">
                  {periods.map((p) => {
                    const slots = timeSlots.filter((s) => p.test(s.time));
                    if (slots.length === 0) return null;
                    return (
                      <div key={p.label}>
                        <h4 className="label mb-2.5 text-steel-400">
                          {p.label}
                        </h4>
                        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6">
                          {slots.map((slot) => {
                            const { off } = slotDisabled(slot.time);
                            const active = time === slot.time;
                            return (
                              <button
                                key={slot.time}
                                type="button"
                                disabled={off}
                                onClick={() => setTime(slot.time)}
                                className={`rounded-xl border py-3 text-center text-sm font-semibold tabular-nums transition-all ${
                                  off
                                    ? "cursor-not-allowed border-white/5 bg-white/[0.01] text-steel-400/40 line-through"
                                    : active
                                      ? "btn-royal border-transparent text-white"
                                      : "border-white/8 bg-surface/70 text-white hover:border-electric/45"
                                }`}
                              >
                                {slot.time}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-steel-400">
                    Horários riscados estão indisponíveis (reservados, bloqueados
                    ou fora da antecedência mínima).
                  </p>
                </div>
              ) : (
                <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-steel-400">
                  Escolha um dia para ver os horários livres.
                </p>
              )}
            </section>

            {/* ── 3. Seus dados ──────────────────────────── */}
            <section>
              <div className="flex items-center justify-between">
                <StepTitle n={3} title="Seus dados" />
                {!isSub && (
                  <span className="label text-steel-400">Sem senha</span>
                )}
              </div>
              <div className="mt-4 space-y-4">
                <Field
                  label="Nome completo"
                  value={name}
                  onChange={setName}
                  placeholder="Ex.: Gabriel Silva"
                  autoComplete="name"
                />
                <Field
                  label="WhatsApp (com DDD)"
                  value={phone}
                  onChange={setPhone}
                  placeholder="(11) 9 0000-0000"
                  type="tel"
                  autoComplete="tel"
                />
                <label className="block">
                  <span className="label mb-2 block text-steel-400">
                    Observação (opcional)
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Ex.: máquina 2 nas laterais, barba na navalha…"
                    className="w-full resize-none rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
                  />
                </label>
                <p className="text-xs text-steel-400">
                  Você recebe a confirmação e um lembrete no WhatsApp.
                </p>
              </div>
            </section>
          </div>

          {/* Resumo — lateral no desktop, bloco final no celular */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <h3 className="label text-steel-300">Resumo</h3>
                {isSub && (
                  <span className="label inline-flex items-center gap-1.5 rounded-full bg-royal-grad px-2.5 py-1.5 text-white">
                    <Crown className="h-3 w-3" />
                    {plan!.name.replace("Plano ", "")}
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2.5">
                {chosen.length === 0 ? (
                  <p className="text-sm text-steel-400">
                    Selecione ao menos um serviço para começar.
                  </p>
                ) : (
                  chosen.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-steel-200">{s.name}</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          isSub ? "text-electric" : "text-white"
                        }`}
                      >
                        {isSub ? "Incluso" : formatBRL(s.price)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-white/8 pt-4 text-sm">
                <div className="flex items-center gap-2 text-steel-300">
                  <Sparkles className="h-4 w-4 flex-none text-electric" />
                  {barber ? barber.name : "Primeiro barbeiro disponível"}
                </div>
                {selectedDay && (
                  <div className="flex items-center gap-2 text-steel-300">
                    <CalendarDays className="h-4 w-4 flex-none text-electric" />
                    <span>
                      <span className="capitalize">{selectedDay.weekday}</span>,{" "}
                      {selectedDay.dayLabel}
                    </span>
                  </div>
                )}
                {time && (
                  <div className="flex items-center gap-2 text-steel-300">
                    <Clock className="h-4 w-4 flex-none text-electric" />
                    {time}
                    {totalMin > 0 && (
                      <span className="text-steel-400">
                        · {formatDuration(totalMin)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-white/8 pt-4">
                {isSub ? (
                  <p className="text-sm text-steel-300">
                    Coberto pelo seu{" "}
                    <span className="font-semibold text-electric">
                      {plan!.name}
                    </span>
                    . Sem cobrança no atendimento.
                  </p>
                ) : (
                  <div className="flex items-end justify-between">
                    <span className="label text-steel-400">Total</span>
                    <span className="font-display text-3xl text-white">
                      {formatBRL(total)}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setDone(true)}
                disabled={!canConfirm}
                className="btn-royal label mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirmar agendamento
                <ArrowRight className="h-4 w-4" />
              </button>
              {!canConfirm && settings.acceptingBookings && (
                <p className="mt-2.5 text-center text-xs text-steel-400">
                  Complete os 3 passos para confirmar.
                </p>
              )}
            </div>
          </aside>
        </div>
      </main>

      <BottomNav active="inicio" />
    </>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="label flex items-center gap-2.5 text-steel-300">
      <span className="grid h-5 w-5 place-items-center rounded-md bg-electric/15 text-[10px] text-electric">
        {n}
      </span>
      {title}
    </h2>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`label inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 transition-all ${
        active
          ? "btn-royal text-white"
          : "border border-white/10 bg-surface/70 text-steel-300 hover:border-electric/40 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function TopBar({ isSub, planName }: { isSub: boolean; planName?: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-ink-800/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/entrar"
            aria-label="Voltar"
            className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-white/10 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/" className="min-w-0">
            <Logo />
          </Link>
        </div>
        <span
          className={`label flex-none rounded-full px-3 py-2 ${
            isSub
              ? "bg-royal-grad text-white"
              : "border border-electric/30 bg-electric/10 text-electric"
          }`}
        >
          {isSub ? planName?.replace("Plano ", "") : "Sem cadastro"}
        </span>
      </div>
    </header>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="label mb-2 block text-steel-400">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3.5 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20"
      />
    </label>
  );
}

function Success({
  name,
  day,
  time,
  chosen,
  total,
  isSub,
  planName,
  barberName,
}: {
  name: string;
  day?: Day;
  time: string | null;
  chosen: { id: string; name: string }[];
  total: number;
  isSub: boolean;
  planName?: string;
  barberName: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-lg pt-10 text-center"
    >
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-royal-grad shadow-glow">
        <PartyPopper className="h-10 w-10 text-white" />
      </div>
      <h1 className="mt-6 font-display text-3xl text-white sm:text-4xl">
        Tá marcado, {name.split(" ")[0] || "campeão"}!
      </h1>
      <p className="mt-3 text-steel-300">
        Seu horário foi reservado. Enviamos a confirmação no WhatsApp.
      </p>

      <div className="glass mt-8 rounded-2xl p-6 text-left">
        <div className="label flex items-center gap-2 text-electric">
          <Sparkles className="h-3.5 w-3.5" />
          Detalhes do agendamento
        </div>
        <div className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-steel-400">Quando</span>
            <span className="text-right font-semibold text-white">
              {day ? (
                <>
                  <span className="capitalize">{day.weekday}</span>,{" "}
                  {day.dayLabel}
                </>
              ) : (
                "—"
              )}{" "}
              · {time}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-steel-400">Barbeiro</span>
            <span className="font-semibold text-white">{barberName}</span>
          </div>
          {chosen.map((s) => (
            <div key={s.id} className="flex justify-between gap-4">
              <span className="text-steel-400">Serviço</span>
              <span className="text-right font-semibold text-white">
                {s.name}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 border-t border-white/8 pt-3">
            <span className="text-steel-400">{isSub ? "Cobrança" : "Total"}</span>
            {isSub ? (
              <span className="inline-flex items-center gap-1 font-semibold text-electric">
                <Crown className="h-4 w-4" />
                Incluso no {planName}
              </span>
            ) : (
              <span className="font-display text-2xl text-white">
                {formatBRL(total)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href={isSub ? "/cliente" : "/"}
          className="label inline-flex items-center justify-center gap-2 rounded-full border border-white/12 px-6 py-4 text-steel-200 transition-colors hover:border-electric/45 hover:text-white"
        >
          {isSub ? "Voltar à minha conta" : "Voltar ao início"}
        </Link>
        <Link
          href="/entrar"
          className="btn-royal label inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-white"
        >
          Ver outros perfis
        </Link>
      </div>
    </motion.div>
  );
}
