import Link from "next/link";
import {
  DollarSign,
  Repeat,
  Activity,
  Target,
  Plus,
  Crown,
  ArrowUpRight,
  Percent,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import {
  adminOverview,
  appointmentsOfDay,
  weeklyRevenue,
  teamPerformance,
} from "@/lib/queries";
import { getSettings } from "@/lib/schedule";
import { formatBRL, formatCompactBRL, formatDuration } from "@/lib/money";
import { formatShopTime, shopToday, minutesToHHMM } from "@/lib/time";
import { shop } from "@/lib/shop";
import { ApptControls } from "./AgendaHoje";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, { label: string; cls: string; dot: string }> = {
  CONCLUIDO: { label: "Concluído", cls: "bg-neon/10 text-neon", dot: "bg-neon" },
  CONFIRMADO: { label: "Confirmado", cls: "bg-electric/10 text-electric", dot: "bg-electric" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-royal/20 text-electric", dot: "bg-electric" },
  PENDENTE: { label: "Pendente", cls: "bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  CANCELADO: { label: "Cancelado", cls: "bg-white/5 text-steel-400", dot: "bg-steel-400" },
  NO_SHOW: { label: "Faltou", cls: "bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
};

export default async function AdminDashboard() {
  const [kpi, agenda, semana, equipe, settings] = await Promise.all([
    adminOverview(),
    appointmentsOfDay(shopToday()),
    weeklyRevenue(),
    teamPerformance(),
    getSettings(),
  ]);

  const totalSemana = semana.reduce((a, d) => a + d.cents, 0);
  const maxSemana = Math.max(1, ...semana.map((d) => d.cents));

  // Ocupação: minutos vendidos sobre minutos disponíveis hoje.
  const minutosLoja =
    (settings.closeMinute - settings.openMinute) *
    Math.max(1, equipe.filter((e) => e.barber.active).length);
  const minutosVendidos = agenda
    .filter((a) => !["CANCELADO", "NO_SHOW"].includes(a.status))
    .reduce((acc, a) => acc + a.durationMin, 0);
  const ocupacao = Math.min(
    100,
    Math.round((minutosVendidos / minutosLoja) * 100)
  );

  return (
    <>
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
              {shop.legalName} · {shop.unit} · {kpi.agendamentosHoje}{" "}
              atendimento(s) hoje · loja das{" "}
              {minutesToHHMM(settings.openMinute)} às{" "}
              {minutesToHHMM(settings.closeMinute)}
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

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal delay={0.04}>
          <Kpi
            icon={DollarSign}
            label="Faturamento hoje"
            value={formatBRL(kpi.faturamentoHojeCents)}
            hint={`${kpi.concluidosHoje} atendimento(s) concluído(s)`}
          />
        </Reveal>
        <Reveal delay={0.08}>
          <Kpi
            icon={Repeat}
            label="MRR (assinaturas)"
            value={formatCompactBRL(kpi.mrrCents)}
            hint={`${kpi.assinantesAtivos} membro(s) ativo(s)`}
          />
        </Reveal>
        <Reveal delay={0.12}>
          <Kpi
            icon={Activity}
            label="Ocupação de hoje"
            value={`${ocupacao}%`}
            hint={`${Math.round(minutosVendidos / 60)}h vendidas`}
          />
        </Reveal>
        <Reveal delay={0.16}>
          <Kpi
            icon={Wallet}
            label="Comissões do mês"
            value={formatCompactBRL(kpi.comissoesMesCents)}
            hint={`Casa fica com ${formatCompactBRL(kpi.casaMesCents)}`}
          />
        </Reveal>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Agenda de hoje */}
        <Reveal>
          <div className="glass rounded-3xl p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-white">Agenda de hoje</h2>
              <span className="label text-steel-400">
                {minutesToHHMM(settings.openMinute)} —{" "}
                {minutesToHHMM(settings.closeMinute)}
              </span>
            </div>

            {agenda.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-steel-400">
                Nenhum agendamento para hoje ainda.
              </p>
            ) : (
              <ul className="mt-5 space-y-2">
                {agenda.map((a) => {
                  const st = statusStyles[a.status];
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3 transition-colors hover:border-electric/30 sm:gap-4 sm:p-3.5"
                    >
                      <div className="flex w-14 flex-none flex-col items-center">
                        <span className="font-display text-base leading-none text-white sm:text-lg">
                          {formatShopTime(a.startsAt)}
                        </span>
                        <span className="mt-1 text-[10px] text-steel-400">
                          {formatDuration(a.durationMin)}
                        </span>
                      </div>
                      <div className="hidden h-10 w-px bg-white/8 sm:block" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-white">
                            {a.clientName}
                          </span>
                          {a.kind === "ASSINANTE" && (
                            <Crown className="h-3.5 w-3.5 flex-none text-gold" />
                          )}
                        </div>
                        <span className="block truncate text-sm text-steel-400">
                          {a.items.map((i) => i.name).join(" + ")} ·{" "}
                          {a.barber.shortName}
                        </span>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular-nums text-white">
                          {a.kind === "ASSINANTE"
                            ? "Plano"
                            : formatBRL(a.totalCents)}
                        </span>
                        <span
                          className={`label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 ${st.cls}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                        <ApptControls id={a.id} status={a.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Reveal>

        <div className="flex flex-col gap-5">
          {/* Faturamento da semana */}
          <Reveal delay={0.06}>
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-white">Faturamento</h2>
                <span className="label text-steel-400">Últimos 7 dias</span>
              </div>
              <div className="mt-2 font-display text-3xl text-white">
                {formatBRL(totalSemana)}
              </div>
              <div className="mt-6 flex h-40 items-end justify-between gap-2">
                {semana.map((d) => {
                  const hPx = Math.max(
                    6,
                    Math.round((d.cents / maxSemana) * 118)
                  );
                  const isPeak = d.cents === maxSemana && d.cents > 0;
                  return (
                    <div
                      key={d.dateKey}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                    >
                      <div
                        className={`w-full rounded-t-md ${
                          isPeak ? "bg-royal-grad" : "bg-electric/30"
                        }`}
                        style={{ height: `${hPx}px` }}
                        title={`${d.day}: ${formatBRL(d.cents)}`}
                      />
                      <span className="text-[11px] capitalize text-steel-400">
                        {d.day}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>

          {/* Resultado do mês */}
          <Reveal delay={0.1}>
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-electric" />
                <h2 className="font-display text-lg text-white">Mês corrente</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <Line
                  label="Serviços realizados"
                  value={formatBRL(kpi.faturamentoMesCents)}
                />
                <Line
                  label="Comissões da equipe"
                  value={formatBRL(kpi.comissoesMesCents)}
                />
                <div className="flex items-center justify-between border-t border-white/8 pt-3">
                  <span className="text-steel-400">Fica com a barbearia</span>
                  <span className="font-display text-xl text-electric">
                    {formatBRL(kpi.casaMesCents)}
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* Equipe */}
      <Reveal>
        <div className="glass mt-5 rounded-3xl p-6" id="equipe">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-white">
              Desempenho da equipe
            </h2>
            <Link
              href="/admin/equipe"
              className="label inline-flex items-center gap-1 text-electric hover:underline"
            >
              Gerenciar
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="mt-5 space-y-2">
            {equipe.map((t) => (
              <li
                key={t.barber.id}
                className="flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
              >
                <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                  {t.barber.user.name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">
                    {t.barber.user.name}
                  </p>
                  <p className="truncate text-xs text-steel-400">
                    {t.barber.title} · {t.atendimentos} atendimento(s)
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p className="font-display text-base text-white">
                    {formatBRL(t.baseCents)}
                  </p>
                  <p className="inline-flex items-center gap-1 text-xs text-electric">
                    <Percent className="h-3 w-3" />
                    comissão {formatBRL(t.barberCents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-steel-400">{label}</span>
      <span className="font-semibold tabular-nums text-white">{value}</span>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="glass glass-hover rounded-2xl p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="mt-4 font-display text-2xl text-white">{value}</div>
      <div className="mt-1 text-sm text-steel-400">{label}</div>
      <div className="mt-1.5 text-xs text-steel-400/80">{hint}</div>
    </div>
  );
}
