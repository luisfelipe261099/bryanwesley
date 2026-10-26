// Preço por turno: a regra certa vale no horário certo, o preço fica
// gravado no atendimento e remarcar ou trocar serviço segue as regras.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications,
  servicePriceRules, services as sv, users,
} from "../db/schema";
import { createBooking, rescheduleBooking, updateAppointmentServices } from "../lib/appointments";
import { getAvailability, getSettings } from "../lib/schedule";
import { precoNoHorario, regraDoHorario, rotuloDias, rotuloFaixa, type RegraPreco } from "../lib/precos";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const FONE = (n: number) => `4197019${String(n).padStart(4, "0")}`;

async function limpar(serviceId?: number) {
  if (serviceId) await db.delete(servicePriceRules).where(eq(servicePriceRules.serviceId, serviceId));
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197019%"));
  const ids = gente.map((u) => u.id);
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments).where(inArray(appointments.clientUserId, ids));
  const a = appts.map((x) => x.id);
  if (a.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
    await db.delete(notifications).where(inArray(notifications.appointmentId, a));
    await db.delete(appointments).where(inArray(appointments.id, a));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

async function main() {
  console.log("Funções puras");
  const r = (id: number, weekdays: number[], a: number, b: number, preco: number, label = ""): RegraPreco => ({
    id, serviceId: 1, label, weekdays, startMin: a, endMin: b, priceCents: preco,
  });
  const regras = [r(1, [1, 2, 3, 4, 5], 18 * 60, 21 * 60, 6000, "Noite"), r(2, [6], 0, 24 * 60, 7000, "Sábado"), r(3, [0, 1, 2, 3, 4, 5, 6], 19 * 60, 20 * 60, 6500)];
  const corte = { id: 1, priceCents: 5000 };
  ok("fora de regra vale o catálogo", precoNoHorario(corte, regras, 2, 10 * 60) === 5000);
  ok("noite de terça vale a regra da noite", precoNoHorario(corte, regras, 2, 18 * 60) === 6000);
  ok("21:00 já é fora da noite (faixa sem o fim)", precoNoHorario(corte, regras, 2, 21 * 60) === 5000);
  ok("sábado vale a regra do sábado o dia todo", precoNoHorario(corte, regras, 6, 9 * 60) === 7000);
  ok("sábado 19h: Sábado (1 dia) vence a de todo dia", regraDoHorario(regras, 1, 6, 19 * 60)?.id === 2);
  ok("terça 19h: Noite (5 dias) vence a de todo dia (7 dias)", regraDoHorario(regras, 1, 2, 19 * 60)?.id === 1);
  ok("outro serviço não pega a regra", precoNoHorario({ id: 2, priceCents: 9000 }, regras, 2, 18 * 60) === 9000);
  ok("rótulo de dias seguidos", rotuloDias([1, 2, 3, 4, 5]) === "Seg a Sex");
  ok("rótulo de dias soltos", rotuloDias([1, 3, 5]) === "Seg, Qua e Sex");
  ok("rótulo da faixa", rotuloFaixa({ startMin: 18 * 60, endMin: 21 * 60 }) === "18:00 às 21:00");

  console.log("Agendamento com preço por turno");
  const corteDb = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  await limpar(corteDb.id);
  try {
    // dia aberto com um horário livre cedo e outro livre à noite (ou o último do dia)
    const settings = await getSettings();
    let dia = "", cedo = "", tarde = "";
    for (let i = 2; i <= 30 && !dia; i++) {
      const d = addDays(shopToday(), i);
      if (settings.closedWeekdays.includes(weekdayOf(d))) continue;
      const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corteDb.durationMin, ignorarAntecedencia: true });
      const livres = slots.filter((s) => s.available).map((s) => s.time);
      if (closed || livres.length < 4) continue;
      dia = d; cedo = livres[0]; tarde = livres[livres.length - 1];
    }
    if (!dia) throw new Error("sem dia livre para o teste");
    const [h, m] = tarde.split(":").map(Number);
    const wd = weekdayOf(dia);
    // a regra cobre só o horário "tarde"
    await db.insert(servicePriceRules).values({
      serviceId: corteDb.id, label: "Noite", weekdays: [wd], startMin: h * 60 + m, endMin: h * 60 + m + 1, priceCents: corteDb.priceCents + 2000,
    });

    const a1 = await createBooking({ serviceIds: [corteDb.id], dateKey: dia, time: cedo, clientName: "Teste Turno", clientPhone: FONE(1) });
    ok("horário fora do turno sai pelo catálogo", a1.totalCents === corteDb.priceCents, `${a1.totalCents}`);
    const a2 = await createBooking({ serviceIds: [corteDb.id], dateKey: dia, time: tarde, clientName: "Teste Turno", clientPhone: FONE(2) });
    ok("horário do turno sai com o preço do turno", a2.totalCents === corteDb.priceCents + 2000, `${a2.totalCents}`);
    const item = (await db.select().from(appointmentServices).where(eq(appointmentServices.appointmentId, a2.id)))[0];
    ok("o item gravado leva o preço do turno", item.priceCents === corteDb.priceCents + 2000);

    // mudar a regra depois não mexe no que já foi marcado
    await db.update(servicePriceRules).set({ priceCents: corteDb.priceCents + 9000 }).where(eq(servicePriceRules.serviceId, corteDb.id));
    const a2b = (await db.select().from(appointments).where(eq(appointments.id, a2.id)))[0];
    ok("mudar a regra não muda quem já marcou", a2b.totalCents === corteDb.priceCents + 2000);

    // remarcar mantém o combinado (regra antiga), mesmo indo para fora do turno
    const outro = (await getAvailability({ dateKey: dia, durationMin: corteDb.durationMin, barberId: a2.barberId, ignorarAntecedencia: true }))
      .slots.find((s) => s.available && s.time !== cedo && s.time !== tarde);
    if (outro) {
      const r2 = await rescheduleBooking({ appointmentId: a2.id, dateKey: dia, time: outro.time });
      ok("remarcar mantém o preço combinado", r2.totalCents === corteDb.priceCents + 2000, `${r2.totalCents}`);
    }

    // trocar serviços: o que já estava conserva o combinado; o que entra
    // agora vai pelo turno do horário
    const barba = (await db.select().from(sv).where(eq(sv.slug, "barba")))[0];
    if (barba) {
      const livre = (await getAvailability({ dateKey: dia, durationMin: corteDb.durationMin + barba.durationMin, ignorarAntecedencia: true }))
        .slots.find((s) => s.available);
      if (livre) {
        const a3 = await createBooking({ serviceIds: [corteDb.id], dateKey: dia, time: livre.time, barberId: livre.barberIds[0], clientName: "Teste Turno", clientPhone: FONE(3) });
        await db.insert(servicePriceRules).values({
          serviceId: barba.id, label: "Dia todo", weekdays: [wd], startMin: 0, endMin: 24 * 60, priceCents: barba.priceCents + 1000,
        });
        const up = await updateAppointmentServices({ appointmentId: a3.id, serviceIds: [corteDb.id, barba.id] });
        ok("serviço que entra na troca vai pelo preço do turno", up.totalCents === a3.totalCents + barba.priceCents + 1000, `${up.totalCents}`);
        await db.delete(servicePriceRules).where(eq(servicePriceRules.serviceId, barba.id));
      }
    }
  } finally {
    await limpar(corteDb.id);
  }

  console.log(`\n${p} ok, ${f} falha(s)`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
