import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { services as servicesTable } from "@/db/schema";
import { listPlans } from "@/lib/queries";
import { carregarRegras } from "@/lib/precos-server";
import { CatalogoManager } from "./CatalogoManager";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminCatalogo() {
  // Confere a sessão aqui também: o Next não roda o layout de novo na
  // navegação pelo app nem na volta de uma Server Action.
  await requireRole(["ADMIN"]);
  // Inclui inativos: o admin precisa poder reativar.
  const [services, plans, regras] = await Promise.all([
    db.select().from(servicesTable).orderBy(asc(servicesTable.sortOrder)),
    listPlans({ todos: true }),
    carregarRegras(),
  ]);

  return (
    <CatalogoManager
      services={services}
      regras={regras}
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        kicker: p.kicker,
        tagline: p.tagline,
        priceCents: p.priceCents,
        annualPriceCents: p.annualPriceCents,
        features: p.features,
        highlight: p.highlight,
        badge: p.badge,
        active: p.active,
        serviceIds: p.covers.map((c) => c.id),
        quotas: Object.fromEntries(p.covers.map((c) => [c.id, c.quota])),
      }))}
    />
  );
}
