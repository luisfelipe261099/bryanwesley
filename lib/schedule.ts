// ───────────────────────────────────────────────────────────
// Motor de agenda: quem está livre, quando, e por quê não.
// Toda a disponibilidade sai do banco — jornada da loja, agendamentos
// já gravados, bloqueios do admin e antecedência mínima.
// ───────────────────────────────────────────────────────────
import { and, eq, gte, lt, inArray, asc, sql as rawSql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  barbers,
  barberHours,
  scheduleBlocks,
  services as servicesTable,
  settings as settingsTable,
  users,
  type Settings,
} from "@/db/schema";
import {
  shopTimeToUtc,
  parseDateKey,
  weekdayOf,
  addDays,
  shopToday,
  minutesToHHMM,
  relativeWeekday,
  labelDayMonth,
} from "./time";

/** Status que continuam ocupando a cadeira. */
export const BLOCKING_STATUSES = [
  "PENDENTE",
  "CONFIRMADO",
  "EM_ANDAMENTO",
  "CONCLUIDO",
] as const;

export async function getSettings(): Promise<Settings> {
  const row = await db.query.settings.findFirst({
    where: eq(settingsTable.id, 1),
  });
  if (row) return row;
  // Primeira leitura de um banco vazio: cria a linha única com os padrões.
  await db
    .insert(settingsTable)
    .values({ id: 1, closedWeekdays: [0, 1] })
    .onDuplicateKeyUpdate({ set: { id: rawSql`${settingsTable.id}` } });
  return (await db.query.settings.findFirst({ where: eq(settingsTable.id, 1) }))!;
}

export async function getActiveBarbers() {
  // Join explícito: `with` relacional vira LATERAL, que o TiDB não executa.
  const rows = await db
    .select({ barber: barbers, user: users })
    .from(barbers)
    .innerJoin(users, eq(users.id, barbers.userId))
    .where(eq(barbers.active, true))
    .orderBy(asc(barbers.sortOrder));
  return rows.map((r) => ({ ...r.barber, user: r.user }));
}

export async function getActiveServices() {
  return db.query.services.findMany({
    where: eq(servicesTable.active, true),
    orderBy: [asc(servicesTable.sortOrder)],
  });
}

export type DayOption = {
  dateKey: string;
  weekday: string; // "Hoje" | "Amanhã" | "sex"
  dayLabel: string; // "24 out"
  closed: boolean;
};

/** Próximos dias em que a loja abre, para os chips de data. */
export function listOpenDays(s: Settings, count = 10): DayOption[] {
  const today = shopToday();
  const out: DayOption[] = [];
  for (let i = 0; i < s.maxAdvanceDays && out.length < count; i++) {
    const dateKey = addDays(today, i);
    if (s.closedWeekdays.includes(weekdayOf(dateKey))) continue;
    out.push({
      dateKey,
      weekday: relativeWeekday(dateKey, today),
      dayLabel: labelDayMonth(dateKey),
      closed: false,
    });
  }
  return out;
}

type Busy = { start: number; end: number }; // instantes em ms

/** Intervalos ocupados de um barbeiro no dia: atendimentos + bloqueios. */
async function busyIntervals(dateKey: string, barberIds: number[]) {
  const { year, month, day } = parseDateKey(dateKey);
  const dayStart = shopTimeToUtc(year, month, day, 0);
  const dayEnd = shopTimeToUtc(year, month, day, 24 * 60);

  const [appts, blocks] = await Promise.all([
    db
      .select({
        barberId: appointments.barberId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
      })
      .from(appointments)
      .where(
        and(
          inArray(appointments.barberId, barberIds),
          inArray(appointments.status, [...BLOCKING_STATUSES]),
          lt(appointments.startsAt, dayEnd),
          gte(appointments.endsAt, dayStart)
        )
      ),
    db
      .select({
        barberId: scheduleBlocks.barberId,
        startsAt: scheduleBlocks.startsAt,
        endsAt: scheduleBlocks.endsAt,
      })
      .from(scheduleBlocks)
      .where(
        and(
          lt(scheduleBlocks.startsAt, dayEnd),
          gte(scheduleBlocks.endsAt, dayStart)
        )
      ),
  ]);

  const byBarber = new Map<number, Busy[]>();
  for (const id of barberIds) byBarber.set(id, []);

  for (const a of appts) {
    byBarber
      .get(a.barberId)
      ?.push({ start: a.startsAt.getTime(), end: a.endsAt.getTime() });
  }
  // Bloqueio sem barbeiro vale para a loja inteira.
  for (const b of blocks) {
    const interval = { start: b.startsAt.getTime(), end: b.endsAt.getTime() };
    if (b.barberId === null) {
      for (const list of byBarber.values()) list.push(interval);
    } else {
      byBarber.get(b.barberId)?.push(interval);
    }
  }
  return byBarber;
}

/**
 * Janela de trabalho de cada barbeiro no dia.
 * Sem jornada própria cadastrada vale o horário da loja; com jornada
 * cadastrada e nenhuma linha para este dia da semana, o barbeiro folga.
 */
export async function workingWindows(
  barberIds: number[],
  weekday: number,
  s: Settings
) {
  const rows = barberIds.length
    ? await db
        .select()
        .from(barberHours)
        .where(inArray(barberHours.barberId, barberIds))
    : [];

  const hasOwn = new Set(rows.map((r) => r.barberId));
  const out = new Map<number, { open: number; close: number } | null>();
  for (const id of barberIds) {
    if (!hasOwn.has(id)) {
      out.set(id, { open: s.openMinute, close: s.closeMinute });
      continue;
    }
    const today = rows.find((r) => r.barberId === id && r.weekday === weekday);
    out.set(
      id,
      today
        ? {
            // A jornada própria nunca extrapola a da loja.
            open: Math.max(today.openMinute, s.openMinute),
            close: Math.min(today.closeMinute, s.closeMinute),
          }
        : null
    );
  }
  return out;
}

function overlaps(a: Busy, list: Busy[]) {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

export type Slot = {
  time: string; // "HH:MM"
  minutes: number;
  available: boolean;
  reason?: "ocupado" | "antecedencia" | "fechado";
  /** Barbeiros livres nesse horário (para o modo "mais rápido"). */
  barberIds: number[];
};

export type AvailabilityResult = {
  dateKey: string;
  closed: boolean;
  slots: Slot[];
};

/**
 * Horários possíveis para um atendimento de `durationMin`.
 * `barberId` nulo = qualquer barbeiro (pega o primeiro livre).
 */
export async function getAvailability(opts: {
  dateKey: string;
  durationMin: number;
  barberId?: number | null;
  settings?: Settings;
}): Promise<AvailabilityResult> {
  const s = opts.settings ?? (await getSettings());
  const { dateKey } = opts;
  const durationMin = Math.max(opts.durationMin, s.slotMinutes);

  if (s.closedWeekdays.includes(weekdayOf(dateKey))) {
    return { dateKey, closed: true, slots: [] };
  }

  const team = await getActiveBarbers();
  const pool = opts.barberId
    ? team.filter((b) => b.id === opts.barberId)
    : team;
  if (pool.length === 0) return { dateKey, closed: true, slots: [] };

  const ids = pool.map((b) => b.id);
  const weekday = weekdayOf(dateKey);
  const [busy, windows] = await Promise.all([
    busyIntervals(dateKey, ids),
    workingWindows(ids, weekday, s),
  ]);

  // Barbeiro escolhido folga hoje: dia fechado para ele.
  if (opts.barberId && windows.get(opts.barberId) === null) {
    return { dateKey, closed: true, slots: [] };
  }

  const { year, month, day } = parseDateKey(dateKey);
  const earliest = Date.now() + s.minAdvanceHours * 3600_000;

  const slots: Slot[] = [];
  for (
    let m = s.openMinute;
    m + durationMin <= s.closeMinute;
    m += s.slotMinutes
  ) {
    const start = shopTimeToUtc(year, month, day, m);
    const interval = {
      start: start.getTime(),
      end: start.getTime() + durationMin * 60_000,
    };

    if (interval.start < earliest) {
      slots.push({
        time: minutesToHHMM(m),
        minutes: m,
        available: false,
        reason: "antecedencia",
        barberIds: [],
      });
      continue;
    }

    const free = pool
      .filter((b) => {
        const w = windows.get(b.id);
        if (!w) return false; // folga
        if (m < w.open || m + durationMin > w.close) return false;
        return !overlaps(interval, busy.get(b.id) ?? []);
      })
      .map((b) => b.id);

    slots.push({
      time: minutesToHHMM(m),
      minutes: m,
      available: free.length > 0,
      reason: free.length > 0 ? undefined : "ocupado",
      barberIds: free,
    });
  }

  return { dateKey, closed: false, slots };
}

/** Código curto e legível para o cliente identificar o agendamento. */
export function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export { shopTimeToUtc, parseDateKey };
