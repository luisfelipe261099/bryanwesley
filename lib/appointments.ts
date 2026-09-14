// ───────────────────────────────────────────────────────────
// Criação e transições de estado dos agendamentos.
// A prevenção de horário duplicado é da constraint de exclusão
// no banco; aqui traduzimos a violação para uma mensagem humana.
// ───────────────────────────────────────────────────────────
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  appointmentServices,
  barbers,
  bookingLocks,
  services as servicesTable,
  subscriptions,
  users,
  planServices,
} from "@/db/schema";
import { sql as rawSql } from "drizzle-orm";
import { getAvailability, getSettings, generateCode } from "./schedule";
import { resolveBarberPct, recordCommission } from "./commissions";
import {
  queueBookingNotifications,
  queueNotification,
  cancelPendingNotifications,
} from "./notifications";
import { randomBytes } from "node:crypto";
import { shopTimeToUtc, parseDateKey } from "./time";
import { normalizePhone } from "./phone";

/** MySQL: chave duplicada (unicidade). */
const DUP_ENTRY = "ER_DUP_ENTRY";

// Teto de horários futuros em aberto por telefone. A agenda é pública:
// sem teto, uma pessoa (ou um script) reserva o dia inteiro e trava a
// barbearia. Quem assina marca mais vezes, então tem folga maior.
const MAX_ABERTOS_AVULSO = 4;
const MAX_ABERTOS_ASSINANTE = 12;

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingError";
  }
}

export type CreateBookingInput = {
  serviceIds: number[];
  dateKey: string;
  time: string; // "HH:MM"
  barberId?: number | null;
  clientName: string;
  clientPhone: string;
  notes?: string;
  /** Sessão do cliente, quando logado. */
  userId?: number | null;
  /**
   * Horário fixo materializado pelo sistema: não manda a confirmação
   * imediata (o membro já sabe), só os lembretes.
   */
  fromRecurring?: boolean;
  /** Remarcação: a mensagem certa é "remarcado", não "criado". */
  skipConfirmation?: boolean;
};

export async function createBooking(input: CreateBookingInput) {
  const settings = await getSettings();
  if (!settings.acceptingBookings) {
    throw new BookingError(
      "A agenda está temporariamente fechada para novos agendamentos."
    );
  }

  if (input.serviceIds.length === 0) {
    throw new BookingError("Escolha ao menos um serviço.");
  }

  const chosen = await db.query.services.findMany({
    where: and(
      inArray(servicesTable.id, input.serviceIds),
      eq(servicesTable.active, true)
    ),
  });
  if (chosen.length !== input.serviceIds.length) {
    throw new BookingError("Algum serviço escolhido não está mais disponível.");
  }

  const durationMin = chosen.reduce((acc, s) => acc + s.durationMin, 0);
  const phone = normalizePhone(input.clientPhone);

  // Assinatura ativa cobre os serviços do plano — nesse caso não há cobrança.
  const subscription = input.userId
    ? await db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.userId, input.userId),
          eq(subscriptions.status, "ATIVA")
        ),
      })
    : undefined;

  let coveredIds = new Set<number>();
  if (subscription) {
    const covers = await db.query.planServices.findMany({
      where: eq(planServices.planId, subscription.planId),
    });
    coveredIds = new Set(covers.map((c) => c.serviceId));
  }
  const allCovered =
    !!subscription && chosen.every((s) => coveredIds.has(s.id));

  // Horário fixo é materializado pelo próprio sistema (5 semanas de uma
  // vez): ele não passa pelo teto, senão o benefício se auto-bloqueia.
  if (!input.fromRecurring) {
    const teto = subscription ? MAX_ABERTOS_ASSINANTE : MAX_ABERTOS_AVULSO;
    const abertos = await db
      .select({ total: rawSql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientPhone, phone),
          inArray(appointments.status, ["PENDENTE", "CONFIRMADO"]),
          gt(appointments.startsAt, new Date())
        )
      );
    if (Number(abertos[0]?.total ?? 0) >= teto) {
      throw new BookingError(
        `Você já tem ${teto} horários marcados. Cancele um antes de marcar outro ou fale com a barbearia.`
      );
    }
  }

  const totalCents = allCovered
    ? 0
    : chosen.reduce(
        (acc, s) => acc + (coveredIds.has(s.id) ? 0 : s.priceCents),
        0
      );

  // Confere a disponibilidade e resolve "mais rápido" para um barbeiro real.
  const availability = await getAvailability({
    dateKey: input.dateKey,
    durationMin,
    barberId: input.barberId ?? null,
    settings,
  });
  if (availability.closed) {
    throw new BookingError("A barbearia não abre nesse dia.");
  }
  const slot = availability.slots.find((s) => s.time === input.time);
  if (!slot) {
    throw new BookingError("Horário fora da jornada de atendimento.");
  }
  if (!slot.available) {
    throw new BookingError(
      slot.reason === "antecedencia"
        ? `Esse horário exige ao menos ${settings.minAdvanceHours}h de antecedência.`
        : "Esse horário acabou de ser preenchido. Escolha outro."
    );
  }

  const barberId = input.barberId ?? slot.barberIds[0];
  if (!barberId) throw new BookingError("Nenhum barbeiro livre nesse horário.");

  const barber = await db.query.barbers.findFirst({
    where: and(eq(barbers.id, barberId), eq(barbers.active, true)),
  });
  if (!barber) throw new BookingError("Barbeiro indisponível.");

  const { year, month, day } = parseDateKey(input.dateKey);
  const startsAt = shopTimeToUtc(year, month, day, slot.minutes);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  // Cliente sem conta vira um registro "leve": dá pra reconhecê-lo na
  // próxima visita e ele pode assumir a conta depois definindo senha.
  let clientUserId = input.userId ?? null;
  if (!clientUserId) {
    const existing = await db.query.users.findFirst({
      where: eq(users.phone, phone),
    });
    if (existing) {
      clientUserId = existing.id;
    } else {
      const [{ id }] = await db
        .insert(users)
        .values({ name: input.clientName.trim(), phone, role: "CLIENT" })
        .$returningId();
      clientUserId = id;
    }
  }

  // Percentual do barbeiro congelado agora: se a meta dele mudar depois,
  // este atendimento mantém a divisão combinada no dia.
  const { pct: barberPct } = await resolveBarberPct(barberId);

  // Poucas tentativas cobrem a colisão rara do código de 6 letras.
  for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const appt = await db.transaction(async (tx) => {
      // Trava por (barbeiro, dia): serializa as reservas concorrentes.
      // Funciona igual em Postgres e MySQL/TiDB.
      // INSERT ... ON DUPLICATE KEY UPDATE sem efeito = "cria se não existir".
      await tx
        .insert(bookingLocks)
        .values({ barberId, dateKey: input.dateKey })
        .onDuplicateKeyUpdate({ set: { dateKey: rawSql`${bookingLocks.dateKey}` } });
      await tx.execute(
        rawSql`SELECT 1 FROM booking_locks WHERE barber_id = ${barberId} AND date_key = ${input.dateKey} FOR UPDATE`
      );

      // Reconfere o horário já dentro da trava — quem entrou antes ganhou.
      // FOR UPDATE é obrigatório aqui: no TiDB (transação pessimista) um
      // SELECT comum lê o snapshot tirado no BEGIN, ou seja, de ANTES de
      // esperarmos a trava — e não enxergaria a reserva que a outra
      // transação acabou de gravar. A leitura com trava vê o dado atual.
      // No InnoDB tanto faz (o snapshot nasce na primeira leitura), e o
      // teste de corrida local passa dos dois jeitos — por isso o cuidado.
      const [clash] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.barberId, barberId),
            inArray(appointments.status, [
              "PENDENTE",
              "CONFIRMADO",
              "EM_ANDAMENTO",
              "CONCLUIDO",
            ]),
            // Operadores tipados: o Drizzle serializa o Date pelo tipo da coluna.
            lt(appointments.startsAt, endsAt),
            gt(appointments.endsAt, startsAt)
          )
        )
        .limit(1)
        .for("update");
      if (clash) {
        throw new BookingError(
          "Esse horário acabou de ser reservado por outra pessoa. Escolha outro."
        );
      }

      const [{ id: createdId }] = await tx
        .insert(appointments)
        .values({
          code: generateCode(),
          checkinToken: randomBytes(16).toString("hex"),
          clientUserId,
          clientName: input.clientName.trim(),
          clientPhone: phone,
          barberId,
          startsAt,
          endsAt,
          durationMin,
          totalCents,
          status: "CONFIRMADO",
          kind: allCovered ? "ASSINANTE" : "AVULSO",
          subscriptionId: allCovered ? subscription!.id : null,
          barberPctSnapshot: barberPct,
          notes: input.notes?.trim() || null,
        })
        .$returningId();

      await tx.insert(appointmentServices).values(
        chosen.map((s) => ({
          appointmentId: createdId,
          serviceId: s.id,
          name: s.name,
          priceCents: coveredIds.has(s.id) ? 0 : s.priceCents,
          durationMin: s.durationMin,
        }))
      );

      const created = await tx.query.appointments.findFirst({
        where: eq(appointments.id, createdId),
      });
      if (!created) throw new Error("Agendamento gravado mas não relido.");
      return created;
    });

    // Confirmação + lembretes. Falha de notificação não derruba o
    // agendamento: o horário já está garantido.
    try {
      await queueBookingNotifications(appt, barber.shortName, {
        skipConfirmation: !!input.fromRecurring || !!input.skipConfirmation,
      });
    } catch (e) {
      console.error("Falha ao enfileirar notificações:", e);
    }

    return appt;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = (err as { message?: string })?.message ?? "";
    if (code === DUP_ENTRY && message.includes("appointments_code_unique")) {
      continue; // colisão do código curto: tenta de novo
    }
    throw err;
  }
  }
  throw new BookingError("Não foi possível gerar o código. Tente novamente.");
}

/**
 * Remarca um atendimento: cancela o antigo e cria o novo com os mesmos
 * serviços, passando pela mesma trava de conflito. Se o horário novo não
 * estiver livre, nada muda — o cliente não perde o que já tinha.
 */
export async function rescheduleBooking(input: {
  appointmentId: number;
  dateKey: string;
  time: string;
  barberId?: number | null;
}) {
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, input.appointmentId),
  });
  if (!appt) throw new BookingError("Agendamento não encontrado.");
  if (["CONCLUIDO", "CANCELADO", "NO_SHOW"].includes(appt.status)) {
    throw new BookingError("Esse atendimento já foi encerrado.");
  }

  const items = await db
    .select()
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appt.id));
  const serviceIds = items
    .map((i) => i.serviceId)
    .filter((id): id is number => id !== null);
  if (serviceIds.length === 0) {
    throw new BookingError("Não dá para remarcar: os serviços saíram do catálogo.");
  }

  // Libera o horário antigo primeiro, senão ele bloquearia o novo quando
  // for o mesmo barbeiro em horário próximo.
  await db
    .update(appointments)
    .set({ status: "CANCELADO" })
    .where(eq(appointments.id, appt.id));

  try {
    const novo = await createBooking({
      serviceIds,
      dateKey: input.dateKey,
      time: input.time,
      barberId: input.barberId ?? appt.barberId,
      clientName: appt.clientName,
      clientPhone: appt.clientPhone,
      userId: appt.clientUserId,
      notes: appt.notes ?? undefined,
      skipConfirmation: true,
    });
    await cancelPendingNotifications(appt.id);
    try {
      await queueNotification({
        kind: "AGENDAMENTO_REMARCADO",
        appointment: novo,
      });
    } catch (e) {
      console.error("Falha ao avisar remarcação:", e);
    }
    return novo;
  } catch (err) {
    // Não conseguiu o horário novo: devolve o antigo como estava.
    await db
      .update(appointments)
      .set({ status: appt.status })
      .where(eq(appointments.id, appt.id));
    throw err;
  }
}

/** Transições de estado permitidas, para não pular etapas. */
type ApptStatusName = (typeof appointments.$inferSelect)["status"];

const ALLOWED: Record<ApptStatusName, ApptStatusName[]> = {
  PENDENTE: ["CONFIRMADO", "CANCELADO", "NO_SHOW"],
  CONFIRMADO: ["EM_ANDAMENTO", "CONCLUIDO", "CANCELADO", "NO_SHOW"],
  EM_ANDAMENTO: ["CONCLUIDO", "CANCELADO"],
  CONCLUIDO: [],
  CANCELADO: [],
  NO_SHOW: [],
};

export type { ApptStatusName };

export async function transitionAppointment(
  id: number,
  next: ApptStatusName
) {
  const current = await db.query.appointments.findFirst({
    where: eq(appointments.id, id),
  });
  if (!current) throw new BookingError("Agendamento não encontrado.");
  if (!ALLOWED[current.status]?.includes(next)) {
    throw new BookingError(
      `Não é possível mudar de ${current.status.toLowerCase()} para ${next.toLowerCase()}.`
    );
  }

  const patch: Partial<typeof appointments.$inferInsert> = { status: next };
  if (next === "EM_ANDAMENTO") patch.startedAt = new Date();
  if (next === "CONCLUIDO") patch.finishedAt = new Date();

  await db.update(appointments).set(patch).where(eq(appointments.id, id));
  const updated = (await db.query.appointments.findFirst({
    where: eq(appointments.id, id),
  }))!;

  // Efeitos colaterais do novo estado.
  if (next === "CONCLUIDO") {
    await recordCommission(updated.id);
  }
  if (next === "CANCELADO" || next === "NO_SHOW") {
    await cancelPendingNotifications(updated.id);
    if (next === "CANCELADO") {
      try {
        await queueNotification({
          kind: "AGENDAMENTO_CANCELADO",
          appointment: updated,
        });
      } catch (e) {
        console.error("Falha ao enfileirar cancelamento:", e);
      }
    }
  }

  return updated;
}
