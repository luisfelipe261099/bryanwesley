// Ajustes da operação: dados da barbearia, regras da agenda e bloqueios.
//
// Isto morava em /admin/agenda, o que fazia a aba "Agenda" abrir um
// formulário de configuração em vez dos horários marcados. A agenda de
// verdade é a lista; aqui ficam as regras que mandam nela.
import { asc, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduleBlocks } from "@/db/schema";
import { getSettings } from "@/lib/schedule";
import { listTeam } from "@/lib/queries";
import { shopToday, labelFullDate, formatShopTime, utcToShopParts } from "@/lib/time";
import { AgendaSettings, BlocksManager, ShopInfo } from "./AgendaSettings";

export const dynamic = "force-dynamic";

export default async function AdminAjustes() {
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
      <div>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Ajustes</h1>
        <p className="mt-1.5 text-sm text-steel-400">
          Os dados da barbearia, as regras que valem para a agenda e os
          bloqueios de horário. Para ver os agendamentos, use a aba Agenda.
        </p>
      </div>
      <ShopInfo
        settings={{
          shopName: settings.shopName,
          shopUnit: settings.shopUnit,
          shopPhone: settings.shopPhone,
          shopAddress: settings.shopAddress,
          shopInstagram: settings.shopInstagram,
          shopHoursLabel: settings.shopHoursLabel,
        }}
      />
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
