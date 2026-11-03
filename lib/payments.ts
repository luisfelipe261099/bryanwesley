// ───────────────────────────────────────────────────────────
// Cobrança pelo Asaas. Uma cobrança por ciclo da assinatura: o cliente
// paga na fatura do Asaas (Pix, boleto ou cartão), o webhook avisa e a
// baixa só acontece depois que a própria API do Asaas confirma.
// Sem ASAAS_API_KEY o módulo fica inerte e a ativação segue manual.
// ───────────────────────────────────────────────────────────
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { payments, planRequests, plans, subscriptions, users } from "@/db/schema";
import { avisarPagamento } from "./avisos";
import { cpfValido, soDigitosCpf } from "./cpf";
import {
  cobrancaPaga,
  consultarCobranca,
  criarCobranca,
  isAsaasConfigured,
  salvarCliente,
} from "./providers/asaas";
import { nextRenewal } from "./subscriptions";
import { addDays, shopToday } from "./time";
import { randomBytes } from "node:crypto";

/** A cobrança online está ligada (chave do Asaas configurada). */
export function isCobrancaOnline() {
  return isAsaasConfigured();
}

function nsu() {
  return `BW${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
}

export type ChargeResult =
  | { ok: true; url: string; orderNsu: string }
  | { ok: false; error: string; precisaCpf?: boolean };

/** Dias para pagar a fatura antes de ela vencer. */
const PRAZO_DIAS = 3;

/**
 * Gera a cobrança de um ciclo da assinatura. O Asaas exige CPF: vem da
 * conta, ou de `cpf` (que fica salvo na conta para as próximas).
 */
export async function chargeSubscription(
  userId: number,
  cycle: "MENSAL" | "ANUAL",
  opts: { cpf?: string } = {}
): Promise<ChargeResult> {
  if (!isCobrancaOnline()) {
    return { ok: false, error: "Cobrança online não configurada (ASAAS_API_KEY ausente)." };
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

  let cpf = user.cpf;
  if (opts.cpf) {
    if (!cpfValido(opts.cpf)) return { ok: false, error: "CPF inválido. Confira os números.", precisaCpf: true };
    cpf = soDigitosCpf(opts.cpf);
  }
  if (!cpf) {
    return {
      ok: false,
      precisaCpf: true,
      error: "Para pagar online, informe o CPF de quem é o plano.",
    };
  }

  const cliente = await salvarCliente({
    asaasId: user.asaasCustomerId,
    nome: user.name,
    cpf,
    telefone: user.phone,
    email: user.email,
    referencia: `usuario-${user.id}`,
  });
  if (!cliente.ok) return { ok: false, error: cliente.error };
  if (cliente.data.id !== user.asaasCustomerId || cpf !== user.cpf) {
    await db.update(users).set({ asaasCustomerId: cliente.data.id, cpf }).where(eq(users.id, user.id));
  }

  const meses = cycle === "ANUAL" ? 12 : 1;
  const unit = cycle === "ANUAL" ? plan.annualPriceCents : plan.priceCents;
  const amountCents = unit * meses;
  const orderNsu = nsu();
  const descricao = `${plan.name} — ${cycle === "ANUAL" ? "12 meses" : "1 mês"}`;

  const cobranca = await criarCobranca({
    cliente: cliente.data.id,
    valorCents: amountCents,
    vencimento: addDays(shopToday(), PRAZO_DIAS),
    descricao: `Clube VIP Bryan Wesley · ${descricao}`,
    referencia: orderNsu,
  });
  if (!cobranca.ok) return { ok: false, error: cobranca.error };
  if (!cobranca.data.invoiceUrl) return { ok: false, error: "O Asaas não devolveu o link da fatura." };

  await db.insert(payments).values({
    orderNsu,
    userId,
    subscriptionId: sub.id,
    kind: "ASSINATURA",
    cycle,
    planId: plan.id,
    amountCents,
    description: `${plan.name} · ${cycle.toLowerCase()}`,
    provider: "asaas",
    checkoutUrl: cobranca.data.invoiceUrl,
    // O id da cobrança no Asaas: a baixa só aceita esta cobrança.
    transactionNsu: cobranca.data.id,
  });

  return { ok: true, url: cobranca.data.invoiceUrl, orderNsu };
}

/** Recibo só do próprio Asaas (o corpo do webhook vem de fora). */
function reciboConfiavel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "asaas.com" || u.hostname.endsWith(".asaas.com"))
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Dá baixa numa cobrança e aplica o efeito (renovar assinatura).
 * `paymentId` é o id da cobrança no Asaas, como veio no webhook.
 */
export async function settlePayment(input: { orderNsu: string; paymentId?: string }) {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.orderNsu, input.orderNsu),
  });
  // Mesmo texto para cobrança desconhecida e para aviso incompleto: a
  // diferença diria quais referências existem.
  if (!payment) return { ok: false as const, error: "Pagamento não confirmado." };
  if (payment.status === "PAGO") return { ok: true as const, already: true };
  if (!input.paymentId) return { ok: false as const, error: "Pagamento não confirmado." };
  // A cobrança gravada é a única que dá baixa nesta referência.
  if (payment.transactionNsu && payment.transactionNsu !== input.paymentId) {
    return { ok: false as const, error: "Pagamento não confirmado." };
  }

  // Nunca confia só no aviso: a situação e o valor vêm da API do Asaas.
  const check = await consultarCobranca(input.paymentId);
  if (!check.ok) return { ok: false as const, error: check.error, temporario: true };
  const c = check.data;
  if (c.deleted || !cobrancaPaga(c.status) || c.externalReference !== payment.orderNsu) {
    return { ok: false as const, error: "Pagamento não confirmado." };
  }
  if (Math.round(c.value * 100) < payment.amountCents) {
    console.error("Pagamento abaixo do cobrado:", input.orderNsu, c.value, payment.amountCents);
    return { ok: false as const, error: "Pagamento não confirmado." };
  }
  const receiptUrl = reciboConfiavel(c.transactionReceiptUrl);

  // Condicional ao PENDENTE: o provedor pode entregar o mesmo webhook duas
  // vezes ao mesmo tempo; só a chamada que der a baixa aplica o efeito,
  // senão a assinatura seria estendida dois ciclos.
  const [upd] = await db
    .update(payments)
    .set({
      status: "PAGO",
      paidAt: new Date(),
      transactionNsu: input.paymentId,
      receiptUrl,
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

      // O pedido que originou a cobrança está atendido. Sem fechar, ele
      // seguia aparecendo como "aguardando" no painel e o dono, tentando
      // ajudar, "ativava" de novo — recomeçando o ciclo de quem acabou
      // de pagar.
      await db
        .update(planRequests)
        .set({ status: "ATENDIDA" })
        .where(
          and(
            eq(planRequests.userId, sub.userId),
            eq(planRequests.status, "ABERTA")
          )
        );

      // Admin e cliente ficam sabendo no celular, na hora.
      await avisarPagamento({ userId: sub.userId, planId: payment.planId ?? sub.planId });
    }
  }

  return { ok: true as const, already: false };
}


/** Cobrança apagada no Asaas: some da lista de pendentes. */
export async function cancelPayment(input: { orderNsu: string; paymentId?: string }) {
  const payment = await db.query.payments.findFirst({ where: eq(payments.orderNsu, input.orderNsu) });
  if (!payment || payment.status !== "PENDENTE") return;
  if (payment.transactionNsu && payment.transactionNsu !== input.paymentId) return;
  await db
    .update(payments)
    .set({ status: "CANCELADO" })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "PENDENTE")));
}
