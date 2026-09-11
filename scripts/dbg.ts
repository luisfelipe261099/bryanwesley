import "../db/load-env";
import { db, pool } from "../db/client";
import { users, plans, services, subscriptions, planRequests } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createBooking } from "../lib/appointments";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { getSettings } from "../lib/schedule";

async function main() {
  const settings = await getSettings();
  const cliente = (await db.select().from(users).where(eq(users.role, "CLIENT")).limit(1))[0];
  const corte = (await db.select().from(services).where(eq(services.slug, "corte")))[0];
  console.log("cliente:", cliente?.id, cliente?.name);

  let dia = addDays(shopToday(), 5);
  while (settings.closedWeekdays.includes(weekdayOf(dia))) dia = addDays(dia, 1);

  console.log("\n1) createBooking COM userId");
  try {
    const a = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: "11:00", barberId: null,
      clientName: cliente.name, clientPhone: cliente.phone, userId: cliente.id,
    });
    console.log("   OK id=", a.id, "code=", a.code);
  } catch (e) {
    console.log("   ERRO:", (e as Error).name, (e as Error).message);
    console.log((e as Error).stack?.split("\n").slice(0,5).join("\n"));
  }

  console.log("\n2) query planRequests");
  try {
    const r = await db.query.planRequests.findFirst({
      where: and(eq(planRequests.userId, cliente.id), eq(planRequests.status, "ABERTA")),
    });
    console.log("   OK:", r ? "achou" : "vazio");
  } catch (e) {
    console.log("   ERRO:", (e as Error).message);
  }

  console.log("\n3) query subscriptions com orderBy callback");
  try {
    const s = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, cliente.id),
      orderBy: (t, { desc }) => [desc(t.startedAt)],
    });
    console.log("   OK:", s ? "achou" : "vazio");
  } catch (e) {
    console.log("   ERRO:", (e as Error).message);
  }

  console.log("\n4) insert planRequests");
  try {
    const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
    await db.insert(planRequests).values({ userId: cliente.id, planId: gold.id, cycle: "ANUAL" });
    console.log("   OK inserido");
  } catch (e) {
    console.log("   ERRO:", (e as Error).message);
  }

  await pool.end();
}
main().catch(async (e) => { console.error("FATAL", e); await pool.end(); process.exit(1); });
