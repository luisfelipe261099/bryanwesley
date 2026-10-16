"use server";

import { revalidatePath } from "next/cache";
import { z } from "@/lib/zod-pt";
import { getAvailability, getSettings } from "@/lib/schedule";
import { createBooking, BookingError } from "@/lib/appointments";
import { getSession } from "@/lib/auth";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { addDays, parseDateKey, shopTimeToUtc } from "@/lib/time";
import { hitRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import type { Slot } from "@/lib/schedule";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments } from "@/db/schema";

/** "2026-10-47" passa na máscara e virava outro dia lá na frente. */
const diaDeVerdade = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k) && addDays(k, 0) === k;

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
  /**
   * Remarcação: o próprio horário não ocupa a cadeira — sem isto, empurrar
   * o corte 30 minutos com o mesmo barbeiro aparecia como indisponível.
   */
  remarcandoId?: number;
}): Promise<AvailabilityPayload> {
  // Equipe logada está fazendo encaixe: enxerga também os horários que a
  // antecedência mínima esconde do cliente.
  if (!diaDeVerdade(params.dateKey)) return { slots: [], closed: true };
  const session = await getSession();
  const daCasa = session?.role === "ADMIN" || session?.role === "BARBER";

  // Só ignora o horário de quem pode remarcá-lo: o dono ou a equipe.
  let ignorar: number | undefined;
  if (params.remarcandoId && session) {
    const appt = await db.query.appointments.findFirst({
      where: eq(appointments.id, params.remarcandoId),
    });
    if (appt && (daCasa || appt.clientUserId === session.id)) ignorar = appt.id;
  }

  const result = await getAvailability({
    dateKey: params.dateKey,
    durationMin: Math.max(params.durationMin, 1),
    barberId: params.barberId,
    ignorarAntecedencia: daCasa,
    ignorarAppointmentId: ignorar,
  });
  return { slots: result.slots, closed: result.closed, motivo: result.motivo };
}

const bookingSchema = z.object({
  serviceIds: z.array(z.number().int().positive()).min(1, "Escolha ao menos um serviço."),
  dateKey: z.string().refine(diaDeVerdade, "Escolha um dia."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Escolha um horário."),
  barberId: z.number().int().positive().nullable(),
  clientName: z
    .string()
    // Caractere de controle no nome não tem uso e quebrava a planilha.
    .transform((v) => v.replace(/[\u0000-\u001f\u007f]/g, " "))
    .pipe(z.string().trim()
    .min(3, "Informe seu nome completo.")
    .max(120, "Nome muito longo (máximo de 120 letras).")),
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
  // Cliente logado também tem teto: o telefone do formulário é texto
  // livre, então o teto por telefone não segura quem troca de número a
  // cada pedido. Por conta, não por rede (o Wi-Fi da barbearia é de todos).
  if (session?.role === "CLIENT") {
    const veredito = await hitRateLimit(`agendar:u:${session.id}`, 10, 60 * 60_000);
    if (!veredito.ok) {
      return {
        ok: false,
        error: "Muitos agendamentos seguidos. Tente de novo mais tarde ou fale com a barbearia pelo WhatsApp.",
      };
    }
  }

  // Mesmo pedido de novo (a resposta se perdeu na rede e o cliente tocou
  // outra vez): devolve o horário que já foi criado, em vez de marcar um
  // segundo — no "Mais rápido" ele ia para outro barbeiro, no mesmo horário.
  // Nome diferente no mesmo WhatsApp (pai marcando os dois filhos) segue.
  if (!daCasa) {
    const { year, month, day } = parseDateKey(parsed.data.dateKey);
    const [hh, mm] = parsed.data.time.split(":").map(Number);
    const inicio = shopTimeToUtc(year, month, day, hh * 60 + mm);
    const candidatos = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.clientPhone, normalizePhone(parsed.data.clientPhone)),
          eq(appointments.startsAt, inicio),
          inArray(appointments.status, ["PENDENTE", "CONFIRMADO"]),
          gt(appointments.createdAt, new Date(Date.now() - 10 * 60_000))
        )
      );
    const mesmo = candidatos.find(
      (a) => a.clientName.trim().toLowerCase() === parsed.data.clientName.trim().toLowerCase()
    );
    if (mesmo?.checkinToken) {
      return { ok: true, code: mesmo.code, id: mesmo.id, token: mesmo.checkinToken };
    }
  }

  try {
    const appt = await createBooking({
      ...parsed.data,
      userId: session?.role === "CLIENT" ? session.id : null,
      // Pedido feito pelo site, por quem não é da casa: é este caminho que
      // respeita a pausa da agenda, a antecedência e o limite de dias.
      publicRequest: !daCasa,
      autorUserId: session?.id ?? null,
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
