// Mensalista: o plano não cobre à noite, no salão não paga em dinheiro
// e a mensalidade é cobrada sozinha (Pix) antes de vencer. Asaas simulado.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  plans, services as sv, settings as settingsTable, subscriptions, users,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { attachDetails } from "../lib/queries";
import { rotuloPagamento } from "../lib/rotulo-pagamento";
import { addDays, shopToday, utcToShopParts, weekdayOf } from "../lib/time";
import { and, eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

// ── Asaas de mentira ─────────────────────────────────────────
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
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/payments") {
    return json(200, { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` });
  }
  return json(200, { deleted: true });
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197023%"));
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
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");

  const cfgAntes = await getSettings();
  const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
  const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  await limpar();
  try {
    // Noite a partir das 17:00 para o teste caber na jornada.
    await db.update(settingsTable).set({ memberNightFrom: 17 * 60, autoCharge: true }).where(eq(settingsTable.id, 1));
    await db.insert(users).values({ name: "Mensalista Teste", phone: "41970230001", role: "CLIENT", cpf: "52998224725" });
    const u = (await db.select().from(users).where(eq(users.phone, "41970230001")))[0];
    await db.insert(subscriptions).values({ userId: u.id, planId: gold.id, cycle: "MENSAL", status: "ATIVA", renewsAt: new Date(Date.now() + 40 * 86400_000) });

    console.log("1. Plano não cobre à noite");
    const livre = async (deNoite: boolean) => {
      for (let i = 2; i <= 30; i++) {
        const d = addDays(shopToday(), i);
        if (cfgAntes.closedWeekdays.includes(weekdayOf(d))) continue;
        const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
        if (closed) continue;
        const s = slots.find((x) => x.available && (x.time >= "17:00") === deNoite);
        if (s) return { dia: d, hora: s.time, barberId: s.barberIds[0] };
      }
      throw new Error("sem horário");
    };
    const dia = await livre(false);
    const a1 = await createBooking({ serviceIds: [corte.id], dateKey: dia.dia, time: dia.hora, barberId: dia.barberId, clientName: u.name, clientPhone: u.phone });
    ok(`de dia (${dia.hora}) sai pelo plano`, a1.totalCents === 0 && a1.kind === "ASSINANTE");
    const noite = await livre(true);
    const a2 = await createBooking({ serviceIds: [corte.id], dateKey: noite.dia, time: noite.hora, barberId: noite.barberId, clientName: u.name, clientPhone: u.phone });
    ok(`à noite (${noite.hora}) sai avulso, preço cheio`, a2.totalCents > 0 && a2.kind === "AVULSO");

    console.log("2. No salão, sem dinheiro");
    const [full] = await attachDetails([a2]);
    ok("a agenda sabe que é mensalista", full.mensalista === true);
    ok("etiqueta 'Paga na hora · Pix/cartão'", rotuloPagamento(full)?.texto === "Paga na hora · Pix/cartão");

    console.log("3. Cobrança automática da mensalidade");
    const sub = (await db.select().from(subscriptions).where(eq(subscriptions.userId, u.id)))[0];
    const vence = new Date(Date.now() + 2 * 86400_000);
    await db.update(subscriptions).set({ renewsAt: vence }).where(eq(subscriptions.id, sub.id));
    const r0 = await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("pedido de plano que nunca foi pago não é cobrado sozinho", r0.geradas === 0);
    // Já pagou antes: é mensalista de verdade.
    await db.insert(payments).values({ orderNsu: `TESTE-${sub.id}`, userId: u.id, subscriptionId: sub.id, kind: "ASSINATURA", amountCents: gold.priceCents, description: "mês anterior", status: "PAGO", paidAt: new Date() });
    const r1 = await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    const cob = chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST");
    ok("vence em 2 dias: gera a mensalidade sozinha", r1.geradas >= 1);
    ok("no Pix, com o valor do plano e vencendo no dia", cob?.corpo?.billingType === "PIX" && cob?.corpo?.value === gold.priceCents / 100 && cob?.corpo?.dueDate === utcToShopParts(vence).dateKey);
    const linhas = (await db.select().from(payments).where(eq(payments.subscriptionId, sub.id))).filter((x) => x.status === "PENDENTE");
    ok("fica pendente, ligada à assinatura", linhas.length === 1 && linhas[0].kind === "ASSINATURA");
    await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("rodar de novo não duplica", (await db.select().from(payments).where(eq(payments.subscriptionId, sub.id))).filter((x) => x.status === "PENDENTE").length === 1);

    await db.delete(payments).where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")));
    await db.update(subscriptions).set({ canceledAt: new Date() }).where(eq(subscriptions.id, sub.id));
    await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("quem pediu para sair não é cobrado", (await db.select().from(payments).where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")))).length === 0);

    await db.update(subscriptions).set({ canceledAt: null, renewsAt: new Date(Date.now() + 10 * 86400_000) }).where(eq(subscriptions.id, sub.id));
    await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("vence daqui a 10 dias: ainda não cobra", (await db.select().from(payments).where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")))).length === 0);

    await db.update(subscriptions).set({ renewsAt: vence }).where(eq(subscriptions.id, sub.id));
    await db.update(users).set({ cpf: null }).where(eq(users.id, u.id));
    const r2 = await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("sem CPF não gera (o Asaas exige)", r2.semCpf >= 1 && (await db.select().from(payments).where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")))).length === 0);

    await db.update(users).set({ cpf: "52998224725" }).where(eq(users.id, u.id));
    await db.update(settingsTable).set({ autoCharge: false }).where(eq(settingsTable.id, 1));
    await pay.cobrarMensalidadesAutomaticas({ forcar: true });
    ok("cobrança automática desligada: não cobra", (await db.select().from(payments).where(and(eq(payments.subscriptionId, sub.id), eq(payments.status, "PENDENTE")))).length === 0);
  } finally {
    await db.update(settingsTable).set({ memberNightFrom: cfgAntes.memberNightFrom, autoCharge: cfgAntes.autoCharge }).where(eq(settingsTable.id, 1));
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
