import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { services as servicesTable } from "@/db/schema";
import { listPlans } from "@/lib/queries";
import { CatalogoManager } from "./CatalogoManager";

export const dynamic = "force-dynamic";

export default async function AdminCatalogo() {
  // Inclui inativos: o admin precisa poder reativar.
  const [services, plans] = await Promise.all([
    db.select().from(servicesTable).orderBy(asc(servicesTable.sortOrder)),
    listPlans(),
  ]);

  return (
    <CatalogoManager
      services={services}
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
      }))}
    />
  );
}
