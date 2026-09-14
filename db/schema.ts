// ───────────────────────────────────────────────────────────
// Esquema do banco — MySQL / TiDB (Drizzle mysql-core).
//
// A garantia contra reserva dupla NÃO é uma constraint aqui (MySQL não
// tem exclusion constraint): é a trava `booking_locks` + SELECT FOR UPDATE
// dentro da transação de agendamento (lib/appointments.ts).
// ───────────────────────────────────────────────────────────
import {
  mysqlTable,
  mysqlEnum,
  int,
  varchar,
  text,
  boolean,
  datetime,
  customType,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/mysql-core";
import { relations, sql } from "drizzle-orm";

/** Coluna JSON que devolve objeto mesmo quando o driver entrega string. */
function jsonCol<T>(name: string) {
  return customType<{ data: T; driverData: string | T }>({
    dataType: () => "json",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) =>
      typeof value === "string" ? (JSON.parse(value) as T) : (value as T),
  })(name);
}

/** datetime(3) em UTC; o driver está fixado em timezone "Z". */
const ts = (name: string) => datetime(name, { mode: "date", fsp: 3 });
const tsNow = (name: string) =>
  ts(name).notNull().default(sql`CURRENT_TIMESTAMP(3)`);

export const ROLES = ["ADMIN", "BARBER", "CLIENT"] as const;
export const APPT_STATUSES = [
  "PENDENTE",
  "CONFIRMADO",
  "EM_ANDAMENTO",
  "CONCLUIDO",
  "CANCELADO",
  "NO_SHOW",
] as const;
export const APPT_KINDS = ["AVULSO", "ASSINANTE"] as const;
export const SUB_STATUSES = ["ATIVA", "CANCELADA", "INADIMPLENTE"] as const;
export const SUB_CYCLES = ["MENSAL", "ANUAL"] as const;
export const NOTIF_STATUSES = ["PENDENTE", "ENVIADA", "ERRO", "CANCELADA"] as const;
export const NOTIF_CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
export const NOTIF_KINDS = [
  "AGENDAMENTO_CRIADO",
  "LEMBRETE_24H",
  "LEMBRETE_2H",
  "AGENDAMENTO_CANCELADO",
  "AGENDAMENTO_REMARCADO",
  "ASSINATURA_RENOVADA",
  "ASSINATURA_FALHOU",
] as const;

// ───────────────────────── Usuários ─────────────────────────

export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    // Telefone é o login do cliente; normalizado só com dígitos.
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 190 }),
    passwordHash: varchar("password_hash", { length: 100 }),
    role: mysqlEnum("role", ROLES).notNull().default("CLIENT"),
    active: boolean("active").notNull().default(true),
    // Força bruta: após 5 erros seguidos a conta trava por 15 minutos.
    failedLogins: int("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    // Sobe a cada troca/redefinição de senha: sessões antigas (cookie de
    // 30 dias) carregam a versão com que nasceram e deixam de valer.
    tokenVersion: int("token_version").notNull().default(0),
    createdAt: tsNow("created_at"),
  },
  (t) => ({
    phoneIdx: uniqueIndex("users_phone_idx").on(t.phone),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

// ───────────────────────── Barbeiros ─────────────────────────

export const barbers = mysqlTable(
  "barbers",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 80 }).notNull(),
    shortName: varchar("short_name", { length: 60 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    rating: int("rating").notNull().default(50), // 50 = 5.0
    commissionPct: int("commission_pct").notNull().default(40),
    // Meta de comissão do mês, mostrada na barra do painel do barbeiro.
    monthlyGoalCents: int("monthly_goal_cents").notNull().default(700000),
    active: boolean("active").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => ({ slugIdx: uniqueIndex("barbers_slug_idx").on(t.slug) })
);

// ───────────────────────── Serviços ─────────────────────────

export const services = mysqlTable(
  "services",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 255 }).notNull().default(""),
    priceCents: int("price_cents").notNull(),
    durationMin: int("duration_min").notNull(),
    tag: varchar("tag", { length: 40 }),
    active: boolean("active").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => ({ slugIdx: uniqueIndex("services_slug_idx").on(t.slug) })
);

// ───────────────────────── Planos ─────────────────────────

export const plans = mysqlTable(
  "plans",
  {
    id: int("id").autoincrement().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kicker: varchar("kicker", { length: 60 }).notNull().default(""),
    tagline: varchar("tagline", { length: 160 }).notNull().default(""),
    priceCents: int("price_cents").notNull(),
    annualPriceCents: int("annual_price_cents").notNull(),
    features: jsonCol<string[]>("features").notNull(),
    highlight: boolean("highlight").notNull().default(false),
    badge: varchar("badge", { length: 40 }),
    active: boolean("active").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => ({ slugIdx: uniqueIndex("plans_slug_idx").on(t.slug) })
);

// Quais serviços cada plano cobre (o assinante agenda sem pagar).
export const planServices = mysqlTable(
  "plan_services",
  {
    planId: int("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    serviceId: int("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.planId, t.serviceId] }) })
);

// ───────────────────────── Assinaturas ─────────────────────────

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: int("plan_id")
      .notNull()
      .references(() => plans.id),
    status: mysqlEnum("status", SUB_STATUSES).notNull().default("ATIVA"),
    cycle: mysqlEnum("cycle", SUB_CYCLES).notNull().default("MENSAL"),
    startedAt: tsNow("started_at"),
    renewsAt: ts("renews_at").notNull(),
    canceledAt: ts("canceled_at"),
  },
  (t) => ({ userIdx: index("subscriptions_user_idx").on(t.userId) })
);

// ───────────────────────── Agendamentos ─────────────────────────

export const appointments = mysqlTable(
  "appointments",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 8 }).notNull(), // código curto p/ o cliente
    // Cliente pode não ter conta (agendamento avulso "sem cadastro").
    clientUserId: int("client_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clientName: varchar("client_name", { length: 120 }).notNull(),
    clientPhone: varchar("client_phone", { length: 20 }).notNull(),
    barberId: int("barber_id")
      .notNull()
      .references(() => barbers.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    durationMin: int("duration_min").notNull(),
    totalCents: int("total_cents").notNull().default(0),
    status: mysqlEnum("status", APPT_STATUSES).notNull().default("CONFIRMADO"),
    kind: mysqlEnum("kind", APPT_KINDS).notNull().default("AVULSO"),
    subscriptionId: int("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    // Token do QR que o cliente apresenta para o barbeiro validar a chegada.
    checkinToken: varchar("checkin_token", { length: 40 }),
    checkedInAt: ts("checked_in_at"),
    // Percentual do barbeiro congelado no momento do atendimento.
    barberPctSnapshot: int("barber_pct_snapshot"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: tsNow("created_at"),
  },
  (t) => ({
    codeIdx: uniqueIndex("appointments_code_unique").on(t.code),
    tokenIdx: uniqueIndex("appointments_checkin_token_idx").on(t.checkinToken),
    barberStartIdx: index("appointments_barber_start_idx").on(t.barberId, t.startsAt),
    clientIdx: index("appointments_client_idx").on(t.clientUserId),
    phoneIdx: index("appointments_phone_idx").on(t.clientPhone),
  })
);

// Snapshot dos serviços no momento do agendamento — preço não muda
// retroativamente se o admin reajustar a tabela depois.
export const appointmentServices = mysqlTable("appointment_services", {
  id: int("id").autoincrement().primaryKey(),
  appointmentId: int("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  serviceId: int("service_id").references(() => services.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 120 }).notNull(),
  priceCents: int("price_cents").notNull(),
  durationMin: int("duration_min").notNull(),
});

// ───────────────────────── Bloqueios de agenda ─────────────────────────

// barberId nulo = bloqueio da barbearia inteira (feriado, folga coletiva).
export const scheduleBlocks = mysqlTable(
  "schedule_blocks",
  {
    id: int("id").autoincrement().primaryKey(),
    barberId: int("barber_id").references(() => barbers.id, {
      onDelete: "cascade",
    }),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    reason: varchar("reason", { length: 160 }),
    createdAt: tsNow("created_at"),
  },
  (t) => ({ rangeIdx: index("schedule_blocks_range_idx").on(t.startsAt) })
);

// ───────────────────────── Jornada por barbeiro ─────────────────────────

// Cada barbeiro pode ter a própria agenda semanal. Sem linhas aqui,
// vale o horário geral da loja em `settings`.
export const barberHours = mysqlTable(
  "barber_hours",
  {
    id: int("id").autoincrement().primaryKey(),
    barberId: int("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    weekday: int("weekday").notNull(), // 0 = domingo
    openMinute: int("open_minute").notNull(),
    closeMinute: int("close_minute").notNull(),
  },
  (t) => ({
    barberWeekdayIdx: uniqueIndex("barber_hours_barber_weekday_idx").on(
      t.barberId,
      t.weekday
    ),
  })
);

// ───────────────────────── Comissões ─────────────────────────

// Faixas de comissão: quando o barbeiro passa de `minRevenueCents` no mês,
// o percentual dele sobe. barberId nulo = regra vale para todos.
export const commissionTiers = mysqlTable("commission_tiers", {
  id: int("id").autoincrement().primaryKey(),
  barberId: int("barber_id").references(() => barbers.id, {
    onDelete: "cascade",
  }),
  minRevenueCents: int("min_revenue_cents").notNull().default(0),
  barberPct: int("barber_pct").notNull(),
  label: varchar("label", { length: 60 }),
});

// Razão de comissão por atendimento. Como o cliente pode passar por
// barbeiros diferentes, a divisão é gravada atendimento a atendimento.
export const appointmentCommissions = mysqlTable(
  "appointment_commissions",
  {
    id: int("id").autoincrement().primaryKey(),
    appointmentId: int("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    barberId: int("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    // Base de cálculo: valor do avulso ou o rateio da assinatura.
    baseCents: int("base_cents").notNull(),
    barberPct: int("barber_pct").notNull(),
    barberCents: int("barber_cents").notNull(),
    shopCents: int("shop_cents").notNull(),
    fromSubscription: boolean("from_subscription").notNull().default(false),
    createdAt: tsNow("created_at"),
  },
  (t) => ({
    apptIdx: uniqueIndex("appointment_commissions_appt_idx").on(t.appointmentId),
    barberIdx: index("appointment_commissions_barber_idx").on(t.barberId),
  })
);

// ───────────────────────── Horário fixo ─────────────────────────

// O assinante reserva o mesmo dia/hora toda semana ou todo mês.
// Ter o fixo não impede agendar horários avulsos além dele.
export const recurringSlots = mysqlTable(
  "recurring_slots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    barberId: int("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    // "SEMANAL" usa weekday; "MENSAL" usa dayOfMonth.
    frequency: varchar("frequency", { length: 10 }).notNull().default("SEMANAL"),
    weekday: int("weekday"),
    dayOfMonth: int("day_of_month"),
    minutesOfDay: int("minutes_of_day").notNull(),
    serviceIds: jsonCol<number[]>("service_ids").notNull(),
    active: boolean("active").notNull().default(true),
    startsOn: varchar("starts_on", { length: 10 }).notNull(), // YYYY-MM-DD
    endsOn: varchar("ends_on", { length: 10 }),
    createdAt: tsNow("created_at"),
  },
  (t) => ({ userIdx: index("recurring_slots_user_idx").on(t.userId) })
);

// ───────────────────────── Notificações ─────────────────────────

// Caixa de saída: a aplicação só enfileira; quem entrega é o worker.
export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").references(() => users.id, { onDelete: "cascade" }),
    appointmentId: int("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    phone: varchar("phone", { length: 20 }).notNull(),
    kind: mysqlEnum("kind", NOTIF_KINDS).notNull(),
    channel: mysqlEnum("channel", NOTIF_CHANNELS).notNull().default("WHATSAPP"),
    body: text("body").notNull(),
    status: mysqlEnum("status", NOTIF_STATUSES).notNull().default("PENDENTE"),
    scheduledFor: tsNow("scheduled_for"),
    sentAt: ts("sent_at"),
    attempts: int("attempts").notNull().default(0),
    error: varchar("error", { length: 500 }),
    createdAt: tsNow("created_at"),
  },
  (t) => ({
    pendingIdx: index("notifications_pending_idx").on(t.status, t.scheduledFor),
  })
);

// ───────────────────────── Trava de reserva ─────────────────────────

// Uma linha por (barbeiro, dia). A transação de agendamento faz
// SELECT ... FOR UPDATE nela antes de conferir o horário, serializando
// as reservas daquele barbeiro naquele dia. Em MySQL/TiDB é a garantia
// contra reserva dupla.
export const bookingLocks = mysqlTable(
  "booking_locks",
  {
    barberId: int("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    dateKey: varchar("date_key", { length: 10 }).notNull(), // YYYY-MM-DD na loja
  },
  (t) => ({ pk: primaryKey({ columns: [t.barberId, t.dateKey] }) })
);

// ───────────────────────── Configurações ─────────────────────────

// Linha única (id = 1) com as regras da operação. A aplicação sempre lê
// e grava o id 1 — sem CHECK, que o TiDB não garante em todas as versões.
export const settings = mysqlTable("settings", {
  id: int("id").primaryKey().default(1),
  acceptingBookings: boolean("accepting_bookings").notNull().default(true),
  minAdvanceHours: int("min_advance_hours").notNull().default(2),
  slotMinutes: int("slot_minutes").notNull().default(30),
  openMinute: int("open_minute").notNull().default(9 * 60), // 09:00
  closeMinute: int("close_minute").notNull().default(20 * 60), // 20:00
  closedWeekdays: jsonCol<number[]>("closed_weekdays").notNull(),
  maxAdvanceDays: int("max_advance_days").notNull().default(60),
  // Divisão padrão: metade do barbeiro, metade da barbearia.
  defaultBarberPct: int("default_barber_pct").notNull().default(50),
  // Base de comissão no atendimento de assinante: preço de tabela do
  // serviço entregue ("PRECO_TABELA") ou rateio da mensalidade ("RATEIO").
  subscriptionCommissionBase: varchar("subscription_commission_base", { length: 20 })
    .notNull()
    .default("PRECO_TABELA"),
  // Identidade da barbearia — editável no painel, sem mexer no código.
  shopName: varchar("shop_name", { length: 120 })
    .notNull()
    .default("Bryan Wesley Barbearia"),
  shopUnit: varchar("shop_unit", { length: 80 }).notNull().default("Unidade Cajuru"),
  shopPhone: varchar("shop_phone", { length: 20 }).notNull().default(""),
  shopAddress: varchar("shop_address", { length: 200 }).notNull().default(""),
  shopInstagram: varchar("shop_instagram", { length: 80 }).notNull().default(""),
  shopHoursLabel: varchar("shop_hours_label", { length: 80 })
    .notNull()
    .default("Ter — Sáb · 09h às 20h"),
  // Última vez que a fila de notificações foi varrida. Serve de trava
  // (compare-and-swap) para o heartbeat do painel não rodar em duplicidade
  // e de indicador no /admin/notificacoes.
  lastDispatchAt: ts("last_dispatch_at"),
});

// ───────────────────────── Pagamentos ─────────────────────────

export const PAYMENT_STATUSES = ["PENDENTE", "PAGO", "EXPIRADO", "CANCELADO"] as const;
export const PAYMENT_KINDS = ["ASSINATURA", "AVULSO"] as const;

// Cobrança gerada para o cliente (link da InfinitePay). O webhook dá baixa
// e a reconferência via payment_check evita confiar só no callback.
export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    orderNsu: varchar("order_nsu", { length: 40 }).notNull(),
    userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
    subscriptionId: int("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    appointmentId: int("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    kind: mysqlEnum("kind", PAYMENT_KINDS).notNull(),
    amountCents: int("amount_cents").notNull(),
    description: varchar("description", { length: 160 }).notNull(),
    status: mysqlEnum("status", PAYMENT_STATUSES).notNull().default("PENDENTE"),
    provider: varchar("provider", { length: 30 }).notNull().default("infinitepay"),
    checkoutUrl: varchar("checkout_url", { length: 500 }),
    transactionNsu: varchar("transaction_nsu", { length: 60 }),
    slug: varchar("slug", { length: 60 }),
    receiptUrl: varchar("receipt_url", { length: 500 }),
    paidAt: ts("paid_at"),
    createdAt: tsNow("created_at"),
  },
  (t) => ({
    nsuIdx: uniqueIndex("payments_order_nsu_idx").on(t.orderNsu),
    userIdx: index("payments_user_idx").on(t.userId),
  })
);

// ───────────────────────── Solicitações de plano ─────────────────────────

export const REQUEST_STATUSES = ["ABERTA", "ATENDIDA", "RECUSADA"] as const;

// O cliente pede um plano pelo site; o admin ativa (ou o pagamento ativa).
export const planRequests = mysqlTable(
  "plan_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: int("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    cycle: mysqlEnum("cycle", SUB_CYCLES).notNull().default("MENSAL"),
    status: mysqlEnum("status", REQUEST_STATUSES).notNull().default("ABERTA"),
    note: varchar("note", { length: 300 }),
    createdAt: tsNow("created_at"),
  },
  (t) => ({ userIdx: index("plan_requests_user_idx").on(t.userId) })
);

// ───────────────────────── Relações ─────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  barber: one(barbers, { fields: [users.id], references: [barbers.userId] }),
  subscriptions: many(subscriptions),
  appointments: many(appointments),
}));

export const barbersRelations = relations(barbers, ({ one, many }) => ({
  user: one(users, { fields: [barbers.userId], references: [users.id] }),
  appointments: many(appointments),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  planServices: many(planServices),
  subscriptions: many(subscriptions),
}));

export const planServicesRelations = relations(planServices, ({ one }) => ({
  plan: one(plans, { fields: [planServices.planId], references: [plans.id] }),
  service: one(services, {
    fields: [planServices.serviceId],
    references: [services.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  barber: one(barbers, {
    fields: [appointments.barberId],
    references: [barbers.id],
  }),
  client: one(users, {
    fields: [appointments.clientUserId],
    references: [users.id],
  }),
  items: many(appointmentServices),
}));

export const appointmentServicesRelations = relations(
  appointmentServices,
  ({ one }) => ({
    appointment: one(appointments, {
      fields: [appointmentServices.appointmentId],
      references: [appointments.id],
    }),
    service: one(services, {
      fields: [appointmentServices.serviceId],
      references: [services.id],
    }),
  })
);

export type User = typeof users.$inferSelect;
export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type BarberHours = typeof barberHours.$inferSelect;
export type RecurringSlot = typeof recurringSlots.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AppointmentCommission = typeof appointmentCommissions.$inferSelect;
export type CommissionTier = typeof commissionTiers.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PlanRequest = typeof planRequests.$inferSelect;
export type ApptStatus = Appointment["status"];
