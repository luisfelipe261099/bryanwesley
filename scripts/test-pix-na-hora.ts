// Pix na hora sem CPF (QR estático do Asaas) e "Corrigir" do barbeiro.
// Asaas simulado — nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments, services as sv,
} from "../db/schema";
import { createBooking, reabrirAtendimento } from "../lib/appointments";
import { recordCommission } from "../lib/commissions";
import { getAvailability, getSettings } from "../lib/schedule";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const qrs = new Map<string, { value: number; ref: string }>();
const cobrancas = new Map<string, { id: string; status: string; value: number; pixQrCodeId: string; externalReference: null }>();
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
  const json = (st: number, b: unknown) => new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } });
  if (caminho === "/pix/addressKeys") return json(200, { data: [{ key: "chave-evp-teste", status: "ACTIVE" }] });
  if (metodo === "POST" && caminho === "/pix/qrCodes/static") {
    const id = `qr_${++seq}`;
    qrs.set(id, { value: corpo.value, ref: corpo.externalReference });
    return json(200, { id, encodedImage: "x", payload: `00020126PIXTESTE${id}5204000053039865406${corpo.value}` });
  }
  let m = caminho.match(/^\/pix\/qrCodes\/static\/(.+)$/);
  if (m && metodo === "DELETE") { qrs.delete(m[1]); return json(200, { deleted: true }); }
  m = caminho.match(/^\/payments\/([^/]+)$/);
  if (m) {
    const c = cobrancas.get(m[1]);
    return c ? json(200, c) : json(404, {});
  }
  return json(400, { errors: [{ description: "rota não simulada" }] });
}) as typeof fetch;

async function limpar() {
  const appts = await db.select({ id: appointments.id }).from(appointments).where(like(appointments.clientPhone, "4197036%"));
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
  process.env.ASAAS_WEBHOOK_TOKEN = "token-de-teste-123";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");
  const { POST: webhook } = await import("../app/api/pagamentos/asaas/route");
  await limpar();
  const cfg = await getSettings();
  const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  const livres: { dia: string; hora: string; barberId: number }[] = [];
  for (let i = 2; i <= 40 && livres.length < 2; i++) {
    const d = addDays(shopToday(), i);
    if (cfg.closedWeekdays.includes(weekdayOf(d))) continue;
    const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
    const s = closed ? undefined : slots.find((x) => x.available && x.time < "16:00");
    if (s) livres.push({ dia: d, hora: s.time, barberId: s.barberIds[0] });
  }
  try {
    console.log("1. Pix na hora, sem CPF");
    const a = await createBooking({ serviceIds: [corte.id], dateKey: livres[0].dia, time: livres[0].hora, barberId: livres[0].barberId, clientName: "Sem CPF", clientPhone: "41970360001" });
    const r = await pay.gerarPixNaHora(a.id);
    ok("gera o QR com o valor", r.ok && qrs.size === 1 && [...qrs.values()][0].value === a.totalCents / 100);
    ok("sem criar cliente nem pedir CPF", !chamadas.some((c) => c.caminho.startsWith("/customers")));
    const linha = (await db.select().from(payments).where(eq(payments.appointmentId, a.id)))[0];
    ok("fica um Pix pendente ligado ao QR", linha.status === "PENDENTE" && linha.slug === "PIX_QR" && !!linha.transactionNsu?.startsWith("qr:"));
    const r2 = await pay.gerarPixNaHora(a.id);
    ok("gerar de novo reaproveita o mesmo QR", r2.ok && r.ok && r2.payload === r.payload && qrs.size === 1);

    // O cliente paga: o Asaas cria a cobrança (sem a nossa referência) e avisa.
    const qrId = linha.transactionNsu!.slice(3);
    cobrancas.set("pay_qr1", { id: "pay_qr1", status: "RECEIVED", value: a.totalCents / 100, pixQrCodeId: qrId, externalReference: null });
    const resp = await webhook(new Request("http://localhost/api/pagamentos/asaas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": "token-de-teste-123" },
      body: JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_qr1", pixQrCodeId: qrId } }),
    }));
    const depois = (await db.select().from(payments).where(eq(payments.id, linha.id)))[0];
    ok("o aviso do Asaas acha o QR e dá baixa", resp.status === 200 && depois.status === "PAGO");

    console.log("2. Cobrança de outro QR não dá baixa aqui");
    cobrancas.set("pay_falso", { id: "pay_falso", status: "RECEIVED", value: 999, pixQrCodeId: "qr_de_outro", externalReference: null });
    const resp2 = await webhook(new Request("http://localhost/api/pagamentos/asaas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": "token-de-teste-123" },
      body: JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_falso", pixQrCodeId: "qr_de_outro" } }),
    }));
    ok("QR desconhecido é ignorado com 200", resp2.status === 200);

    console.log("3. Corrigir: reabrir o que foi finalizado sem querer");
    const b = await createBooking({ serviceIds: [corte.id], dateKey: livres[1].dia, time: livres[1].hora, barberId: livres[1].barberId, clientName: "Reabrir", clientPhone: "41970360002" });
    const ontem = new Date(Date.now() - 86400_000);
    await db.update(appointments).set({ status: "CONCLUIDO", startsAt: ontem, endsAt: new Date(ontem.getTime() + 40 * 60_000) }).where(eq(appointments.id, b.id));
    await recordCommission(b.id);
    await reabrirAtendimento(b.id);
    const sb = (await db.select().from(appointments).where(eq(appointments.id, b.id)))[0];
    const com = await db.select().from(appointmentCommissions).where(eq(appointmentCommissions.appointmentId, b.id));
    ok("volta para em andamento", sb.status === "EM_ANDAMENTO" && sb.finishedAt === null);
    ok("e a comissão lançada sai", com.length === 0);
    let erro = "";
    try { await reabrirAtendimento(b.id); } catch (e) { erro = (e as Error).message; }
    ok("reabrir de novo é recusado", /Só dá para reabrir/.test(erro));
  } finally {
    await limpar();
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
