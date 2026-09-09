import { listClients, listPlans } from "@/lib/queries";
import { utcToShopParts, labelDayMonth } from "@/lib/time";
import { ClientesManager } from "./ClientesManager";

export const dynamic = "force-dynamic";

export default async function AdminClientes() {
  const [clients, plans] = await Promise.all([listClients(200), listPlans()]);

  return (
    <ClientesManager
      clients={clients.map((c) => ({
        ...c,
        lastVisit: c.lastVisit
          ? labelDayMonth(utcToShopParts(c.lastVisit).dateKey)
          : null,
      }))}
      plans={plans.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
