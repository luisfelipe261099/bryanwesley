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
import { appointments, users } from "@/db/schema";
import {
  chargeAppointment,
  exigePagamentoAntecipado,
  isCobrancaOnline,
  liberarHorariosSemPagamento,
  MINUTOS_PARA_PAGAR,
} from "@/lib/payments";
import { cancelPendingNotifications } from "@/lib/notifications";
import { cpfValido } from "@/lib/cpf";

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
  // Horário de outro dia que não foi pago no prazo volta a aparecer livre.
  await liberarHorariosSemPagamento().catch((e) => console.error("Liberar horários:", e));
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
  /** Pix ou cartão (pelo Asaas, na hora) ou na barbearia. */
  pagamento: z.enum(["PIX", "CARTAO", "BALCAO"]).optional(),
  cpf: z.string().trim().max(20).optional(),
});

const AVISO_ANTECIPADO = `Para agendar para outro dia, pague agora com Pix ou cartão: o horário fica garantido com o pagamento (prazo de ${MINUTOS_PARA_PAGAR} minutos). Pagar na barbearia vale só para hoje.`;

export type BookingResult =
  | { ok: true; code: string; id: number; token: string; avisoPagamento?: string }
  | { ok: false; error: string; precisaCpf?: boolean };

export async function submitBooking(
  raw: z.input<typeof bookingSchema>
): Promise<BookingResult> {
  const parsed = bookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const session = await getSession();
  const daCasa = session?.role === "ADMIN" || session?.role === "BARBER";

  // Para outro dia, quem marca pelo site paga antes (Pix ou cartão): o
  // horário só fica garantido com o pagamento. Para hoje, pode pagar na
  // barbearia.
  const antecipado = !daCasa && exigePagamentoAntecipado(parsed.data.dateKey);
  if (antecipado && parsed.data.pagamento === "BALCAO") {
    return { ok: false, error: AVISO_ANTECIPADO };
  }

  // Pix ou cartão: o CPF é conferido antes de reservar, para o horário não
  // ficar marcado com uma cobrança que não dá para gerar.
  const online =
    (parsed.data.pagamento === "PIX" || parsed.data.pagamento === "CARTAO") && isCobrancaOnline();
  const cpfConfiavel = await podeUsarCpfSalvo(session, parsed.data.clientPhone, daCasa);
  if (online) {
    const cpf = parsed.data.cpf ?? "";
    if (cpf && !cpfValido(cpf)) {
      return { ok: false, error: "CPF inválido. Confira os números.", precisaCpf: true };
    }
    if (!cpf) {
      const temSalvo = cpfConfiavel
        ? !!(await db.query.users.findFirst({
            columns: { cpf: true },
            where: eq(users.phone, normalizePhone(parsed.data.clientPhone)),
          }))?.cpf
        : false;
      if (!temSalvo) {
        return { ok: false, error: "Para pagar com Pix ou cartão, informe o CPF.", precisaCpf: true };
      }
    }
  }

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
    await liberarHorariosSemPagamento().catch((e) => console.error("Liberar horários:", e));
    const appt = await createBooking({
      ...parsed.data,
      userId: session?.role === "CLIENT" ? session.id : null,
      // Pedido feito pelo site, por quem não é da casa: é este caminho que
      // respeita a pausa da agenda, a antecedência e o limite de dias.
      publicRequest: !daCasa,
      autorUserId: session?.id ?? null,
      aguardandoPagamentoAte: antecipado && online ? new Date(Date.now() + MINUTOS_PARA_PAGAR * 60_000) : null,
    });
    // Só cobra o que não é do plano. Na barbearia: fica anotado e pronto.
    let avisoPagamento: string | undefined;
    if (antecipado && appt.totalCents > 0 && !online) {
      // A tela achou que o plano cobria, mas há valor a pagar: sem Pix ou
      // cartão escolhido, o horário de outro dia não fica.
      await db.update(appointments).set({ status: "CANCELADO" }).where(eq(appointments.id, appt.id));
      await cancelPendingNotifications(appt.id).catch(() => {});
      return { ok: false, error: AVISO_ANTECIPADO };
    }
    if (appt.totalCents > 0 && parsed.data.pagamento) {
      await db
        .update(appointments)
        .set({
          paymentMethod: online ? parsed.data.pagamento : "BALCAO",
        })
        .where(eq(appointments.id, appt.id));
      if (online) {
        // Falhou (Asaas fora do ar)? O horário fica e a tela da
        // confirmação oferece gerar o pagamento de novo.
        const cobranca = await chargeAppointment(appt.id, parsed.data.pagamento as "PIX" | "CARTAO", {
          cpf: parsed.data.cpf,
          cpfConfiavel,
        });
        if (!cobranca.ok) avisoPagamento = cobranca.error;
      }
    }
    revalidatePath("/cliente");
    revalidatePath("/barbeiro");
    revalidatePath("/admin");
    return {
      ok: true,
      code: appt.code,
      id: appt.id,
      token: appt.checkinToken ?? "",
      avisoPagamento,
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

/**
 * O CPF salvo na conta do WhatsApp informado só vale quando quem pede é o
 * dono desse WhatsApp (logado) ou a equipe. Um visitante que digita o
 * número de outra pessoa não usa nem troca o CPF dela.
 */
async function podeUsarCpfSalvo(
  session: Awaited<ReturnType<typeof getSession>>,
  telefone: string,
  daCasa: boolean
) {
  if (daCasa) return true;
  if (!session) return false;
  const conta = await db.query.users.findFirst({ columns: { phone: true }, where: eq(users.id, session.id) });
  return !!conta && normalizePhone(conta.phone) === normalizePhone(telefone);
}

export async function currentSettings() {
  return getSettings();
}
