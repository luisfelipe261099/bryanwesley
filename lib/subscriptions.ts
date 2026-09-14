// ───────────────────────────────────────────────────────────
// Ciclo de vida da assinatura enquanto a cobrança é manual.
// Vencida sem renovar → INADIMPLENTE: perde os benefícios até o admin
// registrar o pagamento. Quando o gateway entrar, a renovação vira
// automática pelo webhook — a regra de expirar continua a mesma.
// ───────────────────────────────────────────────────────────
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema";

export async function expireOverdueSubscriptions() {
  const [res] = await db
    .update(subscriptions)
    .set({ status: "INADIMPLENTE" })
    .where(
      and(
        eq(subscriptions.status, "ATIVA"),
        lt(subscriptions.renewsAt, new Date())
      )
    );
  return res.affectedRows;
}

/**
 * Estende o ciclo a partir do vencimento (não da data de hoje).
 * O dia fica preso ao fim do mês: 31/jan + 1 mês é 28/fev, não 3/mar —
 * setMonth puro "transborda" e a assinatura ganharia dias de graça.
 */
export function nextRenewal(from: Date, cycle: "MENSAL" | "ANUAL") {
  const base = from.getTime() > Date.now() ? new Date(from) : new Date();
  const dia = base.getDate();
  base.setDate(1);
  base.setMonth(base.getMonth() + (cycle === "ANUAL" ? 12 : 1));
  const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(dia, ultimo));
  return base;
}
