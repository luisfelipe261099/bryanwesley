import { listClients, listPlans, countClients } from "@/lib/queries";
import { utcToShopParts, labelDayMonth } from "@/lib/time";
import { ClientesManager } from "./ClientesManager";

export const dynamic = "force-dynamic";

/** Quantos cabem numa página do painel. */
const POR_PAGINA = 100;

export default async function AdminClientes({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const [clients, plans, total] = await Promise.all([
    listClients(POR_PAGINA, q),
    listPlans(),
    countClients(q),
  ]);

  return (
    <ClientesManager
      busca={q}
      total={total}
      mostrando={clients.length}
      clients={clients.map((c) => ({
        ...c,
        lastVisit: c.lastVisit
          ? labelDayMonth(utcToShopParts(c.lastVisit).dateKey)
          : null,
        renewsAt: c.renewsAt
          ? labelDayMonth(utcToShopParts(c.renewsAt).dateKey)
          : null,
      }))}
      plans={plans.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
