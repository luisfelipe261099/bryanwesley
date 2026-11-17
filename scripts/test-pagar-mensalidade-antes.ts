// Mensalista paga antes de vencer (Pix ou cartão só deste mês): o mês novo
// conta do vencimento, não de hoje. Asaas simulado.
import "../db/load-env";
import { db, pool } from "../db/client";
import { payments, plans, subscriptions, users } from "../db/schema";
import { eq, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

type Cob = { id: string; status: string; value: number; externalReference: string; billingType: string };
const cobs = new Map<string, Cob>();
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  const json = (st: number, b: unknown) => new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/payments") {
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, billingType: corpo.billingType };
    cobs.set(c.id, c);
    return json(200, { ...c, invoiceUrl: `https://www.asaas.com/i/${seq}` });
  }
  const m = caminho.match(/^\/payments\/([^/]+)$/);
  if (m) { const c = cobs.get(m[1]); return c ? json(200, c) : json(404, {}); }
  return json(200, {});
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197038%"));
  for (const g of gente) {
    await db.delete(payments).where(eq(payments.userId, g.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, g.id));
    await db.delete(users).where(eq(users.id, g.id));
  }
}

async function main() {
  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");
  await limpar();
  try {
    const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
    await db.insert(users).values({ name: "Paga Antes", phone: "41970380001", role: "CLIENT", cpf: "52998224725" });
    const u = (await db.select().from(users).where(eq(users.phone, "41970380001")))[0];
    const vence = new Date(Date.now() + 10 * 86400_000);
    await db.insert(subscriptions).values({ userId: u.id, planId: gold.id, cycle: "MENSAL", status: "ATIVA", renewsAt: vence });

    console.log("1. Cartão só deste mês, 10 dias antes de vencer");
    const r = await pay.chargeSubscription(u.id, "MENSAL", { tipo: "CREDIT_CARD" });
    const cob = [...cobs.values()].at(-1)!;
    ok("gera cobrança no cartão, à vista, com o valor do plano", r.ok && cob.billingType === "CREDIT_CARD" && cob.value === gold.priceCents / 100);
    cob.status = "CONFIRMED";
    const s = await pay.settlePayment({ orderNsu: cob.externalReference, paymentId: cob.id });
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.userId, u.id)))[0];
    const dias = (sub.renewsAt.getTime() - vence.getTime()) / 86400_000;
    ok("pago: o mês novo conta do vencimento (não perde os 10 dias)", s.ok && dias > 27 && dias < 32, `diferença ${dias.toFixed(1)} dias`);
  } finally {
    await limpar();
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
