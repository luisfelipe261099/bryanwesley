"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAvailability, getSettings } from "@/lib/schedule";
import { createBooking, BookingError } from "@/lib/appointments";
import { getSession } from "@/lib/auth";
import { isValidPhone } from "@/lib/phone";
import type { Slot } from "@/lib/schedule";

export type AvailabilityPayload = {
  slots: Slot[];
  closed: boolean;
};

/** Consultada pelo formulário sempre que muda data, serviços ou barbeiro. */
export async function fetchAvailability(params: {
  dateKey: string;
  durationMin: number;
  barberId: number | null;
}): Promise<AvailabilityPayload> {
  const result = await getAvailability({
    dateKey: params.dateKey,
    durationMin: Math.max(params.durationMin, 1),
    barberId: params.barberId,
  });
  return { slots: result.slots, closed: result.closed };
}

const bookingSchema = z.object({
  serviceIds: z.array(z.number().int().positive()).min(1, "Escolha ao menos um serviço."),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha um dia."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Escolha um horário."),
  barberId: z.number().int().positive().nullable(),
  clientName: z.string().trim().min(3, "Informe seu nome completo."),
  clientPhone: z.string().refine(isValidPhone, "Informe um WhatsApp válido com DDD."),
  notes: z.string().trim().max(500).optional(),
});

export type BookingResult =
  | { ok: true; code: string; id: number }
  | { ok: false; error: string };

export async function submitBooking(
  raw: z.input<typeof bookingSchema>
): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const session = await getSession();

  try {
    const appt = await createBooking({
      ...parsed.data,
      userId: session?.role === "CLIENT" ? session.id : null,
    });
    revalidatePath("/cliente");
    revalidatePath("/barbeiro");
    revalidatePath("/admin");
    return { ok: true, code: appt.code, id: appt.id };
  } catch (err) {
    if (err instanceof BookingError) return { ok: false, error: err.message };
    console.error("Erro ao agendar:", err);
    return {
      ok: false,
      error: "Não conseguimos concluir o agendamento. Tente novamente.",
    };
  }
}

export async function currentSettings() {
  return getSettings();
}
