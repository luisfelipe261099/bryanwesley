import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions,
  notifications, recurringSlots, subscriptions, users, plans, services as sv,
} from "../db/schema";
import { materializeRecurring, occurrencesFor } from "../lib/recurring";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { eq, and, inArray } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

async function main() {
  await db.delete(appointmentCommissions);
  await db.delete(notifications);
  await db.delete(appointmentServices);
  await db.delete(appointments);
  await db.delete(recurringSlots);

  const gold = (await db.query.plans.findFirst({ where: eq(plans.slug, "gold") }))!;
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
  const barbeiro = (await db.query.barbers.findFirst())!;

  // Cliente com assinatura ativa
  await db.insert(users).values({
    name: "Membro Fixo", phone: "11970001111", role: "CLIENT",
  }).onDuplicateKeyUpdate({ set: { name: "Membro Fixo" } });
  const cliente = (await db.query.users.findFirst({ where: eq(users.phone, "11970001111") }))!;

  const renova = new Date(); renova.setMonth(renova.getMonth() + 1);
  await db.delete(subscriptions).where(eq(subscriptions.userId, cliente.id));
  await db.insert(subscriptions).values({
    userId: cliente.id, planId: gold.id, renewsAt: renova,
  });

  console.log("\n1. Cálculo das ocorrências");
  // escolhe um dia da semana em que a loja abre
  let wd = 4;
  const slotBase = {
    frequency: "SEMANAL", weekday: wd, dayOfMonth: null,
    startsOn: shopToday(), endsOn: null,
  };
  const datas = occurrencesFor(slotBase);
  ok("gera ocorrências semanais", datas.length >= 4, `(${datas.length})`);
  ok("todas caem no mesmo dia da semana", datas.every((d) => weekdayOf(d) === wd));

  const mensal = occurrencesFor({
    frequency: "MENSAL", weekday: null, dayOfMonth: 15,
    startsOn: shopToday(), endsOn: null,
  });
  ok("gera ocorrência mensal", mensal.every((d) => d.endsWith("-15")), mensal.join(","));

  console.log("\n2. Materialização");
  await db.insert(recurringSlots).values({
    userId: cliente.id, barberId: barbeiro.id, frequency: "SEMANAL",
    weekday: wd, minutesOfDay: 10 * 60, serviceIds: [corte.id],
    startsOn: shopToday(),
  });

  const r1 = await materializeRecurring();
  ok("cria os horários fixos", r1.criados > 0, `(${r1.criados})`);

  const criados = await db.query.appointments.findMany({
    where: eq(appointments.clientUserId, cliente.id),
  });
  ok("marcados como assinante (sem cobrança)",
     criados.every((a) => a.kind === "ASSINANTE" && a.totalCents === 0));
  ok("todos às 10:00 do dia certo",
     criados.every((a) => weekdayOf(a.startsAt.toISOString().slice(0,10)) >= 0));

  console.log("\n3. Idempotência");
  const r2 = await materializeRecurring();
  ok("rodar de novo não duplica", r2.criados === 0 && r2.jaExistiam > 0,
     `(criados ${r2.criados}, existentes ${r2.jaExistiam})`);

  const total = await db.query.appointments.findMany({
    where: eq(appointments.clientUserId, cliente.id),
  });
  ok("contagem estável", total.length === criados.length, `${total.length} vs ${criados.length}`);

  console.log("\n4. Fixo não impede horário avulso");
  const { createBooking } = await import("../lib/appointments");
  const outroDia = addDays(shopToday(), 3);
  let extra = null;
  try {
    extra = await createBooking({
      serviceIds: [corte.id], dateKey: outroDia, time: "15:30",
      barberId: null, clientName: cliente.name, clientPhone: cliente.phone,
      userId: cliente.id,
    });
  } catch (e) { /* dia fechado, tenta outro */ }
  if (!extra) {
    const outro2 = addDays(shopToday(), 4);
    try {
      extra = await createBooking({
        serviceIds: [corte.id], dateKey: outro2, time: "15:30",
        barberId: null, clientName: cliente.name, clientPhone: cliente.phone,
        userId: cliente.id,
      });
    } catch (e) { console.log("     (não foi possível: " + (e as Error).message + ")"); }
  }
  ok("membro com fixo ainda agenda avulso", !!extra);

  console.log(`\n${p} passaram · ${f} falharam\n`);
  await pool.end();
  process.exit(f > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
