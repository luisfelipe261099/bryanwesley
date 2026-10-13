import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { barberHours, commissionTiers } from "@/db/schema";
import { teamPerformance } from "@/lib/queries";
import { getSettings } from "@/lib/schedule";
import { formatPhone } from "@/lib/phone";
import { requireRole } from "@/lib/auth";
import { EquipeManager } from "./EquipeManager";

export const dynamic = "force-dynamic";

export default async function AdminEquipe() {
  // O layout já conferiu o papel; aqui só se pega quem está mexendo.
  const session = await requireRole(["ADMIN"]);
  const [perf, hours, tiers, settings] = await Promise.all([
    // Inclui desativados: é aqui que o dono reativa alguém.
    teamPerformance({ todos: true }),
    db.select().from(barberHours),
    db.select().from(commissionTiers).orderBy(asc(commissionTiers.minRevenueCents)),
    getSettings(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Equipe</h1>
        <p className="mt-1.5 text-sm text-steel-400">
          Quem atende na barbearia: login, comissão, meta do mês e os dias de
          folga de cada um. Barbeiro novo entra em &ldquo;Cadastrar
          barbeiro&rdquo;, logo depois dos cartões.
        </p>
      </div>
      <EquipeManager
        euUserId={session.id}
        team={perf.map((p) => ({
          id: p.barber.id,
          // Conta de login do barbeiro: a senha é do usuário, não do cartão.
          userId: p.barber.userId,
          name: p.barber.user.name,
          phone: formatPhone(p.barber.user.phone),
          email: p.barber.user.email ?? "",
          isAdmin: p.barber.user.role === "ADMIN",
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
        comissaoPadrao={settings.defaultBarberPct}
      />
    </div>
  );
}
