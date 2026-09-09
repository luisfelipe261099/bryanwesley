"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, recurringSlots, subscriptions } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { transitionAppointment, BookingError } from "@/lib/appointments";
import { materializeRecurring } from "@/lib/recurring";
import { shopToday } from "@/lib/time";

export type ActionResult = { ok: true } | { ok: false; error: string };

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

  // Um fixo por membro: salvar substitui o anterior.
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(
      and(
        eq(recurringSlots.userId, session.id),
        eq(recurringSlots.active, true)
      )
    );

  await db.insert(recurringSlots).values({
    userId: session.id,
    barberId: input.barberId,
    frequency: input.frequency,
    weekday: input.frequency === "SEMANAL" ? input.weekday : null,
    dayOfMonth: input.frequency === "MENSAL" ? input.dayOfMonth : null,
    minutesOfDay: input.minutesOfDay,
    serviceIds: input.serviceIds,
    startsOn: shopToday(),
  });

  // Já deixa os próximos horários garantidos na agenda.
  const report = await materializeRecurring();

  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");

  if (report.criados === 0 && report.conflitos.length > 0) {
    return {
      ok: false,
      error: `Horário salvo, mas os próximos já estavam ocupados: ${report.conflitos[0].motivo}`,
    };
  }
  return { ok: true };
}

export async function cancelRecurringSlot(): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(
      and(
        eq(recurringSlots.userId, session.id),
        eq(recurringSlots.active, true)
      )
    );
  revalidatePath("/cliente");
  return { ok: true };
}
