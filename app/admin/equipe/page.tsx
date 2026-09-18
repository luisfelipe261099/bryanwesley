import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { barberHours, commissionTiers } from "@/db/schema";
import { teamPerformance } from "@/lib/queries";
import { EquipeManager } from "./EquipeManager";

export const dynamic = "force-dynamic";

export default async function AdminEquipe() {
  const [perf, hours, tiers] = await Promise.all([
    // Inclui desativados: é aqui que o dono reativa alguém.
    teamPerformance({ todos: true }),
    db.select().from(barberHours),
    db.select().from(commissionTiers).orderBy(asc(commissionTiers.minRevenueCents)),
  ]);

  return (
    <EquipeManager
      team={perf.map((p) => ({
        id: p.barber.id,
        // Conta de login do barbeiro: a senha é do usuário, não do cartão.
        userId: p.barber.userId,
        name: p.barber.user.name,
        shortName: p.barber.shortName,
        title: p.barber.title,
        commissionPct: p.barber.commissionPct,
        monthlyGoalCents: p.barber.monthlyGoalCents,
        active: p.barber.active,
        baseCents: p.baseCents,
        barberCents: p.barberCents,
        atendimentos: p.atendimentos,
        hours: hours
          .filter((h) => h.barberId === p.barber.id)
          .map((h) => ({
            weekday: h.weekday,
            openMinute: h.openMinute,
            closeMinute: h.closeMinute,
          })),
      }))}
      tiers={tiers}
    />
  );
}
