// Leituras usadas pelas telas. Tudo vem do banco — nada de mock.
import { and, asc, desc, eq, gte, lt, inArray, sum, count } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  appointmentCommissions,
  barbers,
  plans,
  planServices,
  services,
  subscriptions,
  users,
} from "@/db/schema";
import { BLOCKING_STATUSES } from "./schedule";
import {
  shopTimeToUtc,
  parseDateKey,
  shopToday,
  addDays as addDaysKey,
  labelWeekday as weekdayLabel,
} from "./time";
import { monthStart, nextMonthStart } from "./commissions";

export async function listServices() {
  return db.query.services.findMany({
    where: eq(services.active, true),
    orderBy: [asc(services.sortOrder)],
  });
}

export async function listPlans() {
  const rows = await db.query.plans.findMany({
    where: eq(plans.active, true),
    orderBy: [asc(plans.sortOrder)],
    with: { planServices: { with: { service: true } } },
  });
  return rows.map((p) => ({
    ...p,
    covers: p.planServices.map((ps) => ps.service).filter(Boolean),
  }));
}

export async function listTeam() {
  return db.query.barbers.findMany({
    where: eq(barbers.active, true),
    with: { user: true },
    orderBy: [asc(barbers.sortOrder)],
  });
}

/** Limites do dia (na loja) como instantes UTC. */
export function dayBounds(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return {
    start: shopTimeToUtc(year, month, day, 0),
    end: shopTimeToUtc(year, month, day, 24 * 60),
  };
}

export async function appointmentsOfDay(
  dateKey: string,
  barberId?: number | null
) {
  const { start, end } = dayBounds(dateKey);
  return db.query.appointments.findMany({
    where: and(
      gte(appointments.startsAt, start),
      lt(appointments.startsAt, end),
      barberId ? eq(appointments.barberId, barberId) : undefined
    ),
    with: { barber: { with: { user: true } }, items: true },
    orderBy: [asc(appointments.startsAt)],
  });
}

export async function upcomingForUser(userId: number, limit = 10) {
  return db.query.appointments.findMany({
    where: and(
      eq(appointments.clientUserId, userId),
      gte(appointments.startsAt, new Date()),
      inArray(appointments.status, ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"])
    ),
    with: { barber: { with: { user: true } }, items: true },
    orderBy: [asc(appointments.startsAt)],
    limit,
  });
}

export async function historyForUser(userId: number, limit = 12) {
  return db.query.appointments.findMany({
    where: and(
      eq(appointments.clientUserId, userId),
      inArray(appointments.status, ["CONCLUIDO", "CANCELADO", "NO_SHOW"])
    ),
    with: { barber: { with: { user: true } }, items: true },
    orderBy: [desc(appointments.startsAt)],
    limit,
  });
}

export async function countForUser(userId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.clientUserId, userId),
        eq(appointments.status, "CONCLUIDO")
      )
    );
  return Number(row?.total ?? 0);
}

export async function activeSubscription(userId: number) {
  return db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "ATIVA")
    ),
    with: { plan: true },
  });
}

/** Comissão do barbeiro no mês corrente. */
export async function barberMonthSummary(barberId: number, ref = new Date()) {
  const [row] = await db
    .select({
      base: sum(appointmentCommissions.baseCents),
      barber: sum(appointmentCommissions.barberCents),
      shop: sum(appointmentCommissions.shopCents),
      atendimentos: count(),
    })
    .from(appointmentCommissions)
    .where(
      and(
        eq(appointmentCommissions.barberId, barberId),
        gte(appointmentCommissions.createdAt, monthStart(ref)),
        lt(appointmentCommissions.createdAt, nextMonthStart(ref))
      )
    );
  return {
    baseCents: Number(row?.base ?? 0),
    barberCents: Number(row?.barber ?? 0),
    shopCents: Number(row?.shop ?? 0),
    atendimentos: Number(row?.atendimentos ?? 0),
  };
}

/** Ganhos e atendimentos do barbeiro hoje. */
export async function barberTodaySummary(barberId: number) {
  const { start, end } = dayBounds(shopToday());
  const rows = await db
    .select({
      status: appointments.status,
      totalCents: appointments.totalCents,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.barberId, barberId),
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end)
      )
    );
  const ativos = rows.filter((r) =>
    (BLOCKING_STATUSES as readonly string[]).includes(r.status)
  );
  return {
    total: ativos.length,
    concluidos: rows.filter((r) => r.status === "CONCLUIDO").length,
    faturamentoCents: rows
      .filter((r) => r.status === "CONCLUIDO")
      .reduce((acc, r) => acc + r.totalCents, 0),
  };
}

export async function listClients(limit = 50) {
  const rows = await db.query.users.findMany({
    where: eq(users.role, "CLIENT"),
    orderBy: [desc(users.createdAt)],
    limit,
    with: {
      subscriptions: { with: { plan: true } },
      appointments: { columns: { id: true, startsAt: true, status: true } },
    },
  });
  return rows.map((u) => {
    const done = u.appointments.filter((a) => a.status === "CONCLUIDO");
    const last = done.sort(
      (a, b) => b.startsAt.getTime() - a.startsAt.getTime()
    )[0];
    const sub = u.subscriptions.find((s) => s.status === "ATIVA");
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      plan: sub?.plan?.name ?? null,
      visits: done.length,
      lastVisit: last?.startsAt ?? null,
      hasAccount: !!u.passwordHash,
    };
  });
}

/** KPIs do dashboard, todos calculados do banco. */
export async function adminOverview() {
  const now = new Date();
  const { start, end } = dayBounds(shopToday());

  const [hoje, mesCom, assinantes, planosAtivos] = await Promise.all([
    db
      .select({ status: appointments.status, totalCents: appointments.totalCents })
      .from(appointments)
      .where(and(gte(appointments.startsAt, start), lt(appointments.startsAt, end))),
    db
      .select({
        base: sum(appointmentCommissions.baseCents),
        barber: sum(appointmentCommissions.barberCents),
        shop: sum(appointmentCommissions.shopCents),
      })
      .from(appointmentCommissions)
      .where(
        and(
          gte(appointmentCommissions.createdAt, monthStart(now)),
          lt(appointmentCommissions.createdAt, nextMonthStart(now))
        )
      ),
    db
      .select({ planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.status, "ATIVA")),
    db.select({ id: plans.id, priceCents: plans.priceCents }).from(plans),
  ]);

  const precoPorPlano = new Map(planosAtivos.map((p) => [p.id, p.priceCents]));
  const mrrCents = assinantes.reduce(
    (acc, s) => acc + (precoPorPlano.get(s.planId) ?? 0),
    0
  );

  const concluidosHoje = hoje.filter((a) => a.status === "CONCLUIDO");
  const ativosHoje = hoje.filter((a) =>
    (BLOCKING_STATUSES as readonly string[]).includes(a.status)
  );

  return {
    faturamentoHojeCents: concluidosHoje.reduce((a, r) => a + r.totalCents, 0),
    agendamentosHoje: ativosHoje.length,
    concluidosHoje: concluidosHoje.length,
    mrrCents,
    assinantesAtivos: assinantes.length,
    faturamentoMesCents: Number(mesCom[0]?.base ?? 0),
    comissoesMesCents: Number(mesCom[0]?.barber ?? 0),
    casaMesCents: Number(mesCom[0]?.shop ?? 0),
  };
}

/** Faturamento por dia nos últimos 7 dias (mini-gráfico). */
export async function weeklyRevenue() {
  const out: { day: string; dateKey: string; cents: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dateKey = addDaysKey(shopToday(), -i);
    const { start, end } = dayBounds(dateKey);
    const [row] = await db
      .select({ total: sum(appointments.totalCents) })
      .from(appointments)
      .where(
        and(
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          eq(appointments.status, "CONCLUIDO")
        )
      );
    out.push({
      day: weekdayLabel(dateKey),
      dateKey,
      cents: Number(row?.total ?? 0),
    });
  }
  return out;
}

/** Desempenho da equipe no mês. */
export async function teamPerformance() {
  const team = await listTeam();
  return Promise.all(
    team.map(async (b) => ({
      barber: b,
      ...(await barberMonthSummary(b.id)),
    }))
  );
}
