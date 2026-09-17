import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  listClients,
  type OrdemCliente,
  type SituacaoCliente,
} from "@/lib/queries";
import { toCsv } from "@/lib/reports";
import { formatPhone } from "@/lib/phone";
import { utcToShopParts, labelDayMonth } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Base de clientes em CSV — backup e uso em campanhas.
 *
 * Respeita a busca e o filtro em vigor na tela: exportar sempre a base
 * inteira obrigaria a abrir a planilha e filtrar de novo lá fora.
 */
export async function GET(req: Request) {
  await requireRole(["ADMIN"]);
  const p = new URL(req.url).searchParams;
  const clients = await listClients({
    limit: 5000,
    q: p.get("q") ?? undefined,
    situacao: (p.get("situacao") as SituacaoCliente) ?? undefined,
    ordem: (p.get("ordem") as OrdemCliente) ?? undefined,
  });

  const csv = toCsv(
    clients.map((c) => ({
      Nome: c.name,
      WhatsApp: formatPhone(c.phone),
      Plano: c.plan ?? c.overduePlan ?? "Avulso",
      Situação: c.plan ? "Ativo" : c.overduePlan ? "Vencido" : "—",
      Visitas: c.visits,
      "Próximos horários": c.upcoming,
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
