// Regressão da terceira revisão: o que ela achou e corrigiu.
// Cada bloco reproduz o cenário que estava quebrado.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  services as sv, users,
} from "../db/schema";
import { createBooking, rescheduleBooking, BookingError } from "../lib/appointments";
import { discardStaleNotifications } from "../lib/dispatch";
import { queueFreeText } from "../lib/notifications";
import { getSettings, getAvailability } from "../lib/schedule";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZRev3";

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users)
    .where(like(users.phone, "4197003%"));
  const ids = gente.map((u) => u.id);
  await db.delete(notifications).where(like(notifications.phone, "4197003%"));
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments)
    .where(inArray(appointments.clientUserId, ids));
  const apptIds = appts.map((a) => a.id);
  if (apptIds.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, apptIds));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, apptIds));
    await db.delete(notifications).where(inArray(notifications.appointmentId, apptIds));
    await db.delete(appointments).where(inArray(appointments.id, apptIds));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

/** Dia aberto com pelo menos `n` horários livres (a partir de amanhã). */
async function diaComVagas(durationMin: number, n: number, depoisDe = 1) {
  const settings = await getSettings();
  for (let i = depoisDe; i <= 20; i++) {
    const dia = addDays(shopToday(), i);
    if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
    const { slots } = await getAvailability({ dateKey: dia, durationMin, barberId: null });
    const livres = slots.filter((s) => s.available);
    if (livres.length >= n) return { dia, livres: livres.map((s) => s.time) };
  }
  throw new Error("sem vaga para montar o teste");
}

async function main() {
  await limpar();
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;

  console.log("\n1. Aviso atrasado demais não sai quando o WhatsApp for ligado");
  {
    const velho = await queueFreeText({ phone: "41970030001", body: `${MARCA} velho`, kind: "RESPOSTA_WHATSAPP",
      scheduledFor: new Date(Date.now() - 30 * 3600_000) });
    const novo = await queueFreeText({ phone: "41970030001", body: `${MARCA} novo`, kind: "RESPOSTA_WHATSAPP" });
    const { dia, livres } = await diaComVagas(corte.durationMin, 1);
    const appt = await createBooking({ serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: null,
      clientName: `${MARCA} Fila`, clientPhone: "41970030002" });
    // A confirmação foi para a fila agora; finge que ela tem 2 dias.
    await db.update(notifications).set({ scheduledFor: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(notifications.appointmentId, appt.id));
    await discardStaleNotifications();
    const [v, n] = await Promise.all([
      db.query.notifications.findFirst({ where: eq(notifications.id, velho!.id) }),
      db.query.notifications.findFirst({ where: eq(notifications.id, novo!.id) }),
    ]);
    ok("mensagem solta com mais de 1 dia cai", v?.status === "CANCELADA", v?.status);
    ok("a recente continua na fila", n?.status === "PENDENTE", n?.status);
    const conf = await db.query.notifications.findFirst({
      where: (t, { and, eq }) => and(eq(t.appointmentId, appt.id), eq(t.kind, "AGENDAMENTO_CRIADO")) });
    ok("confirmação de 2 dias atrás não sai numa rajada", conf?.status === "CANCELADA", conf?.status);
  }

  console.log("\n2. Remarcar pelo cliente segue as regras de agendar pelo site");
  {
    const settings = await getSettings();
    const { dia, livres } = await diaComVagas(corte.durationMin, 2);
    const appt = await createBooking({ serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: null,
      clientName: `${MARCA} Remarca`, clientPhone: "41970030003", publicRequest: true });
    const longe = addDays(shopToday(), settings.maxAdvanceDays + 7);
    let recusou = "";
    try {
      await rescheduleBooking({ appointmentId: appt.id, dateKey: longe, time: livres[1], publicRequest: true });
    } catch (e) {
      recusou = e instanceof BookingError ? e.message : String(e);
    }
    ok("o cliente não leva o horário para além do limite de dias", /dias à frente/.test(recusou), recusou);
    const aindaLa = await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) });
    ok("e o horário dele continua de pé", aindaLa?.status === "CONFIRMADO", aindaLa?.status);
  }

  console.log("\n3. Dois pedidos do mesmo telefone novo ao mesmo tempo");
  {
    // Horários longe um do outro: o corte dura mais que um slot, e dois
    // horários colados disputariam a mesma cadeira de verdade.
    const { dia, livres } = await diaComVagas(corte.durationMin, 4);
    const [a, b] = await Promise.allSettled([
      createBooking({ serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: null,
        clientName: `${MARCA} Duplo`, clientPhone: "41970030004" }),
      createBooking({ serviceIds: [corte.id], dateKey: dia, time: livres[livres.length - 1], barberId: null,
        clientName: `${MARCA} Duplo`, clientPhone: "41970030004" }),
    ]);
    ok("os dois agendamentos saem", a.status === "fulfilled" && b.status === "fulfilled",
      [a, b].map((r) => (r.status === "rejected" ? String(r.reason) : "ok")).join(" | "));
    const cadastros = await db.select().from(users).where(eq(users.phone, "41970030004"));
    ok("com um cadastro só", cadastros.length === 1, String(cadastros.length));
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
