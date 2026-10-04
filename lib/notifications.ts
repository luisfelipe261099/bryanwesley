// ───────────────────────────────────────────────────────────
// Notificações em caixa de saída (outbox).
// A regra de negócio só ENFILEIRA; a entrega é de um worker que chama
// o provedor. Trocar WhatsApp por SMS não mexe em nada aqui.
// ───────────────────────────────────────────────────────────
import { and, eq, gt, lte, desc, inArray, count as drizzleCount } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, appointments } from "@/db/schema";
import { getSettings } from "./schedule";
import { contarAparelhos } from "./push";
import { formatShopTime, labelFullDate, utcToShopParts } from "./time";
import { formatBRL } from "./money";

export type NotifKind = (typeof notifications.$inferSelect)["kind"];
export type NotifChannel = (typeof notifications.$inferSelect)["channel"];

/** Título do aviso no celular para cada tipo de mensagem da fila. */
export const TITULO_PUSH: Record<NotifKind, string> = {
  AGENDAMENTO_CRIADO: "Horário confirmado",
  LEMBRETE_24H: "Seu horário é amanhã",
  LEMBRETE_2H: "Seu horário é daqui a pouco",
  AGENDAMENTO_CANCELADO: "Horário cancelado",
  AGENDAMENTO_REMARCADO: "Horário remarcado",
  ASSINATURA_RENOVADA: "Assinatura renovada",
  ASSINATURA_FALHOU: "Problema na assinatura",
  RESPOSTA_WHATSAPP: "Bryan Wesley Barbearia",
};

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
    case "RESPOSTA_WHATSAPP":
      // O texto do atendente é montado em lib/whatsapp-bot e chega pronto
      // em queueFreeText — não passa por template.
      return `${first}, é a ${shop}. Fale com a gente por aqui.`;
  }
}

/** Enfileira uma mensagem para envio imediato ou agendado. */
export async function queueNotification(opts: {
  kind: NotifKind;
  appointment: typeof appointments.$inferSelect;
  barberName?: string;
  scheduledFor?: Date;
  /** PUSH: aviso no celular do cliente (precisa de clientUserId). */
  channel?: NotifChannel;
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
      channel: opts.channel ?? "WHATSAPP",
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

  // Cliente com avisos ligados no celular recebe os lembretes também por
  // lá — e por lá eles chegam mesmo com o WhatsApp da barbearia
  // desligado. Quem ligar os avisos depois de marcar é coberto por
  // garantirLembretesPush, na hora em que liga.
  if (appt.clientUserId && (await contarAparelhos(appt.clientUserId)) > 0) {
    for (const [kind, quando] of [["LEMBRETE_24H", h24], ["LEMBRETE_2H", h2]] as const) {
      if (quando.getTime() > now) {
        jobs.push(
          queueNotification({ kind, appointment: appt, barberName, scheduledFor: quando, channel: "PUSH" })
        );
      }
    }
  }

  await Promise.all(jobs);
}

/**
 * A pessoa acabou de ligar os avisos no celular: os lembretes dos
 * horários que ela já tem marcados ganham a versão push, se ainda não
 * têm. Olha os lembretes de WhatsApp pendentes dela e copia cada um.
 */
export async function garantirLembretesPush(userId: number) {
  const pendentes = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "PENDENTE"),
        inArray(notifications.kind, ["LEMBRETE_24H", "LEMBRETE_2H"]),
        gt(notifications.scheduledFor, new Date())
      )
    );
  const whats = pendentes.filter((n) => n.channel === "WHATSAPP" && n.appointmentId !== null);
  const jaTem = new Set(
    pendentes.filter((n) => n.channel === "PUSH").map((n) => `${n.appointmentId}:${n.kind}`)
  );
  const novos = whats.filter((n) => !jaTem.has(`${n.appointmentId}:${n.kind}`));
  if (novos.length === 0) return 0;
  await db.insert(notifications).values(
    novos.map((n) => ({
      userId: n.userId,
      appointmentId: n.appointmentId,
      phone: n.phone,
      kind: n.kind,
      channel: "PUSH" as const,
      body: n.body,
      scheduledFor: n.scheduledFor,
    }))
  );
  return novos.length;
}

/**
 * Enfileira uma mensagem solta, sem agendamento por trás.
 *
 * É o que guarda a resposta do auto-atendente quando o envio imediato
 * falha (ou quando o número ainda não foi aprovado pela Meta): a
 * mensagem fica visível no painel e sai na próxima varredura.
 */
export async function queueFreeText(opts: {
  phone: string;
  body: string;
  kind?: NotifKind;
  scheduledFor?: Date;
}) {
  const [{ id }] = await db
    .insert(notifications)
    .values({
      phone: opts.phone,
      kind: opts.kind ?? "RESPOSTA_WHATSAPP",
      body: opts.body,
      scheduledFor: opts.scheduledFor ?? new Date(),
    })
    .$returningId();
  return db.query.notifications.findFirst({ where: eq(notifications.id, id) });
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

/**
 * O que está na hora de sair, por canal. O WhatsApp é o padrão: o
 * despacho e a ponte só mandam por ele; os avisos no celular (PUSH) têm
 * entrega própria em lib/dispatch.
 */
export async function pendingNotifications(limit = 50, channel: NotifChannel = "WHATSAPP") {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "PENDENTE"),
        eq(notifications.channel, channel),
        lte(notifications.scheduledFor, new Date())
      )
    )
    .orderBy(notifications.scheduledFor)
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
