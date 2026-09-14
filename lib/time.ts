// ───────────────────────────────────────────────────────────
// A barbearia raciocina em horário de Brasília; o servidor roda em UTC.
// Toda conversão entre "09:00 na loja" e um instante real passa por aqui.
// ───────────────────────────────────────────────────────────

export const SHOP_TZ = "America/Sao_Paulo";

/** Deslocamento do fuso (minutos) no instante informado. */
function tzOffsetMinutes(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "0" : map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

/** Hora de parede na loja → instante UTC. Duas passadas cobrem bordas de DST. */
export function shopTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  minutesOfDay: number
): Date {
  const guess = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60
  );
  let ts = guess - tzOffsetMinutes(new Date(guess), SHOP_TZ) * 60000;
  ts = guess - tzOffsetMinutes(new Date(ts), SHOP_TZ) * 60000;
  return new Date(ts);
}

/** Instante UTC → partes do calendário da loja. */
export function utcToShopParts(date: Date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    minutesOfDay: hour * 60 + Number(map.minute),
    weekday: weekdays.indexOf(map.weekday), // 0 = domingo
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

/** "YYYY-MM-DD" do dia atual na loja. */
export function shopToday() {
  return utcToShopParts(new Date()).dateKey;
}

export function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** Dia da semana (0 = domingo) de uma data da loja. */
export function weekdayOf(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Soma dias a um "YYYY-MM-DD" sem passar por fuso. */
export function addDays(dateKey: string, days: number) {
  const { year, month, day } = parseDateKey(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

export function minutesToHHMM(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;
}

/** "HH:MM" na loja para um instante. */
export function formatShopTime(date: Date) {
  const p = utcToShopParts(date);
  return minutesToHHMM(p.minutesOfDay);
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  timeZone: "UTC",
});
const DAYMONTH_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const FULL_FMT = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

function utcNoon(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function labelWeekday(dateKey: string) {
  return WEEKDAY_FMT.format(utcNoon(dateKey)).replace(".", "");
}

export function labelDayMonth(dateKey: string) {
  return DAYMONTH_FMT.format(utcNoon(dateKey)).replace(".", "");
}

export function labelFullDate(dateKey: string) {
  return FULL_FMT.format(utcNoon(dateKey));
}

/** "Hoje" / "Amanhã" / "sex" para os chips de data. */
export function relativeWeekday(dateKey: string, today = shopToday()) {
  if (dateKey === today) return "Hoje";
  if (dateKey === addDays(today, 1)) return "Amanhã";
  return labelWeekday(dateKey);
}

/** "agora", "há 3 min", "há 2 h", "há 3 dias" — para carimbos de status. */
export function labelAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}
