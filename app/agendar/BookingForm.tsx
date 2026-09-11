"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  CalendarDays,
  Sparkles,
  Crown,
  Loader2,
  Zap,
} from "lucide-react";
import { serviceIcons } from "@/components/serviceIcons";
import { formatBRL, formatDuration } from "@/lib/money";
import type { Service, Plan } from "@/db/schema";
import type { Slot } from "@/lib/schedule";
import type { DayOption } from "@/lib/schedule";
import { fetchAvailability, submitBooking } from "./actions";

type TeamMember = { id: number; shortName: string; name: string };

const periods = [
  { label: "Manhã", test: (t: string) => t < "12:00" },
  { label: "Tarde", test: (t: string) => t >= "12:00" && t < "18:00" },
  { label: "Noite", test: (t: string) => t >= "18:00" },
];

export function BookingForm({
  services,
  team,
  days,
  plan,
  viewer,
  minAdvanceHours,
}: {
  services: Service[];
  team: TeamMember[];
  days: DayOption[];
  plan: (Plan & { covers: { id: number }[] }) | null;
  viewer: { name: string; phone: string } | null;
  minAdvanceHours: number;
}) {
  const isSub = !!plan;

  const [selected, setSelected] = useState<number[]>([]);
  const [barberId, setBarberId] = useState<number | null>(null);
  const [dateKey, setDateKey] = useState<string | null>(days[0]?.dateKey ?? null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState(viewer?.name ?? "");
  const [phone, setPhone] = useState(viewer?.phone ?? "");
  const [notes, setNotes] = useState("");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [closed, setClosed] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const chosen = services.filter((s) => selected.includes(s.id));
  const totalCents = chosen.reduce((acc, s) => acc + s.priceCents, 0);
  const totalMin = chosen.reduce((acc, s) => acc + s.durationMin, 0);
  const selectedDay = days.find((d) => d.dateKey === dateKey);
  const barber = team.find((b) => b.id === barberId);

  // Recarrega a grade sempre que muda o que afeta a disponibilidade.
  useEffect(() => {
    if (!dateKey || totalMin === 0) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    fetchAvailability({ dateKey, durationMin: totalMin, barberId })
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setClosed(res.closed);
        // Se o horário escolhido deixou de existir, limpa a seleção.
        setTime((current) =>
          current && res.slots.some((s) => s.time === current && s.available)
            ? current
            : null
        );
      })
      .finally(() => !cancelled && setLoadingSlots(false));
    return () => {
      cancelled = true;
    };
  }, [dateKey, totalMin, barberId]);

  const canConfirm =
    selected.length > 0 &&
    !!dateKey &&
    !!time &&
    name.trim().length > 2 &&
    phone.replace(/\D/g, "").length >= 10 &&
    !pending;

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
      const res = await submitBooking({
        serviceIds: selected,
        dateKey: dateKey!,
        time: time!,
        barberId,
        clientName: name,
        clientPhone: phone,
        notes: notes || undefined,
      });
      if (res.ok) {
        // Confirmação é uma página de verdade: sobrevive a recarregar,
        // dá para salvar e mandar no WhatsApp.
        router.push(`/agendar/confirmado/${res.token}`);
        return;
      } else {
        setError(res.error);
        // O horário pode ter sido tomado — recarrega a grade.
        if (dateKey && totalMin > 0) {
          const fresh = await fetchAvailability({
            dateKey,
            durationMin: totalMin,
            barberId,
          });
          setSlots(fresh.slots);
          setTime(null);
        }
      }
      } catch (e) {
        // Falha inesperada (rede, servidor): o cliente precisa saber.
        console.error(e);
        setError(
          "Não conseguimos falar com o servidor agora. Confira sua conexão e tente de novo."
        );
      }
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-10">
        {/* ── 1. Serviço ── */}
        <section>
          <StepTitle n={1} title="Escolha o serviço" />
          <div className="mt-4 space-y-2.5">
            {services.map((s) => {
              const Icon = serviceIcons[s.slug] ?? serviceIcons.corte;
              const active = selected.includes(s.id);
              const covered = plan?.covers.some((c) => c.id === s.id);
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
                      <span className="hidden sm:inline"> · {s.description}</span>
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-3">
                    <span
                      className={`font-display text-base tabular-nums ${
                        covered ? "text-electric" : "text-white"
                      }`}
                    >
                      {covered ? "Incluso" : formatBRL(s.priceCents)}
                    </span>
                    <span
                      className={`grid h-6 w-6 place-items-center rounded-full border transition-colors ${
                        active
                          ? "border-electric bg-electric text-ink"
                          : "border-white/20"
                      }`}
                    >
                      {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── 2. Barbeiro & horário ── */}
        <section>
          <StepTitle n={2} title="Barbeiro & horário" />

          <div className="mt-4 flex flex-wrap gap-2">
            <ChipButton active={barberId === null} onClick={() => setBarberId(null)}>
              <Zap className="h-3.5 w-3.5" />
              Mais rápido
            </ChipButton>
            {team.map((b) => (
              <ChipButton
                key={b.id}
                active={barberId === b.id}
                onClick={() => setBarberId(b.id)}
              >
                {b.shortName}
              </ChipButton>
            ))}
          </div>

          <div className="mt-5 flex gap-2.5 overflow-x-auto pb-1">
            {days.map((d) => {
              const active = dateKey === d.dateKey;
              return (
                <button
                  key={d.dateKey}
                  type="button"
                  onClick={() => {
                    setDateKey(d.dateKey);
                    setTime(null);
                  }}
                  className={`flex min-w-[92px] flex-none flex-col items-center gap-1 rounded-2xl border px-4 py-3 transition-all ${
                    active
                      ? "border-electric/60 bg-electric/[0.07] shadow-glow-sm"
                      : "border-white/8 bg-surface/70 hover:border-white/20"
                  }`}
                >
                  <span
                    className={`label capitalize ${
                      active ? "text-electric" : "text-steel-400"
                    }`}
                  >
                    {d.weekday}
                  </span>
                  <span className="font-display text-sm text-white">
                    {d.dayLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {selected.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-steel-400">
              Escolha um serviço para ver os horários livres.
            </p>
          ) : loadingSlots ? (
            <p className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-steel-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando a agenda…
            </p>
          ) : closed ? (
            <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-steel-400">
              A barbearia não abre nesse dia.
            </p>
          ) : (
            <div className="mt-5 space-y-5">
              {periods.map((p) => {
                const list = slots.filter((s) => p.test(s.time));
                if (list.length === 0) return null;
                return (
                  <div key={p.label}>
                    <h4 className="label mb-2.5 text-steel-400">{p.label}</h4>
                    <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6">
                      {list.map((slot) => {
                        const active = time === slot.time;
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            disabled={!slot.available}
                            title={
                              slot.reason === "antecedencia"
                                ? `Exige ${minAdvanceHours}h de antecedência`
                                : slot.reason === "ocupado"
                                  ? "Horário ocupado"
                                  : undefined
                            }
                            onClick={() => setTime(slot.time)}
                            className={`rounded-xl border py-3 text-center text-sm font-semibold tabular-nums transition-all ${
                              !slot.available
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
              {slots.every((s) => !s.available) && (
                <p className="text-sm text-steel-400">
                  Nenhum horário livre nesse dia. Tente outra data ou outro
                  barbeiro.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── 3. Seus dados ── */}
        <section>
          <div className="flex items-center justify-between">
            <StepTitle n={3} title="Seus dados" />
            {!viewer && <span className="label text-steel-400">Sem senha</span>}
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
                maxLength={500}
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

      {/* Resumo */}
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
              chosen.map((s) => {
                const covered = plan?.covers.some((c) => c.id === s.id);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-steel-200">{s.name}</span>
                    <span
                      className={`flex-none font-semibold tabular-nums ${
                        covered ? "text-electric" : "text-white"
                      }`}
                    >
                      {covered ? "Incluso" : formatBRL(s.priceCents)}
                    </span>
                  </div>
                );
              })
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
            <div className="flex items-end justify-between">
              <span className="label text-steel-400">Total</span>
              <span className="font-display text-3xl text-white">
                {formatBRL(totalCents)}
              </span>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-3 text-sm text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="btn-royal label mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            Confirmar agendamento
          </button>
          {!canConfirm && !pending && (
            <p className="mt-2.5 text-center text-xs text-steel-400">
              Complete os 3 passos para confirmar.
            </p>
          )}
        </div>
      </aside>
    </div>
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
