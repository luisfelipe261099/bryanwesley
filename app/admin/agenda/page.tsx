import { asc, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduleBlocks } from "@/db/schema";
import { getSettings } from "@/lib/schedule";
import { listTeam } from "@/lib/queries";
import { shopToday, labelFullDate, formatShopTime, utcToShopParts } from "@/lib/time";
import { AgendaSettings, BlocksManager } from "./AgendaSettings";

export const dynamic = "force-dynamic";

export default async function AdminAgenda() {
  const [settings, team, blocks] = await Promise.all([
    getSettings(),
    listTeam(),
    db
      .select()
      .from(scheduleBlocks)
      .where(gte(scheduleBlocks.endsAt, new Date()))
      .orderBy(asc(scheduleBlocks.startsAt))
      .limit(50),
  ]);

  return (
    <div className="space-y-5">
      <AgendaSettings settings={settings} />
      <BlocksManager
        today={shopToday()}
        team={team.map((b) => ({ id: b.id, shortName: b.shortName }))}
        blocks={blocks.map((b) => ({
          id: b.id,
          barberId: b.barberId,
          reason: b.reason,
          label: `${labelFullDate(utcToShopParts(b.startsAt).dateKey)} · ${formatShopTime(
            b.startsAt
          )}–${formatShopTime(b.endsAt)}`,
        }))}
      />
    </div>
  );
}
