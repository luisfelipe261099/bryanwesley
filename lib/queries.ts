// ───────────────────────────────────────────────────────────
// Leituras usadas pelas telas. Tudo vem do banco — nada de mock.
//
// Sem `db.query.*.with`: o Drizzle implementa relações com LATERAL /
// subquery correlacionada, que o TiDB não executa. Aqui as relações são
// joins explícitos ou uma segunda consulta por lote — portável.
// ───────────────────────────────────────────────────────────
import { and, asc, desc, eq, gte, like, lt, or, inArray, sql, sum, count } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  appointmentCommissions,
  appointmentServices,
  barbers,
  plans,
  planServices,
  planRequests,
  payments,
  services,
  recurringSlots,
  subscriptions,
  users,
  type Appointment,
  type Barber,
  type Plan,
  type Service,
  type Subscription,
  type User,
} from "@/db/schema";
import { BLOCKING_STATUSES } from "./schedule";
import { isPlaceholderPhone } from "./phone";
import {
  shopTimeToUtc,
  parseDateKey,
  shopToday,
  addDays as addDaysKey,
  labelWeekday as weekdayLabel,
} from "./time";
import { monthStart, nextMonthStart } from "./commissions";

export type BarberWithUser = Barber & { user: User };
export type AppointmentItem = typeof appointmentServices.$inferSelect;
export type AppointmentFull = Appointment & {
  barber: BarberWithUser;
  items: AppointmentItem[];
};
export type PlanWithCovers = Plan & { covers: Service[] };

// ───────────────────────── Catálogo ─────────────────────────

export async function listServices() {
  return db
    .select()
    .from(services)
    .where(eq(services.active, true))
    .orderBy(asc(services.sortOrder));
}

export async function listPlans(): Promise<PlanWithCovers[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(asc(plans.sortOrder));
  if (rows.length === 0) return [];

  const covers = await db
    .select({ planId: planServices.planId, service: services })
    .from(planServices)
    .innerJoin(services, eq(services.id, planServices.serviceId))
    .where(inArray(planServices.planId, rows.map((p) => p.id)));

  return rows.map((p) => ({
    ...p,
    covers: covers.filter((c) => c.planId === p.id).map((c) => c.service),
  }));
}

/** Barbeiros ativos com o usuário anexado. */
export async function listTeam(): Promise<BarberWithUser[]> {
  const rows = await db
    .select({ barber: barbers, user: users })
    .from(barbers)
    .innerJoin(users, eq(users.id, barbers.userId))
    .where(eq(barbers.active, true))
    .orderBy(asc(barbers.sortOrder));
  return rows.map((r) => ({ ...r.barber, user: r.user }));
}

/** Um barbeiro pelo id, ou o primeiro da equipe quando id é nulo. */
export async function getBarberWithUser(
  id: number | null | undefined
): Promise<BarberWithUser | null> {
  const rows = await db
    .select({ barber: barbers, user: users })
    .from(barbers)
    .innerJoin(users, eq(users.id, barbers.userId))
    .where(id ? eq(barbers.id, id) : undefined)
    .orderBy(asc(barbers.sortOrder))
    .limit(1);
  return rows[0] ? { ...rows[0].barber, user: rows[0].user } : null;
}

// ───────────────────────── Agendamentos ─────────────────────────

/** Anexa barbeiro (com usuário) e itens a uma lista de agendamentos. */
export async function attachDetails(
  rows: Appointment[]
): Promise<AppointmentFull[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((a) => a.id);
  const barberIds = Array.from(new Set(rows.map((a) => a.barberId)));

  const [team, items] = await Promise.all([
    db
      .select({ barber: barbers, user: users })
      .from(barbers)
      .innerJoin(users, eq(users.id, barbers.userId))
      .where(inArray(barbers.id, barberIds)),
    db
      .select()
      .from(appointmentServices)
      .where(inArray(appointmentServices.appointmentId, ids))
      .orderBy(asc(appointmentServices.id)),
  ]);

  const byBarber = new Map(team.map((t) => [t.barber.id, { ...t.barber, user: t.user }]));
  return rows.map((a) => ({
    ...a,
    barber: byBarber.get(a.barberId)!,
    items: items.filter((i) => i.appointmentId === a.id),
  }));
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
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        barberId ? eq(appointments.barberId, barberId) : undefined
      )
    )
    .orderBy(asc(appointments.startsAt));
  return attachDetails(rows);
}

export async function upcomingForUser(userId: number, limit = 10) {
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clientUserId, userId),
        // Pelo fim, não pelo início: o atendimento em curso continua aqui.
        gte(appointments.endsAt, new Date()),
        inArray(appointments.status, ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"])
      )
    )
    .orderBy(asc(appointments.startsAt))
    .limit(limit);
  return attachDetails(rows);
}

export async function historyForUser(userId: number, limit = 12) {
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clientUserId, userId),
        or(
          inArray(appointments.status, ["CONCLUIDO", "CANCELADO", "NO_SHOW"]),
          // Passou e ninguém deu baixa: não pode sumir da vista do cliente.
          lt(appointments.endsAt, new Date())
        )
      )
    )
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
  return attachDetails(rows);
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

// ───────────────────────── Assinaturas ─────────────────────────

export async function activeSubscription(
  userId: number
): Promise<(Subscription & { plan: Plan }) | undefined> {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(eq(subscriptions.userId, userId), eq(subscriptions.status, "ATIVA"))
    )
    .limit(1);
  return rows[0] ? { ...rows[0].sub, plan: rows[0].plan } : undefined;
}

// ───────────────────────── Barbeiro ─────────────────────────

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
    .innerJoin(appointments, eq(appointments.id, appointmentCommissions.appointmentId))
    .where(
      and(
        eq(appointmentCommissions.barberId, barberId),
        // Mês do atendimento, não do fechamento (veja barberMonthRevenueCents).
        gte(appointments.startsAt, monthStart(ref)),
        lt(appointments.startsAt, nextMonthStart(ref))
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
    .select({ status: appointments.status, totalCents: appointments.totalCents })
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

// ───────────────────────── Clientes ─────────────────────────

/**
 * Clientes para o painel, com busca no banco.
 *
 * A base importada do sistema antigo passa de novecentas pessoas: filtrar
 * no navegador só encontraria quem estivesse na primeira página. O termo
 * vai para o SQL, e `total` é a contagem real, não o tamanho da página.
 */
export type SituacaoCliente =
  | "todos"
  | "assinantes"
  | "inadimplentes"
  | "avulsos"
  | "sem-telefone"
  | "com-conta"
  | "fixo";

export type OrdemCliente = "recentes" | "nome" | "visitas" | "ultima-visita";

export type FiltroClientes = {
  q?: string;
  situacao?: SituacaoCliente;
  ordem?: OrdemCliente;
  limit?: number;
  offset?: number;
};

/** Quantos atendimentos concluídos a pessoa tem — usado para ordenar. */
const visitasDe = sql<number>`(select count(*) from ${appointments}
  where ${appointments.clientUserId} = ${users.id}
    and ${appointments.status} = 'CONCLUIDO')`;

/** Quando foi o último — nulo para quem nunca veio. */
const ultimaVisitaDe = sql<Date | null>`(select max(${appointments.startsAt}) from ${appointments}
  where ${appointments.clientUserId} = ${users.id}
    and ${appointments.status} = 'CONCLUIDO')`;

const temAssinatura = (status: "ATIVA" | "INADIMPLENTE") =>
  sql`exists (select 1 from ${subscriptions}
    where ${subscriptions.userId} = ${users.id}
      and ${subscriptions.status} = ${status})`;

function clientFilter(f: FiltroClientes) {
  const termo = (f.q ?? "").trim();
  const partes = [eq(users.role, "CLIENT")];

  if (termo) {
    const digitos = termo.replace(/\D/g, "");
    // Busca por nome ou por telefone — o telefone é guardado só com dígitos.
    const porNome = like(users.name, `%${termo}%`);
    partes.push(
      digitos.length >= 3 ? or(porNome, like(users.phone, `%${digitos}%`))! : porNome
    );
  }

  switch (f.situacao) {
    case "assinantes":
      partes.push(temAssinatura("ATIVA"));
      break;
    case "inadimplentes":
      // Vencido de verdade: quem já renovou tem uma ATIVA e não conta.
      partes.push(temAssinatura("INADIMPLENTE"), sql`not ${temAssinatura("ATIVA")}`);
      break;
    case "avulsos":
      partes.push(sql`not ${temAssinatura("ATIVA")}`);
      break;
    case "sem-telefone":
      partes.push(like(users.phone, "00%"));
      break;
    case "com-conta":
      partes.push(sql`${users.passwordHash} is not null`);
      break;
    case "fixo":
      partes.push(
        sql`exists (select 1 from ${recurringSlots}
          where ${recurringSlots.userId} = ${users.id}
            and ${recurringSlots.active} = true)`
      );
      break;
    default:
      break;
  }

  return and(...partes);
}

/**
 * Quantos clientes o filtro encontra no banco.
 *
 * A base importada do sistema antigo passa de novecentas pessoas: filtrar
 * no navegador só encontraria quem estivesse na primeira página. O termo e
 * a situação vão para o SQL, e `total` é a contagem real, não o tamanho da
 * página.
 */
export async function countClients(f: FiltroClientes = {}) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(clientFilter(f));
  return Number(row?.n ?? 0);
}

/**
 * O id entra sempre como desempate.
 *
 * A importação cadastra centenas de pessoas no mesmo instante: só por
 * data, o banco pode devolver empates em ordens diferentes a cada
 * consulta — e aí a mesma pessoa apareceria em duas páginas enquanto
 * outra não apareceria em nenhuma.
 */
function ordenacao(ordem: OrdemCliente = "recentes") {
  switch (ordem) {
    case "nome":
      return [asc(users.name), asc(users.id)];
    case "visitas":
      return [desc(visitasDe), desc(users.createdAt), desc(users.id)];
    case "ultima-visita":
      // Quem nunca veio vai para o fim, não para o topo.
      return [sql`${ultimaVisitaDe} is null`, desc(ultimaVisitaDe), desc(users.id)];
    default:
      return [desc(users.createdAt), desc(users.id)];
  }
}

export async function listClients(f: FiltroClientes = {}) {
  const rows = await db
    .select()
    .from(users)
    .where(clientFilter(f))
    .orderBy(...ordenacao(f.ordem))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  if (rows.length === 0) return [];
  const ids = rows.map((u) => u.id);

  const [subs, appts, fixos] = await Promise.all([
    db
      .select({ sub: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(inArray(subscriptions.userId, ids)),
    db
      .select({
        id: appointments.id,
        clientUserId: appointments.clientUserId,
        startsAt: appointments.startsAt,
        status: appointments.status,
      })
      .from(appointments)
      .where(inArray(appointments.clientUserId, ids)),
    db
      .select({ userId: recurringSlots.userId })
      .from(recurringSlots)
      .where(
        and(
          inArray(recurringSlots.userId, ids),
          eq(recurringSlots.active, true)
        )
      ),
  ]);
  const comFixo = new Set(fixos.map((f) => f.userId));

  return rows.map((u) => {
    const mine = appts.filter((a) => a.clientUserId === u.id);
    const done = mine.filter((a) => a.status === "CONCLUIDO");
    const last = done.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
    const proximos = mine.filter(
      (a) =>
        a.startsAt.getTime() > Date.now() &&
        ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"].includes(a.status)
    ).length;
    const mySubs = subs.filter((s) => s.sub.userId === u.id);
    const active = mySubs.find((s) => s.sub.status === "ATIVA");
    const overdue = mySubs.find((s) => s.sub.status === "INADIMPLENTE");
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      plan: active?.plan.name ?? null,
      overduePlan: !active && overdue ? overdue.plan.name : null,
      renewsAt: active?.sub.renewsAt ?? null,
      visits: done.length,
      lastVisit: last?.startsAt ?? null,
      /** Horários futuros ainda em aberto — o que interessa no atendimento. */
      upcoming: proximos,
      hasAccount: !!u.passwordHash,
      hasFixedSlot: comFixo.has(u.id),
      // Importado sem telefone: aparece com aviso e pede para completar.
      phonePending: isPlaceholderPhone(u.phone),
    };
  });
}

/**
 * Tudo que a ficha do cliente mostra, numa consulta só por assunto.
 *
 * O painel precisava abrir o cliente para agendar, ver o histórico, o
 * plano e os pagamentos; antes essas informações só existiam espalhadas
 * pelas telas do próprio cliente.
 */
export async function clientDetail(id: number) {
  const pessoa = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!pessoa || pessoa.role !== "CLIENT") return null;

  const [proximos, historico, concluidos, assinaturas, pagamentos, fixos] =
    await Promise.all([
      upcomingForUser(id, 20),
      historyForUser(id, 20),
      countForUser(id),
      db
        .select({ sub: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.userId, id))
        .orderBy(desc(subscriptions.id)),
      db
        .select()
        .from(payments)
        .where(eq(payments.userId, id))
        .orderBy(desc(payments.createdAt))
        .limit(20),
      db
        .select({ slot: recurringSlots, barber: barbers, user: users })
        .from(recurringSlots)
        .innerJoin(barbers, eq(barbers.id, recurringSlots.barberId))
        .innerJoin(users, eq(users.id, barbers.userId))
        .where(and(eq(recurringSlots.userId, id), eq(recurringSlots.active, true))),
    ]);

  const ativa = assinaturas.find((a) => a.sub.status === "ATIVA");
  const vencida = !ativa
    ? assinaturas.find((a) => a.sub.status === "INADIMPLENTE")
    : undefined;

  const gasto = historico
    .filter((a) => a.status === "CONCLUIDO")
    .reduce((acc, a) => acc + a.totalCents, 0);

  return {
    cliente: {
      id: pessoa.id,
      name: pessoa.name,
      phone: pessoa.phone,
      email: pessoa.email,
      createdAt: pessoa.createdAt,
      hasAccount: !!pessoa.passwordHash,
      phonePending: isPlaceholderPhone(pessoa.phone),
    },
    proximos,
    historico,
    concluidos,
    /** Soma do que já pagou nos atendimentos que aparecem no histórico. */
    gasto,
    assinatura: ativa ?? vencida ?? null,
    assinaturas,
    pagamentos,
    fixo: fixos[0]
      ? {
          frequency: fixos[0].slot.frequency,
          weekday: fixos[0].slot.weekday,
          dayOfMonth: fixos[0].slot.dayOfMonth,
          minutesOfDay: fixos[0].slot.minutesOfDay,
          barberName: fixos[0].user.name,
        }
      : null,
  };
}

export type ClientDetail = NonNullable<Awaited<ReturnType<typeof clientDetail>>>;

// ───────────────────────── Admin ─────────────────────────

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
      .innerJoin(appointments, eq(appointments.id, appointmentCommissions.appointmentId))
      .where(
        and(
          gte(appointments.startsAt, monthStart(now)),
          lt(appointments.startsAt, nextMonthStart(now))
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
    out.push({ day: weekdayLabel(dateKey), dateKey, cents: Number(row?.total ?? 0) });
  }
  return out;
}

/** Desempenho da equipe no mês. */
export async function teamPerformance() {
  const team = await listTeam();
  return Promise.all(
    team.map(async (b) => ({ barber: b, ...(await barberMonthSummary(b.id)) }))
  );
}

/** Pedidos de plano feitos pelo site e ainda não resolvidos. */
export async function openPlanRequests() {
  const rows = await db
    .select({ req: planRequests, user: users, plan: plans })
    .from(planRequests)
    .innerJoin(users, eq(users.id, planRequests.userId))
    .innerJoin(plans, eq(plans.id, planRequests.planId))
    .where(eq(planRequests.status, "ABERTA"))
    .orderBy(desc(planRequests.createdAt))
    .limit(20);
  return rows.map((r) => ({
    id: r.req.id,
    cycle: r.req.cycle,
    clientName: r.user.name,
    clientPhone: r.user.phone,
    planName: r.plan.name,
    priceCents:
      r.req.cycle === "ANUAL" ? r.plan.annualPriceCents : r.plan.priceCents,
  }));
}
