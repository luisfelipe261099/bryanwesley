import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { commissionReport, toCsv, brl } from "@/lib/reports";
import { utcToShopParts } from "@/lib/time";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { barbers } from "@/db/schema";

export const dynamic = "force-dynamic";

/** CSV do fechamento do mês, para conferência e contabilidade. */
export async function GET(req: Request) {
  await requireRole(["ADMIN"]);
  const url = new URL(req.url);
  const hoje = utcToShopParts(new Date());
  const year = Number(url.searchParams.get("ano") ?? hoje.year);
  const month = Number(url.searchParams.get("mes") ?? hoje.month);
  const pedido = Number(url.searchParams.get("barbeiro"));
  const barberId = Number.isInteger(pedido) && pedido > 0 ? pedido : null;

  const lines = await commissionReport(year, month, barberId);

  const COLUNAS = [
    "Data", "Hora", "Cliente", "Serviços", "Barbeiro", "Origem",
    "Base (R$)", "Comissão (%)", "Barbeiro (R$)", "Barbearia (R$)",
  ];
  const csv = toCsv(
    lines.map((l) => ({
      Data: l.data,
      Hora: l.hora,
      Cliente: l.cliente,
      Serviços: l.servicos,
      Barbeiro: l.barbeiro,
      Origem: l.origem,
      "Base (R$)": brl(l.baseCents),
      "Comissão (%)": l.barberPct,
      "Barbeiro (R$)": brl(l.barberCents),
      "Barbearia (R$)": brl(l.shopCents),
    })),
    COLUNAS
  );

  // O fechamento de cada barbeiro sai com o nome dele: baixados um atrás do
  // outro, os arquivos tinham todos o mesmo nome.
  let sufixo = "";
  if (barberId !== null) {
    const b = await db
      .select({ shortName: barbers.shortName })
      .from(barbers)
      .where(eq(barbers.id, barberId))
      .then((r) => r[0]);
    const slug = (b?.shortName ?? `barbeiro-${barberId}`)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    sufixo = `-${slug}`;
  }
  const nome = `comissoes-${year}-${String(month).padStart(2, "0")}${sufixo}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
    },
  });
}
