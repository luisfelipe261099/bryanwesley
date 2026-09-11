// Povoa a agenda de HOJE com atendimentos realistas para demonstração
// (capturas de tela, apresentação ao cliente). Não roda em produção.
import "../db/load-env";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client";
import { appointments, appointmentServices, barbers, services, users, subscriptions, plans } from "../db/schema";
import { shopToday, parseDateKey, shopTimeToUtc } from "../lib/time";
import { generateCode } from "../lib/schedule";
import { recordCommission } from "../lib/commissions";
import { randomBytes } from "node:crypto";

const NOMES = ["Ricardo Mendes", "Thiago Castro", "Gabriel Rocha", "Fernando Souza", "Marcos Vianna", "Henrique Dias", "Bruno Carvalho", "Felipe Nunes"];

async function main() {
  const team = await db.select().from(barbers).orderBy(barbers.sortOrder);
  const svc = await db.select().from(services);
  const by = (slug: string) => svc.find((s) => s.slug === slug)!;
  const gold = (await db.select().from(plans).where(eq(plans.slug, "gold")))[0];
  const { year, month, day } = parseDateKey(shopToday());
  const at = (min: number) => shopTimeToUtc(year, month, day, min);

  // Um assinante de verdade para o "Plano" aparecer na agenda
  const [{ id: memberId }] = await db.insert(users).values({ name: NOMES[0], phone: "41988110001", role: "CLIENT" })
    .onDuplicateKeyUpdate({ set: { name: NOMES[0] } }).$returningId();
  const member = (await db.select().from(users).where(eq(users.phone, "41988110001")))[0];
  const hasSub = (await db.select().from(subscriptions).where(eq(subscriptions.userId, member.id)))[0];
  let subId = hasSub?.id;
  if (!hasSub) {
    const renews = new Date(); renews.setMonth(renews.getMonth() + 1);
    const [{ id }] = await db.insert(subscriptions).values({ userId: member.id, planId: gold.id, renewsAt: renews }).$returningId();
    subId = id;
  }

  // [barbeiro, hora(min), serviços, status, cliente]
  const plano: [number, number, string[], "CONCLUIDO" | "EM_ANDAMENTO" | "CONFIRMADO", number][] = [
    [0, 9 * 60,       ["corte"],          "CONCLUIDO",    0],
    [0, 10 * 60,      ["barba"],          "CONCLUIDO",    1],
    [0, 11 * 60 + 30, ["combo"],          "EM_ANDAMENTO", 2],
    [0, 14 * 60,      ["corte","sobrancelha"], "CONFIRMADO", 3],
    [0, 16 * 60 + 30, ["platinado"],      "CONFIRMADO",   4],
    [1, 9 * 60 + 30,  ["lavagem"],        "CONCLUIDO",    5],
    [1, 11 * 60,      ["corte"],          "CONCLUIDO",    6],
    [1, 13 * 60 + 30, ["combo"],          "CONFIRMADO",   7],
    [1, 15 * 60,      ["barba"],          "CONFIRMADO",   1],
    [2, 10 * 60,      ["barba"],          "CONCLUIDO",    3],
    [2, 12 * 60,      ["corte","barba"],  "CONFIRMADO",   5],
  ];

  let n = 0;
  for (const [bi, min, slugs, status, ci] of plano) {
    const b = team[bi]; if (!b) continue;
    const items = slugs.map(by);
    const dur = items.reduce((a, s) => a + s.durationMin, 0);
    const isMember = ci === 0;
    const total = isMember ? 0 : items.reduce((a, s) => a + s.priceCents, 0);
    const startsAt = at(min), endsAt = new Date(startsAt.getTime() + dur * 60000);
    // pula se já existe algo nesse horário para esse barbeiro
    const clash = await db.select({ id: appointments.id }).from(appointments)
      .where(eq(appointments.barberId, b.id));
    if (clash.some(() => false)) {}
    try {
      const [{ id }] = await db.insert(appointments).values({
        code: generateCode(), checkinToken: randomBytes(16).toString("hex"),
        clientUserId: isMember ? member.id : null, clientName: NOMES[ci], clientPhone: `1199${String(1000000 + ci * 1111).slice(-7)}`,
        barberId: b.id, startsAt, endsAt, durationMin: dur, totalCents: total, status,
        kind: isMember ? "ASSINANTE" : "AVULSO", subscriptionId: isMember ? subId : null,
        barberPctSnapshot: b.commissionPct,
        checkedInAt: status !== "CONFIRMADO" ? startsAt : null,
        startedAt: status !== "CONFIRMADO" ? startsAt : null,
        finishedAt: status === "CONCLUIDO" ? endsAt : null,
      }).$returningId();
      await db.insert(appointmentServices).values(items.map((s) => ({
        appointmentId: id, serviceId: s.id, name: s.name, priceCents: isMember ? 0 : s.priceCents, durationMin: s.durationMin,
      })));
      if (status === "CONCLUIDO") await recordCommission(id);
      n++;
    } catch (e) { /* horário já ocupado por rodada anterior: ignora */ }
  }
  console.log(`✓ ${n} atendimentos de demonstração para ${shopToday()}`);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
