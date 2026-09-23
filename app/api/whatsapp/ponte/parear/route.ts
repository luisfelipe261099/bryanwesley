import { NextResponse } from "next/server";
import { parear } from "@/lib/ponte";
import { hitRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * O instalador troca o código de uso único (gerado no painel) pelo
 * segredo da ponte. Endereço público: o código vale 30 minutos, uma vez,
 * e cada origem tem 10 tentativas por hora.
 */
export async function POST(req: Request) {
  const origem = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "?").trim();
  const [porOrigem, geral] = await Promise.all([
    hitRateLimit(`ponte:parear:${origem}`, 10, 3600_000),
    hitRateLimit("ponte:parear", 60, 3600_000),
  ]);
  if (!porOrigem.ok || !geral.ok) {
    return NextResponse.json({ error: "Muitas tentativas. Espere um pouco." }, { status: 429 });
  }

  let codigo = "";
  try {
    codigo = String(((await req.json()) as { codigo?: unknown })?.codigo ?? "");
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const segredo = await parear(codigo);
  if (!segredo) {
    return NextResponse.json(
      { error: "Código inválido ou vencido. Gere outro comando no painel." },
      { status: 401 }
    );
  }
  return NextResponse.json({ segredo });
}
