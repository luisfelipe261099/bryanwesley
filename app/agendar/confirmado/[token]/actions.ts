"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { hitRateLimit } from "@/lib/rate-limit";
import {
  cancelarCobrancasDoAgendamento,
  chargeAppointment,
  conferirPagamento,
  pagamentoDoAgendamento,
} from "@/lib/payments";

// Tudo aqui é endereçado pelo token do link da confirmação (32
// caracteres, impossível de adivinhar), como a própria página.

async function horario(token: string) {
  if (!/^[a-f0-9]{16,64}$/i.test(token)) return null;
  return (await db.query.appointments.findFirst({ where: eq(appointments.checkinToken, token) })) ?? null;
}

/** Quem pode usar o CPF salvo: a equipe ou o dono do WhatsApp, logado. */
async function cpfConfiavel(clientPhone: string) {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "ADMIN" || session.role === "BARBER") return true;
  const conta = await db.query.users.findFirst({ columns: { phone: true }, where: eq(users.id, session.id) });
  return !!conta && normalizePhone(conta.phone) === normalizePhone(clientPhone);
}

/** A tela pergunta de tempos em tempos se o Pix/cartão já caiu. */
export async function statusDoPagamento(token: string): Promise<{ pago: boolean }> {
  const appt = await horario(token);
  if (!appt) return { pago: false };
  const p = await pagamentoDoAgendamento(appt.id);
  if (!p) return { pago: false };
  const atual = await conferirPagamento(p);
  if (atual.status === "PAGO" && p.status !== "PAGO") revalidatePath(`/agendar/confirmado/${token}`);
  return { pago: atual.status === "PAGO" };
}

export async function pagarAgendamento(
  token: string,
  metodo: "PIX" | "CARTAO",
  cpf?: string
): Promise<{ ok: true; url: string } | { ok: false; error: string; precisaCpf?: boolean }> {
  const appt = await horario(token);
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  const freio = await hitRateLimit(`pagar:${appt.id}`, 12, 60 * 60_000);
  if (!freio.ok) return { ok: false, error: "Muitas tentativas. Tente de novo mais tarde ou pague na barbearia." };
  const res = await chargeAppointment(appt.id, metodo, {
    cpf,
    cpfConfiavel: await cpfConfiavel(appt.clientPhone),
  });
  revalidatePath(`/agendar/confirmado/${token}`);
  return res.ok ? { ok: true, url: res.url } : res;
}

/** Desistiu do Pix/cartão: paga na barbearia, e a fatura em aberto sai. */
export async function pagarNaBarbearia(token: string): Promise<{ ok: boolean; error?: string }> {
  const appt = await horario(token);
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  const p = await pagamentoDoAgendamento(appt.id);
  if (p?.status === "PAGO") return { ok: false, error: "Esse horário já está pago." };
  await cancelarCobrancasDoAgendamento(appt.id);
  await db.update(appointments).set({ paymentMethod: "BALCAO" }).where(eq(appointments.id, appt.id));
  revalidatePath(`/agendar/confirmado/${token}`);
  revalidatePath("/barbeiro");
  revalidatePath("/admin/agenda");
  return { ok: true };
}
