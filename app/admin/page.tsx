import Link from "next/link";
import {
  DollarSign,
  CalendarCheck,
  Users,
  Activity,
  Target,
  Plus,
  Phone,
  Crown,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { Reveal } from "@/components/Reveal";
import { GerenciarAgenda } from "@/components/GerenciarAgenda";
import {
  adminStats,
  todayAppointments,
  clients,
  weeklyRevenue,
  formatBRL,
  type ApptStatus,
} from "@/lib/data";

const statusStyles: Record<
  ApptStatus,
  { label: string; cls: string; dot: string }
> = {
  concluido: {
    label: "Concluído",
    cls: "bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  confirmado: {
    label: "Confirmado",
    cls: "bg-royal/15 text-electric",
    dot: "bg-electric",
  },
  pendente: {
    label: "Pendente",
    cls: "bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
};

export default function AdminDashboard() {
  const metaPct = Math.round(
    (adminStats.faturamentoMes / adminStats.metaMes) * 100
  );
  const maxRev = Math.max(...weeklyRevenue.map((d) => d.value));

  return (
    <>
      <Background />
      <AppHeader badge="Administrador" user={{ name: "Bryan W.", initial: "B" }} />

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-24 lg:px-8">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-5xl text-white sm:text-6xl">
                Painel
              </h1>
              <p className="mt-2 text-steel-400">
                Visão geral da barbearia · Hoje, 6 atendimentos
              </p>
            </div>
            <Link
              href="/agendar"
              className="btn-royal inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Novo agendamento
            </Link>
          </div>
        </Reveal>

        {/* KPIs */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Reveal delay={0.02}>
            <Kpi
              icon={DollarSign}
              label="Faturamento hoje"
              value={formatBRL(adminStats.faturamentoHoje)}
              trend="+12%"
            />
          </Reveal>
          <Reveal delay={0.06}>
            <Kpi
              icon={CalendarCheck}
              label="Agendamentos hoje"
              value={String(adminStats.agendamentosHoje)}
              trend="+2"
            />
          </Reveal>
          <Reveal delay={0.1}>
            <Kpi
              icon={Users}
              label="Assinantes ativos"
              value={String(adminStats.assinantesAtivos)}
              trend="+5"
            />
          </Reveal>
          <Reveal delay={0.14}>
            <Kpi
              icon={Activity}
              label="Taxa de ocupação"
              value={`${adminStats.taxaOcupacao}%`}
              trend="+8%"
            />
          </Reveal>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Agenda de hoje */}
          <Reveal>
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">
                  Agenda de hoje
                </h2>
                <span className="text-sm text-steel-400">Ter · 09h–20h</span>
              </div>

              <ul className="mt-5 space-y-2">
                {todayAppointments.map((a) => {
                  const st = statusStyles[a.status];
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-4 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5 transition-colors hover:border-white/15"
                    >
                      <div className="flex w-14 flex-none flex-col items-center">
                        <span className="font-display text-2xl leading-none text-white">
                          {a.time}
                        </span>
                        <span className="mt-0.5 text-[10px] text-steel-400">
                          {a.durationMin}min
                        </span>
                      </div>
                      <div className="h-10 w-px bg-white/8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-white">
                            {a.client}
                          </span>
                          {a.kind === "assinante" && (
                            <Crown className="h-3.5 w-3.5 flex-none text-gold" />
                          )}
                        </div>
                        <span className="text-sm text-steel-400">
                          {a.serviceName}
                        </span>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular-nums text-white">
                          {a.kind === "assinante" ? "Plano" : formatBRL(a.price)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.cls}`}
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

          {/* Coluna direita: faturamento semana + meta */}
          <div className="flex flex-col gap-5">
            <Reveal delay={0.06}>
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    Faturamento
                  </h2>
                  <span className="text-xs font-medium text-steel-400">
                    Últimos 7 dias
                  </span>
                </div>
                <div className="mt-2 font-display text-4xl text-white">
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
                            isPeak ? "bg-royal-grad" : "bg-royal/45"
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
                  <h2 className="text-lg font-semibold text-white">Meta do mês</h2>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <span className="font-display text-3xl text-white">
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
                <p className="mt-2 text-sm text-steel-400">
                  <span className="font-semibold text-electric">{metaPct}%</span>{" "}
                  da meta atingida
                </p>
              </div>
            </Reveal>
          </div>
        </div>

        {/* Gerenciar agenda (bloqueios e restrições) */}
        <Reveal>
          <div className="mt-5">
            <GerenciarAgenda />
          </div>
        </Reveal>

        {/* Clientes */}
        <Reveal>
          <div className="mt-5 glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Clientes</h2>
              <Link
                href="/entrar"
                className="inline-flex items-center gap-1 text-sm font-medium text-electric hover:underline"
              >
                Ver todos
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-white/8 text-xs uppercase tracking-wider text-steel-400">
                    <th className="pb-3 font-medium">Cliente</th>
                    <th className="pb-3 font-medium">Plano</th>
                    <th className="pb-3 font-medium">Visitas</th>
                    <th className="pb-3 font-medium">Última</th>
                    <th className="pb-3 font-medium">Status</th>
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-royal/15 px-2.5 py-1 text-xs font-semibold text-electric">
                            <Crown className="h-3 w-3" />
                            {c.plan}
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
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            c.status === "ativo"
                              ? "bg-emerald-400/10 text-emerald-300"
                              : "bg-amber-400/10 text-amber-300"
                          }`}
                        >
                          {c.status === "ativo" ? "Ativo" : "Atrasado"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>
      </main>
    </>
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
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-royal/15 text-electric">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
          <ArrowUpRight className="h-3 w-3" />
          {trend}
        </span>
      </div>
      <div className="mt-4 font-display text-3xl text-white">{value}</div>
      <div className="text-sm text-steel-400">{label}</div>
    </div>
  );
}
