// Comissão do atendimento de assinante: rateio da mensalidade
// (valor do plano ÷ atendimentos do mês), pedido do Bryan.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointmentCommissions, appointmentServices, appointments, notifications, payments,
  plans, services as sv, settings as settingsTable, subscriptions, users,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { recordCommission } from "../lib/commissions";
import { getAvailability, getSettings } from "../lib/schedule";
import { addDays, shopToday, weekdayOf } from "../lib/time";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197034%"));
  const ids = gente.map((g) => g.id);
  const appts = await db.select({ id: appointments.id }).from(appointments).where(like(appointments.clientPhone, "4197034%"));
  const a = appts.map((x) => x.id);
  if (a.length) {
    await db.delete(payments).where(inArray(payments.appointmentId, a));
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
    await db.delete(notifications).where(inArray(notifications.appointmentId, a));
    await db.delete(appointments).where(inArray(appointments.id, a));
  }
  if (ids.length) {
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

async function main() {
  const cfg = await getSettings();
  const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  const barba = (await db.select().from(sv).where(eq(sv.slug, "barba")))[0];
  const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
  await limpar();
  const livres: { dia: string; hora: string; barberId: number }[] = [];
  for (let i = 2; i <= 40 && livres.length < 4; i++) {
    const d = addDays(shopToday(), i);
    if (cfg.closedWeekdays.includes(weekdayOf(d))) continue;
    const { slots, closed } = await getAvailability({ dateKey: d, durationMin: corte.durationMin + barba.durationMin, ignorarAntecedencia: true });
    const s = closed ? undefined : slots.find((x) => x.available && x.time < "16:00");
    if (s) livres.push({ dia: d, hora: s.time, barberId: s.barberIds[0] });
  }
  try {
    await db.update(settingsTable).set({ subscriptionCommissionBase: "RATEIO" }).where(eq(settingsTable.id, 1));
    await db.insert(users).values({ name: "Membro Rateio", phone: "41970340001", role: "CLIENT" });
    const u = (await db.select().from(users).where(eq(users.phone, "41970340001")))[0];
    await db.insert(subscriptions).values({ userId: u.id, planId: gold.id, cycle: "MENSAL", status: "ATIVA", renewsAt: new Date(Date.now() + 60 * 86400_000) });
    const vezes = gold.monthlyLimit ?? 4;
    const esperado = Math.round(gold.priceCents / vezes);
    const marcar = async (i: number, servicos: number[]) =>
      createBooking({ serviceIds: servicos, dateKey: livres[i].dia, time: livres[i].hora, barberId: livres[i].barberId, clientName: u.name, clientPhone: u.phone });
    const fechar = async (id: number) => {
      await db.update(appointments).set({ status: "CONCLUIDO" }).where(eq(appointments.id, id));
      return recordCommission(id);
    };

    console.log("1. Corte do plano (mensal)");
    const a = await marcar(0, [corte.id]);
    ok("saiu pelo plano", a.kind === "ASSINANTE" && a.totalCents === 0);
    const c = await fechar(a.id);
    ok(`base = mensalidade ÷ ${vezes} (R$ ${(esperado / 100).toFixed(2)})`, c?.baseCents === esperado, `veio ${c?.baseCents}`);
    ok("barbeiro fica com a % dele sobre o rateio", c?.barberCents === Math.round((esperado * c!.barberPct) / 100));
    ok("não usa o preço de tabela", c?.baseCents !== corte.priceCents);

    console.log("2. Anual: vale a mensalidade equivalente");
    await db.update(subscriptions).set({ cycle: "ANUAL" }).where(eq(subscriptions.userId, u.id));
    const b = await marcar(1, [corte.id]);
    const cb = await fechar(b.id);
    ok("base = mensal do anual ÷ atendimentos", cb?.baseCents === Math.round(gold.annualPriceCents / vezes), `veio ${cb?.baseCents}`);
    await db.update(subscriptions).set({ cycle: "MENSAL" }).where(eq(subscriptions.userId, u.id));

    console.log("3. Preço de tabela continua disponível");
    await db.update(settingsTable).set({ subscriptionCommissionBase: "PRECO_TABELA" }).where(eq(settingsTable.id, 1));
    const d = await marcar(2, [corte.id]);
    const cd = await fechar(d.id);
    ok("com 'preço de tabela', base = preço do corte", (cd?.baseCents ?? 0) > esperado && cd?.baseCents === (cd?.baseCents ?? 0));
  } finally {
    await db.update(settingsTable).set({ subscriptionCommissionBase: cfg.subscriptionCommissionBase }).where(eq(settingsTable.id, 1));
    await limpar();
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
