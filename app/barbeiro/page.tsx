"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Play,
  Check,
  Lock,
  Plus,
  Receipt,
  Coffee,
  Star,
  Target,
  Wallet,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { Reveal } from "@/components/Reveal";
import {
  barbers,
  barberStats,
  todayAppointments,
  formatBRL,
  type ApptStatus,
} from "@/lib/data";

const statusStyles: Record<ApptStatus, { label: string; cls: string }> = {
  concluido: { label: "Concluído", cls: "bg-neon/10 text-neon" },
  confirmado: { label: "Confirmado", cls: "bg-electric/10 text-electric" },
  pendente: { label: "Pendente", cls: "bg-amber-400/10 text-amber-300" },
};

export default function BarbeiroPanel() {
  const barber = barbers.find((b) => b.id === barberStats.barberId)!;
  const meta = Math.round((barberStats.comissaoMes / barberStats.metaMes) * 100);

  // Agenda só deste barbeiro, em ordem de horário
  const agenda = useMemo(
    () =>
      todayAppointments
        .filter((a) => a.barberId === barber.id)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [barber.id]
  );

  // Atendimento em andamento (o primeiro ainda não concluído)
  const emAndamento = agenda.find((a) => a.status !== "concluido");
  const [iniciado, setIniciado] = useState(false);

  // Faixa da semana — calculada no cliente para não divergir do servidor
  const [week, setWeek] = useState<
    { key: string; weekday: string; dayNum: string; today: boolean }[]
  >([]);
  const [mesLabel, setMesLabel] = useState("");

  useEffect(() => {
    const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 3);

    const list = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        key: d.toISOString(),
        weekday: wd.format(d).replace(".", ""),
        dayNum: String(d.getDate()).padStart(2, "0"),
        today: d.getTime() === today.getTime(),
      };
    });
    setWeek(list);
    setMesLabel(
      new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
      }).format(today)
    );
  }, []);

  return (
    <>
      <Background />
      <AppHeader
        badge="Barbeiro"
        user={{ name: barber.short, initial: barber.initial }}
      />

      <main className="mx-auto max-w-3xl px-5 pb-28 pt-24 lg:px-8">
        {/* Identidade do profissional */}
        <Reveal>
          <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-royal-grad font-display text-xl text-white ring-2 ring-electric/30">
                {barber.initial}
              </span>
              <div className="min-w-0">
                <p className="font-display text-xl text-white">{barber.name}</p>
                <p className="label mt-1.5 text-steel-400">{barber.role}</p>
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-gold">
                  <Star className="h-3 w-3 fill-gold" />
                  {barber.rating.toFixed(1)} · comissão {barber.commissionPct}%
                </p>
              </div>
            </div>
            <span className="label inline-flex items-center gap-1.5 rounded-full bg-neon/10 px-3 py-2 text-neon">
              <span className="h-1.5 w-1.5 rounded-full bg-neon" />
              Em atendimento
            </span>
          </div>
        </Reveal>

        {/* Comissão + atendimentos */}
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Reveal delay={0.04}>
            <div className="glass h-full rounded-2xl p-5">
              <div className="label flex items-center gap-2 text-electric">
                <Wallet className="h-3.5 w-3.5" />
                Comissão do mês
              </div>
              <p className="mt-3 font-display text-3xl text-white">
                {formatBRL(barberStats.comissaoMes)}
              </p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-royal-grad"
                  style={{ width: `${Math.min(meta, 100)}%` }}
                />
              </div>
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-steel-400">
                <Target className="h-3.5 w-3.5 text-electric" />
                Meta {formatBRL(barberStats.metaMes)} ·{" "}
                <span className="font-semibold text-electric">{meta}%</span>
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="glass h-full rounded-2xl p-5">
              <div className="label flex items-center gap-2 text-electric">
                <Users className="h-3.5 w-3.5" />
                Atendimentos
              </div>
              <p className="mt-3 font-display text-3xl text-white">
                {barberStats.atendimentosHoje}
                <span className="ml-2 text-base font-normal text-steel-400">
                  hoje
                </span>
              </p>
              <p className="mt-4 text-sm text-steel-300">
                <span className="font-semibold text-neon">
                  {formatBRL(barberStats.ganhoHoje)}
                </span>{" "}
                ganhos hoje
              </p>
              <p className="mt-1.5 text-xs text-steel-400">
                {barberStats.atendimentosFeitos} concluídos ·{" "}
                {barberStats.atendimentosHoje - barberStats.atendimentosFeitos}{" "}
                na fila
              </p>
            </div>
          </Reveal>
        </div>

        {/* Agenda diária */}
        <Reveal delay={0.12}>
          <div className="glass mt-5 rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-white">Agenda diária</h2>
              <span className="label capitalize text-steel-400">
                {mesLabel}
              </span>
            </div>

            {/* Faixa da semana */}
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {week.map((d) => (
                <div
                  key={d.key}
                  aria-current={d.today ? "date" : undefined}
                  className={`flex min-w-[54px] flex-none flex-col items-center gap-1 rounded-xl border py-2.5 ${
                    d.today
                      ? "border-electric/60 bg-electric/[0.08]"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <span
                    className={`label capitalize ${
                      d.today ? "text-electric" : "text-steel-400"
                    }`}
                  >
                    {d.weekday}
                  </span>
                  <span className="font-display text-base text-white">
                    {d.dayNum}
                  </span>
                  <span
                    className={`h-1 w-1 rounded-full ${
                      d.today ? "bg-electric" : "bg-transparent"
                    }`}
                  />
                </div>
              ))}
            </div>

            {/* Atendimentos */}
            <ul className="mt-5 space-y-2">
              {agenda.map((a) => {
                const st = statusStyles[a.status];
                const atual = emAndamento?.id === a.id;
                return (
                  <li
                    key={a.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${
                      atual
                        ? "border-electric/50 bg-electric/[0.06]"
                        : "border-white/6 bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex w-14 flex-none flex-col items-center">
                      {atual && (
                        <span className="label mb-1 text-[8px] text-electric">
                          Agora
                        </span>
                      )}
                      <span className="font-display text-base leading-none text-white">
                        {a.time}
                      </span>
                      <span className="mt-1 text-[10px] text-steel-400">
                        {a.durationMin}min
                      </span>
                    </div>
                    <div className="hidden h-10 w-px bg-white/8 sm:block" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">
                        {a.client}
                      </p>
                      <p className="truncate text-sm text-steel-400">
                        {a.serviceName}
                      </p>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1.5">
                      <span className="text-sm font-semibold tabular-nums text-white">
                        {a.kind === "assinante" ? "Plano" : formatBRL(a.price)}
                      </span>
                      {atual ? (
                        <button
                          type="button"
                          onClick={() => setIniciado((v) => !v)}
                          className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white"
                        >
                          {iniciado ? (
                            <>
                              <Check className="h-3 w-3" strokeWidth={3} />
                              Finalizar
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3" />
                              Iniciar
                            </>
                          )}
                        </button>
                      ) : (
                        <span
                          className={`label rounded-full px-2.5 py-1.5 ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}

              {/* Intervalo operacional */}
              <li className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 p-3.5 text-steel-400">
                <span className="w-14 flex-none text-center font-display text-base text-steel-400">
                  {barberStats.proximoIntervalo}
                </span>
                <div className="hidden h-10 w-px bg-white/8 sm:block" />
                <span className="flex flex-1 items-center gap-2 text-sm">
                  <Coffee className="h-4 w-4" />
                  Intervalo operacional
                </span>
              </li>
            </ul>
          </div>
        </Reveal>

        {/* Ações rápidas */}
        <Reveal delay={0.16}>
          <div className="mt-5">
            <h3 className="label text-steel-400">Ações rápidas</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <QuickAction icon={Lock} label="Bloquear" href="/admin" />
              <QuickAction icon={Plus} label="Encaixe" href="/agendar" />
              <QuickAction icon={Receipt} label="Extrato" href="/admin" />
            </div>
          </div>
        </Reveal>
      </main>

      <BottomNav active="barbeiro" />
    </>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass glass-hover flex flex-col items-center gap-2.5 rounded-2xl py-4 text-steel-300 transition-colors hover:text-white"
    >
      <Icon className="h-5 w-5 text-electric" strokeWidth={1.75} />
      <span className="label">{label}</span>
    </Link>
  );
}
