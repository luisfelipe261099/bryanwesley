// Almoço de cada profissional: bloqueia a agenda e aparece nela.
import "../db/load-env";
import { db, pool } from "../db/client";
import { barbers, services as sv, users } from "../db/schema";
import { createBooking, BookingError } from "../lib/appointments";
import { capacidadeDoDia, getAvailability, getSettings, workingWindows } from "../lib/schedule";
import { bloqueiosDoPeriodo } from "../lib/queries";
import { addDays, shopTimeToUtc, parseDateKey, shopToday, weekdayOf } from "../lib/time";
import { eq, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

async function main() {
  const cfg = await getSettings();
  const barb = (await db.select().from(barbers).where(eq(barbers.active, true)))[0];
  const corte = (await db.select().from(sv).where(eq(sv.slug, "corte")))[0];
  // Um dia em que ele trabalha (e o almoço cabe na jornada).
  let dia = "";
  for (let i = 2; i <= 20 && !dia; i++) {
    const d = addDays(shopToday(), i);
    if (cfg.closedWeekdays.includes(weekdayOf(d))) continue;
    const j = (await workingWindows([barb.id], weekdayOf(d), cfg)).get(barb.id);
    if (j && j.open <= 11 * 60 && j.close >= 14 * 60) dia = d;
  }
  const antes = { inicio: barb.lunchStart, fim: barb.lunchEnd };
  try {
    const capSem = await capacidadeDoDia(dia, barb.id, cfg);
    await db.update(barbers).set({ lunchStart: 12 * 60, lunchEnd: 13 * 60 }).where(eq(barbers.id, barb.id));

    const { slots } = await getAvailability({ dateKey: dia, durationMin: corte.durationMin, barberId: barb.id, ignorarAntecedencia: true });
    const em = (t: string) => slots.find((s) => s.time === t);
    ok("12:00 e 12:30 ficam ocupados", em("12:00")?.available === false && (em("12:30")?.available ?? false) === false);
    ok("horário que invadiria o almoço também não", (em("11:30")?.available ?? false) === false || corte.durationMin <= 30);
    ok("13:00 fica livre", em("13:00")?.available === true, JSON.stringify(em("13:00")));
    ok("antes do almoço segue livre (10:00)", em("10:00")?.available === true);

    let recusou = false;
    try {
      await createBooking({ serviceIds: [corte.id], dateKey: dia, time: "12:00", barberId: barb.id, clientName: "Almoço Teste", clientPhone: "41970300001" });
    } catch (e) {
      recusou = e instanceof BookingError;
    }
    ok("marcar no almoço é recusado (nem encaixe passa)", recusou);

    const { year, month, day } = parseDateKey(dia);
    const bl = await bloqueiosDoPeriodo(shopTimeToUtc(year, month, day, 0), shopTimeToUtc(year, month, day, 24 * 60), barb.id);
    ok("o almoço aparece na agenda do dia", bl.some((b) => b.reason === "Almoço" && b.barberName === barb.shortName && b.id < 0));

    const capCom = await capacidadeDoDia(dia, barb.id, cfg);
    ok("a capacidade do dia perde 1 hora", capSem - capCom === 60, `${capSem} → ${capCom}`);
  } finally {
    await db.update(barbers).set({ lunchStart: antes.inicio, lunchEnd: antes.fim }).where(eq(barbers.id, barb.id));
    await db.delete(users).where(like(users.phone, "4197030%"));
  }
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
