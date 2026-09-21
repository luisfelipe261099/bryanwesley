// Regressão da segunda leva da auditoria.
// Cada bloco reproduz o cenário que estava quebrado antes da correção.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  payments, planServices, plans, rateLimits, recurringSlots,
  services as sv, scheduleBlocks, subscriptions, users,
} from "../db/schema";
import {
  createBooking,
  rescheduleBooking,
  transitionAppointment,
  updateAppointmentServices,
  BookingError,
} from "../lib/appointments";
import { recordCommission } from "../lib/commissions";
import {
  clientDetail,
  memberStats,
  agendaDoPeriodo,
  bloqueiosDoPeriodo,
  dayBounds,
} from "../lib/queries";
import { capacidadeDoDia, gradeDeHorarios, getSettings, getAvailability } from "../lib/schedule";
import { expireOverdueSubscriptions } from "../lib/subscriptions";
import { markFailed, notificationStats, cancelPendingNotifications, queueNotification } from "../lib/notifications";
import { hitRateLimit, purgeRateLimits } from "../lib/rate-limit";
import { parseMoneyToCents } from "../lib/money";
import { safeNext } from "../lib/url";
import { shopToday, addDays, weekdayOf, parseDateKey, shopTimeToUtc } from "../lib/time";
import { and, eq, inArray, like, sql } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZAudit2";

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = gente.map((u) => u.id);
  await db.delete(rateLimits).where(like(rateLimits.chave, "teste:%"));
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

async function diaComVaga(barberId: number, durationMin: number, pular: string[] = []) {
  const settings = await getSettings();
  for (let i = 1; i <= 14; i++) {
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
  const settings = await getSettings();

  console.log("\n1. Preço digitado com ponto não vira 100×");
  {
    ok("199,90 → 19990", parseMoneyToCents("199,90") === 19990);
    ok("199.90 → 19990 (era 1.999.000)", parseMoneyToCents("199.90") === 19990,
      String(parseMoneyToCents("199.90")));
    ok("1.299,00 → 129900", parseMoneyToCents("1.299,00") === 129900);
    ok("1299 → 129900", parseMoneyToCents("1299") === 129900);
    ok("R$ 89,90 → 8990", parseMoneyToCents("R$ 89,90") === 8990);
    ok("1.299 (milhar sem decimal) → 129900", parseMoneyToCents("1.299") === 129900,
      String(parseMoneyToCents("1.299")));
    ok("vazio → 0", parseMoneyToCents("") === 0);
  }

  console.log("\n2. safeNext barra caractere de controle e barra invertida");
  {
    ok("caminho interno passa", safeNext("/cliente") === "/cliente");
    ok("//site.de.fora cai", safeNext("//evil.com") === null);
    ok("TAB no meio cai", safeNext("/\thttps://evil.com") === null);
    ok("LF cai", safeNext("/\nhttps://evil.com") === null);
    ok("CR cai", safeNext("/\rx") === null);
    ok("barra invertida cai", safeNext("/\\/evil.com") === null);
    ok("sem barra inicial cai", safeNext("https://evil.com") === null);
  }

  console.log("\n3. Ocupação usa a capacidade real do dia");
  {
    const aberto = [1, 2, 3, 4, 5, 6, 0].find((d) => !settings.closedWeekdays.includes(d))!;
    let dia = shopToday();
    for (let i = 0; i < 8 && weekdayOf(dia) !== aberto; i++) dia = addDays(dia, 1);
    const daEquipe = await capacidadeDoDia(dia, null, settings);
    const deUm = await capacidadeDoDia(dia, barbeiro.id, settings);
    ok("dia aberto tem capacidade > 0", daEquipe > 0, String(daEquipe));
    ok("com um barbeiro a capacidade é menor ou igual", deUm <= daEquipe && deUm > 0,
      `${deUm} / ${daEquipe}`);
    const fechado = settings.closedWeekdays[0];
    if (fechado !== undefined) {
      let diaF = shopToday();
      for (let i = 0; i < 8 && weekdayOf(diaF) !== fechado; i++) diaF = addDays(diaF, 1);
      ok("dia fechado tem capacidade 0", (await capacidadeDoDia(diaF, null, settings)) === 0);
    } else {
      ok("dia fechado tem capacidade 0", true, "(loja abre todo dia)");
    }
  }

  console.log("\n4. Grade de horários do fixo");
  {
    const grade = gradeDeHorarios(settings);
    ok("começa na abertura", grade[0] === `${String(Math.floor(settings.openMinute / 60)).padStart(2, "0")}:${String(settings.openMinute % 60).padStart(2, "0")}`, grade[0]);
    ok("todos os horários estão na grade", grade.length > 0);
    ok("nenhum passa do fechamento", grade.every((h) => {
      const [hh, mm] = h.split(":").map(Number);
      return hh * 60 + mm < settings.closeMinute;
    }));
  }

  console.log("\n5. Números do membro saem do banco, não da amostra");
  {
    await db.insert(users).values({ name: `${MARCA} Membro`, phone: "11970005001", role: "CLIENT" });
    const membro = (await db.query.users.findFirst({ where: eq(users.phone, "11970005001") }))!;
    const renova = new Date(); renova.setMonth(renova.getMonth() + 1);
    await db.insert(subscriptions).values({ userId: membro.id, planId: gold.id, renewsAt: renova });

    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: membro.name, clientPhone: membro.phone, userId: membro.id,
    });
    await transitionAppointment(appt.id, "EM_ANDAMENTO");
    await transitionAppointment(appt.id, "CONCLUIDO");

    const stats = await memberStats(membro.id, appt.startsAt);
    ok("economia acumulada deixa de ser R$ 0,00", stats.economiaCents === corte.priceCents,
      `${stats.economiaCents} vs ${corte.priceCents}`);
    ok("atendimentos no mês conta o atendimento", stats.atendimentosNoMes >= 1,
      String(stats.atendimentosNoMes));

    const ficha = (await clientDetail(membro.id))!;
    const [{ total }] = await db
      .select({ total: sql<number>`COALESCE(SUM(${appointments.totalCents}), 0)` })
      .from(appointments)
      .where(and(eq(appointments.clientUserId, membro.id), eq(appointments.status, "CONCLUIDO")));
    ok("total gasto na ficha bate com a soma de TODOS os concluídos",
      ficha.gasto === Number(total), `${ficha.gasto} vs ${total}`);
  }

  console.log("\n6. Comissão com cobertura parcial do plano");
  {
    const cobertos = await db.select({ serviceId: planServices.serviceId })
      .from(planServices).where(eq(planServices.planId, gold.id));
    const idsCobertos = cobertos.map((c) => c.serviceId);
    const fora = await db.query.services.findFirst({
      where: and(eq(sv.active, true), sql`${sv.id} not in (${sql.join(idsCobertos.map((i) => sql`${i}`), sql`, `)})`),
    });
    if (!fora) {
      ok("plano cobre tudo — cenário não se aplica", true);
    } else {
      await db.insert(users).values({ name: `${MARCA} Parcial`, phone: "11970005002", role: "CLIENT" });
      const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005002") }))!;
      const renova = new Date(); renova.setMonth(renova.getMonth() + 1);
      await db.insert(subscriptions).values({ userId: cli.id, planId: gold.id, renewsAt: renova });
      const dur = corte.durationMin + fora.durationMin;
      const { dia, hora } = await diaComVaga(barbeiro.id, dur);
      const appt = await createBooking({
        serviceIds: [corte.id, fora.id], dateKey: dia, time: hora, barberId: barbeiro.id,
        clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
      });
      const gravado = (await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) }))!;
      ok("cobertura parcial cobra só o que está fora do plano",
        gravado.totalCents === fora.priceCents, `${gravado.totalCents} vs ${fora.priceCents}`);
      await transitionAppointment(appt.id, "EM_ANDAMENTO");
      await transitionAppointment(appt.id, "CONCLUIDO");
      const com = await db.query.appointmentCommissions.findFirst({
        where: eq(appointmentCommissions.appointmentId, appt.id),
      });
      ok("a comissão soma também o serviço coberto pelo plano",
        !!com && com.baseCents === corte.priceCents + fora.priceCents,
        JSON.stringify(com && { base: com.baseCents, esperado: corte.priceCents + fora.priceCents }));
    }
  }

  console.log("\n7. Remarcar: o novo horário nasce antes de o antigo cair");
  {
    await db.insert(users).values({ name: `${MARCA} Remarca`, phone: "11970005003", role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005003") }))!;
    const a = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: a.dia, time: a.hora, barberId: barbeiro.id,
      clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
    });
    const b = await diaComVaga(barbeiro.id, corte.durationMin, [a.dia]);
    const novo = await rescheduleBooking({
      appointmentId: appt.id, dateKey: b.dia, time: b.hora, barberId: barbeiro.id,
    });
    const velho = (await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) }))!;
    ok("o antigo fica CANCELADO", velho.status === "CANCELADO", velho.status);
    ok("o novo está confirmado", novo.status === "CONFIRMADO", novo.status);
    ok("o preço combinado não muda", novo.totalCents === appt.totalCents,
      `${novo.totalCents} vs ${appt.totalCents}`);
    ok("a confirmação pendente do antigo é derrubada",
      !(await db.query.notifications.findFirst({
        where: and(eq(notifications.appointmentId, appt.id), eq(notifications.status, "PENDENTE")),
      })));
    const aviso = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, novo.id), eq(notifications.kind, "AGENDAMENTO_REMARCADO")),
    });
    ok("o aviso de remarcação diz com quem é", !!aviso && aviso.body.includes(barbeiro.shortName),
      aviso?.body ?? "sem aviso");

    // Remarcar para o MESMO horário: sem ignoreAppointmentId ele conflitava
    // consigo mesmo e a remarcação era recusada.
    const mesmo = await rescheduleBooking({
      appointmentId: novo.id, dateKey: b.dia, time: b.hora, barberId: barbeiro.id,
    });
    ok("remarcar para o próprio horário funciona", mesmo.id !== novo.id,
      `${mesmo.id} / ${novo.id}`);
  }

  console.log("\n8. Cancelar derruba a confirmação que ainda não saiu");
  {
    await db.insert(users).values({ name: `${MARCA} Cancela`, phone: "11970005004", role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005004") }))!;
    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
    });
    const antes = await db.query.notifications.findFirst({
      where: and(eq(notifications.appointmentId, appt.id), eq(notifications.kind, "AGENDAMENTO_CRIADO")),
    });
    ok("a confirmação entra na fila", antes?.status === "PENDENTE", antes?.status);
    await transitionAppointment(appt.id, "CANCELADO");
    const depois = await db.query.notifications.findFirst({
      where: eq(notifications.id, antes!.id),
    });
    ok("cancelando, ela não sai mais", depois?.status === "CANCELADA", depois?.status);
  }

  console.log("\n9. Fila: 'prontas' é o que o botão manda");
  {
    const stats = await notificationStats();
    ok("prontas nunca passa de pendentes", stats.prontas <= stats.pendentes,
      `${stats.prontas} / ${stats.pendentes}`);
    const futura = await db.query.notifications.findFirst({
      where: eq(notifications.status, "PENDENTE"),
      orderBy: (n, { desc }) => [desc(n.scheduledFor)],
    });
    if (futura && futura.scheduledFor.getTime() > Date.now()) {
      ok("lembrete do futuro conta em 'na fila' mas não em 'prontas'",
        stats.pendentes > stats.prontas, `${stats.pendentes} / ${stats.prontas}`);
    } else {
      ok("lembrete do futuro conta em 'na fila' mas não em 'prontas'", true, "(fila sem futuros)");
    }
  }

  console.log("\n10. Falha definitiva não inventa 100 tentativas");
  {
    const alvo = await db.query.appointments.findFirst();
    const [{ id }] = await db.insert(notifications).values({
      appointmentId: alvo?.id ?? null, phone: "11900000000", kind: "AGENDAMENTO_CRIADO",
      body: "teste tentativa", scheduledFor: new Date(),
    }).$returningId();
    await markFailed(id, "número inválido", 0, true);
    const n = (await db.query.notifications.findFirst({ where: eq(notifications.id, id) }))!;
    ok("erro definitivo marca ERRO", n.status === "ERRO", n.status);
    ok("e conta UMA tentativa, não 100", n.attempts === 1, String(n.attempts));
    await markFailed(id, "timeout", n.attempts, false);
    const n2 = (await db.query.notifications.findFirst({ where: eq(notifications.id, id) }))!;
    ok("erro passageiro volta para a fila", n2.status === "PENDENTE" && n2.attempts === 2,
      `${n2.status}/${n2.attempts}`);
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  console.log("\n11. Cancelamento pedido pelo cliente encerra no fim do ciclo");
  {
    await db.insert(users).values({ name: `${MARCA} Saiu`, phone: "11970005005", role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005005") }))!;
    const ontem = new Date(Date.now() - 86400_000);
    await db.insert(subscriptions).values({
      userId: cli.id, planId: gold.id, renewsAt: ontem, canceledAt: new Date(),
    });
    await expireOverdueSubscriptions();
    const sub = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, cli.id) }))!;
    ok("quem avisou que saía vira CANCELADA, não INADIMPLENTE",
      sub.status === "CANCELADA", sub.status);

    await db.insert(users).values({ name: `${MARCA} Devendo`, phone: "11970005006", role: "CLIENT" });
    const cli2 = (await db.query.users.findFirst({ where: eq(users.phone, "11970005006") }))!;
    await db.insert(subscriptions).values({ userId: cli2.id, planId: gold.id, renewsAt: ontem });
    await expireOverdueSubscriptions();
    const sub2 = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, cli2.id) }))!;
    ok("quem só venceu continua INADIMPLENTE", sub2.status === "INADIMPLENTE", sub2.status);
  }

  console.log("\n12. Freio da agenda pública");
  {
    const chave = "teste:freio";
    let ultimo = await hitRateLimit(chave, 3, 60_000);
    ok("primeiro uso passa", ultimo.ok);
    await hitRateLimit(chave, 3, 60_000);
    ultimo = await hitRateLimit(chave, 3, 60_000);
    ok("dentro do teto passa", ultimo.ok);
    ultimo = await hitRateLimit(chave, 3, 60_000);
    ok("passando do teto, barra", !ultimo.ok);
    ok("e diz quanto falta", !ultimo.ok && ultimo.retryInMs > 0 && ultimo.retryInMs <= 60_000,
      JSON.stringify(ultimo));
    // Janela vencida recomeça a contagem.
    await db.update(rateLimits)
      .set({ windowStart: new Date(Date.now() - 120_000) })
      .where(eq(rateLimits.chave, chave));
    ultimo = await hitRateLimit(chave, 3, 60_000);
    ok("janela vencida libera de novo", ultimo.ok);
    await purgeRateLimits(new Date(Date.now() + 1000));
    ok("a limpeza apaga as janelas antigas",
      !(await db.query.rateLimits.findFirst({ where: eq(rateLimits.chave, chave) })));
  }

  console.log("\n13. Trocar os serviços de um atendimento marcado");
  {
    await db.insert(users).values({ name: `${MARCA} Troca`, phone: "11970005007", role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005007") }))!;
    const extra = (await db.query.services.findFirst({
      where: and(eq(sv.active, true), sql`${sv.id} <> ${corte.id}`),
    }))!;
    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin + extra.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
    });
    const novo = await updateAppointmentServices({
      appointmentId: appt.id,
      serviceIds: [corte.id, extra.id],
    });
    ok("o valor é refeito com o serviço novo",
      novo.totalCents === corte.priceCents + extra.priceCents,
      `${novo.totalCents} vs ${corte.priceCents + extra.priceCents}`);
    ok("a duração acompanha",
      novo.durationMin === corte.durationMin + extra.durationMin,
      String(novo.durationMin));
    ok("o fim do atendimento é recalculado",
      novo.endsAt.getTime() === novo.startsAt.getTime() + novo.durationMin * 60_000);
    const itens = await db.select().from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, appt.id));
    ok("o snapshot de serviços é reescrito", itens.length === 2, String(itens.length));
    ok("o código do agendamento não muda", novo.code === appt.code);

    // Não pode invadir o horário seguinte da mesma cadeira: marca o
    // próximo horário livre do mesmo barbeiro, no mesmo dia.
    const { slots } = await getAvailability({
      dateKey: dia, durationMin: corte.durationMin, barberId: barbeiro.id,
    });
    const seguinte = slots.find((x) => x.available && x.time > hora);
    if (!seguinte) {
      ok("recusa quando passa por cima do próximo horário", true, "(dia sem horário seguinte livre)");
    } else {
      const depois = await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: seguinte.time,
        barberId: barbeiro.id, clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
      });
      let recusou = false;
      try {
        const gordo = await db.query.services.findMany({ where: eq(sv.active, true) });
        await updateAppointmentServices({
          appointmentId: appt.id,
          serviceIds: gordo.map((g) => g.id),
        });
      } catch (e) {
        recusou = e instanceof BookingError;
      }
      ok("recusa quando passa por cima do próximo horário", recusou);
      await transitionAppointment(depois.id, "CANCELADO");
    }

    // Nem por cima de um bloqueio.
    {
      const { year, month, day } = parseDateKey(dia);
      const [h, m] = hora.split(":").map(Number);
      const depoisDoInicio = h * 60 + m + corte.durationMin;
      const [{ id: bid }] = await db.insert(scheduleBlocks).values({
        startsAt: shopTimeToUtc(year, month, day, depoisDoInicio),
        endsAt: shopTimeToUtc(year, month, day, depoisDoInicio + 60),
        reason: `${MARCA} bloqueio`,
      }).$returningId();
      let barrouBloqueio = false;
      try {
        await updateAppointmentServices({
          appointmentId: appt.id,
          serviceIds: [corte.id, extra.id],
        });
      } catch (e) {
        barrouBloqueio = e instanceof BookingError && /bloqueado/i.test((e as Error).message);
      }
      ok("recusa quando o serviço novo entra num bloqueio", barrouBloqueio);
      await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, bid));
    }

    // Atendimento encerrado não muda mais.
    await transitionAppointment(appt.id, "CANCELADO");
    let barrou = false;
    try {
      await updateAppointmentServices({ appointmentId: appt.id, serviceIds: [corte.id] });
    } catch (e) {
      barrou = e instanceof BookingError;
    }
    ok("atendimento encerrado não aceita troca de serviço", barrou);
  }

  console.log("\n14. Bloqueios entram na agenda do painel");
  {
    const { dia } = await diaComVaga(barbeiro.id, corte.durationMin);
    const { year, month, day } = parseDateKey(dia);
    const inicio = shopTimeToUtc(year, month, day, 12 * 60);
    const fim = shopTimeToUtc(year, month, day, 13 * 60);
    const [{ id }] = await db.insert(scheduleBlocks).values({
      startsAt: inicio, endsAt: fim, reason: `${MARCA} almoço`,
    }).$returningId();
    const lista = await bloqueiosDoPeriodo(dayBounds(dia).start, dayBounds(dia).end, null);
    ok("o bloqueio aparece no período", lista.some((b) => b.id === id));
    ok("com motivo e sem barbeiro (loja toda)",
      lista.find((b) => b.id === id)?.reason === `${MARCA} almoço` &&
      lista.find((b) => b.id === id)?.barberName === null);
    const deOutroBarbeiro = await bloqueiosDoPeriodo(
      dayBounds(dia).start, dayBounds(dia).end, barbeiro.id
    );
    ok("bloqueio da loja aparece mesmo filtrando um barbeiro",
      deOutroBarbeiro.some((b) => b.id === id));
    await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, id));
  }

  console.log("\n15. Busca da agenda acha pelo código");
  {
    await db.insert(users).values({ name: `${MARCA} Codigo`, phone: "11970005008", role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, "11970005008") }))!;
    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
    });
    const achados = await agendaDoPeriodo({
      de: dayBounds(dia).start, ate: dayBounds(dia).end, busca: appt.code,
    });
    ok("procurar pelo código devolve o agendamento",
      achados.some((a) => a.id === appt.id), appt.code);
    const porNome = await agendaDoPeriodo({
      de: dayBounds(dia).start, ate: dayBounds(dia).end, busca: "Codigo",
    });
    ok("e procurar pelo nome continua funcionando",
      porNome.some((a) => a.id === appt.id));
    const porTelefone = await agendaDoPeriodo({
      de: dayBounds(dia).start, ate: dayBounds(dia).end, busca: "70005008",
    });
    ok("e pelo telefone também", porTelefone.some((a) => a.id === appt.id));
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
