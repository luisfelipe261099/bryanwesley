// Pagamento no agendamento (Pix, cartão ou na barbearia), com o Asaas
// simulado: nada sai para a internet.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  services as sv, users,
} from "../db/schema";
import { createBooking, rescheduleBooking, transitionAppointment } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { attachDetails } from "../lib/queries";
import { rotuloPagamento } from "../lib/rotulo-pagamento";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const CPF = "52998224725";
const FONE = (n: number) => `4197021${String(n).padStart(4, "0")}`;

// ── Asaas de mentira ─────────────────────────────────────────
type Cob = { id: string; status: string; value: number; billingType: string; externalReference: string; invoiceUrl: string; deleted?: boolean };
const cobs = new Map<string, Cob>();
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
  if (metodo === "POST" && caminho === "/customers") return json(200, { id: `cus_${++seq}` });
  if (metodo === "POST" && caminho.startsWith("/customers/")) return json(200, { id: caminho.split("/")[2] });
  if (metodo === "POST" && caminho === "/payments") {
    const c: Cob = { id: `pay_${++seq}`, status: "PENDING", value: corpo.value, billingType: corpo.billingType, externalReference: corpo.externalReference, invoiceUrl: `https://www.asaas.com/i/${seq}` };
    cobs.set(c.id, c);
    return json(200, c);
  }
  const m = caminho.match(/^\/payments\/([^/]+)(\/pixQrCode)?$/);
  if (m) {
    const c = cobs.get(m[1]);
    if (!c) return json(404, { errors: [{ description: "não encontrada" }] });
    if (metodo === "DELETE") { c.deleted = true; return json(200, { deleted: true, id: c.id }); }
    if (m[2]) return json(200, { encodedImage: "iVBORw0KGgo=", payload: `00020126pix-${c.id}`, expirationDate: null });
    return json(200, c);
  }
  return json(400, { errors: [{ description: "rota não simulada" }] });
}) as typeof fetch;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197021%"));
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
  await db.delete(users).where(inArray(users.id, ids));
}

async function main() {
  process.env.ASAAS_API_KEY = "$aact_hmlg_teste";
  delete process.env.ASAAS_API_URL;
  const pay = await import("../lib/payments");

  await limpar();
  try {
    const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
    const settings = await getSettings();
    // Cada horário é procurado na hora: a grade muda a cada marcação.
    const proximoLivre = async () => {
      for (let i = 2; i <= 40; i++) {
        const d = addDays(shopToday(), i);
        if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
        const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin, ignorarAntecedencia: true });
        if (closed) continue;
        const s = slots.find((x) => x.available);
        if (s) return { dia: d, hora: s.time, barberId: s.barberIds[0] };
      }
      throw new Error("sem horários livres para o teste");
    };
    const usados: { dia: string; hora: string; barberId: number }[] = [];
    const marcar = async (n: number) => {
      const l = await proximoLivre();
      usados.push(l);
      return createBooking({ serviceIds: [corte.id], dateKey: l.dia, time: l.hora, barberId: l.barberId, clientName: "Teste Pagamento", clientPhone: FONE(n) });
    };

    console.log("1. Cobrança do horário");
    const a1 = await marcar(1);
    const semCpf = await pay.chargeAppointment(a1.id, "PIX");
    ok("sem CPF, pede o CPF", !semCpf.ok && !!semCpf.precisaCpf);
    const ruim = await pay.chargeAppointment(a1.id, "PIX", { cpf: "123.456.789-00" });
    ok("CPF inválido recusado antes do Asaas", !ruim.ok && !!ruim.precisaCpf && chamadas.length === 0);

    const c1 = await pay.chargeAppointment(a1.id, "PIX", { cpf: "529.982.247-25" });
    ok("com CPF, gera a cobrança", c1.ok);
    const post = chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST");
    ok("cobra o valor do horário, já no Pix", post?.corpo?.value === a1.totalCents / 100 && post?.corpo?.billingType === "PIX");
    ok("vencimento no dia do horário", post?.corpo?.dueDate === usados[0].dia);
    const linha1 = (await db.select().from(payments).where(eq(payments.appointmentId, a1.id)))[0];
    ok("fica pendente, ligada ao horário", linha1?.status === "PENDENTE" && linha1.kind === "AVULSO" && linha1.slug === "PIX");
    const ap1 = (await db.select().from(appointments).where(eq(appointments.id, a1.id)))[0];
    ok("o horário guarda a forma: Pix", ap1.paymentMethod === "PIX");
    const dono1 = (await db.select().from(users).where(eq(users.id, a1.clientUserId!)))[0];
    ok("visitante não grava CPF na conta do WhatsApp", dono1.cpf === null && dono1.asaasCustomerId === null);

    const antes = chamadas.length;
    const c1b = await pay.chargeAppointment(a1.id, "PIX", { cpf: CPF });
    ok("mesma forma de novo: reaproveita a fatura", c1b.ok && c1.ok && c1b.orderNsu === c1.orderNsu && !chamadas.slice(antes).some((c) => c.caminho === "/payments"));

    const pix = await pay.pixDoPagamento(linha1);
    ok("o QR do Pix vem para a tela", !!pix?.imagem && !!pix?.copiaECola);

    console.log("2. Troca de forma");
    const c2 = await pay.chargeAppointment(a1.id, "CARTAO", { cpf: CPF });
    ok("cartão gera fatura de cartão", c2.ok && chamadas.some((c) => c.corpo?.billingType === "CREDIT_CARD"));
    const velha = (await db.select().from(payments).where(eq(payments.id, linha1.id)))[0];
    ok("a fatura do Pix sai (apagada no Asaas)", velha.status === "CANCELADO" && cobs.get(linha1.transactionNsu!)!.deleted === true);
    const atual = await pay.pagamentoDoAgendamento(a1.id);
    ok("sem QR de Pix para cartão", (await pay.pixDoPagamento(atual!)) === null);

    console.log("3. Baixa");
    cobs.get(atual!.transactionNsu!)!.status = "CONFIRMED";
    const conferida = await pay.conferirPagamento(atual!);
    ok("a tela confere no Asaas e dá baixa", conferida.status === "PAGO");
    const de = await pay.chargeAppointment(a1.id, "PIX", { cpf: CPF });
    ok("horário pago não gera outra cobrança", !de.ok && /já está pago/.test(de.error));
    const [full] = await attachDetails([(await db.select().from(appointments).where(eq(appointments.id, a1.id)))[0]]);
    ok("a agenda mostra 'Pago no cartão'", full.pagamentoOnline === "PAGO" && rotuloPagamento(full)?.texto === "Pago no cartão");

    console.log("4. Cliente confiável (dono do WhatsApp ou equipe)");
    const a2 = await marcar(2);
    const c3 = await pay.chargeAppointment(a2.id, "PIX", { cpf: CPF, cpfConfiavel: true });
    const dono2 = (await db.select().from(users).where(eq(users.id, a2.clientUserId!)))[0];
    ok("CPF e cliente do Asaas ficam salvos na conta", c3.ok && dono2.cpf === CPF && !!dono2.asaasCustomerId);
    await pay.cancelarCobrancasDoAgendamento(a2.id);
    const c4 = await pay.chargeAppointment(a2.id, "PIX", { cpfConfiavel: true });
    ok("da próxima vez usa o CPF salvo, sem pedir", c4.ok);
    const c5 = await pay.chargeAppointment(a2.id, "CARTAO", {});
    ok("sem ser confiável, o CPF salvo não serve", !c5.ok && !!c5.precisaCpf);

    console.log("5. Cancelar e remarcar");
    const pend = await pay.pagamentoDoAgendamento(a2.id);
    await transitionAppointment(a2.id, "CANCELADO");
    const pos = (await db.select().from(payments).where(eq(payments.id, pend!.id)))[0];
    ok("cancelar o horário apaga a fatura em aberto", pos.status === "CANCELADO" && cobs.get(pend!.transactionNsu!)!.deleted === true);

    const a3 = await marcar(3);
    await pay.chargeAppointment(a3.id, "PIX", { cpf: CPF });
    const destino = await proximoLivre();
    const novo = await rescheduleBooking({ appointmentId: a3.id, dateKey: destino.dia, time: destino.hora, barberId: destino.barberId });
    const seguiu = await pay.pagamentoDoAgendamento(novo.id);
    const apNovo = (await db.select().from(appointments).where(eq(appointments.id, novo.id)))[0];
    ok("remarcar leva o pagamento e a forma junto", !!seguiu && seguiu.status === "PENDENTE" && apNovo.paymentMethod === "PIX");

    console.log("6. Na barbearia");
    const [semOnline] = await attachDetails([{ ...apNovo, paymentMethod: "BALCAO" as const }]);
    ok("etiqueta 'Paga na hora' sem fatura online", rotuloPagamento({ ...semOnline, pagamentoOnline: null })?.texto === "Paga na hora");
    ok("horário do plano não tem etiqueta", rotuloPagamento({ kind: "ASSINANTE", totalCents: 0, paymentMethod: null, pagamentoOnline: null }) === null);
  } finally {
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
