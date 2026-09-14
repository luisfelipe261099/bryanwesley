"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  recurringSlots,
  subscriptions,
  users,
  plans,
  planRequests,
} from "@/db/schema";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth";
import { SESSION_COOKIE, signSession, sessionCookieOptions } from "@/lib/auth/session";
import {
  transitionAppointment,
  rescheduleBooking,
  BookingError,
} from "@/lib/appointments";
import { chargeSubscription, isInfinitePayConfigured } from "@/lib/payments";
import { materializeRecurring, cancelFutureOccurrences } from "@/lib/recurring";
import { shopToday } from "@/lib/time";

export type ActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/** O cliente só pode cancelar o próprio horário, e com antecedência. */
export async function cancelMyAppointment(
  appointmentId: number
): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };

  if (session.role !== "ADMIN" && appt.clientUserId !== session.id) {
    return { ok: false, error: "Esse agendamento não é seu." };
  }

  const duasHoras = 2 * 3600_000;
  if (
    session.role !== "ADMIN" &&
    appt.startsAt.getTime() - Date.now() < duasHoras
  ) {
    return {
      ok: false,
      error:
        "Faltam menos de 2h para o horário. Fale com a barbearia pelo WhatsApp.",
    };
  }

  try {
    await transitionAppointment(appointmentId, "CANCELADO");
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return { ok: true };
}

// ───────────────────────── Horário fixo ─────────────────────────

/** O membro reserva o mesmo dia/hora toda semana ou todo mês. */
export async function saveRecurringSlot(input: {
  barberId: number;
  frequency: "SEMANAL" | "MENSAL";
  weekday: number | null;
  dayOfMonth: number | null;
  minutesOfDay: number;
  serviceIds: number[];
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      eq(subscriptions.status, "ATIVA")
    ),
  });
  if (!sub) {
    return { ok: false, error: "O horário fixo é um benefício de quem assina." };
  }
  if (input.serviceIds.length === 0) {
    return { ok: false, error: "Escolha ao menos um serviço." };
  }

  // Um fixo por membro: salvar substitui o anterior — e as semanas que o
  // anterior já tinha garantido na agenda saem junto, senão o membro fica
  // com dois horários fixos ocupando a agenda do barbeiro.
  const antigos = await db
    .select({ id: recurringSlots.id })
    .from(recurringSlots)
    .where(
      and(eq(recurringSlots.userId, session.id), eq(recurringSlots.active, true))
    );
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(
      and(
        eq(recurringSlots.userId, session.id),
        eq(recurringSlots.active, true)
      )
    );
  await cancelFutureOccurrences(antigos.map((a) => a.id));

  const [{ id: novoId }] = await db.insert(recurringSlots).values({
    userId: session.id,
    barberId: input.barberId,
    frequency: input.frequency,
    weekday: input.frequency === "SEMANAL" ? input.weekday : null,
    dayOfMonth: input.frequency === "MENSAL" ? input.dayOfMonth : null,
    minutesOfDay: input.minutesOfDay,
    serviceIds: input.serviceIds,
    startsOn: shopToday(),
  }).$returningId();

  // Já deixa os próximos horários garantidos na agenda — só deste fixo.
  const report = await materializeRecurring({ slotId: novoId });

  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");

  if (report.criados === 0 && report.conflitos.length > 0) {
    // Nenhuma data coube: não deixa um fixo "fantasma" ativo.
    await db
      .update(recurringSlots)
      .set({ active: false })
      .where(
        and(
          eq(recurringSlots.userId, session.id),
          eq(recurringSlots.active, true)
        )
      );
    return {
      ok: false,
      error: `Esse horário não está livre: ${report.conflitos[0].motivo} Escolha outro.`,
    };
  }
  if (report.conflitos.length > 0) {
    // Parte das semanas coube, parte não: o membro precisa saber quais
    // datas ficaram de fora em vez de achar que está tudo reservado.
    const dias = report.conflitos.map(
      (c) => `${c.dateKey.slice(8, 10)}/${c.dateKey.slice(5, 7)}`
    );
    return {
      ok: true,
      warning: `Fixo salvo, mas ${dias.length === 1 ? "o dia" : "os dias"} ${dias.join(", ")} já ${dias.length === 1 ? "estava ocupado" : "estavam ocupados"}. Marque avulso nessas datas.`,
    };
  }
  return { ok: true };
}

export async function cancelRecurringSlot(): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  const ativos = await db
    .select({ id: recurringSlots.id })
    .from(recurringSlots)
    .where(
      and(eq(recurringSlots.userId, session.id), eq(recurringSlots.active, true))
    );
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(
      and(
        eq(recurringSlots.userId, session.id),
        eq(recurringSlots.active, true)
      )
    );
  // Abrir mão do fixo libera as semanas que já estavam na agenda: senão o
  // barbeiro segue bloqueado por um fixo que não existe mais.
  const liberados = await cancelFutureOccurrences(ativos.map((a) => a.id));
  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return {
    ok: true,
    warning:
      liberados > 0
        ? `${liberados} horário(s) futuro(s) do fixo liberado(s).`
        : undefined,
  };
}

// ───────────────────────── Minha conta ─────────────────────────

export async function changeMyPassword(input: {
  current: string;
  next: string;
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN", "BARBER"]);
  if (input.next.trim().length < 6) {
    return { ok: false, error: "A nova senha precisa ter ao menos 6 caracteres." };
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, session.id) });
  if (!user?.passwordHash) return { ok: false, error: "Conta sem senha definida." };
  const ok = await verifyPassword(input.current, user.passwordHash);
  if (!ok) return { ok: false, error: "Senha atual incorreta." };
  // Versão nova derruba as outras sessões desta conta (celular antigo,
  // computador da barbearia). A sessão atual ganha um cookie novo e segue.
  const v = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.next.trim()), tokenVersion: v })
    .where(eq(users.id, session.id));
  cookies().set(
    SESSION_COOKIE,
    await signSession({ ...session, v }),
    sessionCookieOptions
  );
  return { ok: true };
}

// ───────────────────────── Remarcar ─────────────────────────

export async function rescheduleMyAppointment(input: {
  appointmentId: number;
  dateKey: string;
  time: string;
  barberId: number | null;
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, input.appointmentId),
  });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  if (session.role !== "ADMIN" && appt.clientUserId !== session.id) {
    return { ok: false, error: "Esse agendamento não é seu." };
  }
  if (
    session.role !== "ADMIN" &&
    appt.startsAt.getTime() - Date.now() < 2 * 3600_000
  ) {
    return {
      ok: false,
      error: "Faltam menos de 2h. Fale com a barbearia pelo WhatsApp.",
    };
  }

  try {
    await rescheduleBooking(input);
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return { ok: true };
}

// ───────────────────────── Assinar ─────────────────────────

export type SubscribeResult =
  | { ok: true; mode: "pedido" }
  | { ok: true; mode: "pagamento"; url: string }
  | { ok: false; error: string };

/**
 * O cliente pede o plano pelo site. Com cobrança online configurada,
 * devolve o link de pagamento; senão registra a solicitação e avisa o
 * admin, que ativa no painel.
 */
export async function requestPlan(input: {
  planId: number;
  cycle: "MENSAL" | "ANUAL";
}): Promise<SubscribeResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const plan = await db.query.plans.findFirst({
    where: and(eq(plans.id, input.planId), eq(plans.active, true)),
  });
  if (!plan) return { ok: false, error: "Esse plano não está disponível." };

  const ativa = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      eq(subscriptions.status, "ATIVA")
    ),
  });
  if (ativa) {
    return {
      ok: false,
      error: "Você já tem um plano ativo. Fale com a barbearia para trocar.",
    };
  }

  const aberta = await db.query.planRequests.findFirst({
    where: and(
      eq(planRequests.userId, session.id),
      eq(planRequests.status, "ABERTA")
    ),
  });
  if (!aberta) {
    await db.insert(planRequests).values({
      userId: session.id,
      planId: plan.id,
      cycle: input.cycle,
    });
  }

  if (isInfinitePayConfigured()) {
    // Cria a assinatura inadimplente e cobra o primeiro ciclo: o webhook
    // ativa quando o pagamento cair.
    const existente = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, session.id),
      orderBy: (s, { desc }) => [desc(s.startedAt)],
    });
    if (!existente) {
      await db.insert(subscriptions).values({
        userId: session.id,
        planId: plan.id,
        cycle: input.cycle,
        status: "INADIMPLENTE",
        renewsAt: new Date(),
      });
    }
    const charge = await chargeSubscription(session.id, input.cycle);
    if (charge.ok) {
      revalidatePath("/cliente");
      return { ok: true, mode: "pagamento", url: charge.url };
    }
  }

  revalidatePath("/cliente");
  revalidatePath("/admin");
  return { ok: true, mode: "pedido" };
}
