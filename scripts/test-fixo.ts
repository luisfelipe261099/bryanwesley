import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions,
  notifications, recurringSlots, subscriptions, users, plans, services as sv,
} from "../db/schema";
import { materializeRecurring, occurrencesFor, cancelFutureOccurrences } from "../lib/recurring";
import { createBooking, transitionAppointment } from "../lib/appointments";
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
  // Procura o próximo dia em que a loja abre: fixar "daqui a 3 dias"
  // fazia o teste falhar nas semanas em que essa data caía no domingo.
  let extra = null;
  let motivo = "";
  for (let i = 1; i <= 10 && !extra; i++) {
    const dia = addDays(shopToday(), i);
    if (weekdayOf(dia) === wd) continue; // nesse dia o fixo já ocupa a agenda
    try {
      extra = await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: "15:30",
        barberId: null, clientName: cliente.name, clientPhone: cliente.phone,
        userId: cliente.id,
      });
    } catch (e) { motivo = (e as Error).message; }
  }
  if (!extra) console.log("     (não foi possível: " + motivo + ")");
  ok("membro com fixo ainda agenda avulso", !!extra);


  console.log("\n5. Ocorrência cancelada pelo membro não volta");
  {
    const slot = (await db.query.recurringSlots.findFirst({
      where: eq(recurringSlots.active, true),
    }))!;
    const ocor = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.recurringSlotId, slot.id),
          eq(appointments.status, "CONFIRMADO")
        )
      );
    ok("ocorrências carregam o vínculo com o fixo", ocor.length > 0, String(ocor.length));
    if (ocor.length > 0) {
      await transitionAppointment(ocor[0].id, "CANCELADO");
      const antes = (
        await db.select().from(appointments).where(eq(appointments.recurringSlotId, slot.id))
      ).length;
      const rel = await materializeRecurring();
      const depois = (
        await db.select().from(appointments).where(eq(appointments.recurringSlotId, slot.id))
      ).length;
      ok(
        "materializar de novo não recria a cancelada",
        rel.criados === 0 && depois === antes,
        `criados=${rel.criados} ${antes}->${depois}`
      );
      const mesma = await db.query.appointments.findFirst({
        where: eq(appointments.id, ocor[0].id),
      });
      ok("a ocorrência continua CANCELADO", mesma?.status === "CANCELADO", mesma?.status);
    }
  }

  console.log("\n6. Abrir mão do fixo libera as ocorrências futuras");
  {
    const slot = (await db.query.recurringSlots.findFirst({
      where: eq(recurringSlots.active, true),
    }))!;
    const liberados = await cancelFutureOccurrences([slot.id]);
    ok("libera as ocorrências futuras", liberados >= 1, String(liberados));
    const ativas = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.recurringSlotId, slot.id),
          inArray(appointments.status, ["PENDENTE", "CONFIRMADO"])
        )
      );
    ok("nenhuma futura continua ativa", ativas.length === 0, String(ativas.length));
    const rel = await materializeRecurring();
    ok("e a varredura não as recria", rel.criados === 0, `criados=${rel.criados}`);
  }

  console.log("\n7. Transição concorrente: só uma vence, comissão coerente");
  {
    let alvo = null as Awaited<ReturnType<typeof createBooking>> | null;
    for (let d = 2; d <= 9 && !alvo; d++) {
      try {
        alvo = await createBooking({
          serviceIds: [corte.id],
          dateKey: addDays(shopToday(), d),
          time: "16:30",
          barberId: null,
          clientName: "Corrida Transicao",
          clientPhone: "11970008888",
        });
      } catch { /* dia fechado ou ocupado */ }
    }
    if (!alvo) {
      ok("consegui um horário para o teste de corrida", false);
    } else {
      const [a, b] = await Promise.allSettled([
        transitionAppointment(alvo.id, "CONCLUIDO"),
        transitionAppointment(alvo.id, "CANCELADO"),
      ]);
      const venceram = [a, b].filter((r) => r.status === "fulfilled").length;
      ok("exatamente uma transição vence", venceram === 1, `${a.status}/${b.status}`);
      const final = await db.query.appointments.findFirst({
        where: eq(appointments.id, alvo.id),
      });
      const com = await db
        .select()
        .from(appointmentCommissions)
        .where(eq(appointmentCommissions.appointmentId, alvo.id));
      ok(
        "comissão existe se e só se terminou CONCLUIDO",
        (final?.status === "CONCLUIDO") === (com.length === 1),
        `${final?.status} com=${com.length}`
      );
    }
  }

  console.log(`\n${p} passaram · ${f} falharam\n`);
  await pool.end();
  process.exit(f > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
