import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { wahaConfigurado, wahaQr } from "@/lib/providers/waha";

export const dynamic = "force-dynamic";

/**
 * O QR code do WAHA, repassado para o painel. A chave do WAHA fica no
 * servidor: o navegador da dona nunca fala com o WAHA direto.
 */
export async function GET() {
  await requireRole(["ADMIN"]);
  if (!wahaConfigurado()) return new NextResponse(null, { status: 404 });
  const res = await wahaQr();
  if (!res) return new NextResponse(null, { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "no-store",
    },
  });
}
