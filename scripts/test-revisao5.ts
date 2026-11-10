// Revisão 5: o que a revisão de pagamentos e planos encontrou. Asaas
// simulado — nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  plans, services as sv, subscriptions, users,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

type Cob = { id: string; status: string; value: number; externalReference: string | null; invoiceUrl: string; subscription: string | null; deleted?: boolean };
const cobs = new Map<string, Cob>();
const assinaturas = new Map<string, { id: string; deleted?: boolean }>();
let asaasFora = false;
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  if (asaasFora) throw new Error("fora do ar");
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: caminho.split("/")[2] ?? `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/payments") {
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}`, subscription: null };
    cobs.set(c.id, c);
    return json(200, c);
  }
  if (metodo === "POST" && caminho === "/subscriptions") {
    const s = { id: `sub_${++seq}` };
    assinaturas.set(s.id, s);
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}`, subscription: s.id };
    cobs.set(c.id, c);
    return json(200, s);
  }
  let m = caminho.match(/^\/subscriptions\/([^/]+)(\/payments)?$/);
  if (m) {
    const s = assinaturas.get(m[1]);
    if (!s) return json(404, {});
    if (metodo === "DELETE") { s.deleted = true; return json(200, { deleted: true }); }
    return json(200, { data: [...cobs.values()].filter((c) => c.subscription === s.id) });
  }
  m = caminho.match(/^\/payments\/([^/]+)(\/pixQrCode)?$/);
  if (m) {
    const c = cobs.get(m[1]);
    if (!c) return json(404, {});
    if (metodo === "DELETE") {
      // O Asaas não apaga cobrança já paga.
      if (["RECEIVED", "CONFIRMED"].includes(c.status)) return json(400, { errors: [{ description: "Cobrança já recebida" }] });
      c.deleted = true;
      return json(200, { deleted: true });
    }
    return json(200, c);
  }
  return json(400, { errors: [{ description: "rota não simulada" }] });
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197026%"));
  const ids = gente.map((g) => g.id);
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments).where(inArray(appointments.clientUserId, ids));
  const a = appts.map((x) => x.id);
  if (a.length) {
    await db.delete(payments).where(inArray(payments.appointmentId, a));
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
    await db.delete(notifications).where(inArray(notifications.appointmentId, a));
    await db.delete(appointments).where(inArray(appointments.id, a));
  }
  await db.delete(payments).where(inArray(payments.userId, ids));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
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
  const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
  const precoOriginal = gold.priceCents;
  try {
    console.log("1. Pagou o Pix e logo trocou de forma");
    const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
    const settings = await getSettings();
    let livre: { dia: string; hora: string; barberId: number } | null = null;
    for (let i = 2; i <= 30 && !livre; i++) {
      const d = addDays(shopToday(), i);
      if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
      const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
      const s = closed ? undefined : slots.find((x) => x.available && x.time < "17:00");
      if (s) livre = { dia: d, hora: s.time, barberId: s.barberIds[0] };
    }
    const a = await createBooking({ serviceIds: [corte.id], dateKey: livre!.dia, time: livre!.hora, barberId: livre!.barberId, clientName: "Rev5", clientPhone: "41970260001" });
    const c1 = await pay.chargeAppointment(a.id, "PIX", { cpf: "52998224725" });
    const pix = [...cobs.values()].find((c) => c.externalReference === (c1.ok ? c1.orderNsu : ""))!;
    pix.status = "RECEIVED"; // pagou no banco…
    await pay.cancelarCobrancasDoAgendamento(a.id); // …e tocou "Pagar na barbearia"
    const linha = (await db.select().from(payments).where(eq(payments.appointmentId, a.id)))[0];
    ok("cobrança paga não vira 'cancelada' (o Asaas recusa apagar)", linha.status === "PENDENTE");
    await aviso("PAYMENT_RECEIVED", pix);
    ok("e o pagamento é creditado quando o aviso chega", (await db.select().from(payments).where(eq(payments.id, linha.id)))[0].status === "PAGO");

    console.log("2. Pagamento de plano cancelado");
    await db.insert(users).values({ name: "Rev5 Membro", phone: "41970260002", role: "CLIENT", cpf: "52998224725" });
    const u = (await db.select().from(users).where(eq(users.phone, "41970260002")))[0];
    await db.insert(subscriptions).values({ userId: u.id, planId: gold.id, cycle: "MENSAL", status: "ATIVA", renewsAt: new Date(Date.now() + 2 * 86400_000) });
    const sub = () => db.select().from(subscriptions).where(eq(subscriptions.userId, u.id)).then((r) => r[0]);
    const m = await pay.chargeSubscription(u.id, "MENSAL", { tipo: "PIX" });
    const pixPlano = [...cobs.values()].find((c) => c.externalReference === (m.ok ? m.orderNsu : ""))!;
    await db.update(subscriptions).set({ status: "CANCELADA", canceledAt: new Date() }).where(eq(subscriptions.userId, u.id));
    pixPlano.status = "RECEIVED";
    await aviso("PAYMENT_RECEIVED", pixPlano);
    ok("pagar a fatura velha não ressuscita o plano cancelado", (await sub()).status === "CANCELADA");

    console.log("3. Cartão automático");
    await db.update(subscriptions).set({ status: "INADIMPLENTE", canceledAt: null }).where(eq(subscriptions.userId, u.id));
    const r = await pay.assinarNoCartao(u.id, "MENSAL");
    const s1 = await sub();
    ok("assina no cartão", r.ok && !!s1.asaasSubscriptionId);
    // Preço do plano sobe depois da assinatura: o Asaas segue cobrando o valor antigo.
    await db.update(plans).set({ priceCents: precoOriginal + 2000 }).where(eq(plans.id, gold.id));
    const mes2: Cob = { id: "pay_rev5_mes2", status: "CONFIRMED", value: precoOriginal / 100, externalReference: null, invoiceUrl: "x", subscription: s1.asaasSubscriptionId };
    cobs.set(mes2.id, mes2);
    const antes = (await sub()).renewsAt.getTime();
    await Promise.all([aviso("PAYMENT_CONFIRMED", mes2), aviso("PAYMENT_RECEIVED", mes2)]);
    const depois = await sub();
    ok("preço do plano mudou: a cobrança do cartão ainda renova", depois.status === "ATIVA" && depois.renewsAt.getTime() > antes);
    ok("dois avisos ao mesmo tempo renovam uma vez só", depois.renewsAt.getTime() < antes + 40 * 86400_000);
    ok("e geram um registro só", (await db.select().from(payments).where(eq(payments.transactionNsu, mes2.id))).length === 1);

    asaasFora = true;
    const parou = await pay.encerrarCartaoRecorrente(u.id);
    asaasFora = false;
    ok("Asaas fora do ar: não finge que parou o cartão", !parou.ok && !!(await sub()).asaasSubscriptionId);
    const parou2 = await pay.encerrarCartaoRecorrente(u.id);
    ok("com o Asaas de volta, para o cartão", parou2.ok && (await sub()).asaasSubscriptionId === null);
  } finally {
    await db.update(plans).set({ priceCents: precoOriginal }).where(eq(plans.id, gold.id));
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
