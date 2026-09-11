import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { commissionReport, toCsv, brl } from "@/lib/reports";
import { utcToShopParts } from "@/lib/time";

export const dynamic = "force-dynamic";

/** CSV do fechamento do mês, para conferência e contabilidade. */
export async function GET(req: Request) {
  await requireRole(["ADMIN"]);
  const url = new URL(req.url);
  const hoje = utcToShopParts(new Date());
  const year = Number(url.searchParams.get("ano") ?? hoje.year);
  const month = Number(url.searchParams.get("mes") ?? hoje.month);
  const barberId = url.searchParams.get("barbeiro");

  const lines = await commissionReport(
    year,
    month,
    barberId ? Number(barberId) : null
  );

  const csv = toCsv(
    lines.map((l) => ({
      Data: l.data,
      Hora: l.hora,
      Cliente: l.cliente,
      Barbeiro: l.barbeiro,
      Origem: l.origem,
      "Base (R$)": brl(l.baseCents),
      "Comissão (%)": l.barberPct,
      "Barbeiro (R$)": brl(l.barberCents),
      "Barbearia (R$)": brl(l.shopCents),
    }))
  );

  const nome = `comissoes-${year}-${String(month).padStart(2, "0")}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}
