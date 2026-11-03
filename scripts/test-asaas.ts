// Pagamentos pelo Asaas, com a API simulada (nada sai para a internet):
// CPF exigido, cliente e cobrança criados, baixa só com a confirmação da
// API (situação, referência e valor) e webhook protegido por token.
import "../db/load-env";
import { db, pool } from "../db/client";
import { payments, plans, subscriptions, users } from "../db/schema";
import { cpfValido, formatarCpf } from "../lib/cpf";
import { eq, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const CPF = "52998224725"; // CPF de teste válido

// ── Asaas de mentira ─────────────────────────────────────────
type Cobranca = { id: string; status: string; value: number; externalReference: string; invoiceUrl: string; transactionReceiptUrl?: string; deleted?: boolean };
const cobrancas = new Map<string, Cobranca>();
const chamadas: { metodo: string; caminho: string; corpo: Record<string, unknown> | null; chave: string | null }[] = [];
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  chamadas.push({ metodo, caminho, corpo, chave: new Headers(init?.headers).get("access_token") });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho === "/customers") return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho.startsWith("/customers/")) return json(200, { id: caminho.split("/")[2] });
  if (metodo === "POST" && caminho === "/payments") {
    const c: Cobranca = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` };
    cobrancas.set(c.id, c);
    return json(200, c);
  }
  if (metodo === "GET" && caminho.startsWith("/payments/")) {
    const c = cobrancas.get(caminho.split("/")[2]);
    return c ? json(200, c) : json(404, { errors: [{ description: "não encontrada" }] });
  }
  return json(400, { errors: [{ description: "rota não simulada" }] });
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197020%"));
  for (const g of gente) {
    await db.delete(payments).where(eq(payments.userId, g.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, g.id));
    await db.delete(users).where(eq(users.id, g.id));
  }
}

async function main() {
  console.log("1. CPF");
  ok("CPF válido passa", cpfValido(CPF) && cpfValido("529.982.247-25"));
  ok("CPF com dígito errado é recusado", !cpfValido("52998224724"));
  ok("CPF repetido é recusado", !cpfValido("11111111111"));
  ok("formata enquanto digita", formatarCpf("5299822") === "529.982.2" && formatarCpf(CPF) === "529.982.247-25");

  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  process.env.ASAAS_WEBHOOK_TOKEN = "token-de-teste-123";
  delete process.env.ASAAS_API_URL;
  const { chargeSubscription, settlePayment, isCobrancaOnline } = await import("../lib/payments");
  const { POST: webhook } = await import("../app/api/pagamentos/asaas/route");

  await limpar();
  try {
    const plano = (await db.select().from(plans).where(eq(plans.active, true)))[0];
    await db.insert(users).values({ name: "Teste Asaas", phone: "41970200001", role: "CLIENT" });
    const cliente = (await db.select().from(users).where(eq(users.phone, "41970200001")))[0];
    await db.insert(subscriptions).values({ userId: cliente.id, planId: plano.id, cycle: "MENSAL", status: "INADIMPLENTE", renewsAt: new Date() });
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.userId, cliente.id)))[0];

    console.log("2. Cobrança");
    ok("com a chave, a cobrança online está ligada", isCobrancaOnline());
    const semCpf = await chargeSubscription(cliente.id, "MENSAL");
    ok("sem CPF, pede o CPF", !semCpf.ok && !!semCpf.precisaCpf);
    const cpfErrado = await chargeSubscription(cliente.id, "MENSAL", { cpf: "123.456.789-00" });
    ok("CPF inválido é recusado antes de ir ao Asaas", !cpfErrado.ok && !!cpfErrado.precisaCpf && chamadas.length === 0);

    const c1 = await chargeSubscription(cliente.id, "MENSAL", { cpf: "529.982.247-25" });
    ok("com CPF, gera a fatura do Asaas", c1.ok && c1.url.startsWith("https://www.asaas.com/i/"));
    ok("usa o sandbox com a chave de sandbox", chamadas.every((c) => c.caminho && c.chave === "$aact_hmlg_teste"));
    const cria = chamadas.find((c) => c.caminho === "/customers");
    ok("cria o cliente com nome, CPF e celular", cria?.corpo?.cpfCnpj === CPF && cria?.corpo?.mobilePhone === "41970200001");
    const cob = chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST");
    ok("cobra o valor do plano, com Pix/boleto/cartão à escolha", cob?.corpo?.value === plano.priceCents / 100 && cob?.corpo?.billingType === "UNDEFINED");
    const conta = (await db.select().from(users).where(eq(users.id, cliente.id)))[0];
    ok("o CPF e o cliente do Asaas ficam salvos na conta", conta.cpf === CPF && !!conta.asaasCustomerId);
    if (!c1.ok) throw new Error("sem cobrança");
    const pg = (await db.select().from(payments).where(eq(payments.orderNsu, c1.orderNsu)))[0];
    ok("a cobrança fica registrada como pendente, com o id do Asaas", pg.status === "PENDENTE" && pg.provider === "asaas" && pg.transactionNsu?.startsWith("pay_") === true);

    const antes = chamadas.length;
    const c2 = await chargeSubscription(cliente.id, "MENSAL");
    ok("na próxima vez, usa o CPF salvo e atualiza o mesmo cliente", c2.ok && chamadas.slice(antes).some((c) => c.caminho === `/customers/${conta.asaasCustomerId}`));

    console.log("3. Baixa");
    const id = pg.transactionNsu!;
    ok("aviso sem o id da cobrança é recusado", !(await settlePayment({ orderNsu: c1.orderNsu })).ok);
    ok("aviso com id de outra cobrança é recusado", !(await settlePayment({ orderNsu: c1.orderNsu, paymentId: "pay_outra" })).ok);
    ok("cobrança ainda não paga não dá baixa", !(await settlePayment({ orderNsu: c1.orderNsu, paymentId: id })).ok);
    cobrancas.get(id)!.status = "RECEIVED";
    cobrancas.get(id)!.value = plano.priceCents / 100 - 1;
    ok("valor abaixo do cobrado não dá baixa", !(await settlePayment({ orderNsu: c1.orderNsu, paymentId: id })).ok);
    cobrancas.get(id)!.value = plano.priceCents / 100;
    cobrancas.get(id)!.externalReference = "OUTRA";
    ok("referência trocada não dá baixa", !(await settlePayment({ orderNsu: c1.orderNsu, paymentId: id })).ok);
    cobrancas.get(id)!.externalReference = c1.orderNsu;
    cobrancas.get(id)!.transactionReceiptUrl = "https://www.asaas.com/comprovantes/1";

    console.log("4. Webhook");
    const req = (token: string | null, corpo: unknown) =>
      new Request("http://localhost/api/pagamentos/asaas", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "asaas-access-token": token } : {}) },
        body: JSON.stringify(corpo),
      });
    const aviso = { event: "PAYMENT_RECEIVED", payment: { id, externalReference: c1.orderNsu } };
    ok("sem token: 401", (await webhook(req(null, aviso))).status === 401);
    ok("token errado: 401", (await webhook(req("token-errado-123", aviso))).status === 401);
    const r = await webhook(req("token-de-teste-123", aviso));
    ok("token certo: 200", r.status === 200);
    const pago = (await db.select().from(payments).where(eq(payments.orderNsu, c1.orderNsu)))[0];
    ok("cobrança paga, com o recibo do Asaas", pago.status === "PAGO" && pago.receiptUrl === "https://www.asaas.com/comprovantes/1");
    const ativa = (await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0];
    ok("a assinatura fica ativa por mais um ciclo", ativa.status === "ATIVA" && ativa.renewsAt.getTime() > Date.now() + 20 * 86400_000);
    const renova = ativa.renewsAt.getTime();
    await webhook(req("token-de-teste-123", { event: "PAYMENT_CONFIRMED", payment: { id, externalReference: c1.orderNsu } }));
    const denovo = (await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0];
    ok("aviso repetido não estende o plano duas vezes", denovo.renewsAt.getTime() === renova);

    const pg2 = (await db.select().from(payments).where(eq(payments.orderNsu, c2.ok ? c2.orderNsu : "")))[0];
    await webhook(req("token-de-teste-123", { event: "PAYMENT_DELETED", payment: { id: pg2.transactionNsu, externalReference: pg2.orderNsu } }));
    const apagada = (await db.select().from(payments).where(eq(payments.id, pg2.id)))[0];
    ok("cobrança apagada no Asaas sai das pendentes", apagada.status === "CANCELADO");
    ok("evento sem a nossa referência é ignorado com 200", (await webhook(req("token-de-teste-123", { event: "PAYMENT_RECEIVED", payment: { id: "pay_x" } }))).status === 200);
  } finally {
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
