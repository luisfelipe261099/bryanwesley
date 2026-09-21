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
import { getSettings, capacidadeDoDia } from "@/lib/schedule";
import { formatBRL, formatCompactBRL, formatDuration } from "@/lib/money";
import {
  formatShopTime,
  shopToday,
  minutesToHHMM,
  labelFullDate,
} from "@/lib/time";
import { shopFrom } from "@/lib/shop";
import { openPlanRequests } from "@/lib/queries";
import { appointmentStatus as statusStyles } from "@/lib/status";
import { ApptControls } from "./AgendaHoje";
import { PlanRequests } from "./PlanRequests";

export const dynamic = "force-dynamic";



// O painel é o resumo do dia; navegar por dia, filtrar barbeiro e
// procurar cliente é tarefa da Agenda (/admin/agenda). Ter os dois
// lugares com controles parecidos, e resultados diferentes, era metade da
// confusão de quem abria o sistema.
export default async function AdminDashboard() {
  const today = shopToday();
  const dateKey = today;
  const barberFilter = null;

  const [kpi, agendaDia, semana, equipe, settings, pedidos] = await Promise.all([
    adminOverview(),
    appointmentsOfDay(dateKey, barberFilter),
    weeklyRevenue(),
    teamPerformance(),
    getSettings(),
    openPlanRequests(),
  ]);
  const agenda = agendaDia;

  const info = shopFrom(settings);
  const totalSemana = semana.reduce((a, d) => a + d.cents, 0);
  const maxSemana = Math.max(1, ...semana.map((d) => d.cents));
  // O painel mostra o começo do dia; o resto fica a um clique, na Agenda.
  const MOSTRAR = 6;
  const restantes = agenda.length - MOSTRAR;

  // Ocupação: minutos vendidos sobre a capacidade REAL do dia mostrado —
  // com o barbeiro filtrado, a folga dele e a folga da loja. A conta
  // antiga usava sempre a equipe inteira no horário cheio da loja, então
  // filtrar um barbeiro (ou abrir um domingo) devolvia um número fictício.
  const minutosLoja = await capacidadeDoDia(dateKey, barberFilter, settings);
  const minutosVendidos = agenda
    .filter((a) => !["CANCELADO", "NO_SHOW"].includes(a.status))
    .reduce((acc, a) => acc + a.durationMin, 0);
  const ocupacao =
    minutosLoja > 0
      ? Math.min(100, Math.round((minutosVendidos / minutosLoja) * 100))
      : 0;

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
              {info.legalName} · {info.unit} · {kpi.agendamentosHoje}{" "}
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
      {/* Dois por linha já no celular: um embaixo do outro, os quatro
          números custavam meia tela de rolagem cada. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0.04} className="h-full">
          <Kpi
            icon={DollarSign}
            label="Faturamento hoje"
            value={formatBRL(kpi.faturamentoHojeCents)}
            hint={`${kpi.concluidosHoje} atendimento(s) concluído(s)`}
          />
        </Reveal>
        <Reveal delay={0.08} className="h-full">
          <Kpi
            icon={Repeat}
            label="MRR (assinaturas)"
            value={formatCompactBRL(kpi.mrrCents)}
            hint={`${kpi.assinantesAtivos} membro(s) ativo(s)`}
          />
        </Reveal>
        <Reveal delay={0.12} className="h-full">
          <Kpi
            icon={Activity}
            label={dateKey === today ? "Ocupação de hoje" : "Ocupação do dia"}
            value={`${ocupacao}%`}
            hint={
              minutosLoja > 0
                ? `${Math.round(minutosVendidos / 60)}h de ${Math.round(minutosLoja / 60)}h`
                : "Sem expediente nesse dia"
            }
          />
        </Reveal>
        <Reveal delay={0.16} className="h-full">
          <Kpi
            icon={Wallet}
            label="Comissões do mês"
            value={formatCompactBRL(kpi.comissoesMesCents)}
            hint={`Casa fica com ${formatCompactBRL(kpi.casaMesCents)}`}
          />
        </Reveal>
      </div>

      {/* min-w-0 nos filhos: um item de grid tem min-width:auto, então o
          trilho de dias esticaria a coluna além da tela e o conteúdo sairia
          cortado pela borda. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Agenda de hoje */}
        <Reveal className="min-w-0">
          <div className="glass rounded-3xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg text-white">Agenda de hoje</h2>
                {/* Dois pedaços: no celular a linha quebra entre a data e o
                    horário, em vez de partir "09:00—20:00" no meio. */}
                <span className="label mt-1 flex flex-wrap gap-x-2 text-steel-400">
                  <span className="first-letter:uppercase">{labelFullDate(dateKey)}</span>
                  <span className="whitespace-nowrap">
                    {minutesToHHMM(settings.openMinute)}—
                    {minutesToHHMM(settings.closeMinute)}
                  </span>
                </span>
              </div>
              <Link
                href="/admin/agenda"
                className="label inline-flex items-center gap-1.5 rounded-full border border-electric/40 px-3.5 py-2.5 text-electric transition-colors hover:bg-electric/10"
              >
                Ver agenda completa
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {agenda.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-steel-400">
                Nenhum agendamento nesse dia.
              </p>
            ) : (
              <ul className="mt-5 space-y-2">
                {agenda.slice(0, MOSTRAR).map((a) => {
                  const st = statusStyles[a.status];
                  return (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/6 bg-white/[0.02] p-3 transition-colors hover:border-electric/30 sm:flex-nowrap sm:gap-4 sm:p-3.5"
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
                      <div className="min-w-0 flex-1 basis-[55%]">
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
                      {/* No celular o preço, a situação e os botões vão para
                          baixo: lado a lado eles empurravam o nome para fora. */}
                      <div className="flex w-full flex-row flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-none sm:flex-col sm:items-end sm:gap-1.5">
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
            {restantes > 0 && (
              <Link
                href="/admin/agenda"
                className="label mt-3 flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/12 py-3.5 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
              >
                +{restantes} na agenda de hoje
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </Reveal>

        <div className="flex min-w-0 flex-col gap-5">
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
              {/* Semana inteira zerada vira uma frase: o gráfico vazio era
                  um bloco de 160px de nada no meio da tela. */}
              {semana.every((d) => d.atendimentos === 0) ? (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-steel-400">
                  Nenhum atendimento concluído nos últimos 7 dias.
                </p>
              ) : (
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
              )}
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

      {pedidos.length > 0 && (
        <Reveal>
          <div className="mt-5">
            <PlanRequests requests={pedidos} />
          </div>
        </Reveal>
      )}

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
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
              >
                <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                  {t.barber.user.name.charAt(0)}
                </span>
                {/* No celular o nome fica com a linha inteira: com o
                    faturamento ao lado sobravam 85px e todo mundo virava
                    "Master Barbe…". */}
                <div className="min-w-0 flex-1 basis-[55%]">
                  <p className="truncate font-medium text-white">
                    {t.barber.user.name}
                  </p>
                  <p className="truncate text-xs text-steel-400">
                    {t.barber.title} · {t.atendimentos} atendimento(s)
                  </p>
                </div>
                <div className="flex w-full flex-none items-baseline justify-between gap-2 sm:w-auto sm:block sm:text-right">
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
    <div className="glass glass-hover h-full rounded-2xl p-4 sm:p-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric sm:h-10 sm:w-10">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={1.75} />
      </span>
      <div className="mt-3 font-display text-xl text-white sm:mt-4 sm:text-2xl">
        {value}
      </div>
      <div className="mt-1 text-[13px] text-steel-400 sm:text-sm">{label}</div>
      <div className="mt-1 text-[11px] leading-snug text-steel-400/80 sm:mt-1.5 sm:text-xs">
        {hint}
      </div>
    </div>
  );
}
