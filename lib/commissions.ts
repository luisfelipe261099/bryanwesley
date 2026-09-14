// ───────────────────────────────────────────────────────────
// Comissões. Um mesmo cliente pode passar por barbeiros diferentes
// a cada visita, então a divisão é calculada e gravada por atendimento
// — nunca por cliente.
//
// Regra base: barbeiro 50% / barbearia 50%.
// Faixas (commission_tiers) elevam o percentual do barbeiro quando ele
// ultrapassa uma meta de faturamento no mês.
// ───────────────────────────────────────────────────────────
import {
  and,
  eq,
  gte,
  lt,
  isNull,
  or,
  desc,
  sum,
  inArray,
  sql as drizzleSql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  appointmentCommissions,
  appointmentServices,
  commissionTiers,
  barbers,
  services as servicesTable,
} from "@/db/schema";
import { getSettings } from "./schedule";
import { shopTimeToUtc, utcToShopParts } from "./time";

/** Primeiro instante do mês (na loja) que contém `ref`. */
export function monthStart(ref = new Date()) {
  const p = utcToShopParts(ref);
  return shopTimeToUtc(p.year, p.month, 1, 0);
}

export function nextMonthStart(ref = new Date()) {
  const p = utcToShopParts(ref);
  const year = p.month === 12 ? p.year + 1 : p.year;
  const month = p.month === 12 ? 1 : p.month + 1;
  return shopTimeToUtc(year, month, 1, 0);
}

/** Faturamento já realizado pelo barbeiro no mês (base das metas). */
export async function barberMonthRevenueCents(barberId: number, ref = new Date()) {
  // O mês é o do atendimento, não o do clique em "concluir": quem fecha os
  // de ontem na manhã seguinte não pode jogar a comissão no mês errado.
  const [row] = await db
    .select({ total: sum(appointmentCommissions.baseCents) })
    .from(appointmentCommissions)
    .innerJoin(appointments, eq(appointments.id, appointmentCommissions.appointmentId))
    .where(
      and(
        eq(appointmentCommissions.barberId, barberId),
        gte(appointments.startsAt, monthStart(ref)),
        lt(appointments.startsAt, nextMonthStart(ref))
      )
    );
  return Number(row?.total ?? 0);
}

/**
 * Percentual do barbeiro considerando as faixas de meta.
 * Faixa específica do barbeiro vence a faixa global de mesmo patamar.
 */
export async function resolveBarberPct(barberId: number, ref = new Date()) {
  const settings = await getSettings();
  const barber = await db.query.barbers.findFirst({
    where: eq(barbers.id, barberId),
  });

  // Base: percentual do próprio barbeiro, senão o padrão da casa.
  let pct = barber?.commissionPct ?? settings.defaultBarberPct;

  const revenue = await barberMonthRevenueCents(barberId, ref);

  const tiers = await db
    .select()
    .from(commissionTiers)
    .where(
      and(
        or(
          eq(commissionTiers.barberId, barberId),
          isNull(commissionTiers.barberId)
        ),
        gte(sqlLiteral(revenue), commissionTiers.minRevenueCents)
      )
    )
    .orderBy(
      desc(commissionTiers.minRevenueCents),
      // Em DESC o Postgres põe NULL primeiro — inverteria a prioridade.
      // Ordena explicitamente: faixa do próprio barbeiro antes da global.
      drizzleSql`${commissionTiers.barberId} IS NULL`
    );

  if (tiers.length > 0) pct = tiers[0].barberPct;
  return { pct, revenue };
}

// `gte(valor, coluna)` precisa de um literal do lado esquerdo.
function sqlLiteral(n: number) {
  return drizzleSql<number>`${n}`;
}

export type CommissionSplit = {
  baseCents: number;
  barberPct: number;
  barberCents: number;
  shopCents: number;
};

export function splitCommission(
  baseCents: number,
  barberPct: number
): CommissionSplit {
  // Arredonda a favor da barbearia só nos centavos que sobram,
  // garantindo barbeiro + barbearia === base (sem centavo perdido).
  const barberCents = Math.round((baseCents * barberPct) / 100);
  return {
    baseCents,
    barberPct,
    barberCents,
    shopCents: baseCents - barberCents,
  };
}

/**
 * Registra a comissão de um atendimento concluído.
 * Idempotente: o índice único por atendimento evita lançar duas vezes.
 */
export async function recordCommission(appointmentId: number) {
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  });
  if (!appt) return null;
  const items = await db
    .select()
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId));

  const existing = await db.query.appointmentCommissions.findFirst({
    where: eq(appointmentCommissions.appointmentId, appointmentId),
  });
  if (existing) return existing;

  const settings = await getSettings();
  const fromSubscription = appt.kind === "ASSINANTE";

  // Assinante não paga no balcão, mas o barbeiro entregou serviço.
  // A base vira o preço de tabela do que foi feito — senão a comissão
  // de todo atendimento de plano seria zero.
  let baseCents = appt.totalCents;
  if (
    fromSubscription &&
    settings.subscriptionCommissionBase === "PRECO_TABELA"
  ) {
    const ids = items
      .map((i) => i.serviceId)
      .filter((id): id is number => id !== null);
    const catalog = ids.length
      ? await db
          .select({
            id: servicesTable.id,
            priceCents: servicesTable.priceCents,
          })
          .from(servicesTable)
          .where(inArray(servicesTable.id, ids))
      : [];
    const priceById = new Map(catalog.map((c) => [c.id, c.priceCents]));
    baseCents = items.reduce(
      (acc, i) =>
        acc +
        (i.priceCents > 0
          ? i.priceCents
          : (i.serviceId !== null ? priceById.get(i.serviceId) : 0) ?? 0),
      0
    );
  }

  const pct =
    appt.barberPctSnapshot ?? (await resolveBarberPct(appt.barberId)).pct;
  const split = splitCommission(baseCents, pct);

  // Índice único por atendimento: uma corrida aqui vira ER_DUP_ENTRY,
  // e nesse caso a linha que já existe é a resposta certa.
  try {
    await db.insert(appointmentCommissions).values({
      appointmentId,
      barberId: appt.barberId,
      baseCents: split.baseCents,
      barberPct: split.barberPct,
      barberCents: split.barberCents,
      shopCents: split.shopCents,
      fromSubscription,
    });
  } catch (e) {
    if ((e as { code?: string })?.code !== "ER_DUP_ENTRY") throw e;
  }
  return (
    (await db.query.appointmentCommissions.findFirst({
      where: eq(appointmentCommissions.appointmentId, appointmentId),
    })) ?? null
  );
}
