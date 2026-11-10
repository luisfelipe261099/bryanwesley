// ───────────────────────────────────────────────────────────
// Cobrança pelo Asaas. Uma cobrança por ciclo da assinatura: o cliente
// paga na fatura do Asaas (Pix, boleto ou cartão), o webhook avisa e a
// baixa só acontece depois que a própria API do Asaas confirma.
// Sem ASAAS_API_KEY o módulo fica inerte e a ativação segue manual.
// ───────────────────────────────────────────────────────────
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql as rawSql } from "drizzle-orm";
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
import { avisarMensalidade, avisarPagamento, avisarPagamentoDoHorario, avisarPagamentoEmPlanoCancelado } from "./avisos";
import { cpfValido, soDigitosCpf } from "./cpf";
import { cancelPendingNotifications } from "./notifications";
import {
  apagarCobranca,
  cancelarAssinaturaAsaas,
  cobrancasDaAssinatura,
  criarAssinaturaCartao,
  cobrancaPaga,
  consultarCobranca,
  estornarCobranca,
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
  // Quem estava no cartão automático e vai pagar no Pix: o cartão para de
  // ser cobrado antes, senão pagaria duas vezes o mesmo mês.
  const comCartao = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.userId, userId), isNotNull(subscriptions.asaasSubscriptionId)),
    columns: { id: true },
  });
  if (comCartao) {
    const parou = await encerrarCartaoRecorrente(userId);
    if (!parou.ok) return { ok: false, error: parou.error };
  }
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
  // Cobrança gerada pela assinatura do cartão: a referência é a da
  // assinatura; vale se a assinatura do Asaas é a deste plano.
  let daAssinatura = false;
  if (c.subscription && payment.subscriptionId) {
    const nossa = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, payment.subscriptionId) });
    daAssinatura = !!nossa?.asaasSubscriptionId && nossa.asaasSubscriptionId === c.subscription;
  }
  if (c.deleted || !cobrancaPaga(c.status) || (c.externalReference !== payment.orderNsu && !daAssinatura)) {
    return { ok: false as const, error: "Pagamento não confirmado." };
  }
  if (Math.round(c.value * 100) < payment.amountCents) {
    console.error("Pagamento abaixo do cobrado:", input.orderNsu, c.value, payment.amountCents);
    return { ok: false as const, error: "Pagamento não confirmado." };
  }
  const receiptUrl = reciboConfiavel(c.transactionReceiptUrl);

  // Condicional ao estado lido: o provedor pode entregar o mesmo webhook
  // duas vezes ao mesmo tempo; só a chamada que der a baixa aplica o
  // efeito, senão a assinatura seria estendida dois ciclos. CANCELADO
  // também dá baixa: o cliente pagou o Pix e logo trocou de forma — a API
  // acabou de confirmar que o dinheiro entrou, então ele não pode sumir.
  const [upd] = await db
    .update(payments)
    .set({
      status: "PAGO",
      paidAt: new Date(),
      transactionNsu: input.paymentId,
      receiptUrl,
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, payment.status)));
  if (upd.affectedRows === 0) return { ok: true as const, already: true };

  if (payment.kind === "ASSINATURA" && payment.subscriptionId) {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, payment.subscriptionId),
    });
    if (sub && sub.status === "CANCELADA") {
      // Plano já encerrado (cancelado ou trocado por outro): o pagamento
      // fica registrado, mas não ressuscita o plano velho. O admin decide.
      await avisarPagamentoEmPlanoCancelado(sub.userId, Math.round(c.value * 100));
    } else if (sub) {
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
    // Reserva de outro dia: com o pagamento ela vira agendamento — se o
    // horário ainda estiver livre. Ocupado por quem pagou antes: devolve.
    const { confirmarReservaPaga } = await import("./appointments");
    const r = await confirmarReservaPaga(payment.appointmentId);
    if (r === "ocupado") {
      await devolverReservaOcupada(payment);
      return { ok: true as const, already: false };
    }
    await avisarPagamentoDoHorario(payment.appointmentId, payment.amountCents);
  }

  return { ok: true as const, already: false };
}


/** Cobrança apagada no Asaas: some da lista de pendentes. */
export async function cancelPayment(input: { orderNsu: string; paymentId?: string }) {
  // Cobrança da assinatura do cartão: a referência é a da assinatura, então
  // o registro é achado pelo id da cobrança no Asaas.
  const payment =
    (await db.query.payments.findFirst({ where: eq(payments.orderNsu, input.orderNsu) })) ??
    (input.paymentId
      ? await db.query.payments.findFirst({ where: eq(payments.transactionNsu, input.paymentId) })
      : undefined);
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
  // Relido depois de gravar: dois toques ao mesmo tempo (duas abas) criam
  // duas faturas, e só a mais nova fica.
  const outras = await db
    .select()
    .from(payments)
    .where(and(eq(payments.appointmentId, appt.id), eq(payments.status, "PENDENTE")));
  for (const velha of outras.filter((p) => p.orderNsu !== orderNsu)) {
    await descartarCobranca(velha);
  }

  return { ok: true, orderNsu, url: cobranca.data.invoiceUrl };
}

/** Apaga no Asaas uma cobrança pendente e a marca como cancelada aqui. */
async function descartarCobranca(p: Payment): Promise<boolean> {
  if (p.status !== "PENDENTE") return false;
  if (p.transactionNsu) {
    const r = await apagarCobranca(p.transactionNsu);
    // O Asaas recusa apagar cobrança já paga (e pode estar fora do ar):
    // aí ela fica pendente aqui, e a baixa acontece quando o aviso chegar.
    if (!r.ok && r.status !== 404) {
      console.error("Asaas: não deu para apagar a cobrança", p.orderNsu, r.error);
      return false;
    }
  }
  await db
    .update(payments)
    .set({ status: "CANCELADO" })
    .where(and(eq(payments.id, p.id), eq(payments.status, "PENDENTE")));
  return true;
}

/**
 * Plano encerrado, trocado ou pago no balcão: as mensalidades em aberto
 * saem (senão o membro pagaria a fatura velha e o plano antigo voltaria).
 */
export async function cancelarCobrancasDoPlano(userId: number) {
  const pendentes = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.kind, "ASSINATURA"), eq(payments.status, "PENDENTE")));
  for (const p of pendentes) {
    try {
      await descartarCobranca(p);
    } catch (e) {
      console.error("Cancelar mensalidade em aberto falhou:", e);
    }
  }
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
    .where(
      and(
        inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"]),
        lte(subscriptions.renewsAt, ate),
        // Vencido há mais de 10 dias não é mais cobrado sozinho: virou
        // caso do balcão (senão o ex-membro recebia Pix para sempre).
        gte(subscriptions.renewsAt, new Date(Date.now() - 10 * 86400_000)),
        isNull(subscriptions.canceledAt),
        isNull(subscriptions.asaasSubscriptionId),
        // Pedido de plano abandonado (nunca pagou, nunca ativado) não é
        // mensalista. Ativado pelo admin (ATIVA) ou que já pagou, é.
        rawSql`(${subscriptions.status} = 'ATIVA' or exists (select 1 from ${payments} where ${payments.subscriptionId} = ${subscriptions.id} and ${payments.status} = 'PAGO'))`,
        rawSql`not exists (select 1 from ${payments} where ${payments.subscriptionId} = ${subscriptions.id} and ${payments.kind} = 'ASSINATURA' and ${payments.status} = 'PENDENTE')`
      )
    )
    .orderBy(subscriptions.renewsAt)
    .limit(opts.limite ?? 40);

  for (const { sub, user } of candidatas) {
    // Pediu para sair no fim do ciclo: não se cobra o próximo. No cartão
    // recorrente quem cobra é o próprio Asaas.
    if (sub.canceledAt || sub.asaasSubscriptionId) { r.puladas++; continue; }
    const aberta = await db.query.payments.findFirst({
      where: and(eq(payments.subscriptionId, sub.id), eq(payments.kind, "ASSINATURA"), eq(payments.status, "PENDENTE")),
    });
    if (aberta) { r.puladas++; continue; }
    if (!user.cpf) { r.semCpf++; continue; }
    const venc = utcToShopParts(sub.renewsAt).dateKey;
    try {
      // Preferência do membro (escolhida pelo admin): cartão automático —
      // a assinatura do cartão nasce agora com a 1ª cobrança no vencimento.
      const c =
        sub.billingPref === "CARTAO"
          ? await assinarNoCartao(user.id, sub.cycle)
          : await chargeSubscription(user.id, sub.cycle, { tipo: "PIX", vencimento: venc });
      if (!c.ok) { r.falhas++; console.error("Mensalidade automática falhou:", user.id, c.error); continue; }
      r.geradas++;
      const linha = await db.query.payments.findFirst({ where: eq(payments.orderNsu, c.orderNsu) });
      await avisarMensalidade(user.id, linha?.amountCents ?? 0, venc, sub.billingPref === "CARTAO" ? "CARTAO" : "PIX");
    } catch (e) {
      r.falhas++;
      console.error("Mensalidade automática falhou:", user.id, e);
    }
  }
  return r;
}


// ───────────────────── Plano no cartão, cobrado sozinho ─────────────────────

/**
 * Mensalidade no cartão de crédito recorrente: cria (ou recria) a
 * assinatura no Asaas. O membro informa o cartão na primeira fatura e,
 * dali em diante, o Asaas cobra o cartão sozinho a cada ciclo, à vista.
 * Cada cobrança paga chega pelo webhook e renova o plano aqui.
 */
export async function assinarNoCartao(
  userId: number,
  cycle: "MENSAL" | "ANUAL",
  opts: { cpf?: string } = {}
): Promise<ChargeResult> {
  if (!isCobrancaOnline()) {
    return { ok: false, error: "Cobrança online não configurada (ASAAS_API_KEY ausente)." };
  }
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
    orderBy: (s, { desc }) => [desc(s.startedAt)],
  });
  if (!sub) return { ok: false, error: "Cliente sem assinatura." };
  if (sub.status === "CANCELADA") {
    return { ok: false, error: "Esse plano está cancelado. Ative de novo antes de gerar a cobrança." };
  }
  const [plan, user] = await Promise.all([
    db.query.plans.findFirst({ where: eq(plans.id, sub.planId) }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
  ]);
  if (!plan || !user) return { ok: false, error: "Plano ou cliente não encontrado." };

  const meses = cycle === "ANUAL" ? 12 : 1;
  const valor = (cycle === "ANUAL" ? plan.annualPriceCents : plan.priceCents) * meses;

  // Já tem a assinatura do cartão com a primeira fatura em aberto: a mesma.
  if (sub.asaasSubscriptionId) {
    const aberta = await db.query.payments.findFirst({
      where: and(
        eq(payments.subscriptionId, sub.id),
        eq(payments.status, "PENDENTE"),
        eq(payments.slug, "CREDIT_CARD_RECORRENTE")
      ),
      orderBy: (p, { desc }) => [desc(p.id)],
    });
    if (aberta?.checkoutUrl && aberta.amountCents === valor && aberta.cycle === cycle) {
      return { ok: true, url: aberta.checkoutUrl, orderNsu: aberta.orderNsu };
    }
  }

  let cpf = user.cpf;
  if (opts.cpf) {
    if (!cpfValido(opts.cpf)) return { ok: false, error: "CPF inválido. Confira os números.", precisaCpf: true };
    cpf = soDigitosCpf(opts.cpf);
  }
  if (!cpf) return { ok: false, precisaCpf: true, error: "Para pagar online, informe o CPF de quem é o plano." };

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

  // Troca de plano ou de ciclo: a assinatura antiga do cartão sai antes,
  // para o cartão não ser cobrado duas vezes.
  if (sub.asaasSubscriptionId) {
    const parou = await encerrarCartaoRecorrente(userId);
    if (!parou.ok) return { ok: false, error: parou.error };
  }

  // Primeira cobrança: hoje para quem está entrando ou vencido; no
  // vencimento para quem está em dia (pode pagar antes, se quiser).
  const hoje = shopToday();
  const venc = sub.status === "ATIVA" && sub.renewsAt > new Date() ? utcToShopParts(sub.renewsAt).dateKey : hoje;
  const descricao = `${plan.name} — ${cycle === "ANUAL" ? "anual" : "mensal"}, cartão automático`;
  const criada = await criarAssinaturaCartao({
    cliente: cliente.data.id,
    valorCents: valor,
    ciclo: cycle === "ANUAL" ? "YEARLY" : "MONTHLY",
    primeiroVencimento: venc > hoje ? venc : hoje,
    descricao: `Clube VIP Bryan Wesley · ${descricao}`,
    referencia: `assinatura-${sub.id}`,
  });
  if (!criada.ok) return { ok: false, error: criada.error };
  await db.update(subscriptions).set({ asaasSubscriptionId: criada.data.id }).where(eq(subscriptions.id, sub.id));

  // A primeira fatura nasce junto com a assinatura.
  const lista = await cobrancasDaAssinatura(criada.data.id);
  const primeira = lista.ok ? lista.data.data?.find((p) => p.invoiceUrl && !cobrancaPaga(p.status)) : undefined;
  if (!primeira?.invoiceUrl) {
    return { ok: false, error: "O Asaas criou a assinatura mas não devolveu a fatura. Tente de novo em instantes." };
  }

  // Faturas antigas em aberto (Pix, cartão avulso) saem: senão o membro
  // poderia pagar duas vezes o mesmo mês.
  const velhas = await db
    .select()
    .from(payments)
    .where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")));
  for (const v of velhas) await descartarCobranca(v);

  const orderNsu = nsu();
  await db.insert(payments).values({
    orderNsu,
    userId,
    subscriptionId: sub.id,
    kind: "ASSINATURA",
    cycle,
    planId: plan.id,
    amountCents: valor,
    description: `${plan.name} · ${cycle.toLowerCase()} · cartão automático`,
    provider: "asaas",
    checkoutUrl: primeira.invoiceUrl,
    transactionNsu: primeira.id,
    slug: "CREDIT_CARD_RECORRENTE",
  });
  return { ok: true, url: primeira.invoiceUrl, orderNsu };
}

/**
 * Cobrança da assinatura do cartão avisada pelo webhook. A do mês seguinte
 * nasce no Asaas sem registro aqui: o registro é criado na hora, a partir
 * da assinatura, e a baixa segue o caminho de sempre (conferida na API).
 */
export async function settleCobrancaRecorrente(input: { paymentId: string; asaasSubscriptionId: string }) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.asaasSubscriptionId, input.asaasSubscriptionId),
  });
  if (!sub) return { ok: false as const, error: "Assinatura do Asaas desconhecida." };
  let linha = await db.query.payments.findFirst({ where: eq(payments.transactionNsu, input.paymentId) });
  if (!linha) {
    // O valor é o que o Asaas cobrou do cartão (a assinatura guarda o preço
    // de quando foi criada): o preço do plano pode ter mudado depois.
    const c = await consultarCobranca(input.paymentId);
    if (!c.ok) return { ok: false as const, error: c.error, temporario: true };
    // Referência fixa por cobrança: dois avisos ao mesmo tempo esbarram no
    // índice único em vez de criar dois registros (e dois ciclos).
    const orderNsu = `AS-${input.paymentId}`.slice(0, 40);
    await db
      .insert(payments)
      .values({
        orderNsu,
        userId: sub.userId,
        subscriptionId: sub.id,
        kind: "ASSINATURA",
        cycle: sub.cycle,
        planId: sub.planId,
        amountCents: Math.round(c.data.value * 100),
        description: `Mensalidade · ${sub.cycle.toLowerCase()} · cartão automático`,
        provider: "asaas",
        transactionNsu: input.paymentId,
        slug: "CREDIT_CARD_RECORRENTE",
      })
      .onDuplicateKeyUpdate({ set: { orderNsu: rawSql`${payments.orderNsu}` } });
    linha = await db.query.payments.findFirst({ where: eq(payments.orderNsu, orderNsu) });
  }
  return settlePayment({ orderNsu: linha!.orderNsu, paymentId: input.paymentId });
}

/**
 * Plano cancelado: o cartão para de ser cobrado no Asaas. Se o Asaas não
 * confirmar (fora do ar), devolve erro — quem chama não encerra o plano
 * sem isso, senão o cartão seguiria sendo cobrado.
 */
export async function encerrarCartaoRecorrente(userId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const subs = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), isNotNull(subscriptions.asaasSubscriptionId)));
  for (const s of subs) {
    const r = await cancelarAssinaturaAsaas(s.asaasSubscriptionId!).catch(() => null);
    if (!r || (!r.ok && r.status !== 404)) {
      console.error("Asaas: não deu para encerrar a assinatura do cartão", s.asaasSubscriptionId, r && !r.ok ? r.error : "sem resposta");
      return {
        ok: false,
        error: "Não deu para parar a cobrança do cartão no Asaas agora. Tente de novo em instantes.",
      };
    }
    await db.update(subscriptions).set({ asaasSubscriptionId: null }).where(eq(subscriptions.id, s.id));
    // A primeira fatura do cartão que ficou em aberto sai daqui também.
    const abertas = await db
      .select()
      .from(payments)
      .where(and(eq(payments.subscriptionId, s.id), eq(payments.status, "PENDENTE"), eq(payments.slug, "CREDIT_CARD_RECORRENTE")));
    for (const p of abertas) {
      await db.update(payments).set({ status: "CANCELADO" }).where(and(eq(payments.id, p.id), eq(payments.status, "PENDENTE")));
    }
  }
  return { ok: true };
}


// ───────────────────── Recebido no balcão ─────────────────────

export type FormaBalcao = "DINHEIRO" | "PIX_BALCAO" | "CARTAO_BALCAO";

/**
 * O barbeiro recebeu na hora (dinheiro, Pix na maquininha/chave da loja ou
 * cartão): o horário fica pago, e a fatura online em aberto sai (se o
 * cliente já tinha pago o Pix, a baixa dela acontece normalmente).
 */
export async function registrarPagamentoNoBalcao(
  appointmentId: number,
  forma: FormaBalcao,
  opts: { mensalista?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const appt = await db.query.appointments.findFirst({ where: eq(appointments.id, appointmentId) });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  if (appt.totalCents <= 0) return { ok: false, error: "Nada a cobrar: o plano cobre este horário." };
  if (["CANCELADO", "NO_SHOW"].includes(appt.status)) return { ok: false, error: "Esse horário foi cancelado." };
  if (forma === "DINHEIRO" && opts.mensalista) {
    return { ok: false, error: "Mensalista não paga em dinheiro: receba no Pix ou no cartão." };
  }
  const pago = await db.query.payments.findFirst({
    where: and(eq(payments.appointmentId, appt.id), eq(payments.status, "PAGO")),
  });
  if (pago) return { ok: false, error: "Esse horário já está pago." };
  await cancelarCobrancasDoAgendamento(appt.id);
  await db.insert(payments).values({
    orderNsu: nsu(),
    userId: appt.clientUserId,
    appointmentId: appt.id,
    kind: "AVULSO",
    amountCents: appt.totalCents,
    description: `Recebido no balcão · ${appt.code}`,
    status: "PAGO",
    provider: "balcao",
    slug: forma,
    paidAt: new Date(),
  });
  await db.update(appointments).set({ paymentMethod: "BALCAO" }).where(eq(appointments.id, appt.id));
  return { ok: true };
}


// ───────────────────── Agendado para outro dia: paga antes ─────────────────────

/** Minutos que o cliente tem para pagar um horário marcado para outro dia. */
export const MINUTOS_PARA_PAGAR = 30;

/** O cliente precisa pagar pelo app para garantir este dia? */
export function exigePagamentoAntecipado(dateKey: string) {
  return isCobrancaOnline() && dateKey > shopToday();
}

let ultimaVarredura = 0;

/**
 * Libera os horários marcados para outro dia que não foram pagos no prazo.
 * Antes de soltar, confere no Asaas (o aviso pode ter atrasado) e só solta
 * se a cobrança em aberto sair de verdade — Pix pago na hora H fica.
 * Barata quando não há nada vencido; roda ao abrir a agenda e ao agendar.
 */
export async function liberarHorariosSemPagamento(opts: { forcar?: boolean } = {}) {
  if (!opts.forcar && Date.now() - ultimaVarredura < 60_000) return 0;
  ultimaVarredura = Date.now();
  const vencidos = await db
    .select()
    .from(appointments)
    .where(
      and(
        isNotNull(appointments.payBy),
        lte(appointments.payBy, new Date()),
        inArray(appointments.status, ["PENDENTE", "CONFIRMADO", "AGUARDANDO_PAGAMENTO"])
      )
    )
    .limit(50);
  let liberados = 0;
  for (const appt of vencidos) {
    try {
      const doHorario = await db.select().from(payments).where(eq(payments.appointmentId, appt.id));
      let pago = doHorario.some((p) => p.status === "PAGO");
      let todasSairam = true;
      for (const p of doHorario.filter((x) => x.status === "PENDENTE")) {
        if (pago) break;
        const conferido = await conferirPagamento(p).catch(() => p);
        if (conferido.status === "PAGO") {
          pago = true;
          break;
        }
        if (!(await descartarCobranca(conferido).catch(() => false))) todasSairam = false;
      }
      if (pago) {
        // conferirPagamento já confirmou (ou devolveu) a reserva; aqui só
        // fecha o prazo de quem estava pago e não era reserva.
        await db
          .update(appointments)
          .set({ payBy: null })
          .where(and(eq(appointments.id, appt.id), ne(appointments.status, "AGUARDANDO_PAGAMENTO")));
        if (appt.status === "AGUARDANDO_PAGAMENTO") {
          const { confirmarReservaPaga } = await import("./appointments");
          const r = await confirmarReservaPaga(appt.id);
          const linha = doHorario.find((p) => p.status === "PAGO") ??
            (await db.query.payments.findFirst({ where: and(eq(payments.appointmentId, appt.id), eq(payments.status, "PAGO")) }));
          if (r === "ocupado" && linha) await devolverReservaOcupada(linha);
        }
        continue;
      }
      if (!todasSairam) continue; // Asaas fora do ar ou já pago: tenta na próxima
      const [r] = await db
        .update(appointments)
        .set({
          status: "CANCELADO",
          notes: [appt.notes, "Liberado: não foi pago no prazo."].filter(Boolean).join(" · "),
        })
        .where(and(eq(appointments.id, appt.id), eq(appointments.status, appt.status)));
      if (r.affectedRows === 1) {
        liberados++;
        await cancelPendingNotifications(appt.id).catch(() => {});
      }
    } catch (e) {
      console.error("Liberar horário sem pagamento falhou:", appt.id, e);
    }
  }
  return liberados;
}


/**
 * Pagou a reserva depois que outra pessoa já tinha ficado com o horário:
 * o valor volta para o cliente pelo Asaas e o admin fica sabendo. Se o
 * estorno não sair, o admin é avisado para devolver à mão.
 */
async function devolverReservaOcupada(payment: Payment) {
  let devolvido = false;
  if (payment.transactionNsu) {
    const r = await estornarCobranca(payment.transactionNsu, "Horário ocupado antes do pagamento").catch(() => null);
    devolvido = !!r?.ok;
  }
  await db
    .update(payments)
    .set({
      status: devolvido ? "CANCELADO" : "PAGO",
      description: `${payment.description ?? ""} · ${devolvido ? "devolvido: horário já ocupado" : "DEVOLVER: horário já ocupado"}`.slice(0, 150),
    })
    .where(eq(payments.id, payment.id));
  try {
    const appt = payment.appointmentId
      ? await db.query.appointments.findFirst({ where: eq(appointments.id, payment.appointmentId) })
      : null;
    const { idsDosAdmins } = await import("./avisos");
    const { enviarPush } = await import("./push");
    const valor = (payment.amountCents / 100).toFixed(2).replace(".", ",");
    await enviarPush(await idsDosAdmins(), {
      titulo: devolvido ? "Pagamento devolvido" : "Devolva um pagamento",
      corpo: devolvido
        ? `${appt?.clientName ?? "Cliente"} pagou R$ ${valor}, mas o horário já tinha sido marcado por outra pessoa. O valor foi devolvido.`
        : `${appt?.clientName ?? "Cliente"} pagou R$ ${valor}, mas o horário já estava ocupado e o estorno automático falhou. Devolva pelo Asaas.`,
      tag: `devolucao-${payment.id}`,
      url: "/admin/agenda",
    });
  } catch (e) {
    console.error("Aviso de devolução falhou:", e);
  }
}
