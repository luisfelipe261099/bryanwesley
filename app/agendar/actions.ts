"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAvailability, getSettings } from "@/lib/schedule";
import { createBooking, BookingError } from "@/lib/appointments";
import { getSession } from "@/lib/auth";
import { isValidPhone } from "@/lib/phone";
import { hitRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import type { Slot } from "@/lib/schedule";

/** Quem está pedindo, do ponto de vista da rede. */
function ipDaRequisicao() {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  // O primeiro da lista é o cliente; o resto são os proxies do caminho.
  return (fwd?.split(",")[0] ?? h.get("x-real-ip") ?? "desconhecido").trim();
}

export type AvailabilityPayload = {
  slots: Slot[];
  closed: boolean;
  /** Fechado por quê: a loja não abre, ou é a folga do barbeiro escolhido. */
  motivo?: "loja-fechada" | "folga" | "sem-equipe";
};

/** Consultada pelo formulário sempre que muda data, serviços ou barbeiro. */
export async function fetchAvailability(params: {
  dateKey: string;
  durationMin: number;
  barberId: number | null;
}): Promise<AvailabilityPayload> {
  // Equipe logada está fazendo encaixe: enxerga também os horários que a
  // antecedência mínima esconde do cliente.
  const session = await getSession();
  const daCasa = session?.role === "ADMIN" || session?.role === "BARBER";
  const result = await getAvailability({
    dateKey: params.dateKey,
    durationMin: Math.max(params.durationMin, 1),
    barberId: params.barberId,
    ignorarAntecedencia: daCasa,
  });
  return { slots: result.slots, closed: result.closed, motivo: result.motivo };
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
  | { ok: true; code: string; id: number; token: string }
  | { ok: false; error: string };

export async function submitBooking(
  raw: z.input<typeof bookingSchema>
): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const session = await getSession();
  const daCasa = session?.role === "ADMIN" || session?.role === "BARBER";

  // Freio por origem: sem isso um script marca o dia inteiro com
  // telefones inventados. Quem está logado (cliente, equipe) já é
  // identificado e responde pelo teto por telefone; o anônimo passa aqui.
  if (!daCasa && !session) {
    const origem = ipDaRequisicao();
    const veredito = await hitRateLimit(`agendar:${origem}`, 6, 60 * 60_000);
    if (!veredito.ok) {
      const min = Math.max(1, Math.round(veredito.retryInMs / 60_000));
      return {
        ok: false,
        error: `Muitos agendamentos seguidos deste aparelho. Tente de novo em ${min} minuto(s) ou fale com a barbearia pelo WhatsApp.`,
      };
    }
  }

  try {
    const appt = await createBooking({
      ...parsed.data,
      userId: session?.role === "CLIENT" ? session.id : null,
      // Pedido feito pelo site, por quem não é da casa: é este caminho que
      // respeita a pausa da agenda, a antecedência e o limite de dias.
      publicRequest: !daCasa,
    });
    revalidatePath("/cliente");
    revalidatePath("/barbeiro");
    revalidatePath("/admin");
    return {
      ok: true,
      code: appt.code,
      id: appt.id,
      token: appt.checkinToken ?? "",
    };
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
