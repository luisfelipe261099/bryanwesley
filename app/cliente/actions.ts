"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { transitionAppointment, BookingError } from "@/lib/appointments";

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
