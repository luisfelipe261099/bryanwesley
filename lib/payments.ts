// ───────────────────────────────────────────────────────────
// Cobrança pela InfinitePay. Só link avulso — a API não tem assinatura
// recorrente —, então a mensalidade é um link por ciclo, com baixa pelo
// webhook e reconferência via payment_check.
// Sem INFINITEPAY_HANDLE o módulo fica inerte e a ativação segue manual.
// ───────────────────────────────────────────────────────────
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { payments, plans, subscriptions, users } from "@/db/schema";
import {
  createPaymentLink,
  checkPayment,
  isInfinitePayConfigured,
} from "./providers/infinitepay";
import { publicBaseUrl } from "./qr";
import { nextRenewal } from "./subscriptions";
import { randomBytes } from "node:crypto";

export { isInfinitePayConfigured };

function nsu() {
  return `BW${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type ChargeResult =
  | { ok: true; url: string; orderNsu: string }
  | { ok: false; error: string };

/** Gera a cobrança de um ciclo da assinatura. */
export async function chargeSubscription(
  userId: number,
  cycle: "MENSAL" | "ANUAL"
): Promise<ChargeResult> {
  if (!isInfinitePayConfigured()) {
    return {
      ok: false,
      error: "Cobrança online não configurada (INFINITEPAY_HANDLE ausente).",
    };
  }

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.userId, userId)),
    orderBy: (s, { desc }) => [desc(s.startedAt)],
  });
  if (!sub) return { ok: false, error: "Cliente sem assinatura." };
  // Assinatura cancelada não se cobra: o pagamento ressuscitaria um plano
  // que o cliente (ou a barbearia) encerrou. Ative de novo antes de cobrar.
  if (sub.status === "CANCELADA") {
    return {
      ok: false,
      error: "Esse plano está cancelado. Ative de novo antes de gerar a cobrança.",
    };
  }

  const [plan, user] = await Promise.all([
    db.query.plans.findFirst({ where: eq(plans.id, sub.planId) }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
  ]);
  if (!plan || !user) return { ok: false, error: "Plano ou cliente não encontrado." };

  const meses = cycle === "ANUAL" ? 12 : 1;
  const unit = cycle === "ANUAL" ? plan.annualPriceCents : plan.priceCents;
  const amountCents = unit * meses;
  const orderNsu = nsu();
  const base = publicBaseUrl();

  const link = await createPaymentLink({
    orderNsu,
    items: [
      {
        description: `${plan.name} — ${cycle === "ANUAL" ? "12 meses" : "1 mês"}`,
        price: amountCents,
        quantity: 1,
      },
    ],
    customer: { name: user.name, phone: user.phone, email: user.email ?? undefined },
    redirectUrl: `${base}/cliente?pagamento=ok`,
    webhookUrl: `${base}/api/pagamentos/infinitepay`,
  });
  if (!link.ok) return { ok: false, error: link.error };

  await db.insert(payments).values({
    orderNsu,
    userId,
    subscriptionId: sub.id,
    kind: "ASSINATURA",
    cycle,
    planId: plan.id,
    amountCents,
    description: `${plan.name} · ${cycle.toLowerCase()}`,
    checkoutUrl: link.url,
  });

  return { ok: true, url: link.url, orderNsu };
}

/** Dá baixa numa cobrança e aplica o efeito (renovar assinatura). */
export async function settlePayment(input: {
  orderNsu: string;
  transactionNsu?: string;
  slug?: string;
  receiptUrl?: string;
}) {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.orderNsu, input.orderNsu),
  });
  if (!payment) return { ok: false as const, error: "Cobrança desconhecida." };
  if (payment.status === "PAGO") return { ok: true as const, already: true };

  // Nunca confia no callback: o webhook é um endereço público e sem
  // assinatura, então quem descobrisse um order_nsu ativaria um plano de
  // graça. A baixa só acontece depois que a própria InfinitePay confirma
  // o pagamento pelo payment_check. Sem os dados da transação não há o
  // que reconferir — e aí a cobrança continua pendente.
  if (!input.transactionNsu || !input.slug) {
    return {
      ok: false as const,
      error: "Callback sem transaction_nsu/slug: pagamento não confirmado.",
    };
  }
  const check = await checkPayment({
    orderNsu: input.orderNsu,
    transactionNsu: input.transactionNsu,
    slug: input.slug,
  });
  if (!check.paid) {
    return { ok: false as const, error: check.error ?? "Pagamento não confirmado." };
  }

  // Condicional ao PENDENTE: o provedor pode entregar o mesmo webhook duas
  // vezes ao mesmo tempo; só a chamada que der a baixa aplica o efeito,
  // senão a assinatura seria estendida dois ciclos.
  const [upd] = await db
    .update(payments)
    .set({
      status: "PAGO",
      paidAt: new Date(),
      transactionNsu: input.transactionNsu ?? null,
      slug: input.slug ?? null,
      receiptUrl: input.receiptUrl ?? null,
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "PENDENTE")));
  if (upd.affectedRows === 0) return { ok: true as const, already: true };

  if (payment.kind === "ASSINATURA" && payment.subscriptionId) {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, payment.subscriptionId),
    });
    if (sub) {
      // Vale o que foi cobrado, não o que está na assinatura agora: quem
      // pagou 12 meses tem que ganhar 12 meses, mesmo que a linha tenha
      // sido mexida no meio do caminho.
      const cicloPago = (payment.cycle as "MENSAL" | "ANUAL" | null) ?? sub.cycle;
      // Renovação de quem está em dia continua do vencimento; quem estava
      // vencido (ou entrando agora) começa a contar de hoje, senão o ciclo
      // pago já nasceria consumido.
      const base = sub.status === "ATIVA" && sub.renewsAt > new Date() ? sub.renewsAt : new Date();
      await db
        .update(subscriptions)
        .set({
          status: "ATIVA",
          planId: payment.planId ?? sub.planId,
          cycle: cicloPago,
          renewsAt: nextRenewal(base, cicloPago),
          canceledAt: null,
        })
        .where(eq(subscriptions.id, sub.id));
    }
  }

  return { ok: true as const, already: false };
}
