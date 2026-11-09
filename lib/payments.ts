// ───────────────────────────────────────────────────────────
// Cobrança pelo Asaas. Uma cobrança por ciclo da assinatura: o cliente
// paga na fatura do Asaas (Pix, boleto ou cartão), o webhook avisa e a
// baixa só acontece depois que a própria API do Asaas confirma.
// Sem ASAAS_API_KEY o módulo fica inerte e a ativação segue manual.
// ───────────────────────────────────────────────────────────
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointmentServices,
  appointments,
  payments,
  planRequests,
  plans,
  subscriptions,
  users,
  type Payment,
} from "@/db/schema";
import { avisarMensalidade, avisarPagamento, avisarPagamentoDoHorario } from "./avisos";
import { cpfValido, soDigitosCpf } from "./cpf";
import {
  apagarCobranca,
  cobrancaPaga,
  consultarCobranca,
  criarCobranca,
  isAsaasConfigured,
  pixDaCobranca,
  salvarCliente,
} from "./providers/asaas";
import { nextRenewal } from "./subscriptions";
import { addDays, shopToday, utcToShopParts } from "./time";
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
  opts: {
    cpf?: string;
    /** Mensalista paga só Pix ou cartão à vista (sem boleto, sem parcelar). */
    tipo?: "PIX" | "CREDIT_CARD";
    /** Vencimento (AAAA-MM-DD); sem ele, daqui a 3 dias. */
    vencimento?: string;
  } = {}
): Promise<ChargeResult> {
  const tipo = opts.tipo ?? "PIX";
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

  const meses0 = cycle === "ANUAL" ? 12 : 1;
  const valor0 = (cycle === "ANUAL" ? plan.annualPriceCents : plan.priceCents) * meses0;
  // Mensalidade já em aberto: a mesma fatura serve (forma e valor iguais).
  // Forma diferente: a velha sai, para não ficarem duas cobranças.
  const abertas = await db
    .select()
    .from(payments)
    .where(and(eq(payments.subscriptionId, sub.id), eq(payments.kind, "ASSINATURA"), eq(payments.status, "PENDENTE")))
    .orderBy(desc(payments.id));
  const mesma = abertas.find(
    (p) => p.checkoutUrl && p.amountCents === valor0 && p.cycle === cycle && (p.slug ?? "UNDEFINED") === tipo
  );
  if (mesma) return { ok: true, url: mesma.checkoutUrl!, orderNsu: mesma.orderNsu };

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
    vencimento: opts.vencimento && opts.vencimento > shopToday() ? opts.vencimento : addDays(shopToday(), PRAZO_DIAS),
    descricao: `Clube VIP Bryan Wesley · ${descricao}`,
    referencia: orderNsu,
    tipo,
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
    slug: tipo,
  });
  for (const velha of abertas) await descartarCobranca(velha);

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

  if (payment.kind === "AVULSO" && payment.appointmentId) {
    await avisarPagamentoDoHorario(payment.appointmentId, payment.amountCents);
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


// ───────────────────── Pagamento do agendamento ─────────────────────
//
// No agendamento avulso o cliente escolhe: Pix ou cartão (pelo Asaas,
// pago na hora pelo app) ou na barbearia (dinheiro ou maquininha). A
// cobrança online fica ligada ao horário em `payments.appointmentId`.

export type MetodoOnline = "PIX" | "CARTAO";

export type CobrancaAgendamento =
  | { ok: true; orderNsu: string; url: string }
  | { ok: false; error: string; precisaCpf?: boolean };

/**
 * Gera (ou reaproveita) a cobrança online de um agendamento.
 *
 * `cpfConfiavel`: quem pede é o próprio dono do WhatsApp ou a equipe. Só
 * aí o CPF salvo na conta pode ser usado, e o digitado pode ser salvo
 * nela. Um visitante que digita o WhatsApp de outra pessoa não vê nem
 * troca o CPF dela: a cobrança sai num cliente do Asaas à parte.
 */
export async function chargeAppointment(
  appointmentId: number,
  metodo: MetodoOnline,
  opts: { cpf?: string; cpfConfiavel?: boolean } = {}
): Promise<CobrancaAgendamento> {
  if (!isCobrancaOnline()) {
    return { ok: false, error: "O pagamento online ainda não está ligado. Pague na barbearia." };
  }
  const appt = await db.query.appointments.findFirst({ where: eq(appointments.id, appointmentId) });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  if (["CANCELADO", "NO_SHOW"].includes(appt.status)) {
    return { ok: false, error: "Esse horário foi cancelado." };
  }
  if (appt.totalCents <= 0) return { ok: false, error: "Nada a pagar: o plano cobre este horário." };

  const tipo = metodo === "PIX" ? "PIX" : "CREDIT_CARD";
  const atuais = await db
    .select()
    .from(payments)
    .where(and(eq(payments.appointmentId, appt.id), inArray(payments.status, ["PENDENTE", "PAGO"])))
    .orderBy(desc(payments.id));
  if (atuais.some((p) => p.status === "PAGO")) return { ok: false, error: "Esse horário já está pago." };
  // Mesma forma e mesmo valor: a fatura que já existe serve.
  const igual = atuais.find(
    (p) => p.slug === tipo && p.amountCents === appt.totalCents && p.checkoutUrl
  );
  if (igual) {
    await db.update(appointments).set({ paymentMethod: metodo }).where(eq(appointments.id, appt.id));
    return { ok: true, orderNsu: igual.orderNsu, url: igual.checkoutUrl! };
  }

  const user = appt.clientUserId
    ? await db.query.users.findFirst({ where: eq(users.id, appt.clientUserId) })
    : null;
  let cpf: string | null = null;
  if (opts.cpf && opts.cpf.trim()) {
    if (!cpfValido(opts.cpf)) return { ok: false, error: "CPF inválido. Confira os números.", precisaCpf: true };
    cpf = soDigitosCpf(opts.cpf);
  } else if (opts.cpfConfiavel && user?.cpf) {
    cpf = user.cpf;
  }
  if (!cpf) {
    return { ok: false, precisaCpf: true, error: "Para pagar com Pix ou cartão, informe o CPF." };
  }

  const confiavel = !!opts.cpfConfiavel && !!user;
  const cliente = await salvarCliente({
    // Só reaproveita (e atualiza) o cliente do Asaas da conta quando o
    // pedido é confiável; senão nasce um cliente só para esta cobrança.
    asaasId: confiavel ? user!.asaasCustomerId : null,
    nome: appt.clientName,
    cpf,
    telefone: appt.clientPhone,
    email: confiavel ? user!.email : null,
    referencia: confiavel ? `usuario-${user!.id}` : `agendamento-${appt.id}`,
  });
  if (!cliente.ok) return { ok: false, error: cliente.error };
  if (confiavel && (cliente.data.id !== user!.asaasCustomerId || cpf !== user!.cpf)) {
    await db.update(users).set({ asaasCustomerId: cliente.data.id, cpf }).where(eq(users.id, user!.id));
  }

  const itens = await db
    .select({ name: appointmentServices.name })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appt.id));
  const servicos = itens.map((i) => i.name).join(" + ") || "Atendimento";
  const dia = utcToShopParts(appt.startsAt).dateKey;
  const hoje = shopToday();
  const orderNsu = nsu();

  const cobranca = await criarCobranca({
    cliente: cliente.data.id,
    valorCents: appt.totalCents,
    // Vence no dia do horário (nunca antes de hoje).
    vencimento: dia > hoje ? dia : hoje,
    descricao: `Bryan Wesley Barbearia · ${servicos} · código ${appt.code}`,
    referencia: orderNsu,
    tipo,
  });
  if (!cobranca.ok) return { ok: false, error: cobranca.error };
  if (!cobranca.data.invoiceUrl) return { ok: false, error: "O Asaas não devolveu o link da fatura." };

  await db.insert(payments).values({
    orderNsu,
    userId: user?.id ?? null,
    appointmentId: appt.id,
    kind: "AVULSO",
    amountCents: appt.totalCents,
    description: `${servicos} · ${appt.code}`.slice(0, 160),
    provider: "asaas",
    checkoutUrl: cobranca.data.invoiceUrl,
    transactionNsu: cobranca.data.id,
    // A forma da fatura (PIX ou CREDIT_CARD), para reaproveitar a certa.
    slug: tipo,
  });
  await db.update(appointments).set({ paymentMethod: metodo }).where(eq(appointments.id, appt.id));

  // A troca de forma deixa a fatura anterior para trás: apaga lá também.
  for (const velha of atuais.filter((p) => p.status === "PENDENTE")) {
    await descartarCobranca(velha);
  }

  return { ok: true, orderNsu, url: cobranca.data.invoiceUrl };
}

/** Apaga no Asaas uma cobrança pendente e a marca como cancelada aqui. */
async function descartarCobranca(p: Payment) {
  if (p.status !== "PENDENTE") return;
  if (p.transactionNsu) {
    const r = await apagarCobranca(p.transactionNsu);
    // Paga no meio do caminho: não cancela, deixa a baixa acontecer.
    if (!r.ok && r.status !== 404) {
      console.error("Asaas: não deu para apagar a cobrança", p.orderNsu, r.error);
    }
  }
  await db
    .update(payments)
    .set({ status: "CANCELADO" })
    .where(and(eq(payments.id, p.id), eq(payments.status, "PENDENTE")));
}

/** Horário cancelado ou trocado para "na barbearia": a fatura aberta sai. */
export async function cancelarCobrancasDoAgendamento(appointmentId: number) {
  const pendentes = await db
    .select()
    .from(payments)
    .where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, "PENDENTE")));
  for (const p of pendentes) {
    try {
      await descartarCobranca(p);
    } catch (e) {
      console.error("Cancelar cobrança do agendamento falhou:", e);
    }
  }
}

/** A cobrança mais recente do horário (paga, pendente ou a última). */
export async function pagamentoDoAgendamento(appointmentId: number) {
  const lista = await db
    .select()
    .from(payments)
    .where(eq(payments.appointmentId, appointmentId))
    .orderBy(desc(payments.id));
  return lista.find((p) => p.status === "PAGO") ?? lista.find((p) => p.status === "PENDENTE") ?? null;
}

/**
 * Confere no Asaas uma cobrança ainda pendente e dá baixa se já foi paga.
 * Garante o "Pago" na tela mesmo se o webhook atrasar.
 */
export async function conferirPagamento(p: Payment): Promise<Payment> {
  if (p.status !== "PENDENTE" || !p.transactionNsu) return p;
  const c = await consultarCobranca(p.transactionNsu);
  if (c.ok && cobrancaPaga(c.data.status)) {
    await settlePayment({ orderNsu: p.orderNsu, paymentId: p.transactionNsu });
    return (await db.query.payments.findFirst({ where: eq(payments.id, p.id) })) ?? p;
  }
  return p;
}

/** QR do Pix da cobrança, para mostrar na própria tela. */
export async function pixDoPagamento(p: Payment) {
  if (p.status !== "PENDENTE" || p.slug !== "PIX" || !p.transactionNsu) return null;
  const r = await pixDaCobranca(p.transactionNsu);
  return r.ok ? { imagem: r.data.encodedImage, copiaECola: r.data.payload } : null;
}


// ───────────────────── Cobrança automática da mensalidade ─────────────────────

/** Dias antes do vencimento em que a mensalidade é gerada. */
export const DIAS_ANTES_DA_MENSALIDADE = 3;

/**
 * Gera sozinha a cobrança (Pix) da mensalidade de quem vence nos próximos
 * dias e avisa o membro no celular. O Asaas também manda o aviso por
 * e-mail/SMS. Pagou, o webhook renova o plano. Roda uma vez por dia
 * (dentro da varredura diária); quem já tem cobrança aberta é pulado.
 */
export async function cobrarMensalidadesAutomaticas(opts: { forcar?: boolean; limite?: number } = {}) {
  const r = { geradas: 0, semCpf: 0, falhas: 0, puladas: 0 };
  if (!isCobrancaOnline()) return r;
  const { getSettings } = await import("./schedule");
  const cfg = await getSettings();
  if (!cfg.autoCharge) return r;
  if (!opts.forcar) {
    const { hitRateLimit } = await import("./rate-limit");
    const vez = await hitRateLimit(`cobranca-auto:${shopToday()}`, 1, 26 * 3600_000);
    if (!vez.ok) return r;
  }

  const ate = new Date(Date.now() + DIAS_ANTES_DA_MENSALIDADE * 86400_000);
  const candidatas = await db
    .select({ sub: subscriptions, user: users })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"]), lte(subscriptions.renewsAt, ate)))
    .limit(opts.limite ?? 40);

  for (const { sub, user } of candidatas) {
    // Pediu para sair no fim do ciclo: não se cobra o próximo.
    if (sub.canceledAt) { r.puladas++; continue; }
    const aberta = await db.query.payments.findFirst({
      where: and(eq(payments.subscriptionId, sub.id), eq(payments.kind, "ASSINATURA"), eq(payments.status, "PENDENTE")),
    });
    if (aberta) { r.puladas++; continue; }
    if (!user.cpf) { r.semCpf++; continue; }
    const venc = utcToShopParts(sub.renewsAt).dateKey;
    try {
      const c = await chargeSubscription(user.id, sub.cycle, { tipo: "PIX", vencimento: venc });
      if (!c.ok) { r.falhas++; console.error("Mensalidade automática falhou:", user.id, c.error); continue; }
      r.geradas++;
      const linha = await db.query.payments.findFirst({ where: eq(payments.orderNsu, c.orderNsu) });
      await avisarMensalidade(user.id, linha?.amountCents ?? 0, venc);
    } catch (e) {
      r.falhas++;
      console.error("Mensalidade automática falhou:", user.id, e);
    }
  }
  return r;
}
