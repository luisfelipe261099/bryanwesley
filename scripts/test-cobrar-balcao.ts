// "Cobrar" na agenda: recebido no balcão (dinheiro, Pix na maquininha,
// cartão). Asaas simulado — nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  services as sv, subscriptions, users,
} from "../db/schema";
import { ajustarValorDoAtendimento, createBooking, removerAjusteDoAtendimento, updateAppointmentServices } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { attachDetails } from "../lib/queries";
import { recordCommission } from "../lib/commissions";
import { devendo, rotuloPagamento } from "../lib/rotulo-pagamento";
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
    for (let i = 2; i <= 30 && livres.length < 3; i++) {
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

    console.log("3. Atendido e não pago fica em vermelho");
    const base = { kind: "AVULSO", totalCents: 3500, paymentMethod: "PIX", pagamentoOnline: null as "PAGO" | "PENDENTE" | null };
    ok("concluído sem pagar: 'Não pago'", rotuloPagamento({ ...base, status: "CONCLUIDO" })?.texto === "Não pago" && devendo({ ...base, status: "CONCLUIDO" }));
    ok("na cadeira com Pix em aberto: 'Não pago · Pix em aberto'", rotuloPagamento({ ...base, pagamentoOnline: "PENDENTE", status: "EM_ANDAMENTO" })?.texto === "Não pago · Pix em aberto");
    ok("concluído e pago: não alerta", !devendo({ ...base, pagamentoOnline: "PAGO", status: "CONCLUIDO" }));
    ok("ainda vai acontecer: não alerta", !devendo({ ...base, status: "CONFIRMADO" }));
    ok("plano: não alerta", !devendo({ ...base, kind: "ASSINANTE", totalCents: 0, status: "CONCLUIDO" }));

    console.log("4. Desconto e venda extra");
    const c3 = await createBooking({ serviceIds: [corte.id], dateKey: livres[2].dia, time: livres[2].hora, barberId: livres[2].barberId, clientName: "Balcão 3", clientPhone: "41970270003" });
    const base3 = c3.totalCents;
    const pix3 = await pay.chargeAppointment(c3.id, "PIX", { cpf: "52998224725" });
    const apagadasAntes = apagadas.length;
    let t = await ajustarValorDoAtendimento(c3.id, { tipo: "EXTRA", valorCents: 2500, descricao: "Pomada" });
    ok("venda extra soma ao total", t === base3 + 2500);
    ok("o Pix antigo (valor velho) sai", pix3.ok && apagadas.length === apagadasAntes + 1);
    t = await ajustarValorDoAtendimento(c3.id, { tipo: "DESCONTO", valorCents: 1000 });
    ok("desconto tira do total", t === base3 + 1500);
    const itens3 = await db.select().from(appointmentServices).where(eq(appointmentServices.appointmentId, c3.id));
    ok("aparecem na lista do atendimento", itens3.some((i) => i.name === "Pomada" && i.priceCents === 2500) && itens3.some((i) => i.name === "Desconto" && i.priceCents === -1000));
    let erro = "";
    try { await ajustarValorDoAtendimento(c3.id, { tipo: "DESCONTO", valorCents: 999_999 }); } catch (e) { erro = (e as Error).message; }
    ok("desconto maior que o total é recusado", /passa do valor/.test(erro));
    erro = "";
    try { await ajustarValorDoAtendimento(c3.id, { tipo: "EXTRA", valorCents: 500, descricao: " " }); } catch (e) { erro = (e as Error).message; }
    ok("venda extra pede o que foi vendido", /vendido/.test(erro));
    const desconto = itens3.find((i) => i.name === "Desconto")!;
    t = await removerAjusteDoAtendimento(c3.id, desconto.id);
    ok("remover o desconto volta o valor", t === base3 + 2500);
    const r5 = await updateAppointmentServices({ appointmentId: c3.id, serviceIds: [corte.id] });
    ok("trocar os serviços mantém a venda extra", r5.totalCents === base3 + 2500 && (await db.select().from(appointmentServices).where(eq(appointmentServices.appointmentId, c3.id))).some((i) => i.name === "Pomada"));
    const pixNovo = await pay.chargeAppointment(c3.id, "PIX", { cpf: "52998224725" });
    const linhaNova = (await db.select().from(payments).where(eq(payments.appointmentId, c3.id))).find((x) => x.status === "PENDENTE");
    ok("o Pix novo sai com o valor ajustado", pixNovo.ok && linhaNova?.amountCents === base3 + 2500);
    // Concluir de verdade só no dia: aqui grava como o fechamento grava.
    await db.update(appointments).set({ status: "CONCLUIDO" }).where(eq(appointments.id, c3.id));
    await recordCommission(c3.id);
    const comAntes = (await db.select().from(appointmentCommissions).where(eq(appointmentCommissions.appointmentId, c3.id)))[0];
    ok("comissão sai sobre o valor ajustado", comAntes?.baseCents === base3 + 2500);
    t = await ajustarValorDoAtendimento(c3.id, { tipo: "DESCONTO", valorCents: 500 });
    const comDepois = (await db.select().from(appointmentCommissions).where(eq(appointmentCommissions.appointmentId, c3.id)))[0];
    ok("desconto depois de concluir acerta a comissão", comDepois.baseCents === t && comDepois.barberCents + comDepois.shopCents === t);
    await pay.registrarPagamentoNoBalcao(c3.id, "PIX_BALCAO");
    erro = "";
    try { await ajustarValorDoAtendimento(c3.id, { tipo: "EXTRA", valorCents: 500, descricao: "Gel" }); } catch (e) { erro = (e as Error).message; }
    ok("depois de pago não muda o valor", /já está pago/.test(erro));
    const pg3 = (await db.select().from(payments).where(eq(payments.appointmentId, c3.id))).find((x) => x.status === "PAGO");
    ok("o recebido no balcão é o valor ajustado", pg3?.amountCents === t);

    console.log("5. Nada a cobrar");
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
