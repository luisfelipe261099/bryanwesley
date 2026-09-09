"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DollarSign,
  Repeat,
  Activity,
  Target,
  Plus,
  Phone,
  Crown,
  ArrowUpRight,
  Download,
  FileBarChart,
  Gem,
  Percent,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { Reveal } from "@/components/Reveal";
import { GerenciarAgenda } from "@/components/GerenciarAgenda";
import {
  adminStats,
  todayAppointments,
  clients,
  weeklyRevenue,
  teamPerformance,
  operationalAlerts,
  barbers,
  barbershop,
  formatBRL,
  formatCompactBRL,
  type ApptStatus,
} from "@/lib/data";

const statusStyles: Record<
  ApptStatus,
  { label: string; cls: string; dot: string }
> = {
  concluido: {
    label: "Concluído",
    cls: "bg-neon/10 text-neon",
    dot: "bg-neon",
  },
  confirmado: {
    label: "Confirmado",
    cls: "bg-electric/10 text-electric",
    dot: "bg-electric",
  },
  pendente: {
    label: "Pendente",
    cls: "bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
};

const periods = ["Hoje", "Esta semana", "Este mês", "Personalizado"];

export default function AdminDashboard() {
  const [period, setPeriod] = useState("Hoje");

  const metaPct = Math.round(
    (adminStats.faturamentoMes / adminStats.metaMes) * 100
  );
  const maxRev = Math.max(...weeklyRevenue.map((d) => d.value));

  return (
    <>
      <Background />
      <AppHeader badge="Gestão executiva" user={{ name: "Bryan W.", initial: "B" }} />

      <main className="mx-auto max-w-7xl overflow-x-clip px-5 pb-28 pt-24 lg:px-8">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="label inline-flex items-center gap-1.5 text-electric">
                <span className="h-1.5 w-1.5 rounded-full bg-neon" />
                Em tempo real
              </span>
              <h1 className="mt-3 font-display text-3xl text-white sm:text-4xl">
                Dashboard Geral
              </h1>
              <p className="mt-2 text-sm text-steel-400">
                Barbearia {barbershop.name} · {barbershop.unit} ·{" "}
                {adminStats.agendamentosHoje} atendimentos hoje
              </p>
            </div>
            <Link
              href="/agendar"
              className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-white"
            >
              <Plus className="h-4 w-4" />
              Novo agendamento
            </Link>
          </div>
        </Reveal>

        {/* Filtro de período */}
        <Reveal delay={0.02}>
          <div className="mt-6 flex flex-wrap gap-2">
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`label rounded-full px-4 py-2.5 transition-all ${
                  period === p
                    ? "btn-royal text-white"
                    : "border border-white/10 bg-surface/70 text-steel-300 hover:border-electric/40 hover:text-white"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Reveal>

        {/* KPIs */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Reveal delay={0.04}>
            <Kpi
              icon={DollarSign}
              label="Faturamento hoje"
              value={formatBRL(adminStats.faturamentoHoje)}
              trend={adminStats.faturamentoHojeTrend}
            />
          </Reveal>
          <Reveal delay={0.08}>
            <Kpi
              icon={Repeat}
              label="MRR (assinaturas)"
              value={formatCompactBRL(adminStats.mrr)}
              trend={adminStats.mrrTrend}
            />
          </Reveal>
          <Reveal delay={0.12}>
            <Kpi
              icon={Activity}
              label="Taxa de ocupação"
              value={`${adminStats.taxaOcupacao}%`}
              trend={adminStats.ocupacaoTrend}
            />
          </Reveal>
          <Reveal delay={0.16}>
            <Kpi
              icon={Gem}
              label="Membros ativos"
              value={String(adminStats.assinantesAtivos)}
              trend="+12"
            />
          </Reveal>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Agenda de hoje */}
          <Reveal>
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-white">
                  Agenda de hoje
                </h2>
                <span className="label text-steel-400">09h — 20h</span>
              </div>

              <ul className="mt-5 space-y-2">
                {todayAppointments.map((a) => {
                  const st = statusStyles[a.status];
                  const barber = barbers.find((b) => b.id === a.barberId);
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3 transition-colors hover:border-electric/30 sm:gap-4 sm:p-3.5"
                    >
                      <div className="flex w-14 flex-none flex-col items-center">
                        <span className="font-display text-base leading-none text-white sm:text-lg">
                          {a.time}
                        </span>
                        <span className="mt-1 text-[10px] text-steel-400">
                          {a.durationMin}min
                        </span>
                      </div>
                      <div className="hidden h-10 w-px bg-white/8 sm:block" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-white">
                            {a.client}
                          </span>
                          {a.kind === "assinante" && (
                            <Crown className="h-3.5 w-3.5 flex-none text-gold" />
                          )}
                        </div>
                        <span className="block truncate text-sm text-steel-400">
                          {a.serviceName}
                          {barber && ` · ${barber.short}`}
                        </span>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular-nums text-white">
                          {a.kind === "assinante" ? "Plano" : formatBRL(a.price)}
                        </span>
                        <span
                          className={`label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 ${st.cls}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>

          {/* Coluna direita: faturamento + meta */}
          <div className="flex flex-col gap-5">
            <Reveal delay={0.06}>
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg text-white">
                    Faturamento
                  </h2>
                  <span className="label text-steel-400">Últimos 7 dias</span>
                </div>
                <div className="mt-2 font-display text-3xl text-white">
                  {formatBRL(weeklyRevenue.reduce((a, d) => a + d.value, 0))}
                </div>

                <div className="mt-6 flex h-40 items-end justify-between gap-2">
                  {weeklyRevenue.map((d) => {
                    const hPx = Math.max(12, Math.round((d.value / maxRev) * 118));
                    const isPeak = d.value === maxRev;
                    return (
                      <div
                        key={d.day}
                        className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                      >
                        <div
                          className={`w-full rounded-t-md ${
                            isPeak ? "bg-royal-grad" : "bg-electric/30"
                          }`}
                          style={{ height: `${hPx}px` }}
                          title={formatBRL(d.value)}
                        />
                        <span className="text-[11px] text-steel-400">
                          {d.day}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-electric" />
                  <h2 className="font-display text-lg text-white">
                    Meta do mês
                  </h2>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <span className="font-display text-2xl text-white">
                    {formatBRL(adminStats.faturamentoMes)}
                  </span>
                  <span className="text-sm text-steel-400">
                    de {formatBRL(adminStats.metaMes)}
                  </span>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-royal-grad"
                    style={{ width: `${metaPct}%` }}
                  />
                </div>
                <p className="mt-2.5 text-sm text-steel-400">
                  <span className="font-semibold text-electric">{metaPct}%</span>{" "}
                  da meta atingida
                </p>
              </div>
            </Reveal>
          </div>
        </div>

        {/* Desempenho da equipe + atenção operacional */}
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Reveal>
            <div className="glass h-full rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-white">
                  Desempenho da equipe
                </h2>
                <span className="label text-steel-400">Este mês</span>
              </div>
              <ul className="mt-5 space-y-2">
                {teamPerformance.map((t) => {
                  const b = barbers.find((x) => x.id === t.barberId)!;
                  return (
                    <li
                      key={t.barberId}
                      className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                    >
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                        {b.initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">
                          {b.name}
                        </p>
                        <p className="truncate text-xs text-steel-400">
                          {b.role}
                        </p>
                      </div>
                      <div className="flex-none text-right">
                        <p className="font-display text-base text-white">
                          {formatBRL(t.faturamento)}
                        </p>
                        <p className="inline-flex items-center gap-1 text-xs text-electric">
                          <Percent className="h-3 w-3" />
                          comissão {formatBRL(t.comissao)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="glass flex h-full flex-col rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-white">
                  Atenção operacional
                </h2>
                <span className="label text-amber-300">
                  {operationalAlerts.length} pendências
                </span>
              </div>
              <ul className="mt-5 space-y-2">
                {operationalAlerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                  >
                    <span
                      className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
                        a.severity === "alta"
                          ? "bg-amber-400/10 text-amber-300"
                          : "bg-electric/10 text-electric"
                      }`}
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {a.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-steel-400">
                        {a.detail}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="label flex-none rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-electric/45 hover:text-white"
                    >
                      {a.action}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/8 pt-5">
                <Shortcut icon={FileBarChart} label="Relatório financeiro" />
                <Shortcut icon={Gem} label="Gerenciar planos" />
              </div>
              <button
                type="button"
                className="btn-royal label mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white"
              >
                <Download className="h-4 w-4" />
                Exportar fechamento mensal
              </button>
            </div>
          </Reveal>
        </div>

        {/* Gerenciar agenda (bloqueios e restrições) */}
        <Reveal>
          <div className="mt-5">
            <GerenciarAgenda />
          </div>
        </Reveal>

        {/* Clientes */}
        <Reveal>
          <div className="glass mt-5 rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-white">Clientes</h2>
              <Link
                href="/entrar"
                className="label inline-flex items-center gap-1 text-electric hover:underline"
              >
                Ver todos
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {/* Celular: cards (sem rolagem lateral) */}
            <div className="mt-4 space-y-2 lg:hidden">
              {clients.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                >
                  <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                    {c.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-white">
                        {c.name}
                      </span>
                      <StatusPill status={c.status} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-steel-400">
                      <Phone className="h-3 w-3 flex-none" />
                      <span className="truncate">{c.phone}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {c.plan ? (
                        <span className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2.5 py-1.5 text-electric">
                          <Crown className="h-3 w-3" />
                          {c.plan.replace("Plano ", "")}
                        </span>
                      ) : (
                        <span className="label rounded-full bg-white/5 px-2.5 py-1.5 text-steel-300">
                          Avulso
                        </span>
                      )}
                      <span className="text-xs text-steel-400">
                        {c.visits} visitas · {c.lastVisit}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: tabela */}
            <div className="mt-4 hidden lg:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="label border-b border-white/8 text-steel-400">
                    <th className="pb-3 font-semibold">Cliente</th>
                    <th className="pb-3 font-semibold">Plano</th>
                    <th className="pb-3 font-semibold">Visitas</th>
                    <th className="pb-3 font-semibold">Última</th>
                    <th className="pb-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                            {c.name.charAt(0)}
                          </span>
                          <div>
                            <div className="font-medium text-white">
                              {c.name}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-steel-400">
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5">
                        {c.plan ? (
                          <span className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2.5 py-1.5 text-electric">
                            <Crown className="h-3 w-3" />
                            {c.plan.replace("Plano ", "")}
                          </span>
                        ) : (
                          <span className="text-sm text-steel-400">Avulso</span>
                        )}
                      </td>
                      <td className="py-3.5 tabular-nums text-steel-200">
                        {c.visits}
                      </td>
                      <td className="py-3.5 text-sm text-steel-300">
                        {c.lastVisit}
                      </td>
                      <td className="py-3.5">
                        <StatusPill status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      </main>

      <BottomNav active="admin" />
    </>
  );
}

function StatusPill({ status }: { status: "ativo" | "atrasado" }) {
  return (
    <span
      className={`label flex-none rounded-full px-2.5 py-1.5 ${
        status === "ativo"
          ? "bg-neon/10 text-neon"
          : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {status === "ativo" ? "Ativo" : "Atrasado"}
    </span>
  );
}

function Shortcut({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-4 text-center text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
    >
      <Icon className="h-5 w-5 text-electric" strokeWidth={1.75} />
      <span className="label leading-[1.4]">{label}</span>
    </button>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <div className="glass glass-hover rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="label inline-flex items-center gap-1 rounded-full bg-neon/10 px-2.5 py-1.5 text-neon">
          <ArrowUpRight className="h-3 w-3" />
          {trend}
        </span>
      </div>
      <div className="mt-4 font-display text-2xl text-white">{value}</div>
      <div className="mt-1 text-sm text-steel-400">{label}</div>
    </div>
  );
}
