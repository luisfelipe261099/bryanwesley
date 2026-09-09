import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { barberHours, commissionTiers } from "@/db/schema";
import { teamPerformance } from "@/lib/queries";
import { EquipeManager } from "./EquipeManager";

export const dynamic = "force-dynamic";

export default async function AdminEquipe() {
  const [perf, hours, tiers] = await Promise.all([
    teamPerformance(),
    db.select().from(barberHours),
    db.select().from(commissionTiers).orderBy(asc(commissionTiers.minRevenueCents)),
  ]);

  return (
    <EquipeManager
      team={perf.map((p) => ({
        id: p.barber.id,
        name: p.barber.user.name,
        shortName: p.barber.shortName,
        title: p.barber.title,
        commissionPct: p.barber.commissionPct,
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
