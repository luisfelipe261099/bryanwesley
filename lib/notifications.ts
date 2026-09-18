// ───────────────────────────────────────────────────────────
// Notificações em caixa de saída (outbox).
// A regra de negócio só ENFILEIRA; a entrega é de um worker que chama
// o provedor. Trocar WhatsApp por SMS não mexe em nada aqui.
// ───────────────────────────────────────────────────────────
import { and, eq, lte, desc, inArray, count as drizzleCount } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, appointments } from "@/db/schema";
import { getSettings } from "./schedule";
import { formatShopTime, labelFullDate, utcToShopParts } from "./time";
import { formatBRL } from "./money";

export type NotifKind = (typeof notifications.$inferSelect)["kind"];

function whenLabel(startsAt: Date) {
  const p = utcToShopParts(startsAt);
  return `${labelFullDate(p.dateKey)} às ${formatShopTime(startsAt)}`;
}

/** Mensagens em português, prontas para o WhatsApp. */
export async function renderTemplate(
  kind: NotifKind,
  appt: typeof appointments.$inferSelect,
  extra: { barberName?: string; shopName?: string } = {}
) {
  const shop = extra.shopName ?? (await getSettings()).shopName;
  const first = appt.clientName.split(" ")[0];
  const quando = whenLabel(appt.startsAt);
  const comQuem = extra.barberName ? ` com ${extra.barberName}` : "";
  const valor =
    appt.kind === "ASSINANTE"
      ? "Incluso no seu plano."
      : `Valor: ${formatBRL(appt.totalCents)}.`;

  switch (kind) {
    case "AGENDAMENTO_CRIADO":
      return `Fala, ${first}! Seu horário na ${shop} está confirmado para ${quando}${comQuem}. ${valor} Código: ${appt.code}.`;
    case "LEMBRETE_24H":
      // Sem "amanhã": a data completa já está no texto, e a mensagem pode
      // sair com atraso — aí "amanhã" viraria mentira.
      return `Oi, ${first}! Passando pra lembrar do seu horário: ${quando}${comQuem}. Até lá! — ${shop}`;
    case "LEMBRETE_2H":
      return `${first}, seu horário é daqui a pouco: ${quando}${comQuem}. Te esperamos na ${shop}!`;
    case "AGENDAMENTO_CANCELADO":
      return `${first}, seu horário de ${quando} na ${shop} foi cancelado. Quando quiser, é só reagendar.`;
    case "AGENDAMENTO_REMARCADO":
      return `${first}, seu horário na ${shop} foi remarcado para ${quando}${comQuem}. Código: ${appt.code}.`;
    case "ASSINATURA_RENOVADA":
      return `${first}, sua assinatura na ${shop} foi renovada. Bom corte!`;
    case "ASSINATURA_FALHOU":
      return `${first}, não conseguimos renovar sua assinatura na ${shop}. Atualize seu pagamento para não perder os benefícios.`;
  }
}

/** Enfileira uma mensagem para envio imediato ou agendado. */
export async function queueNotification(opts: {
  kind: NotifKind;
  appointment: typeof appointments.$inferSelect;
  barberName?: string;
  scheduledFor?: Date;
}) {
  const body = await renderTemplate(opts.kind, opts.appointment, {
    barberName: opts.barberName,
  });
  const [{ id }] = await db
    .insert(notifications)
    .values({
      userId: opts.appointment.clientUserId,
      appointmentId: opts.appointment.id,
      phone: opts.appointment.clientPhone,
      kind: opts.kind,
      body,
      scheduledFor: opts.scheduledFor ?? new Date(),
    })
    .$returningId();
  return db.query.notifications.findFirst({ where: eq(notifications.id, id) });
}

/**
 * Tudo que um agendamento novo dispara: confirmação na hora
 * e os dois lembretes (24h e 2h antes), se ainda fizerem sentido.
 */
export async function queueBookingNotifications(
  appt: typeof appointments.$inferSelect,
  barberName?: string,
  opts: { skipConfirmation?: boolean } = {}
) {
  const now = Date.now();
  const jobs: Promise<unknown>[] = [];
  if (!opts.skipConfirmation) {
    jobs.push(
      queueNotification({ kind: "AGENDAMENTO_CRIADO", appointment: appt, barberName })
    );
  }

  const h24 = new Date(appt.startsAt.getTime() - 24 * 3600_000);
  if (h24.getTime() > now) {
    jobs.push(
      queueNotification({
        kind: "LEMBRETE_24H",
        appointment: appt,
        barberName,
        scheduledFor: h24,
      })
    );
  }

  const h2 = new Date(appt.startsAt.getTime() - 2 * 3600_000);
  if (h2.getTime() > now) {
    jobs.push(
      queueNotification({
        kind: "LEMBRETE_2H",
        appointment: appt,
        barberName,
        scheduledFor: h2,
      })
    );
  }

  await Promise.all(jobs);
}

/** Cancelou o horário: avisa o cliente e derruba os lembretes pendentes. */
export async function cancelPendingNotifications(appointmentId: number) {
  await db
    .update(notifications)
    .set({ status: "CANCELADA" })
    .where(
      and(
        eq(notifications.appointmentId, appointmentId),
        eq(notifications.status, "PENDENTE"),
        // A confirmação também cai. Ela é enfileirada na hora, mas só sai
        // na próxima varredura: quem marcava e desmarcava em seguida
        // recebia "seu horário está confirmado" de um horário que não
        // existia mais — e, na remarcação, com a data errada.
        inArray(notifications.kind, [
          "AGENDAMENTO_CRIADO",
          "LEMBRETE_24H",
          "LEMBRETE_2H",
        ])
      )
    );
}

export async function pendingNotifications(limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "PENDENTE"),
        lte(notifications.scheduledFor, new Date())
      )
    )
    .limit(limit);
}

export async function markSent(id: number) {
  await db
    .update(notifications)
    .set({ status: "ENVIADA", sentAt: new Date() })
    .where(eq(notifications.id, id));
}

/**
 * Falha de envio. `definitiva` é para o erro que não melhora tentando de
 * novo (número inválido, template recusado): antes o chamador forçava
 * `attempts = 99` para o mesmo efeito, e o painel passava a mostrar
 * "100 tentativa(s)" numa mensagem tentada uma única vez.
 */
export async function markFailed(
  id: number,
  error: string,
  attempts: number,
  definitiva = false
) {
  await db
    .update(notifications)
    .set({
      status: definitiva || attempts >= 4 ? "ERRO" : "PENDENTE",
      error: error.slice(0, 500),
      attempts: attempts + 1,
    })
    .where(eq(notifications.id, id));
}

/** Tira uma mensagem da fila de vez (o dono decidiu que não deve sair). */
export async function discardNotification(id: number) {
  await db
    .update(notifications)
    .set({ status: "CANCELADA", error: "Descartada pelo painel" })
    .where(
      and(eq(notifications.id, id), inArray(notifications.status, ["PENDENTE", "ERRO"]))
    );
}

/** Recoloca uma mensagem com erro na fila. */
export async function retryNotification(id: number) {
  await db
    .update(notifications)
    .set({ status: "PENDENTE", attempts: 0, error: null, scheduledFor: new Date() })
    .where(eq(notifications.id, id));
}

/** Contagem por situação, para o painel. */
export async function notificationStats() {
  const rows = await db
    .select({ status: notifications.status, total: drizzleCount() })
    .from(notifications)
    .groupBy(notifications.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));

  // "Na fila" inclui o lembrete que só sai amanhã; "prontas" é o que o
  // botão "Enviar agora" realmente manda. Os dois números juntos eram um
  // só, e o painel dizia "Enviar agora (7)" para responder "0 enviada(s)".
  const [prontas] = await db
    .select({ total: drizzleCount() })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "PENDENTE"),
        lte(notifications.scheduledFor, new Date())
      )
    );
  return {
    pendentes: by.PENDENTE ?? 0,
    prontas: Number(prontas?.total ?? 0),
    enviadas: by.ENVIADA ?? 0,
    erros: by.ERRO ?? 0,
    canceladas: by.CANCELADA ?? 0,
  };
}

/** Últimas mensagens, para auditoria no painel. */
export async function recentNotifications(limit = 40) {
  return db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
