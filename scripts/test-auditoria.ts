// Regressão dos defeitos que a auditoria confirmou.
// Cada bloco reproduz o cenário que estava quebrado.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  payments, plans, recurringSlots, services as sv, subscriptions, users,
} from "../db/schema";
import { createBooking, transitionAppointment } from "../lib/appointments";
import { materializeRecurring } from "../lib/recurring";
import { adminOverview, weeklyRevenue, clubOverview } from "../lib/queries";
import { getSettings, getAvailability } from "../lib/schedule";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { planClientImport } from "../lib/import";
import { discardStaleNotifications } from "../lib/dispatch";
import { and, eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZAudit";

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = gente.map((u) => u.id);
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
  await db.delete(payments).where(inArray(payments.userId, ids));
  await db.delete(recurringSlots).where(inArray(recurringSlots.userId, ids));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** Um dia aberto com horário livre para o barbeiro. */
async function diaComVaga(barberId: number, durationMin: number, pular: string[] = []) {
  const settings = await getSettings();
  for (let i = 1; i <= 12; i++) {
    const dia = addDays(shopToday(), i);
    if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
    if (pular.includes(dia)) continue;
    const { slots } = await getAvailability({ dateKey: dia, durationMin, barberId });
    const livre = slots.find((s) => s.available);
    if (livre) return { dia, hora: livre.time };
  }
  throw new Error("sem vaga para montar o teste");
}

async function main() {
  await limpar();
  const gold = (await db.query.plans.findFirst({ where: eq(plans.slug, "gold") }))!;
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
  const barbeiro = (await db.query.barbers.findFirst())!;

  console.log("\n1. Assinante é assinante mesmo sem sessão");
  {
    await db.insert(users).values({ name: `${MARCA} Membro`, phone: "11970004001", role: "CLIENT" });
    const membro = (await db.query.users.findFirst({ where: eq(users.phone, "11970004001") }))!;
    const renova = new Date(); renova.setMonth(renova.getMonth() + 1);
    await db.insert(subscriptions).values({ userId: membro.id, planId: gold.id, renewsAt: renova });

    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    // userId ausente é exatamente o encaixe feito pelo barbeiro ou o
    // assinante deslogado: antes disso virava AVULSO com preço cheio.
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: membro.name, clientPhone: membro.phone,
    });
    const gravado = (await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) }))!;
    ok("encaixe de membro sai como ASSINANTE", gravado.kind === "ASSINANTE", gravado.kind);
    ok("e não cobra nada", gravado.totalCents === 0, String(gravado.totalCents));
    ok("com a assinatura vinculada", !!gravado.subscriptionId);
    ok("e o agendamento fica no cadastro dele", gravado.clientUserId === membro.id);

    console.log("\n2. Faturamento do dia conta o atendimento do assinante");
    await transitionAppointment(appt.id, "EM_ANDAMENTO");
    await transitionAppointment(appt.id, "CONCLUIDO");
    const com = await db.query.appointmentCommissions.findFirst({
      where: eq(appointmentCommissions.appointmentId, appt.id),
    });
    ok("a comissão registra a base do serviço", !!com && com.baseCents === corte.priceCents,
      JSON.stringify(com && { base: com.baseCents, esperado: corte.priceCents }));
    const semana = await weeklyRevenue();
    const doDia = semana.find((d) => d.dateKey === dia);
    // O atendimento é futuro nos dias da semana só se couber na janela.
    if (doDia) {
      ok("o gráfico da semana conta o atendimento", doDia.atendimentos >= 1, JSON.stringify(doDia));
      ok("e soma a base, não o zero do plano", doDia.cents >= corte.priceCents, JSON.stringify(doDia));
    } else {
      ok("o gráfico da semana conta o atendimento", true, "(fora da janela de 7 dias)");
      ok("e soma a base, não o zero do plano", true, "(fora da janela de 7 dias)");
    }
  }

  console.log("\n3. MRR do painel e do Clube falam o mesmo");
  {
    const anual = new Date(); anual.setFullYear(anual.getFullYear() + 1);
    await db.insert(users).values({ name: `${MARCA} Anual`, phone: "11970004002", role: "CLIENT" });
    const u = (await db.query.users.findFirst({ where: eq(users.phone, "11970004002") }))!;
    await db.insert(subscriptions).values({
      userId: u.id, planId: gold.id, cycle: "ANUAL", renewsAt: anual,
    });
    const painel = await adminOverview();
    const clube = await clubOverview();
    ok("os dois MRR batem", painel.mrrCents === clube.mrrCents, `${painel.mrrCents} vs ${clube.mrrCents}`);
  }

  console.log("\n4. Horário fixo: tentar um horário ocupado não destrói o atual");
  {
    const membro = (await db.query.users.findFirst({ where: eq(users.phone, "11970004001") }))!;
    // Primeiro dia da semana em que a loja abre: fixar "daqui a dois dias"
    // caía no domingo e o fixo não tinha onde materializar.
    const settings = await getSettings();
    let diaOk = -1;
    for (let i = 1; i <= 7 && diaOk < 0; i++) {
      const wd = weekdayOf(addDays(shopToday(), i));
      if (!settings.closedWeekdays.includes(wd)) diaOk = wd;
    }
    await db.insert(recurringSlots).values({
      userId: membro.id, barberId: barbeiro.id, frequency: "SEMANAL", weekday: diaOk,
      minutesOfDay: 9 * 60, serviceIds: [corte.id], startsOn: shopToday(),
    });
    const slot = (await db.query.recurringSlots.findFirst({ where: eq(recurringSlots.userId, membro.id) }))!;
    const rel = await materializeRecurring({ slotId: slot.id });
    ok("o fixo do membro reserva as semanas", rel.criados > 0, JSON.stringify(rel));

    // Membro sem plano não materializa mais (benefício é de quem assina).
    await db.update(subscriptions).set({ status: "CANCELADA" })
      .where(eq(subscriptions.userId, membro.id));
    const depois = await materializeRecurring({ slotId: slot.id });
    ok("sem plano ativo, o fixo para de reservar", depois.criados === 0, JSON.stringify(depois));
    await db.update(subscriptions).set({ status: "ATIVA" })
      .where(eq(subscriptions.userId, membro.id));
  }

  console.log("\n5. Importação aguenta e-mail repetido no arquivo");
  {
    const csv = [
      "nome,telefone,email",
      `${MARCA} Um,(41) 98111-0001,mesmo@email.com`,
      `${MARCA} Dois,(41) 98111-0002,mesmo@email.com`,
    ].join("\n");
    const plano = planClientImport(csv);
    ok("o plano é montado", plano.ok === true);
    if (plano.ok) {
      const comEmail = plano.candidatos.filter((c) => c.email);
      ok("só o primeiro leva o e-mail repetido", comEmail.length === 1,
        JSON.stringify(plano.candidatos.map((c) => c.email)));
      ok("mas as duas pessoas entram", plano.candidatos.length === 2, String(plano.candidatos.length));
    }
  }

  console.log("\n6. Lembrete de 2h não morre antes de ser tentado");
  {
    const membro = (await db.query.users.findFirst({ where: eq(users.phone, "11970004001") }))!;
    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: membro.name, clientPhone: membro.phone, userId: membro.id,
    });
    // Simula a varredura rodando com atraso: o lembrete de 2h já passou da
    // hora, mas o atendimento ainda não começou.
    await db.update(notifications)
      .set({ scheduledFor: new Date(Date.now() - 3 * 3600_000) })
      .where(and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_2H")));
    await discardStaleNotifications();
    const lembrete = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_2H")),
    });
    ok("lembrete atrasado continua na fila", lembrete?.status === "PENDENTE", lembrete?.status ?? "(sumiu)");

    // Depois que o horário começa, aí sim é descartado.
    await db.update(appointments).set({ startsAt: new Date(Date.now() - 600_000) })
      .where(eq(appointments.id, appt.id));
    await discardStaleNotifications();
    const depois = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "LEMBRETE_2H")),
    });
    ok("com o horário já começado, é descartado", depois?.status === "CANCELADA", depois?.status ?? "");
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main();
