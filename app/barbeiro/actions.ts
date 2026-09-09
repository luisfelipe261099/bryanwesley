"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { transitionAppointment, BookingError } from "@/lib/appointments";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** O barbeiro só mexe no próprio atendimento; o admin mexe em qualquer um. */
async function assertOwnership(appointmentId: number) {
  const session = await requireRole(["BARBER", "ADMIN"]);
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  });
  if (!appt) throw new BookingError("Agendamento não encontrado.");
  if (session.role === "BARBER" && appt.barberId !== session.barberId) {
    throw new BookingError("Esse atendimento é de outro barbeiro.");
  }
  return { session, appt };
}

export async function startAppointment(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "EM_ANDAMENTO");
    revalidateAll();
    return { ok: true, message: "Atendimento iniciado." };
  } catch (e) {
    return toResult(e);
  }
}

export async function finishAppointment(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "CONCLUIDO");
    revalidateAll();
    return { ok: true, message: "Atendimento concluído e comissão lançada." };
  } catch (e) {
    return toResult(e);
  }
}

export async function markNoShow(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "NO_SHOW");
    revalidateAll();
    return { ok: true, message: "Marcado como falta." };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Check-in: valida a chegada do cliente.
 * Aceita o token do QR ou o código curto digitado à mão — o barbeiro
 * nunca fica travado se a câmera falhar.
 */
export async function checkIn(input: {
  token?: string;
  code?: string;
}): Promise<ActionResult & { appointmentId?: number }> {
  const session = await requireRole(["BARBER", "ADMIN"]);

  const where = input.token
    ? eq(appointments.checkinToken, input.token)
    : input.code
      ? eq(appointments.code, input.code.trim().toUpperCase())
      : null;
  if (!where) return { ok: false, error: "Informe o QR ou o código." };

  const appt = await db.query.appointments.findFirst({ where });
  if (!appt) return { ok: false, error: "Código não encontrado." };

  if (session.role === "BARBER" && appt.barberId !== session.barberId) {
    return { ok: false, error: "Esse atendimento é de outro barbeiro." };
  }
  if (appt.status === "CANCELADO" || appt.status === "NO_SHOW") {
    return { ok: false, error: "Esse agendamento foi cancelado." };
  }
  if (appt.status === "CONCLUIDO") {
    return { ok: false, error: "Esse atendimento já foi concluído." };
  }

  await db
    .update(appointments)
    .set({ checkedInAt: appt.checkedInAt ?? new Date() })
    .where(eq(appointments.id, appt.id));

  if (appt.status === "CONFIRMADO" || appt.status === "PENDENTE") {
    await transitionAppointment(appt.id, "EM_ANDAMENTO");
  }

  revalidateAll();
  return {
    ok: true,
    message: `Check-in de ${appt.clientName} confirmado.`,
    appointmentId: appt.id,
  };
}

function revalidateAll() {
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  revalidatePath("/cliente");
}

function toResult(e: unknown): ActionResult {
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Não foi possível concluir a ação." };
}
