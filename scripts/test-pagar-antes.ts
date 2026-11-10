// Agendado pelo site para outro dia: paga antes, ou o horário é liberado.
// Asaas simulado — nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  services as sv,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const status = new Map<string, string>();
const corpos = new Map<string, Record<string, unknown>>();
const apagadas: string[] = [];
let fora = false;
let seq = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  if (!u.hostname.includes("asaas.com")) return fetchOriginal(url as string, init);
  if (fora) throw new Error("fora do ar");
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  const metodo = init?.method ?? "GET";
  const caminho = u.pathname.replace(/^\/v3/, "");
  const json = (st: number, b: unknown) => new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } });
  if (metodo === "POST" && caminho.startsWith("/customers")) return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho === "/payments") {
    const id = `pay_${++seq}`;
    status.set(id, "PENDING");
    const c = { id, status: "PENDING", value: corpo.value, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` };
    corpos.set(id, c);
    return json(200, c);
  }
  const m = caminho.match(/^\/payments\/([^/]+)$/);
  if (m && metodo === "DELETE") {
    if (["RECEIVED", "CONFIRMED"].includes(status.get(m[1]) ?? "")) return json(400, { errors: [{ description: "já recebida" }] });
    apagadas.push(m[1]);
    return json(200, { deleted: true });
  }
  if (m) return json(200, { ...corpos.get(m[1]), id: m[1], status: status.get(m[1]) ?? "PENDING" });
  return json(200, {});
}) as typeof fetch;

async function limpar() {
  const appts = await db.select({ id: appointments.id }).from(appointments).where(like(appointments.clientPhone, "4197029%"));
  const a = appts.map((x) => x.id);
  if (!a.length) return;
  await db.delete(payments).where(inArray(payments.appointmentId, a));
  await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
  await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
  await db.delete(notifications).where(inArray(notifications.appointmentId, a));
  await db.delete(appointments).where(inArray(appointments.id, a));
}

async function main() {
  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");
  await limpar();
  try {
    console.log("1. Quando exige pagar antes");
    ok("hoje: pode pagar na barbearia", !pay.exigePagamentoAntecipado(shopToday()));
    ok("amanhã: paga antes", pay.exigePagamentoAntecipado(addDays(shopToday(), 1)));

    const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
    const settings = await getSettings();
    const livres: { dia: string; hora: string; barberId: number }[] = [];
    for (let i = 2; i <= 40 && livres.length < 3; i++) {
      const d = addDays(shopToday(), i);
      if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
      const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
      const s = closed ? undefined : slots.find((x) => x.available && x.time < "17:00");
      if (s) livres.push({ dia: d, hora: s.time, barberId: s.barberIds[0] });
    }
    const marcar = async (i: number) => {
      const a = await createBooking({ serviceIds: [corte.id], dateKey: livres[i].dia, time: livres[i].hora, barberId: livres[i].barberId, clientName: `Antes ${i}`, clientPhone: `4197029000${i}` });
      const c = await pay.chargeAppointment(a.id, "PIX", { cpf: "52998224725" });
      const nsu = c.ok ? (await db.select().from(payments).where(eq(payments.appointmentId, a.id)))[0].transactionNsu! : "";
      await db.update(appointments).set({ payBy: new Date(Date.now() + 30 * 60_000) }).where(eq(appointments.id, a.id));
      return { a, nsu };
    };
    const vencer = (id: number) => db.update(appointments).set({ payBy: new Date(Date.now() - 60_000) }).where(eq(appointments.id, id));
    const st = async (id: number) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

    console.log("2. Sem pagar no prazo, o horário é liberado");
    const x = await marcar(0);
    await pay.liberarHorariosSemPagamento({ forcar: true });
    ok("dentro do prazo continua marcado", (await st(x.a.id)).status === "CONFIRMADO");
    await vencer(x.a.id);
    const n = await pay.liberarHorariosSemPagamento({ forcar: true });
    ok("passou do prazo: horário cancelado", n >= 1 && (await st(x.a.id)).status === "CANCELADO");
    ok("e o Pix some do Asaas", apagadas.includes(x.nsu));
    const livre = await getAvailability({ dateKey: livres[0].dia, durationMin: corte.durationMin, ignorarAntecedencia: true });
    ok("o horário volta a aparecer livre", !!livre.slots.find((s) => s.time === livres[0].hora && s.barberIds.includes(livres[0].barberId)));

    console.log("3. Pagou na última hora");
    const y = await marcar(1);
    status.set(y.nsu, "RECEIVED"); // pagou, mas o aviso ainda não chegou
    await vencer(y.a.id);
    await pay.liberarHorariosSemPagamento({ forcar: true });
    const sy = await st(y.a.id);
    ok("confere no Asaas e mantém o horário", sy.status === "CONFIRMADO" && sy.payBy === null);
    ok("e o pagamento fica creditado", (await db.select().from(payments).where(eq(payments.appointmentId, y.a.id)))[0].status === "PAGO");

    console.log("4. Asaas fora do ar");
    const z = await marcar(2);
    await vencer(z.a.id);
    fora = true;
    await pay.liberarHorariosSemPagamento({ forcar: true });
    fora = false;
    ok("não solta o horário sem conseguir tirar a cobrança", (await st(z.a.id)).status === "CONFIRMADO");
    await pay.liberarHorariosSemPagamento({ forcar: true });
    ok("com o Asaas de volta, solta", (await st(z.a.id)).status === "CANCELADO");
  } finally {
    await limpar();
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
