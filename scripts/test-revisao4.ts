// Regressão da quarta revisão (antes do teste em produção): cada bloco
// reproduz o cenário que estava quebrado.
import "../db/load-env";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, barberHours, barbers, notifications,
  planServices, plans, recurringSlots, scheduleBlocks, services as sv, subscriptions, users,
} from "../db/schema";
import { createBooking, rescheduleBooking, transitionAppointment, BookingError } from "../lib/appointments";
import { getSettings, getAvailability, capacidadeDoDia } from "../lib/schedule";
import { materializeRecurring, ocorrenciasFuturas } from "../lib/recurring";
import { expireOverdueSubscriptions } from "../lib/subscriptions";
import { lancarComissoesPendentes } from "../lib/dispatch";
import { normalizePhone } from "../lib/phone";
import { shopFrom, instagramUrl, rotuloFechado } from "../lib/shop";
import { shopToday, addDays, weekdayOf, parseDateKey, shopTimeToUtc } from "../lib/time";
import { and, eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const FONE = (n: number) => `4197004${String(n).padStart(4, "0")}`;

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.phone, "4197004%"));
  const ids = gente.map((u) => u.id);
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments)
    .where(inArray(appointments.clientUserId, ids));
  const a = appts.map((x) => x.id);
  if (a.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, a));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, a));
    await db.delete(notifications).where(inArray(notifications.appointmentId, a));
    await db.delete(appointments).where(inArray(appointments.id, a));
  }
  await db.delete(recurringSlots).where(inArray(recurringSlots.userId, ids));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** Dias abertos a partir de amanhã com ao menos `n` horários livres para o barbeiro. */
async function diasComVaga(barberId: number, durationMin: number, n = 1, quantos = 1, depoisDe = 1) {
  const settings = await getSettings();
  const out: { dia: string; livres: string[] }[] = [];
  for (let i = depoisDe; i <= 40 && out.length < quantos; i++) {
    const dia = addDays(shopToday(), i);
    if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
    const { slots, closed } = await getAvailability({ dateKey: dia, durationMin, barberId, ignorarAntecedencia: true });
    if (closed) continue;
    const livres = slots.filter((s) => s.available).map((s) => s.time);
    if (livres.length >= n) out.push({ dia, livres });
  }
  if (out.length < quantos) throw new Error("sem vaga para montar o teste");
  return out;
}

/** Todo arquivo "use server" do app: cada export precisa conferir a sessão. */
function arquivosUseServer(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...arquivosUseServer(caminho));
    else if (/\.(ts|tsx)$/.test(nome) && /^\s*["']use server["']/.test(readFileSync(caminho, "utf8"))) out.push(caminho);
  }
  return out;
}

async function main() {
  await limpar();
  const settings = await getSettings();
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
  const barbeiro = (await db.query.barbers.findFirst({ where: eq(barbers.active, true) }))!;

  console.log("\n1. Nenhuma Server Action exportada sem conferir a sessão");
  {
    const semGuarda: string[] = [];
    for (const arq of arquivosUseServer("app")) {
      const src = readFileSync(arq, "utf8");
      const partes = src.split(/\nexport async function /).slice(1);
      for (const parte of partes) {
        const nome = parte.slice(0, parte.indexOf("("));
        const corpo = parte.slice(0, 1500);
        if (!/(requireRole|admin\(\)|getSession|assertOwnership|fazerCheckIn|verifySession|rateLimit|hitRateLimit)/.test(corpo)) {
          semGuarda.push(`${arq}:${nome}`);
        }
      }
    }
    // Ações públicas de propósito: login, cadastro, agenda aberta.
    const publicas = /(entrar\/actions\.ts:(login|signup|logout|signin|primeiroAcesso|assumirConta))|(agendar\/actions\.ts:(submitBooking|fetchAvailability|currentSettings))/;
    const suspeitas = semGuarda.filter((x) => !publicas.test(x));
    ok("toda ação 'use server' confere a sessão (ou é pública de propósito)", suspeitas.length === 0, suspeitas.join(", "));
    ok("liberarFixosDe saiu do arquivo de ações", !readFileSync("app/admin/actions.ts", "utf8").includes("export async function liberarFixosDe"));
  }

  console.log("\n2. Nono dígito: celular importado sem o 9 é o mesmo cliente");
  {
    ok("41 8888-7777 vira 41 9 8888-7777", normalizePhone("(41) 8888-7777") === "41988887777");
    ok("fixo (41 3333-4444) fica como está", normalizePhone("4133334444") === "4133334444");
    ok("número reservado (00…) não muda", normalizePhone("00000000001") === "00000000001");
  }

  console.log("\n3. Jornada própria: dia em branco segue a loja; folga é explícita");
  {
    const [{ dia }] = await diasComVaga(barbeiro.id, 30);
    const wd = weekdayOf(dia);
    const outro = addDays(dia, 1);
    await db.delete(barberHours).where(eq(barberHours.barberId, barbeiro.id));
    await db.insert(barberHours).values({ barberId: barbeiro.id, weekday: weekdayOf(outro), openMinute: 14 * 60, closeMinute: 18 * 60 });
    const av = await getAvailability({ dateKey: dia, durationMin: 30, barberId: barbeiro.id, ignorarAntecedencia: true });
    ok("preencher outro dia não tira o barbeiro deste", !av.closed, String(av.motivo));
    await db.insert(barberHours).values({ barberId: barbeiro.id, weekday: wd, openMinute: 0, closeMinute: 0 });
    const av2 = await getAvailability({ dateKey: dia, durationMin: 30, barberId: barbeiro.id });
    ok("folga 0–0 fecha o dia para ele", av2.closed && av2.motivo === "folga");
    await db.delete(barberHours).where(eq(barberHours.barberId, barbeiro.id));
  }

  console.log("\n4. Ocupação desconta os bloqueios");
  {
    const [{ dia }] = await diasComVaga(barbeiro.id, 30);
    const antes = await capacidadeDoDia(dia, barbeiro.id, settings);
    const { year, month, day } = parseDateKey(dia);
    const [{ id: blocoId }] = await db.insert(scheduleBlocks).values({
      barberId: barbeiro.id,
      startsAt: shopTimeToUtc(year, month, day, 12 * 60),
      endsAt: shopTimeToUtc(year, month, day, 13 * 60),
      reason: "ZZ almoço",
    }).$returningId();
    const depois = await capacidadeDoDia(dia, barbeiro.id, settings);
    ok("almoço de 1h tira 60 min da capacidade", antes - depois === 60, `${antes} → ${depois}`);
    await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, blocoId));
  }

  console.log("\n5. Iniciar, concluir e falta: só no dia; falta só depois do horário, e tem volta");
  {
    const [{ dia, livres }] = await diasComVaga(barbeiro.id, corte.durationMin, 1, 1, 2);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: barbeiro.id,
      clientName: "ZZRev4 Dia", clientPhone: FONE(1),
    });
    for (const st of ["EM_ANDAMENTO", "CONCLUIDO", "NO_SHOW"] as const) {
      let msg = "";
      try { await transitionAppointment(appt.id, st); } catch (e) { msg = e instanceof BookingError ? e.message : String(e); }
      ok(`${st} recusado em dia futuro`, /só no dia/.test(msg), msg);
    }
    // Hoje, mas mais tarde: falta ainda não.
    const daqui = new Date(Date.now() + 3 * 3600_000);
    await db.update(appointments).set({ startsAt: daqui, endsAt: new Date(daqui.getTime() + 40 * 60_000) }).where(eq(appointments.id, appt.id));
    let msg = "";
    if (shopToday() === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(daqui)) {
      try { await transitionAppointment(appt.id, "NO_SHOW"); } catch (e) { msg = (e as Error).message; }
      ok("falta antes do horário é recusada", /depois do horário/.test(msg), msg);
    }
    const passou = new Date(Date.now() - 30 * 60_000);
    await db.update(appointments).set({ startsAt: passou, endsAt: new Date(passou.getTime() + 40 * 60_000) }).where(eq(appointments.id, appt.id));
    const falta = await transitionAppointment(appt.id, "NO_SHOW");
    ok("depois do horário, a falta entra", falta.status === "NO_SHOW");
    const volta = await transitionAppointment(appt.id, "CONFIRMADO");
    ok("e dá para desfazer a falta", volta.status === "CONFIRMADO");
    await transitionAppointment(appt.id, "CANCELADO");
  }

  console.log("\n6. Plano: só para o próprio telefone, e com cota do mês");
  {
    const silver = (await db.query.plans.findFirst({ where: eq(plans.slug, "silver") }))!;
    const cota = await db.query.planServices.findFirst({
      where: and(eq(planServices.planId, silver.id), eq(planServices.serviceId, corte.id)),
    });
    ok("o Silver tem cota de 2 cortes por mês", cota?.monthlyQuota === 2, String(cota?.monthlyQuota));

    const [{ id: membroId }] = await db.insert(users).values({ name: "ZZRev4 Membro", phone: FONE(2), role: "CLIENT" }).$returningId();
    await db.insert(subscriptions).values({ userId: membroId, planId: silver.id, renewsAt: new Date(Date.now() + 40 * 86400_000) });

    // Três cortes no mesmo mês.
    const dias = await diasComVaga(barbeiro.id, corte.durationMin, 1, 3);
    const mesmoMes = dias.filter((d) => d.dia.slice(0, 7) === dias[0].dia.slice(0, 7));
    if (mesmoMes.length >= 3) {
      const gerados = [];
      for (const d of mesmoMes.slice(0, 3)) {
        gerados.push(await createBooking({
          serviceIds: [corte.id], dateKey: d.dia, time: d.livres[0], barberId: barbeiro.id,
          clientName: "ZZRev4 Membro", clientPhone: FONE(2), userId: membroId,
        }));
      }
      ok("1º e 2º corte do mês saem pelo plano", gerados[0].kind === "ASSINANTE" && gerados[1].kind === "ASSINANTE");
      ok("o 3º passa da cota e sai cobrado", gerados[2].kind === "AVULSO" && gerados[2].totalCents === corte.priceCents,
        `${gerados[2].kind} ${gerados[2].totalCents}`);
      // Cancelou um: a cota volta.
      await transitionAppointment(gerados[0].id, "CANCELADO");
      const [{ dia: d4, livres: l4 }] = (await diasComVaga(barbeiro.id, corte.durationMin, 2, 6)).filter((d) => d.dia.slice(0, 7) === mesmoMes[0].dia.slice(0, 7)).slice(-1);
      const quarto = await createBooking({
        serviceIds: [corte.id], dateKey: d4, time: l4[l4.length - 1], barberId: barbeiro.id,
        clientName: "ZZRev4 Membro", clientPhone: FONE(2), userId: membroId,
      });
      ok("cancelado não conta na cota", quarto.kind === "ASSINANTE", quarto.kind);
    } else {
      console.log("  – menos de 3 dias com vaga no mesmo mês, cota pulada");
    }

    // Membro logado marcando para outro telefone: não usa o plano.
    const [{ dia, livres }] = await diasComVaga(barbeiro.id, corte.durationMin, 1, 1, 3);
    const amigo = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[livres.length - 1], barberId: barbeiro.id,
      clientName: "ZZRev4 Amigo", clientPhone: FONE(3), userId: membroId,
    });
    ok("membro logado marcando para o amigo não estende o plano", amigo.kind === "AVULSO" && amigo.totalCents > 0, amigo.kind);
    const dono = await db.query.users.findFirst({ where: eq(users.phone, FONE(3)) });
    ok("e o horário fica no cadastro do amigo", amigo.clientUserId === dono?.id && dono?.id !== membroId);
  }

  console.log("\n7. Teto de horários: só na agenda pública");
  {
    const dias = await diasComVaga(barbeiro.id, corte.durationMin, 1, 6, 2);
    let balcao = 0;
    for (const d of dias) {
      await createBooking({
        serviceIds: [corte.id], dateKey: d.dia, time: d.livres[0], barberId: barbeiro.id,
        clientName: "ZZRev4 Balcão", clientPhone: FONE(4),
      });
      balcao++;
    }
    ok("balcão marca 6 horários para o mesmo cliente", balcao === 6);
    let barrado = "";
    try {
      const [{ dia, livres }] = await diasComVaga(barbeiro.id, corte.durationMin, 1, 1, 9);
      await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: livres[livres.length - 1], barberId: barbeiro.id,
        clientName: "ZZRev4 Balcão", clientPhone: FONE(4), publicRequest: true,
      });
    } catch (e) { barrado = (e as Error).message; }
    ok("pelo site, o teto continua valendo", /já tem/.test(barrado), barrado);
  }

  console.log("\n8. Horário fixo: trocar 30 min no mesmo barbeiro não esbarra no antigo");
  {
    const gold = (await db.query.plans.findFirst({ where: eq(plans.slug, "gold") }))!;
    const [{ id: m }] = await db.insert(users).values({ name: "ZZRev4 Fixo", phone: FONE(5), role: "CLIENT" }).$returningId();
    await db.insert(subscriptions).values({ userId: m, planId: gold.id, renewsAt: new Date(Date.now() + 60 * 86400_000) });
    const [{ dia }] = await diasComVaga(barbeiro.id, corte.durationMin, 4, 1, 2);
    const wd = weekdayOf(dia);
    // Um horário em que as próximas semanas estejam livres.
    const minutos = settings.openMinute + 4 * settings.slotMinutes;
    const [{ id: antigo }] = await db.insert(recurringSlots).values({
      userId: m, barberId: barbeiro.id, frequency: "SEMANAL", weekday: wd, minutesOfDay: minutos,
      serviceIds: [corte.id], startsOn: shopToday(),
    }).$returningId();
    const r1 = await materializeRecurring({ slotId: antigo });
    ok("fixo antigo reservou semanas", r1.criados > 0, JSON.stringify(r1.conflitos.slice(0, 2)));
    ok("e reserva até o limite da agenda pública", r1.criados + r1.conflitos.length >= Math.floor(settings.maxAdvanceDays / 7) - 1,
      `${r1.criados} criados, ${r1.conflitos.length} conflitos, janela ${settings.maxAdvanceDays} dias`);
    const ocorr = await ocorrenciasFuturas([antigo]);
    const [{ id: novo }] = await db.insert(recurringSlots).values({
      userId: m, barberId: barbeiro.id, frequency: "SEMANAL", weekday: wd, minutesOfDay: minutos + settings.slotMinutes,
      serviceIds: [corte.id], startsOn: shopToday(),
    }).$returningId();
    const sem = await materializeRecurring({ slotId: novo });
    ok("sem ignorar as semanas antigas, tudo esbarrava", sem.criados === 0);
    const com = await materializeRecurring({ slotId: novo, ignorarAppointmentIds: ocorr });
    ok("ignorando as semanas do fixo antigo, o novo reserva", com.criados > 0, JSON.stringify(com.conflitos.slice(0, 2)));
  }

  console.log("\n9. Plano cancelado pelo site: no vencimento, o fixo sai da agenda");
  {
    const m = (await db.query.users.findFirst({ where: eq(users.phone, FONE(5)) }))!;
    await db.update(subscriptions)
      .set({ canceledAt: new Date(), renewsAt: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.userId, m.id));
    await expireOverdueSubscriptions();
    const ativos = await db.select().from(recurringSlots).where(and(eq(recurringSlots.userId, m.id), eq(recurringSlots.active, true)));
    ok("fixo desligado", ativos.length === 0, String(ativos.length));
    const futuras = await db.select({ id: appointments.id }).from(appointments)
      .where(and(eq(appointments.clientUserId, m.id), inArray(appointments.status, ["PENDENTE", "CONFIRMADO"])));
    ok("semanas reservadas liberadas", futuras.length === 0, String(futuras.length));
  }

  console.log("\n10. Concluído sem comissão: a varredura lança");
  {
    const [{ dia, livres }] = await diasComVaga(barbeiro.id, corte.durationMin, 1, 1, 4);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: barbeiro.id,
      clientName: "ZZRev4 Comissão", clientPhone: FONE(6),
    });
    // Simula a queda entre mudar o status e lançar a comissão.
    await db.update(appointments).set({ status: "CONCLUIDO", startsAt: new Date(Date.now() - 3600_000) }).where(eq(appointments.id, appt.id));
    const n = await lancarComissoesPendentes();
    const com = await db.query.appointmentCommissions.findFirst({ where: eq(appointmentCommissions.appointmentId, appt.id) });
    ok("comissão lançada pela varredura", n >= 1 && !!com, String(n));
  }

  console.log("\n11. Contato da barbearia sem dado de exemplo");
  {
    const vazio = shopFrom({});
    ok("sem telefone cadastrado, nada de número inventado", vazio.phone === "");
    ok("sem endereço cadastrado, nada de endereço inventado", vazio.address === "");
    ok("Instagram vira o link do perfil", instagramUrl("@bryanwesley.barbearia") === "https://instagram.com/bryanwesley.barbearia");
    ok("rodapé segue os dias fechados", rotuloFechado([0, 1]) === "Seg e Dom · Fechado" && rotuloFechado([0]) === "Dom · Fechado" && rotuloFechado([]) === "");
  }

  console.log("\n12. Remarcar para outro barbeiro continua funcionando");
  {
    const outros = await db.select().from(barbers).where(eq(barbers.active, true));
    const b2 = outros.find((b) => b.id !== barbeiro.id);
    if (b2) {
      const [{ dia, livres }] = await diasComVaga(barbeiro.id, corte.durationMin, 1, 1, 5);
      const appt = await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: livres[0], barberId: barbeiro.id,
        clientName: "ZZRev4 Troca", clientPhone: FONE(7),
      });
      const [{ dia: d2, livres: l2 }] = await diasComVaga(b2.id, corte.durationMin, 1, 1, 5);
      const novo = await rescheduleBooking({ appointmentId: appt.id, dateKey: d2, time: l2[0], barberId: b2.id });
      ok("remarcado para o outro barbeiro", novo.barberId === b2.id);
    }
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
