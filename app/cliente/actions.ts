"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  recurringSlots,
  subscriptions,
  users,
  plans,
  planRequests,
  planServices,
} from "@/db/schema";
import { cookies } from "next/headers";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth";
import { SESSION_COOKIE, signSession, sessionCookieOptions } from "@/lib/auth/session";
import {
  transitionAppointment,
  rescheduleBooking,
  BookingError,
} from "@/lib/appointments";
import { chargeSubscription, isInfinitePayConfigured } from "@/lib/payments";
import { materializeRecurring, cancelFutureOccurrences } from "@/lib/recurring";
import { getSettings } from "@/lib/schedule";
import { shopToday, minutesToHHMM } from "@/lib/time";

export type ActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/** O cliente só pode cancelar o próprio horário, e com antecedência. */
export async function cancelMyAppointment(
  appointmentId: number
): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };

  if (session.role !== "ADMIN" && appt.clientUserId !== session.id) {
    return { ok: false, error: "Esse agendamento não é seu." };
  }

  const duasHoras = 2 * 3600_000;
  if (
    session.role !== "ADMIN" &&
    appt.startsAt.getTime() - Date.now() < duasHoras
  ) {
    return {
      ok: false,
      error:
        "Faltam menos de 2h para o horário. Fale com a barbearia pelo WhatsApp.",
    };
  }

  try {
    await transitionAppointment(appointmentId, "CANCELADO");
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return { ok: true };
}

// ───────────────────────── Horário fixo ─────────────────────────

/** O membro reserva o mesmo dia/hora toda semana ou todo mês. */
export async function saveRecurringSlot(input: {
  barberId: number;
  frequency: "SEMANAL" | "MENSAL";
  weekday: number | null;
  dayOfMonth: number | null;
  minutesOfDay: number;
  serviceIds: number[];
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      eq(subscriptions.status, "ATIVA")
    ),
  });
  if (!sub) {
    return { ok: false, error: "O horário fixo é um benefício de quem assina." };
  }
  if (input.serviceIds.length === 0) {
    return { ok: false, error: "Escolha ao menos um serviço." };
  }

  // O que o plano cobre é decidido no servidor. A tela só oferece os
  // serviços do plano, mas a ação era aceita com qualquer id — dava para
  // reservar toda semana um serviço que o plano não paga.
  const cobertos = await db
    .select({ serviceId: planServices.serviceId })
    .from(planServices)
    .where(eq(planServices.planId, sub.planId));
  const cobertosIds = cobertos.map((c) => c.serviceId);
  const fora = input.serviceIds.filter((id) => !cobertosIds.includes(id));
  if (fora.length > 0) {
    return {
      ok: false,
      error:
        "O horário fixo só reserva os serviços do seu plano. Para o resto, marque avulso.",
    };
  }

  // Grade e jornada: o campo de hora é livre, e um fixo às 10:07 nunca
  // aparecia na agenda de ninguém — materializava fora da grade e ficava
  // invisível para quem procura horário.
  const cfg = await getSettings();
  const { minutesOfDay: hora } = input;
  if (
    hora < cfg.openMinute ||
    hora >= cfg.closeMinute ||
    (hora - cfg.openMinute) % cfg.slotMinutes !== 0
  ) {
    return {
      ok: false,
      error: `Escolha um horário da grade, de ${minutesToHHMM(cfg.openMinute)} às ${minutesToHHMM(cfg.closeMinute)}, de ${cfg.slotMinutes} em ${cfg.slotMinutes} minutos.`,
    };
  }
  if (input.frequency === "SEMANAL") {
    if (input.weekday === null || input.weekday < 0 || input.weekday > 6) {
      return { ok: false, error: "Escolha o dia da semana." };
    }
    if (cfg.closedWeekdays.includes(input.weekday)) {
      return { ok: false, error: "A barbearia não abre nesse dia da semana." };
    }
  } else if (
    input.dayOfMonth === null ||
    input.dayOfMonth < 1 ||
    input.dayOfMonth > 28
  ) {
    return { ok: false, error: "Escolha um dia do mês entre 1 e 28." };
  }

  // Um fixo por membro: salvar substitui o anterior. Mas o anterior só sai
  // depois que o novo estiver garantido — antes o sistema desligava o fixo
  // antigo e cancelava as semanas já reservadas ANTES de saber se o novo
  // horário cabia, e o membro que tentasse um horário ocupado terminava
  // sem fixo nenhum e sem os agendamentos que já tinha.
  const antigos = await db
    .select()
    .from(recurringSlots)
    .where(
      and(eq(recurringSlots.userId, session.id), eq(recurringSlots.active, true))
    );

  // Mesmo dia, mesma hora, mesmo barbeiro: é o fixo que ele já tem, só com
  // outros serviços. Recriar aqui faria as próprias semanas dele
  // aparecerem como "horário ocupado".
  const mesmoHorario = antigos.find(
    (a) =>
      a.barberId === input.barberId &&
      a.frequency === input.frequency &&
      a.minutesOfDay === input.minutesOfDay &&
      (input.frequency === "SEMANAL"
        ? a.weekday === input.weekday
        : a.dayOfMonth === input.dayOfMonth)
  );
  if (mesmoHorario) {
    await db
      .update(recurringSlots)
      .set({ serviceIds: input.serviceIds })
      .where(eq(recurringSlots.id, mesmoHorario.id));
    revalidatePath("/cliente");
    return { ok: true };
  }

  const [{ id: novoId }] = await db.insert(recurringSlots).values({
    userId: session.id,
    barberId: input.barberId,
    frequency: input.frequency,
    weekday: input.frequency === "SEMANAL" ? input.weekday : null,
    dayOfMonth: input.frequency === "MENSAL" ? input.dayOfMonth : null,
    minutesOfDay: input.minutesOfDay,
    serviceIds: input.serviceIds,
    startsOn: shopToday(),
  }).$returningId();

  // Já deixa os próximos horários garantidos na agenda — só deste fixo.
  // Com o fixo antigo ainda de pé, o horário dele aparece ocupado: as
  // ocorrências do próprio membro não contam como conflito.
  const idsAntigos = antigos.map((a) => a.id);
  const report = await materializeRecurring({ slotId: novoId });

  if (
    report.criados === 0 &&
    report.jaExistiam === 0 &&
    report.conflitos.length === 0
  ) {
    // Nenhuma data, nenhum conflito: o fixo não reservaria nada nas
    // próximas semanas e ficaria de enfeite na tela, "ativo" e vazio.
    await db
      .update(recurringSlots)
      .set({ active: false })
      .where(eq(recurringSlots.id, novoId));
    revalidatePath("/cliente");
    return {
      ok: false,
      error:
        "Esse horário não gera reservas nas próximas semanas. Confira o dia escolhido.",
    };
  }

  if (report.criados === 0 && report.conflitos.length > 0) {
    // Nenhuma data coube: descarta só o fixo NOVO e devolve o membro ao
    // estado em que ele estava — com o fixo antigo e as semanas dele.
    await db
      .update(recurringSlots)
      .set({ active: false })
      .where(eq(recurringSlots.id, novoId));
    revalidatePath("/cliente");
    return {
      ok: false,
      error: `Esse horário não está livre: ${report.conflitos[0].motivo} Escolha outro. Seu horário fixo atual continua valendo.`,
    };
  }

  // Deu certo: agora sim o antigo sai e devolve as semanas dele à agenda.
  if (idsAntigos.length > 0) {
    await db
      .update(recurringSlots)
      .set({ active: false })
      .where(inArray(recurringSlots.id, idsAntigos));
    await cancelFutureOccurrences(idsAntigos);
  }

  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");

  if (report.conflitos.length > 0) {
    // Parte das semanas coube, parte não: o membro precisa saber quais
    // datas ficaram de fora em vez de achar que está tudo reservado.
    const dias = report.conflitos.map(
      (c) => `${c.dateKey.slice(8, 10)}/${c.dateKey.slice(5, 7)}`
    );
    return {
      ok: true,
      warning: `Fixo salvo, mas ${dias.length === 1 ? "o dia" : "os dias"} ${dias.join(", ")} já ${dias.length === 1 ? "estava ocupado" : "estavam ocupados"}. Marque avulso nessas datas.`,
    };
  }
  return { ok: true };
}

export async function cancelRecurringSlot(): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  const ativos = await db
    .select({ id: recurringSlots.id })
    .from(recurringSlots)
    .where(
      and(eq(recurringSlots.userId, session.id), eq(recurringSlots.active, true))
    );
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(
      and(
        eq(recurringSlots.userId, session.id),
        eq(recurringSlots.active, true)
      )
    );
  // Abrir mão do fixo libera as semanas que já estavam na agenda: senão o
  // barbeiro segue bloqueado por um fixo que não existe mais.
  const liberados = await cancelFutureOccurrences(ativos.map((a) => a.id));
  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return {
    ok: true,
    warning:
      liberados > 0
        ? `${liberados} horário(s) futuro(s) do fixo liberado(s).`
        : undefined,
  };
}

// ───────────────────────── Minha conta ─────────────────────────

export async function changeMyPassword(input: {
  current: string;
  next: string;
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN", "BARBER"]);
  if (input.next.trim().length < 6) {
    return { ok: false, error: "A nova senha precisa ter ao menos 6 caracteres." };
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, session.id) });
  if (!user?.passwordHash) return { ok: false, error: "Conta sem senha definida." };
  const ok = await verifyPassword(input.current, user.passwordHash);
  if (!ok) return { ok: false, error: "Senha atual incorreta." };
  // Versão nova derruba as outras sessões desta conta (celular antigo,
  // computador da barbearia). A sessão atual ganha um cookie novo e segue.
  const v = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.next.trim()), tokenVersion: v })
    .where(eq(users.id, session.id));
  cookies().set(
    SESSION_COOKIE,
    await signSession({ ...session, v }),
    sessionCookieOptions
  );
  return { ok: true };
}

// ───────────────────────── Remarcar ─────────────────────────

export async function rescheduleMyAppointment(input: {
  appointmentId: number;
  dateKey: string;
  time: string;
  barberId: number | null;
}): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, input.appointmentId),
  });
  if (!appt) return { ok: false, error: "Agendamento não encontrado." };
  if (session.role !== "ADMIN" && appt.clientUserId !== session.id) {
    return { ok: false, error: "Esse agendamento não é seu." };
  }
  if (
    session.role !== "ADMIN" &&
    appt.startsAt.getTime() - Date.now() < 2 * 3600_000
  ) {
    return {
      ok: false,
      error: "Faltam menos de 2h. Fale com a barbearia pelo WhatsApp.",
    };
  }

  try {
    await rescheduleBooking(input);
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/cliente");
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  return { ok: true };
}

// ───────────────────────── Assinar ─────────────────────────

export type SubscribeResult =
  | { ok: true; mode: "pedido" }
  | { ok: true; mode: "pagamento"; url: string }
  | { ok: false; error: string };

/**
 * O cliente pede o plano pelo site. Com cobrança online configurada,
 * devolve o link de pagamento; senão registra a solicitação e avisa o
 * admin, que ativa no painel.
 */
export async function requestPlan(input: {
  planId: number;
  cycle: "MENSAL" | "ANUAL";
}): Promise<SubscribeResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const plan = await db.query.plans.findFirst({
    where: and(eq(plans.id, input.planId), eq(plans.active, true)),
  });
  if (!plan) return { ok: false, error: "Esse plano não está disponível." };

  const ativa = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      eq(subscriptions.status, "ATIVA")
    ),
  });
  if (ativa) {
    return {
      ok: false,
      error: "Você já tem um plano ativo. Fale com a barbearia para trocar.",
    };
  }

  // Pedido em aberto do mesmo cliente é atualizado, não ignorado: antes,
  // quem pedia Silver e depois voltava para pedir Gold recebia "pedido
  // registrado" e a barbearia ativava o Silver do primeiro pedido.
  const aberta = await db.query.planRequests.findFirst({
    where: and(
      eq(planRequests.userId, session.id),
      eq(planRequests.status, "ABERTA")
    ),
  });
  if (aberta) {
    await db
      .update(planRequests)
      .set({ planId: plan.id, cycle: input.cycle })
      .where(eq(planRequests.id, aberta.id));
  } else {
    await db.insert(planRequests).values({
      userId: session.id,
      planId: plan.id,
      cycle: input.cycle,
    });
  }

  if (isInfinitePayConfigured()) {
    // Cria a assinatura inadimplente e cobra o primeiro ciclo: o webhook
    // ativa quando o pagamento cair.
    // Quem já teve assinatura tem uma linha antiga guardada. Ela precisa
    // receber o plano e o ciclo escolhidos agora: a cobrança e a baixa do
    // pagamento leem justamente essa linha, então sem isto o cliente pedia
    // Gold anual e recebia o link — e o plano — do Silver mensal antigo.
    const existente = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, session.id),
      orderBy: (s, { desc }) => [desc(s.startedAt)],
    });
    let novaId: number | null = null;
    if (existente) {
      await db
        .update(subscriptions)
        .set({
          planId: plan.id,
          cycle: input.cycle,
          status: "INADIMPLENTE",
          renewsAt: new Date(),
          canceledAt: null,
        })
        .where(eq(subscriptions.id, existente.id));
    } else {
      const [{ id }] = await db.insert(subscriptions).values({
        userId: session.id,
        planId: plan.id,
        cycle: input.cycle,
        status: "INADIMPLENTE",
        renewsAt: new Date(),
      }).$returningId();
      novaId = id;
    }
    const charge = await chargeSubscription(session.id, input.cycle);
    if (charge.ok) {
      revalidatePath("/cliente");
      return { ok: true, mode: "pagamento", url: charge.url };
    }

    // O link não saiu (provedor fora do ar, chave errada): desfaz a
    // assinatura que só existia para pendurar a cobrança. Deixá-la de pé
    // marcava o cliente como inadimplente de um plano que ele nunca teve,
    // e o painel do Clube passava a cobrar dele.
    if (novaId) {
      await db.delete(subscriptions).where(eq(subscriptions.id, novaId));
    } else if (existente) {
      await db
        .update(subscriptions)
        .set({
          planId: existente.planId,
          cycle: existente.cycle,
          status: existente.status,
          renewsAt: existente.renewsAt,
          canceledAt: existente.canceledAt,
        })
        .where(eq(subscriptions.id, existente.id));
    }
  }

  revalidatePath("/cliente");
  revalidatePath("/admin");
  return { ok: true, mode: "pedido" };
}

/**
 * O cliente cancela o próprio plano — o site promete isso desde a
 * vitrine ("cancele quando quiser"), e não havia botão nenhum: ele
 * dependia de pedir pelo WhatsApp.
 *
 * Cancela para o fim do ciclo: o mês já foi pago, então os benefícios
 * valem até a data de renovação e a varredura encerra a assinatura lá.
 */
export async function cancelMyPlan(): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"])
    ),
    orderBy: (s, { desc }) => [desc(s.startedAt)],
  });
  if (!sub) return { ok: false, error: "Você não tem plano ativo." };

  if (sub.status === "INADIMPLENTE") {
    // Vencida e não paga: encerra na hora, não há ciclo pago a respeitar.
    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
    await soltarMeuFixo(session.id);
    revalidatePath("/cliente");
    revalidatePath("/admin");
    return { ok: true, warning: "Plano encerrado." };
  }

  if (sub.canceledAt) {
    return { ok: false, error: "Seu cancelamento já está agendado." };
  }
  await db
    .update(subscriptions)
    .set({ canceledAt: new Date() })
    .where(eq(subscriptions.id, sub.id));
  revalidatePath("/cliente");
  revalidatePath("/admin");
  const dia = sub.renewsAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  return {
    ok: true,
    warning: `Cancelamento agendado. Você continua membro até ${dia}.`,
  };
}

/** Mudou de ideia antes de o ciclo virar. */
export async function resumeMyPlan(): Promise<ActionResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      eq(subscriptions.status, "ATIVA")
    ),
  });
  if (!sub?.canceledAt) {
    return { ok: false, error: "Não há cancelamento agendado." };
  }
  await db
    .update(subscriptions)
    .set({ canceledAt: null })
    .where(eq(subscriptions.id, sub.id));
  revalidatePath("/cliente");
  revalidatePath("/admin");
  return { ok: true, warning: "Assinatura mantida." };
}

/** Gera de novo o link de pagamento de quem está vencido. */
export async function payMyPlan(): Promise<SubscribeResult> {
  const session = await requireRole(["CLIENT", "ADMIN"]);
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, session.id),
      inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"])
    ),
    orderBy: (s, { desc }) => [desc(s.startedAt)],
  });
  if (!sub) return { ok: false, error: "Você não tem plano para pagar." };
  if (!isInfinitePayConfigured()) {
    return {
      ok: false,
      error: "Pagamento online ainda não está ligado. Acerte na barbearia.",
    };
  }
  const charge = await chargeSubscription(session.id, sub.cycle);
  if (!charge.ok) return { ok: false, error: charge.error };
  revalidatePath("/cliente");
  return { ok: true, mode: "pagamento", url: charge.url };
}

/** Sem plano, o horário fixo sai da agenda e a cadeira volta a ser vendida. */
async function soltarMeuFixo(userId: number) {
  const ativos = await db
    .select({ id: recurringSlots.id })
    .from(recurringSlots)
    .where(and(eq(recurringSlots.userId, userId), eq(recurringSlots.active, true)));
  if (ativos.length === 0) return;
  await db
    .update(recurringSlots)
    .set({ active: false })
    .where(and(eq(recurringSlots.userId, userId), eq(recurringSlots.active, true)));
  await cancelFutureOccurrences(ativos.map((a) => a.id));
}
