// Salão: passar o atendimento para outro barbeiro (mesmo horário).
import "../db/load-env";
import { db, pool } from "../db/client";
import { appointments, appointmentServices, bookingLocks, services as servicesTable } from "../db/schema";
import { getActiveBarbers, getSettings } from "../lib/schedule";
import { createBooking, transitionAppointment, trocarBarbeiroDoAtendimento, BookingError } from "../lib/appointments";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { eq, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));
const erro = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return e instanceof BookingError ? e.message : `inesperado: ${e}`; }
};

async function limpar() {
  const meus = await db.select({ id: appointments.id }).from(appointments).where(like(appointments.clientPhone, "4197039%"));
  for (const a of meus) {
    await db.delete(appointmentServices).where(eq(appointmentServices.appointmentId, a.id));
    await db.delete(appointments).where(eq(appointments.id, a.id));
  }
  await db.delete(bookingLocks);
}

async function main() {
  await limpar();
  const settings = await getSettings();
  const [a, b] = await getActiveBarbers();
  const corte = (await db.select().from(servicesTable)).find((s) => s.slug === "corte")!;
  let dateKey = addDays(shopToday(), 6);
  while (settings.closedWeekdays.includes(weekdayOf(dateKey))) dateKey = addDays(dateKey, 1);
  const marcar = (barberId: number, time: string, fone: string, nome: string) =>
    createBooking({ serviceIds: [corte.id], dateKey, time, barberId, clientName: nome, clientPhone: fone, skipConfirmation: true });

  const x = await marcar(a.id, "10:00", "41970390001", "Cliente Um");
  const y = await marcar(b.id, "10:00", "41970390002", "Cliente Dois");
  const z = await marcar(a.id, "11:00", "41970390003", "Cliente Tres");

  console.log("\n1. Barbeiro ocupado no mesmo horário");
  const e1 = await erro(() => trocarBarbeiroDoAtendimento(x.id, b.id));
  ok("recusa e diz quem está no horário", !!e1 && e1.includes("já tem cliente") && e1.includes("Cliente"), String(e1));
  ok("atendimento continua com o barbeiro antigo", (await db.query.appointments.findFirst({ where: eq(appointments.id, x.id) }))!.barberId === a.id);

  console.log("\n2. Barbeiro livre");
  const r = await trocarBarbeiroDoAtendimento(z.id, b.id);
  const z2 = (await db.query.appointments.findFirst({ where: eq(appointments.id, z.id) }))!;
  ok("passa para o barbeiro novo", z2.barberId === b.id && r.barbeiro === b.shortName);
  ok("mesmo horário, mesmo código e situação", z2.startsAt.getTime() === z.startsAt.getTime() && z2.code === z.code && z2.status === z.status);
  ok("percentual é o do barbeiro novo", z2.barberPctSnapshot === (b.commissionPct ?? settings.defaultBarberPct));
  const e2 = await erro(() => marcar(b.id, "11:00", "41970390004", "Cliente Quatro"));
  ok("horário do barbeiro novo fica ocupado", !!e2, String(e2));
  const livre = await erro(() => marcar(a.id, "11:00", "41970390005", "Cliente Cinco"));
  ok("horário do barbeiro antigo volta a ficar livre", livre === null, String(livre));

  console.log("\n3. Regras");
  ok("mesmo barbeiro: recusa", !!(await erro(() => trocarBarbeiroDoAtendimento(z.id, b.id))));
  ok("barbeiro que não existe: recusa", !!(await erro(() => trocarBarbeiroDoAtendimento(x.id, 999999))));
  await transitionAppointment(y.id, "CANCELADO", {});
  ok("cancelado: recusa", !!(await erro(() => trocarBarbeiroDoAtendimento(y.id, a.id))));
  const r2 = await erro(() => trocarBarbeiroDoAtendimento(x.id, b.id));
  ok("depois que o outro foi cancelado, a troca passa", r2 === null, String(r2));

  await limpar();
  console.log(`\n${p} ok, ${f} falhas`);
  await pool.end();
  process.exit(f ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
