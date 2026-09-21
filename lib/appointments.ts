// ───────────────────────────────────────────────────────────
// Criação e transições de estado dos agendamentos.
// A prevenção de horário duplicado é da constraint de exclusão
// no banco; aqui traduzimos a violação para uma mensagem humana.
// ───────────────────────────────────────────────────────────
import { and, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  appointmentServices,
  barbers,
  bookingLocks,
  scheduleBlocks,
  services as servicesTable,
  subscriptions,
  users,
  planServices,
} from "@/db/schema";
import { sql as rawSql } from "drizzle-orm";
import {
  getAvailability,
  getSettings,
  generateCode,
  workingWindows,
  BLOCKING_STATUSES,
} from "./schedule";
import { resolveBarberPct, recordCommission } from "./commissions";
import {
  queueBookingNotifications,
  queueNotification,
  cancelPendingNotifications,
} from "./notifications";
import { randomBytes } from "node:crypto";
import {
  shopTimeToUtc,
  parseDateKey,
  shopToday,
  addDays as addDaysKey,
  utcToShopParts,
  minutesToHHMM,
} from "./time";
import { normalizePhone } from "./phone";
import { dbErrorCode, dbErrorMessage } from "./errors";

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
  /** Horário fixo que está gerando esta ocorrência. */
  recurringSlotId?: number | null;
  /**
   * Veio do site, do cliente. Só o pedido público respeita a pausa da
   * agenda, a antecedência mínima e o limite de dias à frente: pausar a
   * agenda pública travava também o encaixe do balcão, a remarcação pelo
   * painel e a materialização do horário fixo dos membros.
   */
  publicRequest?: boolean;
  /**
   * Preços e durações congelados (remarcação): o atendimento continua
   * valendo o que foi combinado, mesmo que o catálogo tenha mudado.
   */
  frozenItems?: {
    serviceId: number;
    name: string;
    priceCents: number;
    durationMin: number;
  }[];
  /**
   * Remarcação: o agendamento que está sendo movido não conta como
   * conflito consigo mesmo, nem para o teto de horários em aberto.
   */
  ignoreAppointmentId?: number;
};

export async function createBooking(input: CreateBookingInput) {
  const settings = await getSettings();
  if (input.publicRequest && !settings.acceptingBookings) {
    throw new BookingError(
      "A agenda está temporariamente fechada para novos agendamentos."
    );
  }
  if (input.publicRequest) {
    // O limite de dias à frente só valia para os chips da tela: pela ação
    // dava para reservar 2030.
    const limite = addDaysKey(shopToday(), settings.maxAdvanceDays);
    if (input.dateKey > limite) {
      throw new BookingError(
        `A agenda abre até ${settings.maxAdvanceDays} dias à frente. Escolha uma data mais próxima.`
      );
    }
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
    // Dizer qual saiu: "algum serviço" deixava o cliente clicando de novo
    // no mesmo combo e recebendo o mesmo erro para sempre.
    const encontrados = new Set(chosen.map((s) => s.id));
    const faltando = await db.query.services.findMany({
      where: inArray(
        servicesTable.id,
        input.serviceIds.filter((id) => !encontrados.has(id))
      ),
    });
    const nomes = faltando.map((s) => s.name).join(", ");
    throw new BookingError(
      nomes
        ? `${nomes} saiu do catálogo. Escolha outro serviço.`
        : "Algum serviço escolhido não está mais disponível."
    );
  }

  // Na remarcação vale o que foi combinado, não o catálogo de hoje: o
  // cliente só mudou de horário e não pode receber preço novo (nem ver a
  // duração mudar) por causa de um reajuste no meio do caminho.
  const congelado = new Map(
    (input.frozenItems ?? []).map((i) => [i.serviceId, i])
  );
  const preco = (s: { id: number; priceCents: number }) =>
    congelado.get(s.id)?.priceCents ?? s.priceCents;
  const duracao = (s: { id: number; durationMin: number }) =>
    congelado.get(s.id)?.durationMin ?? s.durationMin;

  const durationMin = chosen.reduce((acc, s) => acc + duracao(s), 0);
  const phone = normalizePhone(input.clientPhone);

  // De quem é este telefone. Antes o plano só era procurado quando havia
  // sessão de cliente, então o encaixe feito pelo barbeiro e o próprio
  // assinante deslogado saíam como avulso, com o preço cheio no WhatsApp e
  // no faturamento. O telefone é a chave do cadastro: dá para saber sem
  // sessão nenhuma.
  let ownerId = input.userId ?? null;
  if (!ownerId) {
    const dono = await db.query.users.findFirst({ where: eq(users.phone, phone) });
    if (dono) ownerId = dono.id;
  }

  // Assinatura ativa cobre os serviços do plano — nesse caso não há cobrança.
  const subscription = ownerId
    ? await db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.userId, ownerId),
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
          gt(appointments.startsAt, new Date()),
          input.ignoreAppointmentId
            ? ne(appointments.id, input.ignoreAppointmentId)
            : undefined
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
    : chosen.reduce((acc, s) => acc + (coveredIds.has(s.id) ? 0 : preco(s)), 0);

  // Confere a disponibilidade e resolve "mais rápido" para um barbeiro real.
  const availability = await getAvailability({
    dateKey: input.dateKey,
    durationMin,
    barberId: input.barberId ?? null,
    settings,
    ignorarAppointmentId: input.ignoreAppointmentId,
    // Encaixe do balcão vale aqui também. Sem isto a tela da equipe
    // oferecia o horário (ela consulta ignorando a antecedência) e a
    // gravação recusava logo depois, dizendo que faltava antecedência.
    ignorarAntecedencia: !input.publicRequest,
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

  // "Mais rápido" tem candidatos, não um escolhido. Fixar o primeiro
  // livre fazia dois pedidos simultâneos disputarem a mesma cadeira, e o
  // segundo ouvia "esse horário acabou de ser reservado" com a cadeira do
  // lado vazia. Perdendo a disputa, o pedido tenta o próximo candidato.
  const candidatos = input.barberId ? [input.barberId] : slot.barberIds;
  if (candidatos.length === 0) {
    throw new BookingError("Nenhum barbeiro livre nesse horário.");
  }
  let barberId = candidatos[0];

  const { year, month, day } = parseDateKey(input.dateKey);
  const startsAt = shopTimeToUtc(year, month, day, slot.minutes);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  // Cliente sem conta vira um registro "leve": dá pra reconhecê-lo na
  // próxima visita e ele pode assumir a conta depois definindo senha.
  let clientUserId = ownerId;
  if (!clientUserId) {
    const [{ id }] = await db
      .insert(users)
      .values({ name: input.clientName.trim(), phone, role: "CLIENT" })
      .$returningId();
    clientUserId = id;
  }

  // Poucas tentativas cobrem a colisão rara do código de 6 letras, e a
  // troca de candidato quando outro pedido leva a cadeira primeiro.
  let candidato = 0;
  for (let attempt = 0; attempt < 3 + candidatos.length; attempt++) {
  barberId = candidatos[candidato];
  const barber = await db.query.barbers.findFirst({
    where: and(eq(barbers.id, barberId), eq(barbers.active, true)),
  });
  if (!barber) throw new BookingError("Barbeiro indisponível.");

  // Percentual do barbeiro congelado agora: se a meta dele mudar depois,
  // este atendimento mantém a divisão combinada no dia.
  const { pct: barberPct } = await resolveBarberPct(barberId);

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
            gt(appointments.endsAt, startsAt),
            // O horário que está sendo remarcado não conflita consigo
            // mesmo: é ele que vai sair do lugar.
            input.ignoreAppointmentId
              ? ne(appointments.id, input.ignoreAppointmentId)
              : undefined
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
          recurringSlotId: input.recurringSlotId ?? null,
        })
        .$returningId();

      await tx.insert(appointmentServices).values(
        chosen.map((s) => ({
          appointmentId: createdId,
          serviceId: s.id,
          name: congelado.get(s.id)?.name ?? s.name,
          priceCents: coveredIds.has(s.id) ? 0 : preco(s),
          durationMin: duracao(s),
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
    if (
      dbErrorCode(err) === DUP_ENTRY &&
      dbErrorMessage(err).includes("appointments_code_unique")
    ) {
      continue; // colisão do código curto: tenta de novo
    }
    // Perdeu a cadeira para outro pedido, mas havia mais de um livre:
    // tenta o próximo em vez de recusar o cliente.
    if (err instanceof BookingError && candidato + 1 < candidatos.length) {
      candidato++;
      continue;
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

  // O novo horário nasce ANTES de o antigo cair.
  //
  // A ordem inversa (cancelar e depois criar) tinha um instante em que o
  // cliente não tinha horário nenhum: uma queda entre as duas escritas —
  // ou um erro fora do alcance do rollback — o deixava sem nada, e sem
  // ninguém para avisar. Agora o pior caso é o oposto e reversível: dois
  // horários marcados, que o painel mostra e a barbearia resolve. O
  // próprio agendamento não conflita consigo mesmo (ignoreAppointmentId).
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
    // O que foi combinado continua valendo, preço e duração.
    frozenItems: items
      .filter((i) => i.serviceId !== null)
      .map((i) => ({
        serviceId: i.serviceId as number,
        name: i.name,
        priceCents: i.priceCents,
        durationMin: i.durationMin,
      })),
    // Remarcar uma ocorrência do horário fixo mantém o vínculo, senão a
    // varredura seguinte enxerga a semana "livre" e reserva de novo.
    recurringSlotId: appt.recurringSlotId,
    ignoreAppointmentId: appt.id,
  });

  // Agora o antigo sai. O UPDATE é condicionado ao estado lido: se o
  // barbeiro concluiu o atendimento no meio do caminho, a remarcação não
  // pode apagar a conclusão — e aí quem sai é o horário novo.
  const [liberado] = await db
    .update(appointments)
    .set({ status: "CANCELADO" })
    .where(and(eq(appointments.id, appt.id), eq(appointments.status, appt.status)));
  if (liberado.affectedRows === 0) {
    await db
      .update(appointments)
      .set({ status: "CANCELADO" })
      .where(eq(appointments.id, novo.id));
    await cancelPendingNotifications(novo.id);
    throw new BookingError(
      "Esse horário mudou de situação enquanto você remarcava. Abra de novo para ver como ficou."
    );
  }

  await cancelPendingNotifications(appt.id);
  try {
    // Com o nome do barbeiro: a remarcação pode ter trocado de
    // profissional, e a mensagem sem nome deixava o cliente achando que
    // continuava com o mesmo.
    const prof = await db.query.barbers.findFirst({
      where: eq(barbers.id, novo.barberId),
    });
    await queueNotification({
      kind: "AGENDAMENTO_REMARCADO",
      appointment: novo,
      barberName: prof?.shortName,
    });
  } catch (e) {
    console.error("Falha ao avisar remarcação:", e);
  }
  return novo;
}

/**
 * Troca os serviços de um atendimento já marcado.
 *
 * Acontece o tempo todo no balcão: o cliente sentou para cortar e pede
 * barba também. Sem isto o jeito era cancelar e marcar de novo — o que
 * dispara um "seu horário foi cancelado" no WhatsApp, perde o código e
 * some com o histórico do horário.
 *
 * O horário de início não muda; o que muda é a duração (e o preço). Se o
 * atendimento passar a invadir o próximo da cadeira, ou o fim do
 * expediente, a troca é recusada com o motivo.
 */
export async function updateAppointmentServices(input: {
  appointmentId: number;
  serviceIds: number[];
}) {
  if (input.serviceIds.length === 0) {
    throw new BookingError("Escolha ao menos um serviço.");
  }

  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, input.appointmentId),
  });
  if (!appt) throw new BookingError("Agendamento não encontrado.");
  if (["CONCLUIDO", "CANCELADO", "NO_SHOW"].includes(appt.status)) {
    throw new BookingError(
      "Esse atendimento já foi encerrado. Só dá para mudar o que ainda está em aberto."
    );
  }

  const chosen = await db.query.services.findMany({
    where: and(
      inArray(servicesTable.id, input.serviceIds),
      eq(servicesTable.active, true)
    ),
  });
  if (chosen.length !== input.serviceIds.length) {
    throw new BookingError("Algum serviço escolhido não está mais no catálogo.");
  }

  const settings = await getSettings();
  const durationMin = Math.max(
    chosen.reduce((acc, s) => acc + s.durationMin, 0),
    settings.slotMinutes
  );
  const endsAt = new Date(appt.startsAt.getTime() + durationMin * 60_000);

  // Não pode passar do fim do expediente — nem o da loja, nem o do
  // profissional, que pode ter jornada própria.
  const partes = utcToShopParts(appt.startsAt);
  const inicio = partes.minutesOfDay;
  const janelas = await workingWindows([appt.barberId], partes.weekday, settings);
  const fimDoTurno = janelas.get(appt.barberId)?.close ?? settings.closeMinute;
  if (inicio + durationMin > fimDoTurno) {
    throw new BookingError(
      `Com esses serviços o atendimento passa do fim do expediente (${minutesToHHMM(
        fimDoTurno
      )}). Remarque para um horário mais cedo.`
    );
  }

  // Nem invadir o próximo horário da mesma cadeira.
  const [depois] = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.barberId, appt.barberId),
        ne(appointments.id, appt.id),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, appt.startsAt)
      )
    )
    .limit(1);
  if (depois) {
    throw new BookingError(
      "Com esses serviços o atendimento passa por cima do próximo horário dessa cadeira."
    );
  }

  // Nem por cima de um bloqueio (almoço, manutenção, folga).
  const [bloqueio] = await db
    .select({ id: scheduleBlocks.id, reason: scheduleBlocks.reason })
    .from(scheduleBlocks)
    .where(
      and(
        lt(scheduleBlocks.startsAt, endsAt),
        gt(scheduleBlocks.endsAt, appt.startsAt),
        or(
          eq(scheduleBlocks.barberId, appt.barberId),
          isNull(scheduleBlocks.barberId)
        )
      )
    )
    .limit(1);
  if (bloqueio) {
    throw new BookingError(
      `Com esses serviços o atendimento entra num horário bloqueado${
        bloqueio.reason ? ` (${bloqueio.reason})` : ""
      }.`
    );
  }

  // Preço: o que o plano do cliente cobre continua sem cobrança.
  const dono = appt.clientUserId
    ? appt.clientUserId
    : (await db.query.users.findFirst({ where: eq(users.phone, appt.clientPhone) }))?.id ?? null;
  const assinatura = dono
    ? await db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.userId, dono),
          eq(subscriptions.status, "ATIVA")
        ),
      })
    : undefined;
  let cobertos = new Set<number>();
  if (assinatura) {
    const cobre = await db.query.planServices.findMany({
      where: eq(planServices.planId, assinatura.planId),
    });
    cobertos = new Set(cobre.map((c) => c.serviceId));
  }
  const tudoCoberto = !!assinatura && chosen.every((s) => cobertos.has(s.id));
  const totalCents = tudoCoberto
    ? 0
    : chosen.reduce((acc, s) => acc + (cobertos.has(s.id) ? 0 : s.priceCents), 0);

  await db
    .update(appointments)
    .set({
      endsAt,
      durationMin,
      totalCents,
      kind: tudoCoberto ? "ASSINANTE" : "AVULSO",
      subscriptionId: tudoCoberto ? assinatura!.id : null,
    })
    .where(eq(appointments.id, appt.id));

  // O snapshot de serviços é reescrito: é ele que vira a comissão e a
  // linha do relatório quando o atendimento fechar.
  await db
    .delete(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appt.id));
  await db.insert(appointmentServices).values(
    chosen.map((s) => ({
      appointmentId: appt.id,
      serviceId: s.id,
      name: s.name,
      priceCents: cobertos.has(s.id) ? 0 : s.priceCents,
      durationMin: s.durationMin,
    }))
  );

  return (await db.query.appointments.findFirst({
    where: eq(appointments.id, appt.id),
  }))!;
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

  // Condicional ao estado lido: dois cliques concorrentes ("concluir" e
  // "cancelar") não podem passar os dois — o segundo encontra outro estado
  // e para aqui, sem comissão lançada em atendimento cancelado.
  const [res] = await db
    .update(appointments)
    .set(patch)
    .where(and(eq(appointments.id, id), eq(appointments.status, current.status)));
  if (res.affectedRows === 0) {
    throw new BookingError(
      "A situação desse atendimento acabou de mudar. Atualize a tela."
    );
  }
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
