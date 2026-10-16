// ───────────────────────────────────────────────────────────
// Relatórios de fechamento. Tudo sai da razão de comissões, que é
// gravada atendimento a atendimento — o número bate com a agenda.
// ───────────────────────────────────────────────────────────
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointmentCommissions,
  appointmentServices,
  appointments,
  barbers,
  users,
} from "@/db/schema";
import { shopTimeToUtc, utcToShopParts, formatShopTime } from "./time";

/** Início e fim (exclusivo) de um mês da loja, em instantes UTC. */
export function monthRange(year: number, month: number) {
  const start = shopTimeToUtc(year, month, 1, 0);
  const end =
    month === 12
      ? shopTimeToUtc(year + 1, 1, 1, 0)
      : shopTimeToUtc(year, month + 1, 1, 0);
  return { start, end };
}

export type CommissionLine = {
  id: number;
  data: string;
  hora: string;
  cliente: string;
  servicos: string;
  barbeiro: string;
  barberId: number;
  baseCents: number;
  barberPct: number;
  barberCents: number;
  shopCents: number;
  origem: "Plano" | "Avulso";
};

/** Lançamentos do mês, opcionalmente de um barbeiro só. */
export async function commissionReport(
  year: number,
  month: number,
  barberId?: number | null
): Promise<CommissionLine[]> {
  const { start, end } = monthRange(year, month);
  const rows = await db
    .select({
      c: appointmentCommissions,
      a: appointments,
      b: barbers,
      u: users,
    })
    .from(appointmentCommissions)
    .innerJoin(appointments, eq(appointments.id, appointmentCommissions.appointmentId))
    .innerJoin(barbers, eq(barbers.id, appointmentCommissions.barberId))
    .innerJoin(users, eq(users.id, barbers.userId))
    .where(
      and(
        // Mês do atendimento: o fechamento pode ser registrado no dia seguinte.
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        barberId ? eq(appointmentCommissions.barberId, barberId) : undefined
      )
    )
    .orderBy(asc(appointments.startsAt));

  // O que foi feito em cada atendimento: sem isso a linha "Base" não tinha
  // como ser conferida com a agenda.
  const ids = rows.map((r) => r.a.id);
  const itens = ids.length
    ? await db
        .select({ appointmentId: appointmentServices.appointmentId, name: appointmentServices.name })
        .from(appointmentServices)
        .where(inArray(appointmentServices.appointmentId, ids))
    : [];
  const servicosDe = new Map<number, string[]>();
  for (const i of itens) {
    servicosDe.set(i.appointmentId, [...(servicosDe.get(i.appointmentId) ?? []), i.name]);
  }

  return rows.map(({ c, a, b, u }) => {
    const p = utcToShopParts(a.startsAt);
    return {
      id: c.id,
      data: `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`,
      hora: formatShopTime(a.startsAt),
      cliente: a.clientName,
      servicos: (servicosDe.get(a.id) ?? []).join(" + "),
      barbeiro: u.name,
      barberId: b.id,
      baseCents: c.baseCents,
      barberPct: c.barberPct,
      barberCents: c.barberCents,
      shopCents: c.shopCents,
      origem: c.fromSubscription ? "Plano" : "Avulso",
    };
  });
}

export function summarize(lines: CommissionLine[]) {
  return lines.reduce(
    (acc, l) => ({
      atendimentos: acc.atendimentos + 1,
      baseCents: acc.baseCents + l.baseCents,
      barberCents: acc.barberCents + l.barberCents,
      shopCents: acc.shopCents + l.shopCents,
    }),
    { atendimentos: 0, baseCents: 0, barberCents: 0, shopCents: 0 }
  );
}

/** Agrupa por barbeiro, para o fechamento da equipe. */
export function byBarber(lines: CommissionLine[]) {
  const map = new Map<number, { nome: string } & ReturnType<typeof summarize>>();
  for (const l of lines) {
    const cur =
      map.get(l.barberId) ??
      { nome: l.barbeiro, atendimentos: 0, baseCents: 0, barberCents: 0, shopCents: 0 };
    map.set(l.barberId, {
      nome: l.barbeiro,
      atendimentos: cur.atendimentos + 1,
      baseCents: cur.baseCents + l.baseCents,
      barberCents: cur.barberCents + l.barberCents,
      shopCents: cur.shopCents + l.shopCents,
    });
  }
  return Array.from(map.entries()).map(([barberId, v]) => ({ barberId, ...v }));
}

/**
 * CSV com ponto e vírgula e vírgula decimal — abre direto no Excel pt-BR.
 * `cabecalho` garante as colunas mesmo num mês vazio (antes saía um
 * arquivo em branco, que parecia erro).
 */
export function toCsv(rows: Record<string, string | number>[], cabecalho?: string[]) {
  const headers = rows.length ? Object.keys(rows[0]) : cabecalho ?? [];
  if (headers.length === 0) return "";
  const esc = (v: string | number) => {
    let s = String(v);
    // Nome de cliente é texto que o próprio cliente digitou. Começando com
    // = + - @ (ou tab/CR), o Excel lê como fórmula e executa ao abrir o
    // arquivo. A aspa simples na frente neutraliza sem sujar a leitura.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    // CR solto também quebra a linha no Excel: sem aspas, a linha seguinte
    // começava com uma fórmula viva, passando por cima da aspa simples.
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(";"));
  // BOM para o Excel reconhecer o acento.
  return "﻿" + [headers.join(";"), ...body].join("\r\n");
}

export const brl = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",");
