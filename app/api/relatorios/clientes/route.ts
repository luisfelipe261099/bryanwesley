import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listClients } from "@/lib/queries";
import { toCsv } from "@/lib/reports";
import { formatPhone } from "@/lib/phone";
import { utcToShopParts, labelDayMonth } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Base de clientes em CSV — backup e uso em campanhas. */
export async function GET() {
  await requireRole(["ADMIN"]);
  const clients = await listClients(5000);

  const csv = toCsv(
    clients.map((c) => ({
      Nome: c.name,
      WhatsApp: formatPhone(c.phone),
      Plano: c.plan ?? c.overduePlan ?? "Avulso",
      Situação: c.plan ? "Ativo" : c.overduePlan ? "Vencido" : "—",
      Visitas: c.visits,
      "Última visita": c.lastVisit
        ? labelDayMonth(utcToShopParts(c.lastVisit).dateKey)
        : "",
      "Tem conta": c.hasAccount ? "Sim" : "Não",
    }))
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes.csv"`,
    },
  });
}
