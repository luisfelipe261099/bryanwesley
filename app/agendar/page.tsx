"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
} from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { serviceIcons } from "@/components/serviceIcons";
import {
  services,
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
  dayNum: string;
  blocked: boolean;
};

const stepLabels = ["Serviços", "Data", "Horário", "Confirmar"];

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

  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState(isSub ? "Rafael Lima" : "");
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
    const fmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
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
            : fmt.format(d).replace(".", "");
      list.push({
        key,
        date: d,
        weekday,
        dayNum: String(d.getDate()).padStart(2, "0"),
        blocked: settings.blockedDates.includes(key),
      });
    }
    setDays(list);
  }, [settings.blockedDates]);

  const chosen = availableServices.filter((s) => selected.includes(s.id));
  const total = chosen.reduce((acc, s) => acc + s.price, 0);
  const totalMin = chosen.reduce((acc, s) => acc + s.durationMin, 0);
  const selectedDay = days.find((d) => d.key === day);

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

  const canNext = useMemo(() => {
    if (step === 0) return selected.length > 0;
    if (step === 1) return !!day;
    if (step === 2) return !!time;
    if (step === 3)
      return (
        settings.acceptingBookings &&
        name.trim().length > 1 &&
        phone.trim().length >= 8
      );
    return false;
  }, [step, selected, day, time, name, phone, settings.acceptingBookings]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function next() {
    if (step < 3) setStep((s) => s + 1);
    else setDone(true);
  }

  return (
    <>
      <Background />
      <TopBar isSub={isSub} planName={plan?.name} />

      <main className="mx-auto max-w-5xl px-5 pb-32 pt-24 lg:px-8">
        {!done ? (
          <>
            <div className="mb-6">
              <h1 className="font-display text-5xl text-white sm:text-6xl">
                Agende seu horário
              </h1>
              <p className="mt-2 text-steel-400">
                {isSub
                  ? `Seu plano ${plan!.name} cobre estes serviços — escolha o que quer hoje.`
                  : "Monte seu atendimento. Pode escolher mais de um serviço."}
              </p>
            </div>

            {!settings.acceptingBookings && (
              <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                <Ban className="h-5 w-5 flex-none" />
                A agenda está temporariamente fechada para novos agendamentos.
                Tente novamente mais tarde.
              </div>
            )}

            <Stepper step={step} />

            <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
              <div>
                <AnimatePresence mode="wait">
                  {/* PASSO 1 — Serviços */}
                  {step === 0 && (
                    <StepWrap key="s0">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {availableServices.map((s) => {
                          const Icon = serviceIcons[s.id];
                          const active = selected.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggle(s.id)}
                              className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
                                active
                                  ? "border-electric/60 bg-royal/10 shadow-glow-sm"
                                  : "border-white/8 bg-white/[0.02] hover:border-white/20"
                              }`}
                            >
                              <span
                                className={`grid h-11 w-11 flex-none place-items-center rounded-xl ${
                                  active
                                    ? "bg-royal-grad text-white"
                                    : "bg-white/5 text-steel-300"
                                }`}
                              >
                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-semibold text-white">
                                  {s.name}
                                </span>
                                <span className="text-xs text-steel-400">
                                  {isSub ? (
                                    <span className="inline-flex items-center gap-1 text-electric">
                                      <Crown className="h-3 w-3" />
                                      Incluso no plano
                                    </span>
                                  ) : (
                                    <>
                                      {formatDuration(s.durationMin)} ·{" "}
                                      {formatBRL(s.price)}
                                    </>
                                  )}
                                </span>
                              </span>
                              <span
                                className={`grid h-6 w-6 flex-none place-items-center rounded-full border transition-colors ${
                                  active
                                    ? "border-electric bg-electric text-ink"
                                    : "border-white/20"
                                }`}
                              >
                                {active && (
                                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </StepWrap>
                  )}

                  {/* PASSO 2 — Data */}
                  {step === 1 && (
                    <StepWrap key="s1">
                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
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
                              className={`relative flex flex-col items-center rounded-2xl border py-4 transition-all ${
                                d.blocked
                                  ? "cursor-not-allowed border-white/5 bg-white/[0.01]"
                                  : active
                                    ? "border-electric/60 bg-royal/10 shadow-glow-sm"
                                    : "border-white/8 bg-white/[0.02] hover:border-white/20"
                              }`}
                            >
                              <span
                                className={`text-xs font-medium capitalize ${
                                  d.blocked ? "text-steel-400/40" : "text-steel-400"
                                }`}
                              >
                                {d.weekday}
                              </span>
                              <span
                                className={`mt-1 font-display text-3xl ${
                                  d.blocked ? "text-steel-400/30" : "text-white"
                                }`}
                              >
                                {d.dayNum}
                              </span>
                              {d.blocked && (
                                <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/80">
                                  <Lock className="h-2.5 w-2.5" />
                                  Bloqueado
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </StepWrap>
                  )}

                  {/* PASSO 3 — Horário */}
                  {step === 2 && (
                    <StepWrap key="s2">
                      <div className="space-y-6">
                        {periods.map((p) => {
                          const slots = timeSlots.filter((s) => p.test(s.time));
                          if (slots.length === 0) return null;
                          return (
                            <div key={p.label}>
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-steel-400">
                                {p.label}
                              </h4>
                              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                                {slots.map((slot) => {
                                  const { off } = slotDisabled(slot.time);
                                  const active = time === slot.time;
                                  return (
                                    <button
                                      key={slot.time}
                                      type="button"
                                      disabled={off}
                                      onClick={() => setTime(slot.time)}
                                      className={`rounded-xl border py-3.5 text-center text-sm font-semibold tabular-nums transition-all ${
                                        off
                                          ? "cursor-not-allowed border-white/5 bg-white/[0.01] text-steel-400/40 line-through"
                                          : active
                                            ? "border-electric/60 bg-royal-grad text-white shadow-glow-sm"
                                            : "border-white/8 bg-white/[0.02] text-white hover:border-white/25"
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
                          Horários riscados estão indisponíveis (reservados,
                          bloqueados ou fora da antecedência mínima).
                        </p>
                      </div>
                    </StepWrap>
                  )}

                  {/* PASSO 4 — Confirmar */}
                  {step === 3 && (
                    <StepWrap key="s3">
                      <div className="space-y-4">
                        <Field
                          label="Seu nome"
                          value={name}
                          onChange={setName}
                          placeholder="Ex.: Carlos Henrique"
                          autoComplete="name"
                        />
                        <Field
                          label="WhatsApp"
                          value={phone}
                          onChange={setPhone}
                          placeholder="(11) 9 0000-0000"
                          type="tel"
                          autoComplete="tel"
                        />
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-medium text-steel-300">
                            Observação{" "}
                            <span className="text-steel-400/60">(opcional)</span>
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
                    </StepWrap>
                  )}
                </AnimatePresence>
              </div>

              {/* Resumo lateral */}
              <aside className="lg:sticky lg:top-24 lg:self-start">
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-steel-300">
                      Resumo
                    </h3>
                    {isSub && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-royal-grad px-2.5 py-1 text-[11px] font-semibold text-white">
                        <Crown className="h-3 w-3" />
                        {plan!.name}
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

                  {(selectedDay || time) && (
                    <div className="mt-4 space-y-2 border-t border-white/8 pt-4 text-sm">
                      {selectedDay && (
                        <div className="flex items-center gap-2 text-steel-300">
                          <CalendarDays className="h-4 w-4 text-electric" />
                          <span className="capitalize">
                            {selectedDay.weekday} {selectedDay.dayNum}
                          </span>
                        </div>
                      )}
                      {time && (
                        <div className="flex items-center gap-2 text-steel-300">
                          <Clock className="h-4 w-4 text-electric" />
                          {time}
                          {totalMin > 0 && (
                            <span className="text-steel-400">
                              · {formatDuration(totalMin)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 border-t border-white/8 pt-4">
                    {isSub ? (
                      <p className="text-sm text-steel-300">
                        Coberto pelo seu plano{" "}
                        <span className="font-semibold text-electric">
                          {plan!.name}
                        </span>
                        . Sem cobrança no atendimento.
                      </p>
                    ) : (
                      <div className="flex items-end justify-between">
                        <span className="text-sm text-steel-400">Total</span>
                        <span className="font-display text-4xl text-white">
                          {formatBRL(total)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </div>

            {/* Navegação inferior */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink/90 backdrop-blur-xl">
              <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
                <button
                  type="button"
                  onClick={() => (step === 0 ? null : setStep((s) => s - 1))}
                  disabled={step === 0}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </button>

                <div className="hidden text-sm text-steel-400 sm:block">
                  Passo {step + 1} de 4 ·{" "}
                  <span className="text-white">{stepLabels[step]}</span>
                </div>

                <button
                  type="button"
                  onClick={next}
                  disabled={!canNext}
                  className="btn-royal inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {step === 3 ? "Confirmar agendamento" : "Continuar"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <Success
            name={name}
            day={selectedDay}
            time={time}
            chosen={chosen}
            total={total}
            isSub={isSub}
            planName={plan?.name}
          />
        )}
      </main>
    </>
  );
}

function TopBar({
  isSub,
  planName,
}: {
  isSub: boolean;
  planName?: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 lg:px-8">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          {isSub && (
            <span className="hidden items-center gap-1.5 rounded-full border border-electric/30 bg-royal/10 px-3 py-1 text-xs font-semibold text-electric sm:inline-flex">
              <Crown className="h-3.5 w-3.5" />
              {planName}
            </span>
          )}
          <Link
            href={isSub ? "/cliente" : "/entrar"}
            className="text-sm font-medium text-steel-300 transition-colors hover:text-white"
          >
            {isSub ? "Minha conta" : "Trocar perfil"}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {stepLabels.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`grid h-8 w-8 flex-none place-items-center rounded-full text-sm font-bold transition-colors ${
                i < step
                  ? "bg-royal-grad text-white"
                  : i === step
                    ? "bg-white text-ink"
                    : "border border-white/15 text-steel-400"
              }`}
            >
              {i < step ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={`hidden text-sm font-medium sm:block ${
                i <= step ? "text-white" : "text-steel-400"
              }`}
            >
              {label}
            </span>
          </div>
          {i < stepLabels.length - 1 && (
            <div
              className={`h-px flex-1 ${
                i < step ? "bg-electric/50" : "bg-white/10"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StepWrap({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
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
      <span className="mb-1.5 block text-sm font-medium text-steel-300">
        {label}
      </span>
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
}: {
  name: string;
  day?: Day;
  time: string | null;
  chosen: { id: string; name: string }[];
  total: number;
  isSub: boolean;
  planName?: string;
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
      <h1 className="mt-6 font-display text-5xl text-white">
        Tá marcado, {name.split(" ")[0] || "campeão"}!
      </h1>
      <p className="mt-3 text-steel-300">
        Seu horário foi reservado. Enviamos a confirmação no WhatsApp.
      </p>

      <div className="glass mt-8 rounded-2xl p-6 text-left">
        <div className="flex items-center gap-2 text-sm text-electric">
          <Sparkles className="h-4 w-4" />
          Detalhes do agendamento
        </div>
        <div className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-steel-400">Quando</span>
            <span className="font-semibold capitalize text-white">
              {day ? `${day.weekday} ${day.dayNum}` : "—"} · {time}
            </span>
          </div>
          {chosen.map((s) => (
            <div key={s.id} className="flex justify-between">
              <span className="text-steel-400">Serviço</span>
              <span className="font-semibold text-white">{s.name}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-white/8 pt-3">
            <span className="text-steel-400">
              {isSub ? "Cobrança" : "Total"}
            </span>
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
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 px-6 py-3 text-sm font-semibold text-white hover:border-white/30"
        >
          {isSub ? "Voltar à minha conta" : "Voltar ao início"}
        </Link>
        <Link
          href="/entrar"
          className="btn-royal inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white"
        >
          Ver outros perfis
        </Link>
      </div>
    </motion.div>
  );
}
