// "Cobrar" na agenda: recebido no balcão (dinheiro, Pix na maquininha,
// cartão). Asaas simulado — nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  services as sv, subscriptions, users,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { attachDetails } from "../lib/queries";
import { rotuloPagamento } from "../lib/rotulo-pagamento";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const apagadas: string[] = [];
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/payments") {
    return json(200, { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` });
  }
  const m = caminho.match(/^\/payments\/([^/]+)$/);
  if (m && metodo === "DELETE") { apagadas.push(m[1]); return json(200, { deleted: true }); }
  if (m) return json(200, { id: m[1], status: "PENDING" });
  return json(200, {});
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197027%"));
  const ids = gente.map((g) => g.id);
  const appts = await db.select({ id: appointments.id }).from(appointments).where(like(appointments.clientPhone, "4197027%"));
  const a = appts.map((x) => x.id);
  if (a.length) {
    await db.delete(payments).where(inArray(payments.appointmentId, a));
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
    await db.delete(notifications).where(inArray(notifications.appointmentId, a));
    await db.delete(appointments).where(inArray(appointments.id, a));
  }
  if (ids.length) {
    await db.delete(payments).where(inArray(payments.userId, ids));
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

async function main() {
  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");
  await limpar();
  try {
    const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
    const settings = await getSettings();
    const livres: { dia: string; hora: string; barberId: number }[] = [];
    for (let i = 2; i <= 30 && livres.length < 2; i++) {
      const d = addDays(shopToday(), i);
      if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
      const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
      const s = closed ? undefined : slots.find((x) => x.available && x.time < "17:00");
      if (s) livres.push({ dia: d, hora: s.time, barberId: s.barberIds[0] });
    }

    console.log("1. Pix em aberto, pago no balcão em dinheiro");
    const a = await createBooking({ serviceIds: [corte.id], dateKey: livres[0].dia, time: livres[0].hora, barberId: livres[0].barberId, clientName: "Balcão", clientPhone: "41970270001" });
    const c = await pay.chargeAppointment(a.id, "PIX", { cpf: "52998224725" });
    ok("gerou o Pix", c.ok);
    let [full] = await attachDetails([a]);
    ok("agenda mostra 'Aguardando Pix'", rotuloPagamento(full)?.texto === "Aguardando Pix");
    const r = await pay.registrarPagamentoNoBalcao(a.id, "DINHEIRO");
    ok("registra o dinheiro", r.ok);
    ok("a fatura do Pix sai do Asaas", apagadas.length === 1);
    const linhas = await db.select().from(payments).where(eq(payments.appointmentId, a.id));
    ok("fica um pagamento PAGO no balcão", linhas.filter((x) => x.status === "PAGO").length === 1 && linhas.find((x) => x.status === "PAGO")?.provider === "balcao");
    ok("e nenhum pendente", !linhas.some((x) => x.status === "PENDENTE"));
    const appt = (await db.select().from(appointments).where(eq(appointments.id, a.id)))[0];
    [full] = await attachDetails([appt]);
    ok("agenda mostra 'Pago em dinheiro'", rotuloPagamento(full)?.texto === "Pago em dinheiro");
    const r2 = await pay.registrarPagamentoNoBalcao(a.id, "PIX_BALCAO");
    ok("não registra duas vezes", !r2.ok);

    console.log("2. Mensalista não paga em dinheiro");
    const b = await createBooking({ serviceIds: [corte.id], dateKey: livres[1].dia, time: livres[1].hora, barberId: livres[1].barberId, clientName: "Balcão 2", clientPhone: "41970270002" });
    const r3 = await pay.registrarPagamentoNoBalcao(b.id, "DINHEIRO", { mensalista: true });
    ok("dinheiro recusado", !r3.ok);
    const r4 = await pay.registrarPagamentoNoBalcao(b.id, "CARTAO_BALCAO", { mensalista: true });
    ok("cartão aceito", r4.ok);
    const bb = (await db.select().from(appointments).where(eq(appointments.id, b.id)))[0];
    const [fb] = await attachDetails([bb]);
    ok("agenda mostra 'Pago no cartão (balcão)'", rotuloPagamento(fb)?.texto === "Pago no cartão (balcão)");

    console.log("3. Nada a cobrar");
    await db.update(appointments).set({ status: "CANCELADO" }).where(eq(appointments.id, b.id));
    await db.delete(payments).where(eq(payments.appointmentId, b.id));
    ok("horário cancelado não recebe", !(await pay.registrarPagamentoNoBalcao(b.id, "PIX_BALCAO")).ok);
  } finally {
    await limpar();
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
