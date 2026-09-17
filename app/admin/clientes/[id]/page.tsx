import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CreditCard,
  History,
  Receipt,
} from "lucide-react";
import { clientDetail, listServices, listTeam, listPlans } from "@/lib/queries";
import { getSettings, listOpenDays } from "@/lib/schedule";
import { formatBRL } from "@/lib/money";
import {
  formatShopTime,
  utcToShopParts,
  labelFullDate,
  labelDayMonth,
} from "@/lib/time";
import { appointmentStatus, paymentStatus, subscriptionStatus } from "@/lib/status";
import { Card } from "@/components/admin/Feedback";
import { ApptControls } from "../../AgendaHoje";
import { FichaCliente } from "./FichaCliente";

export const dynamic = "force-dynamic";

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function hora(minutos: number) {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(
    minutos % 60
  ).padStart(2, "0")}`;
}

export default async function FichaDoCliente({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const ficha = await clientDetail(id);
  if (!ficha) notFound();

  const [services, team, plans, settings] = await Promise.all([
    listServices(),
    listTeam(),
    listPlans(),
    getSettings(),
  ]);
  const days = listOpenDays(settings, 10);

  return (
    <div className="space-y-5">
      <Link
        href="/admin/clientes"
        className="label inline-flex items-center gap-2 text-steel-300 hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Todos os clientes
      </Link>

      <FichaCliente
        cliente={ficha.cliente}
        assinatura={
          ficha.assinatura
            ? {
                status: ficha.assinatura.sub.status,
                planName: ficha.assinatura.plan.name,
                cycle: ficha.assinatura.sub.cycle,
                renewsAt: labelDayMonth(
                  utcToShopParts(ficha.assinatura.sub.renewsAt).dateKey
                ),
              }
            : null
        }
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
        }))}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          priceCents: s.priceCents,
          durationMin: s.durationMin,
        }))}
        team={team.map((b) => ({ id: b.id, shortName: b.shortName }))}
        days={days}
        resumo={{
          concluidos: ficha.concluidos,
          gasto: ficha.gasto,
          desde: labelDayMonth(utcToShopParts(ficha.cliente.createdAt).dateKey),
        }}
        fixo={
          ficha.fixo
            ? {
                texto:
                  ficha.fixo.frequency === "MENSAL"
                    ? `todo dia ${ficha.fixo.dayOfMonth} às ${hora(ficha.fixo.minutesOfDay)}`
                    : `toda ${DIAS[ficha.fixo.weekday ?? 0]} às ${hora(ficha.fixo.minutesOfDay)}`,
                barberName: ficha.fixo.barberName,
              }
            : null
        }
      />

      <Card
        title="Próximos horários"
        desc={
          ficha.proximos.length === 0
            ? "Nada marcado para os próximos dias."
            : `${ficha.proximos.length} horário(s) em aberto.`
        }
        icon={<CalendarClock className="h-5 w-5" />}
      >
        {ficha.proximos.length > 0 && (
          <ul className="space-y-2">
            {ficha.proximos.map((a) => {
              const st = appointmentStatus[a.status];
              const { dateKey } = utcToShopParts(a.startsAt);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white">
                      {labelFullDate(dateKey)} · {formatShopTime(a.startsAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-steel-400">
                      {a.items.map((i) => i.name).join(", ")} · com{" "}
                      {a.barber.shortName} · código {a.code}
                    </p>
                  </div>
                  <span className={`label rounded-full px-2.5 py-1.5 ${st?.cls ?? ""}`}>
                    {st?.label ?? a.status}
                  </span>
                  <span className="text-sm text-steel-300">
                    {a.kind === "ASSINANTE" ? "Plano" : formatBRL(a.totalCents)}
                  </span>
                  <ApptControls id={a.id} status={a.status} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Pagamentos"
        desc={
          ficha.pagamentos.length === 0
            ? "Nenhuma cobrança gerada para este cliente."
            : "Cobranças geradas pelo sistema, da mais recente para a mais antiga."
        }
        icon={<Receipt className="h-5 w-5" />}
      >
        {ficha.pagamentos.length > 0 && (
          <ul className="space-y-2">
            {ficha.pagamentos.map((p) => {
              const st = paymentStatus[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{p.description}</p>
                    <p className="mt-0.5 text-xs text-steel-400">
                      {labelDayMonth(utcToShopParts(p.createdAt).dateKey)}
                      {p.paidAt
                        ? ` · pago em ${labelDayMonth(utcToShopParts(p.paidAt).dateKey)}`
                        : ""}
                    </p>
                  </div>
                  <span className={`label rounded-full px-2.5 py-1.5 ${st?.cls ?? ""}`}>
                    {st?.label ?? p.status}
                  </span>
                  <span className="text-sm text-white">{formatBRL(p.amountCents)}</span>
                  {(p.receiptUrl || p.checkoutUrl) && (
                    <a
                      href={p.receiptUrl ?? p.checkoutUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="label rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-electric/40 hover:text-white"
                    >
                      {p.receiptUrl ? "Recibo" : "Abrir cobrança"}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Histórico de atendimentos"
        desc={
          ficha.historico.length === 0
            ? "Este cliente ainda não foi atendido."
            : `Últimos ${ficha.historico.length} atendimentos.`
        }
        icon={<History className="h-5 w-5" />}
      >
        {ficha.historico.length > 0 && (
          <ul className="space-y-2">
            {ficha.historico.map((a) => {
              const st = appointmentStatus[a.status];
              const { dateKey } = utcToShopParts(a.startsAt);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3.5 py-3"
                >
                  <span className="text-sm text-white">
                    {labelDayMonth(dateKey)} · {formatShopTime(a.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-steel-400">
                    {a.items.map((i) => i.name).join(", ")} · {a.barber.shortName}
                  </span>
                  <span className={`label rounded-full px-2.5 py-1.5 ${st?.cls ?? ""}`}>
                    {st?.label ?? a.status}
                  </span>
                  <span className="text-sm text-steel-300">
                    {a.kind === "ASSINANTE" ? "Plano" : formatBRL(a.totalCents)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {ficha.assinaturas.length > 1 && (
        <Card
          title="Assinaturas anteriores"
          desc="O que já passou por este cadastro."
          icon={<CreditCard className="h-5 w-5" />}
        >
          <ul className="space-y-2">
            {ficha.assinaturas.map(({ sub, plan }) => {
              const st = subscriptionStatus[sub.status];
              return (
                <li
                  key={sub.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3.5 py-3"
                >
                  <span className="min-w-0 flex-1 text-sm text-white">
                    {plan.name} · {sub.cycle === "ANUAL" ? "anual" : "mensal"}
                  </span>
                  <span className="text-xs text-steel-400">
                    desde {labelDayMonth(utcToShopParts(sub.startedAt).dateKey)}
                  </span>
                  <span className={`label rounded-full px-2.5 py-1.5 ${st?.cls ?? ""}`}>
                    {st?.label ?? sub.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
