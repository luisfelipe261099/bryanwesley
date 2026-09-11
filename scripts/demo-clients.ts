// Clientes plausíveis para a apresentação ao cliente final.
// Idempotente e restrito à demonstração — não roda em produção.
import "../db/load-env";
import { eq, and } from "drizzle-orm";
import { db, pool } from "../db/client";
import { users, subscriptions, plans, recurringSlots, barbers, services } from "../db/schema";
import { shopToday } from "../lib/time";

const CLIENTES = [
  { nome: "Ricardo Mendes", fone: "41988110001", plano: "diamond", fixo: true },
  { nome: "Fernando Souza", fone: "41988110002", plano: "gold", fixo: false },
  { nome: "Thiago Castro", fone: "41988110003", plano: null, fixo: false },
  { nome: "Bruno Carvalho", fone: "41988110004", plano: "silver", fixo: false },
  { nome: "Gabriel Rocha", fone: "41988110005", plano: null, fixo: false },
  { nome: "Felipe Nunes", fone: "41988110006", plano: "gold", fixo: true },
  { nome: "Henrique Dias", fone: "41988110007", plano: null, fixo: false },
  { nome: "Marcos Vianna", fone: "41988110008", plano: null, fixo: false },
];

async function main() {
  const todosPlanos = await db.select().from(plans);
  const barbeiro = (await db.select().from(barbers))[0];
  const corte = (await db.select().from(services).where(eq(services.slug, "corte")))[0];

  for (const c of CLIENTES) {
    let user = (await db.select().from(users).where(eq(users.phone, c.fone)))[0];
    if (!user) {
      await db.insert(users).values({ name: c.nome, phone: c.fone, role: "CLIENT" });
      user = (await db.select().from(users).where(eq(users.phone, c.fone)))[0];
    } else {
      await db.update(users).set({ name: c.nome }).where(eq(users.id, user.id));
    }

    if (c.plano) {
      const plano = todosPlanos.find((p) => p.slug === c.plano)!;
      const existe = (await db.select().from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "ATIVA"))))[0];
      if (!existe) {
        const renova = new Date();
        renova.setDate(renova.getDate() + 12);
        await db.insert(subscriptions).values({
          userId: user.id, planId: plano.id, renewsAt: renova,
        });
      }
    }

    if (c.fixo) {
      const temFixo = (await db.select().from(recurringSlots)
        .where(and(eq(recurringSlots.userId, user.id), eq(recurringSlots.active, true))))[0];
      if (!temFixo) {
        await db.insert(recurringSlots).values({
          userId: user.id, barberId: barbeiro.id, frequency: "SEMANAL",
          weekday: 5, minutesOfDay: 10 * 60, serviceIds: [corte.id],
          startsOn: shopToday(),
        });
      }
    }
  }
  console.log(`✓ ${CLIENTES.length} clientes de demonstração`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
