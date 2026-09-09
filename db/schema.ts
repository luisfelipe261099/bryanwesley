// ───────────────────────────────────────────────────────────
// Esquema do banco (Postgres + Drizzle).
// A regra de ouro fica no banco, não na aplicação: a constraint
// de exclusão em `appointments` torna impossível gravar dois
// atendimentos sobrepostos para o mesmo barbeiro.
// ───────────────────────────────────────────────────────────
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["ADMIN", "BARBER", "CLIENT"]);

export const apptStatusEnum = pgEnum("appt_status", [
  "PENDENTE",
  "CONFIRMADO",
  "EM_ANDAMENTO",
  "CONCLUIDO",
  "CANCELADO",
  "NO_SHOW",
]);

export const apptKindEnum = pgEnum("appt_kind", ["AVULSO", "ASSINANTE"]);

export const subStatusEnum = pgEnum("sub_status", [
  "ATIVA",
  "CANCELADA",
  "INADIMPLENTE",
]);

export const subCycleEnum = pgEnum("sub_cycle", ["MENSAL", "ANUAL"]);

export const notifStatusEnum = pgEnum("notif_status", [
  "PENDENTE",
  "ENVIADA",
  "ERRO",
  "CANCELADA",
]);

export const notifChannelEnum = pgEnum("notif_channel", [
  "WHATSAPP",
  "SMS",
  "EMAIL",
]);

export const notifKindEnum = pgEnum("notif_kind", [
  "AGENDAMENTO_CRIADO",
  "LEMBRETE_24H",
  "LEMBRETE_2H",
  "AGENDAMENTO_CANCELADO",
  "AGENDAMENTO_REMARCADO",
  "ASSINATURA_RENOVADA",
  "ASSINATURA_FALHOU",
]);

// ───────────────────────── Usuários ─────────────────────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Telefone é o login do cliente; normalizado só com dígitos.
    phone: text("phone").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("CLIENT"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("users_phone_idx").on(t.phone),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

// ───────────────────────── Barbeiros ─────────────────────────

export const barbers = pgTable("barbers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  shortName: text("short_name").notNull(),
  title: text("title").notNull(),
  rating: integer("rating").notNull().default(50), // 50 = 5.0
  commissionPct: integer("commission_pct").notNull().default(40),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ───────────────────────── Serviços ─────────────────────────

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  durationMin: integer("duration_min").notNull(),
  tag: text("tag"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ───────────────────────── Planos ─────────────────────────

export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kicker: text("kicker").notNull().default(""),
  tagline: text("tagline").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  annualPriceCents: integer("annual_price_cents").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  highlight: boolean("highlight").notNull().default(false),
  badge: text("badge"),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Quais serviços cada plano cobre (o assinante agenda sem pagar).
export const planServices = pgTable(
  "plan_services",
  {
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.planId, t.serviceId] }) })
);

// ───────────────────────── Assinaturas ─────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subStatusEnum("status").notNull().default("ATIVA"),
    cycle: subCycleEnum("cycle").notNull().default("MENSAL"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    renewsAt: timestamp("renews_at", { withTimezone: true }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => ({ userIdx: index("subscriptions_user_idx").on(t.userId) })
);

// ───────────────────────── Agendamentos ─────────────────────────

export const appointments = pgTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(), // código curto p/ o cliente
    // Cliente pode não ter conta (agendamento avulso "sem cadastro").
    clientUserId: integer("client_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone").notNull(),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    status: apptStatusEnum("status").notNull().default("CONFIRMADO"),
    kind: apptKindEnum("kind").notNull().default("AVULSO"),
    subscriptionId: integer("subscription_id").references(
      () => subscriptions.id,
      { onDelete: "set null" }
    ),
    notes: text("notes"),
    // Token do QR que o cliente apresenta para o barbeiro validar a chegada.
    checkinToken: text("checkin_token"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    // Percentual do barbeiro congelado no momento do atendimento.
    barberPctSnapshot: integer("barber_pct_snapshot"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    barberStartIdx: index("appointments_barber_start_idx").on(
      t.barberId,
      t.startsAt
    ),
    clientIdx: index("appointments_client_idx").on(t.clientUserId),
    phoneIdx: index("appointments_phone_idx").on(t.clientPhone),
  })
);

// Snapshot dos serviços no momento do agendamento — preço não muda
// retroativamente se o admin reajustar a tabela depois.
export const appointmentServices = pgTable("appointment_services", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").references(() => services.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  durationMin: integer("duration_min").notNull(),
});

// ───────────────────────── Bloqueios de agenda ─────────────────────────

// barberId nulo = bloqueio da barbearia inteira (feriado, folga coletiva).
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: serial("id").primaryKey(),
    barberId: integer("barber_id").references(() => barbers.id, {
      onDelete: "cascade",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ rangeIdx: index("schedule_blocks_range_idx").on(t.startsAt) })
);

// ───────────────────────── Configurações ─────────────────────────

// Linha única (id = 1) com as regras da operação.
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  acceptingBookings: boolean("accepting_bookings").notNull().default(true),
  minAdvanceHours: integer("min_advance_hours").notNull().default(2),
  slotMinutes: integer("slot_minutes").notNull().default(30),
  openMinute: integer("open_minute").notNull().default(9 * 60), // 09:00
  closeMinute: integer("close_minute").notNull().default(20 * 60), // 20:00
  closedWeekdays: jsonb("closed_weekdays").$type<number[]>().notNull().default([0, 1]),
  maxAdvanceDays: integer("max_advance_days").notNull().default(60),
  // Divisão padrão: metade do barbeiro, metade da barbearia.
  defaultBarberPct: integer("default_barber_pct").notNull().default(50),
  // Base de comissão no atendimento de assinante: o preço de tabela do
  // serviço entregue ("PRECO_TABELA") ou o rateio da mensalidade ("RATEIO").
  subscriptionCommissionBase: text("subscription_commission_base")
    .notNull()
    .default("PRECO_TABELA"),
  // Nome/telefone que assinam as mensagens enviadas ao cliente.
  shopName: text("shop_name").notNull().default("Bryan Wesley Barbearia"),
  shopPhone: text("shop_phone").notNull().default(""),
});

// ───────────────────────── Jornada por barbeiro ─────────────────────────

// Cada barbeiro pode ter a própria agenda semanal. Sem linhas aqui,
// vale o horário geral da loja em `settings`.
export const barberHours = pgTable(
  "barber_hours",
  {
    id: serial("id").primaryKey(),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0 = domingo
    openMinute: integer("open_minute").notNull(),
    closeMinute: integer("close_minute").notNull(),
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
export const commissionTiers = pgTable("commission_tiers", {
  id: serial("id").primaryKey(),
  barberId: integer("barber_id").references(() => barbers.id, {
    onDelete: "cascade",
  }),
  minRevenueCents: integer("min_revenue_cents").notNull().default(0),
  barberPct: integer("barber_pct").notNull(),
  label: text("label"),
});

// Razão de comissão por atendimento. Como o cliente pode passar por
// barbeiros diferentes, a divisão é gravada atendimento a atendimento.
export const appointmentCommissions = pgTable(
  "appointment_commissions",
  {
    id: serial("id").primaryKey(),
    appointmentId: integer("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    // Base de cálculo: valor do avulso ou o rateio da assinatura.
    baseCents: integer("base_cents").notNull(),
    barberPct: integer("barber_pct").notNull(),
    barberCents: integer("barber_cents").notNull(),
    shopCents: integer("shop_cents").notNull(),
    fromSubscription: boolean("from_subscription").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    apptIdx: uniqueIndex("appointment_commissions_appt_idx").on(t.appointmentId),
    barberIdx: index("appointment_commissions_barber_idx").on(t.barberId),
  })
);

// ───────────────────────── Horário fixo ─────────────────────────

// O assinante reserva o mesmo dia/hora toda semana ou todo mês.
// Ter o fixo não impede agendar horários avulsos além dele.
export const recurringSlots = pgTable(
  "recurring_slots",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    // "SEMANAL" usa weekday; "MENSAL" usa dayOfMonth.
    frequency: text("frequency").notNull().default("SEMANAL"),
    weekday: integer("weekday"),
    dayOfMonth: integer("day_of_month"),
    minutesOfDay: integer("minutes_of_day").notNull(),
    serviceIds: jsonb("service_ids").$type<number[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    startsOn: text("starts_on").notNull(), // YYYY-MM-DD
    endsOn: text("ends_on"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ userIdx: index("recurring_slots_user_idx").on(t.userId) })
);

// ───────────────────────── Notificações ─────────────────────────

// Caixa de saída: a aplicação só enfileira; quem entrega é o worker.
// Assim trocar de provedor (WhatsApp, SMS) não mexe nas regras de negócio.
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    appointmentId: integer("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    phone: text("phone").notNull(),
    kind: notifKindEnum("kind").notNull(),
    channel: notifChannelEnum("channel").notNull().default("WHATSAPP"),
    body: text("body").notNull(),
    status: notifStatusEnum("status").notNull().default("PENDENTE"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingIdx: index("notifications_pending_idx").on(
      t.status,
      t.scheduledFor
    ),
  })
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

export const appointmentsRelations = relations(
  appointments,
  ({ one, many }) => ({
    barber: one(barbers, {
      fields: [appointments.barberId],
      references: [barbers.id],
    }),
    client: one(users, {
      fields: [appointments.clientUserId],
      references: [users.id],
    }),
    items: many(appointmentServices),
  })
);

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
export type ApptStatus = Appointment["status"];
