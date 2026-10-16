// ───────────────────────────────────────────────────────────
// Ciclo de vida da assinatura enquanto a cobrança é manual.
// Vencida sem renovar → INADIMPLENTE: perde os benefícios até o admin
// registrar o pagamento. Quando o gateway entrar, a renovação vira
// automática pelo webhook — a regra de expirar continua a mesma.
// ───────────────────────────────────────────────────────────
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { shopTimeToUtc, utcToShopParts } from "./time";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { desligarFixosDe } from "./recurring";

export async function expireOverdueSubscriptions() {
  const agora = new Date();

  // Quem pediu para cancelar no site continua membro até o fim do ciclo
  // que já pagou. Vencido o ciclo, a assinatura encerra de vez — virar
  // INADIMPLENTE cobraria de quem avisou que estava saindo.
  const saindo = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "ATIVA"),
        lt(subscriptions.renewsAt, agora),
        isNotNull(subscriptions.canceledAt)
      )
    );
  const [saiu] = await db
    .update(subscriptions)
    .set({ status: "CANCELADA" })
    .where(
      and(
        eq(subscriptions.status, "ATIVA"),
        lt(subscriptions.renewsAt, agora),
        isNotNull(subscriptions.canceledAt)
      )
    );

  // Sem plano, o horário fixo sai da agenda: as semanas já reservadas
  // seguiam como "Incluso no plano", segurando a cadeira de graça.
  if (saindo.length) await desligarFixosDe(saindo.map((s) => s.userId));

  const [res] = await db
    .update(subscriptions)
    .set({ status: "INADIMPLENTE" })
    .where(
      and(
        eq(subscriptions.status, "ATIVA"),
        lt(subscriptions.renewsAt, agora)
      )
    );
  return res.affectedRows + saiu.affectedRows;
}

/**
 * Estende o ciclo a partir do vencimento (não da data de hoje).
 * O dia fica preso ao fim do mês: 31/jan + 1 mês é 28/fev, não 3/mar —
 * setMonth puro "transborda" e a assinatura ganharia dias de graça.
 */
export function nextRenewal(from: Date, cycle: "MENSAL" | "ANUAL") {
  const base = from.getTime() > Date.now() ? new Date(from) : new Date();
  // A conta é no calendário da loja, não no do servidor (UTC na Vercel):
  // renovado às 22:30 do dia 30/jan em Curitiba (já 31/jan em UTC), o
  // plano vencia em 27/fev à noite — um dia antes.
  const p = utcToShopParts(base);
  let ano = p.year;
  let mes = p.month + (cycle === "ANUAL" ? 12 : 1);
  while (mes > 12) {
    mes -= 12;
    ano++;
  }
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return shopTimeToUtc(ano, mes, Math.min(p.day, ultimo), p.minutesOfDay);
}
