// ───────────────────────────────────────────────────────────
// Horário fixo do assinante.
//
// O membro reserva o mesmo dia/hora toda semana (ou todo mês) e o
// sistema materializa os agendamentos com antecedência. Ter o fixo não
// impede marcar horários avulsos: são agendamentos comuns, criados pelo
// mesmo caminho e sujeitos às mesmas regras de conflito.
// ───────────────────────────────────────────────────────────
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  recurringSlots,
  services as servicesTable,
  subscriptions,
  users,
} from "@/db/schema";
import { createBooking, BookingError } from "./appointments";
import { cancelPendingNotifications } from "./notifications";
import { getSettings } from "./schedule";
import {
  shopToday,
  addDays,
  weekdayOf,
  parseDateKey,
  minutesToHHMM,
  shopTimeToUtc,
} from "./time";

/** Quantas semanas à frente o fixo é garantido na agenda. */
const HORIZON_DAYS = 35;

/** As datas que um horário fixo ocupa dentro da janela. */
export function occurrencesFor(
  slot: {
    frequency: string;
    weekday: number | null;
    dayOfMonth: number | null;
    startsOn: string;
    endsOn: string | null;
  },
  fromKey = shopToday(),
  horizonDays = HORIZON_DAYS
) {
  const out: string[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const dateKey = addDays(fromKey, i);
    if (dateKey < slot.startsOn) continue;
    if (slot.endsOn && dateKey > slot.endsOn) break;

    if (slot.frequency === "MENSAL") {
      if (Number(dateKey.slice(-2)) === slot.dayOfMonth) out.push(dateKey);
    } else if (weekdayOf(dateKey) === slot.weekday) {
      out.push(dateKey);
    }
  }
  return out;
}

export type MaterializeReport = {
  criados: number;
  jaExistiam: number;
  conflitos: { dateKey: string; motivo: string }[];
};

/**
 * Cria os agendamentos que faltam para os horários fixos ativos.
 * Idempotente: roda quantas vezes quiser sem duplicar.
 * Conflito não é erro — o horário fixo cede para quem já estava lá,
 * e o caso é reportado para o admin resolver.
 */
export async function materializeRecurring(
  opts: { slotId?: number } = {}
): Promise<MaterializeReport> {
  const settings = await getSettings();
  const report: MaterializeReport = { criados: 0, jaExistiam: 0, conflitos: [] };

  // Com slotId, só aquele fixo: o relatório de conflitos é do membro que
  // acabou de salvar, não uma mistura com o de todo mundo.
  const slots = await db.query.recurringSlots.findMany({
    where: opts.slotId
      ? and(eq(recurringSlots.active, true), eq(recurringSlots.id, opts.slotId))
      : eq(recurringSlots.active, true),
  });
  if (slots.length === 0) return report;

  for (const slot of slots) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, slot.userId),
    });
    if (!user) continue;

    // Horário fixo é benefício de membro. Sem plano ativo (cancelou ou
    // venceu), a varredura para de reservar novas semanas — a cadeira volta
    // a ser vendável. O fixo não é apagado: se a pessoa acertar o plano,
    // ele volta a materializar sozinho.
    const plano = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, slot.userId),
        eq(subscriptions.status, "ATIVA")
      ),
    });
    if (!plano) continue;

    const ids = slot.serviceIds ?? [];
    if (ids.length === 0) continue;

    const svcs = await db.query.services.findMany({
      where: and(inArray(servicesTable.id, ids), eq(servicesTable.active, true)),
    });
    if (svcs.length === 0) continue;
    const durationMin = svcs.reduce((a, s) => a + s.durationMin, 0);

    for (const dateKey of occurrencesFor(slot)) {
      if (settings.closedWeekdays.includes(weekdayOf(dateKey))) continue;

      const { year, month, day } = parseDateKey(dateKey);
      const startsAt = shopTimeToUtc(year, month, day, slot.minutesOfDay);

      // Já tratado? Para uma ocorrência deste fixo vale QUALQUER status:
      // cancelada pelo membro, ela não pode voltar na próxima varredura.
      // O segundo ramo cobre ocorrências criadas antes do vínculo existir.
      const existente = await db.query.appointments.findFirst({
        where: or(
          and(
            eq(appointments.recurringSlotId, slot.id),
            eq(appointments.startsAt, startsAt)
          ),
          and(
            eq(appointments.clientUserId, slot.userId),
            eq(appointments.barberId, slot.barberId),
            eq(appointments.startsAt, startsAt),
            inArray(appointments.status, [
              "PENDENTE",
              "CONFIRMADO",
              "EM_ANDAMENTO",
              "CONCLUIDO",
            ])
          )
        ),
      });
      if (existente) {
        report.jaExistiam++;
        continue;
      }

      try {
        await createBooking({
          serviceIds: svcs.map((s) => s.id),
          dateKey,
          time: minutesToHHMM(slot.minutesOfDay),
          barberId: slot.barberId,
          clientName: user.name,
          clientPhone: user.phone,
          userId: user.id,
          notes: "Horário fixo do plano",
          fromRecurring: true,
          recurringSlotId: slot.id,
        });
        report.criados++;
      } catch (e) {
        report.conflitos.push({
          dateKey,
          motivo:
            e instanceof BookingError ? e.message : "Falha ao criar o horário",
        });
      }
    }
  }

  return report;
}

/**
 * Abriu mão do fixo, trocou por outro, ou o barbeiro saiu: as ocorrências
 * futuras que já estavam garantidas na agenda são canceladas e os lembretes
 * delas derrubados. Sem aviso de cancelamento — foi o próprio membro (ou a
 * barbearia) que pediu, e um "seu horário foi cancelado" por semana seria
 * ruído.
 */
export async function cancelFutureOccurrences(slotIds: number[]): Promise<number> {
  if (slotIds.length === 0) return 0;
  const alvo = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        inArray(appointments.recurringSlotId, slotIds),
        gt(appointments.startsAt, new Date()),
        inArray(appointments.status, ["PENDENTE", "CONFIRMADO"])
      )
    );
  if (alvo.length === 0) return 0;
  const ids = alvo.map((a) => a.id);
  await db
    .update(appointments)
    .set({ status: "CANCELADO" })
    .where(inArray(appointments.id, ids));
  for (const id of ids) await cancelPendingNotifications(id);
  return ids.length;
}
