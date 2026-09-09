// Teste de fumaça do motor de agenda contra o Postgres local.
import "../db/load-env";
import { db, sql } from "../db/client";
import {
  appointments,
  appointmentServices,
  appointmentCommissions,
  notifications,
  services as servicesTable,
  scheduleBlocks,
} from "../db/schema";
import { getAvailability, getSettings, getActiveBarbers } from "../lib/schedule";
import { createBooking, transitionAppointment, BookingError } from "../lib/appointments";
import { shopToday, addDays, weekdayOf, shopTimeToUtc, parseDateKey } from "../lib/time";
import { eq } from "drizzle-orm";

let passes = 0;
let fails = 0;
function check(label: string, cond: boolean, extra = "") {
  if (cond) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    fails++;
    console.log(`  ✗ ${label} ${extra}`);
  }
}

async function main() {
  const settings = await getSettings();
  const team = await getActiveBarbers();
  const svcs = await db.select().from(servicesTable);
  const corte = svcs.find((s) => s.slug === "corte")!;
  const barba = svcs.find((s) => s.slug === "barba")!;

  // Limpa resíduo de execuções anteriores.
  await db.delete(appointmentCommissions);
  await db.delete(notifications);
  await db.delete(appointmentServices);
  await db.delete(appointments);
  await db.delete(scheduleBlocks);

  // Um dia aberto bem no futuro, longe da regra de antecedência.
  let dateKey = addDays(shopToday(), 7);
  while (settings.closedWeekdays.includes(weekdayOf(dateKey)))
    dateKey = addDays(dateKey, 1);
  console.log(`\nDia de teste: ${dateKey}\n`);

  console.log("1. Disponibilidade");
  const av = await getAvailability({ dateKey, durationMin: corte.durationMin });
  check("gera grade de horários", av.slots.length > 0, `(${av.slots.length})`);
  check("todos livres num dia vazio", av.slots.every((s) => s.available));
  check(
    "respeita abertura e fechamento",
    av.slots[0].time === "09:00" &&
      av.slots[av.slots.length - 1].minutes + corte.durationMin <= settings.closeMinute
  );

  console.log("\n2. Agendamento");
  const b1 = await createBooking({
    serviceIds: [corte.id],
    dateKey,
    time: "10:00",
    barberId: team[0].id,
    clientName: "Cliente Teste Um",
    clientPhone: "(11) 90000-0001",
  });
  check("cria agendamento", !!b1.id);
  check("gera código do cliente", b1.code.length === 6);
  check("gera token de QR", !!b1.checkinToken);
  check("congela percentual do barbeiro", b1.barberPctSnapshot !== null);
  check("cobra preço de tabela", b1.totalCents === corte.priceCents);

  const notifs = await db
    .select()
    .from(notifications)
    .where(eq(notifications.appointmentId, b1.id));
  check("enfileira confirmação + lembretes", notifs.length === 3, `(${notifs.length})`);

  console.log("\n3. Horário fica indisponível");
  const av2 = await getAvailability({
    dateKey,
    durationMin: corte.durationMin,
    barberId: team[0].id,
  });
  const slot10 = av2.slots.find((s) => s.time === "10:00")!;
  check("10:00 ocupado para o mesmo barbeiro", !slot10.available);
  const slot1030 = av2.slots.find((s) => s.time === "10:30")!;
  check("10:30 ainda bloqueado pela duração de 40min", !slot1030.available);
  const slot1100 = av2.slots.find((s) => s.time === "11:00")!;
  check("11:00 liberado após o atendimento", slot1100.available);

  const avOutro = await getAvailability({
    dateKey,
    durationMin: corte.durationMin,
    barberId: team[1].id,
  });
  check(
    "outro barbeiro segue livre às 10:00",
    avOutro.slots.find((s) => s.time === "10:00")!.available
  );

  console.log("\n4. Reserva dupla é rejeitada");
  let rejeitou = false;
  try {
    await createBooking({
      serviceIds: [corte.id],
      dateKey,
      time: "10:00",
      barberId: team[0].id,
      clientName: "Cliente Teste Dois",
      clientPhone: "(11) 90000-0002",
    });
  } catch (e) {
    rejeitou = e instanceof BookingError;
  }
  check("segundo cliente no mesmo horário é barrado", rejeitou);

  console.log("\n5. Corrida: 5 pedidos simultâneos no mesmo horário");
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      createBooking({
        serviceIds: [barba.id],
        dateKey,
        time: "14:00",
        barberId: team[0].id,
        clientName: `Corrida ${i}`,
        clientPhone: `(11) 9111100${i}0`,
      })
    )
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  check("exatamente 1 vence a corrida", ok === 1, `(venceram: ${ok})`);

  console.log("\n6. 'Mais rápido' escolhe barbeiro livre");
  const auto = await createBooking({
    serviceIds: [corte.id],
    dateKey,
    time: "10:00",
    barberId: null,
    clientName: "Cliente Automatico",
    clientPhone: "(11) 90000-0003",
  });
  check("aloca outro barbeiro sozinho", auto.barberId !== team[0].id);

  console.log("\n7. Bloqueio do admin some da agenda");
  const { year, month, day } = parseDateKey(dateKey);
  await db.insert(scheduleBlocks).values({
    barberId: null, // loja inteira
    startsAt: shopTimeToUtc(year, month, day, 16 * 60),
    endsAt: shopTimeToUtc(year, month, day, 17 * 60),
    reason: "Manutenção",
  });
  const av3 = await getAvailability({ dateKey, durationMin: corte.durationMin });
  check("16:00 bloqueado para todos", !av3.slots.find((s) => s.time === "16:00")!.available);
  check("17:00 continua livre", av3.slots.find((s) => s.time === "17:00")!.available);

  console.log("\n8. Antecedência mínima");
  const hoje = await getAvailability({ dateKey: shopToday(), durationMin: 30 });
  if (!hoje.closed) {
    const passados = hoje.slots.filter((s) => s.reason === "antecedencia");
    check("horários fora da antecedência marcados", passados.length > 0, `(${passados.length})`);
  } else {
    console.log("  – hoje a loja está fechada, teste pulado");
  }

  console.log("\n9. Ciclo de vida e comissão");
  await transitionAppointment(b1.id, "EM_ANDAMENTO");
  const done = await transitionAppointment(b1.id, "CONCLUIDO");
  check("conclui o atendimento", done.status === "CONCLUIDO");
  check("marca horário de término", !!done.finishedAt);

  const [com] = await db
    .select()
    .from(appointmentCommissions)
    .where(eq(appointmentCommissions.appointmentId, b1.id));
  check("lança comissão", !!com);
  if (com) {
    check(
      "divisão fecha com a base (sem centavo perdido)",
      com.barberCents + com.shopCents === com.baseCents,
      `${com.barberCents}+${com.shopCents}≠${com.baseCents}`
    );
    console.log(
      `     base ${com.baseCents} · barbeiro ${com.barberPct}% = ${com.barberCents} · barbearia ${com.shopCents}`
    );
  }

  let pulou = false;
  try {
    await transitionAppointment(b1.id, "EM_ANDAMENTO");
  } catch {
    pulou = true;
  }
  check("não deixa reabrir atendimento concluído", pulou);

  console.log("\n10. Cancelamento");
  const canc = await transitionAppointment(auto.id, "CANCELADO");
  check("cancela", canc.status === "CANCELADO");
  const lembretes = await db
    .select()
    .from(notifications)
    .where(eq(notifications.appointmentId, auto.id));
  check(
    "derruba lembretes pendentes",
    lembretes.filter((n) => n.status === "PENDENTE" && n.kind.startsWith("LEMBRETE")).length === 0
  );
  const av4 = await getAvailability({
    dateKey,
    durationMin: corte.durationMin,
    barberId: auto.barberId,
  });
  check(
    "horário volta a ficar livre após cancelar",
    av4.slots.find((s) => s.time === "10:00")!.available
  );

  console.log(`\n${passes} passaram · ${fails} falharam\n`);
  await sql.end();
  process.exit(fails > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
