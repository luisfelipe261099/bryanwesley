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
  const rows = await db
    .update(subscriptions)
    .set({ status: "INADIMPLENTE" })
    .where(
      and(
        eq(subscriptions.status, "ATIVA"),
        lt(subscriptions.renewsAt, new Date())
      )
    )
    .returning({ id: subscriptions.id });
  return rows.length;
}

/** Estende o ciclo a partir do vencimento (não da data de hoje). */
export function nextRenewal(from: Date, cycle: "MENSAL" | "ANUAL") {
  const base = from.getTime() > Date.now() ? new Date(from) : new Date();
  base.setMonth(base.getMonth() + (cycle === "ANUAL" ? 12 : 1));
  return base;
}
