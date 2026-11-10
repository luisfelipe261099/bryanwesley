// Plano no cartão de crédito cobrado sozinho (assinatura do Asaas), com o
// Asaas simulado: nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import { payments, plans, subscriptions, users } from "../db/schema";
import { eq, like } from "drizzle-orm";
import { utcToShopParts } from "../lib/time";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

type Cob = { id: string; status: string; value: number; externalReference: string | null; invoiceUrl: string; subscription: string | null; deleted?: boolean };
const cobs = new Map<string, Cob>();
const assinaturas = new Map<string, { id: string; value: number; ref: string; deleted?: boolean }>();
const chamadas: { metodo: string; caminho: string; corpo: Record<string, unknown> | null }[] = [];
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  chamadas.push({ metodo, caminho, corpo });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: caminho.split("/")[2] ?? `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/subscriptions") {
    const s = { id: `sub_${++seq}`, value: corpo.value, ref: corpo.externalReference };
    assinaturas.set(s.id, s);
    // O Asaas gera a primeira cobrança junto com a assinatura.
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}`, subscription: s.id };
    cobs.set(c.id, c);
    return json(200, { id: s.id, status: "ACTIVE" });
  }
  let m = caminho.match(/^\/subscriptions\/([^/]+)(\/payments)?$/);
  if (m) {
    const s = assinaturas.get(m[1]);
    if (!s) return json(404, { errors: [{ description: "não encontrada" }] });
    if (metodo === "DELETE") { s.deleted = true; return json(200, { deleted: true }); }
    return json(200, { data: [...cobs.values()].filter((c) => c.subscription === s.id) });
  }
  m = caminho.match(/^\/payments\/([^/]+)$/);
  if (m) {
    const c = cobs.get(m[1]);
    if (!c) return json(404, { errors: [{ description: "não encontrada" }] });
    if (metodo === "DELETE") { c.deleted = true; return json(200, { deleted: true }); }
    return json(200, c);
  }
  if (metodo === "POST" && caminho === "/payments") {
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}`, subscription: null };
    cobs.set(c.id, c);
    return json(200, c);
  }
  return json(400, { errors: [{ description: "rota não simulada" }] });
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197025%"));
  for (const g of gente) {
    await db.delete(payments).where(eq(payments.userId, g.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, g.id));
    await db.delete(users).where(eq(users.id, g.id));
  }
}

async function main() {
  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  process.env.ASAAS_WEBHOOK_TOKEN = "token-de-teste-123";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");
  const { POST: webhook } = await import("../app/api/pagamentos/asaas/route");
  const aviso = (event: string, c: Cob) =>
    webhook(new Request("http://localhost/api/pagamentos/asaas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": "token-de-teste-123" },
      body: JSON.stringify({ event, payment: { id: c.id, externalReference: c.externalReference, subscription: c.subscription } }),
    }));

  await limpar();
  try {
    const plano = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
    await db.insert(users).values({ name: "Cartão Teste", phone: "41970250001", role: "CLIENT", cpf: "52998224725" });
    const u = (await db.select().from(users).where(eq(users.phone, "41970250001")))[0];
    await db.insert(subscriptions).values({ userId: u.id, planId: plano.id, cycle: "MENSAL", status: "INADIMPLENTE", renewsAt: new Date() });
    const sub = () => db.select().from(subscriptions).where(eq(subscriptions.userId, u.id)).then((r) => r[0]);

    console.log("1. Assinar no cartão");
    const r1 = await pay.assinarNoCartao(u.id, "MENSAL");
    const post = chamadas.find((c) => c.caminho === "/subscriptions" && c.metodo === "POST");
    ok("cria a assinatura no Asaas: cartão, mensal, valor do plano", r1.ok && post?.corpo?.billingType === "CREDIT_CARD" && post?.corpo?.cycle === "MONTHLY" && post?.corpo?.value === plano.priceCents / 100);
    ok("sem parcelamento", post?.corpo?.installmentCount === undefined);
    const s1 = await sub();
    ok("guarda a assinatura do Asaas no plano", !!s1.asaasSubscriptionId);
    const primeira = [...cobs.values()].find((c) => c.subscription === s1.asaasSubscriptionId)!;
    ok("devolve a fatura da 1ª cobrança (onde o cliente põe o cartão)", r1.ok && r1.url === primeira.invoiceUrl);
    const antes = chamadas.length;
    const r1b = await pay.assinarNoCartao(u.id, "MENSAL");
    ok("tocar de novo reaproveita, sem criar outra assinatura", r1b.ok && r1b.url === primeira.invoiceUrl && !chamadas.slice(antes).some((c) => c.caminho === "/subscriptions" && c.metodo === "POST"));

    console.log("2. Cobranças pelo webhook");
    primeira.status = "CONFIRMED";
    ok("1ª cobrança confirmada: 200", (await aviso("PAYMENT_CONFIRMED", primeira)).status === 200);
    const s2 = await sub();
    ok("plano ativo por um mês", s2.status === "ATIVA" && s2.renewsAt.getTime() > Date.now() + 25 * 86400_000);
    await aviso("PAYMENT_RECEIVED", primeira);
    ok("aviso repetido não estende duas vezes", (await sub()).renewsAt.getTime() === s2.renewsAt.getTime());

    // Mês seguinte: o Asaas gera e cobra sozinho; aqui não havia registro.
    const proxima: Cob = { id: "pay_mes2", status: "CONFIRMED", value: plano.priceCents / 100, externalReference: primeira.externalReference, invoiceUrl: "https://www.asaas.com/i/mes2", subscription: s1.asaasSubscriptionId };
    cobs.set(proxima.id, proxima);
    await aviso("PAYMENT_CONFIRMED", proxima);
    const s3 = await sub();
    ok("cobrança do mês seguinte renova mais um mês sozinha", s3.renewsAt.getTime() > s2.renewsAt.getTime() + 25 * 86400_000);
    const linha = (await db.select().from(payments).where(eq(payments.transactionNsu, "pay_mes2")))[0];
    ok("e fica registrada como paga", linha?.status === "PAGO" && linha.kind === "ASSINATURA");

    const falsa: Cob = { id: "pay_falsa", status: "CONFIRMED", value: 1, externalReference: null, invoiceUrl: "x", subscription: "sub_de_outro" };
    cobs.set(falsa.id, falsa);
    ok("assinatura desconhecida é ignorada com 200", (await aviso("PAYMENT_CONFIRMED", falsa)).status === 200 && (await sub()).renewsAt.getTime() === s3.renewsAt.getTime());

    console.log("3. Ativado pelo admin com 1ª cobrança no cartão no mês que vem");
    {
      await db.insert(users).values({ name: "Cartão Futuro", phone: "41970250002", role: "CLIENT", cpf: "52998224725" });
      const u2 = (await db.select().from(users).where(eq(users.phone, "41970250002")))[0];
      const venc = new Date(Date.now() + 2 * 86400_000);
      await db.insert(subscriptions).values({ userId: u2.id, planId: plano.id, cycle: "MENSAL", status: "ATIVA", renewsAt: venc, billingPref: "CARTAO" });
      const antesSub = chamadas.filter((c) => c.caminho === "/subscriptions" && c.metodo === "POST").length;
      await db.update(subscriptions).set({ renewsAt: new Date(Date.now() + 20 * 86400_000) }).where(eq(subscriptions.userId, u2.id));
      await pay.cobrarMensalidadesAutomaticas({ forcar: true });
      ok("longe do vencimento: nada é criado no Asaas", chamadas.filter((c) => c.caminho === "/subscriptions" && c.metodo === "POST").length === antesSub);
      await db.update(subscriptions).set({ renewsAt: venc }).where(eq(subscriptions.userId, u2.id));
      const r = await pay.cobrarMensalidadesAutomaticas({ forcar: true });
      const nova = chamadas.filter((c) => c.caminho === "/subscriptions" && c.metodo === "POST").at(-1);
      const s2b = (await db.select().from(subscriptions).where(eq(subscriptions.userId, u2.id)))[0];
      ok("3 dias antes: abre o cartão automático com 1ª cobrança no dia escolhido", r.geradas >= 1 && !!s2b.asaasSubscriptionId && nova?.corpo?.nextDueDate === utcToShopParts(venc).dateKey);
      await db.delete(payments).where(eq(payments.userId, u2.id));
      await db.delete(subscriptions).where(eq(subscriptions.userId, u2.id));
      await db.delete(users).where(eq(users.id, u2.id));
    }

    console.log("4. Pix automático e cancelamento");
    await db.update(subscriptions).set({ renewsAt: new Date(Date.now() + 2 * 86400_000) }).where(eq(subscriptions.id, s1.id));
    const auto = await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("o Pix automático pula quem paga no cartão", auto.geradas === 0);
    const subAsaas = s1.asaasSubscriptionId!;
    await pay.encerrarCartaoRecorrente(u.id);
    ok("cancelar encerra a assinatura no Asaas", assinaturas.get(subAsaas)?.deleted === true && (await sub()).asaasSubscriptionId === null);
  } finally {
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
