// Limite de atendimentos por mês do plano e os extras liberados pelo admin.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  plans, services as sv, subscriptions, users,
} from "../db/schema";
import {
  atendimentosDoPlanoNoMes, createBooking, rescheduleBooking, saldoDeExtras, transitionAppointment,
} from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const FONE = "41970220001";

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197022%"));
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
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

async function main() {
  const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
  const limiteOriginal = gold.monthlyLimit;
  const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  const barba = (await db.select().from(sv).where(eq(sv.slug, "barba")))[0];
  const settings = await getSettings();

  // Um mês com dias livres suficientes: começa daqui a 2 dias.
  const inicio = addDays(shopToday(), 2);
  const mes = inicio.slice(0, 7);
  const livre = async (noMes: string, dur: number) => {
    for (let i = 0; i <= 62; i++) {
      const d = addDays(inicio, i);
      if (d.slice(0, 7) !== noMes) continue;
      if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
      const { slots, closed } = await getAvailability({ dateKey: d, durationMin: dur, ignorarAntecedencia: true });
      if (closed) continue;
      const s = slots.find((x) => x.available);
      if (s) return { dia: d, hora: s.time, barberId: s.barberIds[0] };
    }
    throw new Error(`sem horário livre em ${noMes}`);
  };
  const marcar = async (serviceIds: number[], noMes = mes) => {
    const dur = serviceIds.length * 60;
    const l = await livre(noMes, dur);
    return createBooking({ serviceIds, dateKey: l.dia, time: l.hora, barberId: l.barberId, clientName: "Teste Limite", clientPhone: FONE });
  };

  await limpar();
  await db.update(plans).set({ monthlyLimit: 2 }).where(eq(plans.id, gold.id));
  try {
    await db.insert(users).values({ name: "Teste Limite", phone: FONE, role: "CLIENT" });
    const u = (await db.select().from(users).where(eq(users.phone, FONE)))[0];
    await db.insert(subscriptions).values({ userId: u.id, planId: gold.id, cycle: "MENSAL", status: "ATIVA", renewsAt: new Date(Date.now() + 90 * 86400_000) });

    console.log("1. Limite do mês (2 para o teste)");
    const a1 = await marcar([corte.id, barba.id]);
    ok("1º atendimento (corte + barba) sai pelo plano", a1.totalCents === 0 && a1.kind === "ASSINANTE");
    ok("corte e barba na mesma visita contam 1", (await atendimentosDoPlanoNoMes(u.id, a1.startsAt.toISOString().slice(0, 10))) === 1);
    const a2 = await marcar([corte.id]);
    ok("2º atendimento sai pelo plano", a2.totalCents === 0);
    const a3 = await marcar([corte.id]);
    ok("3º (passou do limite) sai avulso, preço cheio", a3.totalCents > 0 && a3.kind === "AVULSO" && !a3.extraCredit);
    await transitionAppointment(a3.id, "CANCELADO");

    console.log("2. Extras liberados");
    await db.update(users).set({ extraVisits: 2 }).where(eq(users.id, u.id));
    ok("saldo começa com 2", (await saldoDeExtras(u.id)) === 2);
    const a4 = await marcar([corte.id]);
    ok("passou do limite com extra: sai pelo plano usando 1 extra", a4.totalCents === 0 && a4.extraCredit === true);
    ok("saldo cai para 1", (await saldoDeExtras(u.id)) === 1);
    ok("o extra não conta no limite do mês", (await atendimentosDoPlanoNoMes(u.id, `${mes}-01`)) === 2);
    await transitionAppointment(a4.id, "CANCELADO");
    ok("cancelar devolve o extra", (await saldoDeExtras(u.id)) === 2);

    console.log("3. Remarcar e mudar de mês");
    const destino = await livre(mes, 60);
    const re = await rescheduleBooking({ appointmentId: a2.id, dateKey: destino.dia, time: destino.hora, barberId: destino.barberId });
    ok("remarcar no mesmo mês continua pelo plano (não conta 2 vezes)", re.totalCents === 0 && !re.extraCredit);
    const proxMes = addDays(`${mes}-28`, 7).slice(0, 7);
    const a5 = await marcar([corte.id], proxMes);
    ok("no mês seguinte o limite recomeça", a5.totalCents === 0 && !a5.extraCredit);

    console.log("4. Sem limite");
    await db.update(plans).set({ monthlyLimit: null }).where(eq(plans.id, gold.id));
    const a6 = await marcar([corte.id]);
    ok("plano sem limite segue cobrindo", a6.totalCents === 0 && !a6.extraCredit);
  } finally {
    await db.update(plans).set({ monthlyLimit: limiteOriginal }).where(eq(plans.id, gold.id));
    await limpar();
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
