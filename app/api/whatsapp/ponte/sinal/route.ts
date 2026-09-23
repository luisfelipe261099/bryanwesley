import { NextResponse } from "next/server";
import { autenticarPonte, receberSinal, type Sinal } from "@/lib/ponte";

export const dynamic = "force-dynamic";

/**
 * O sinal periódico da ponte: conta como está o número (e manda o QR
 * code), devolve os resultados dos envios e leva as ordens do painel e
 * as mensagens da fila.
 */
export async function POST(req: Request) {
  if (!(await autenticarPonte(req))) {
    return NextResponse.json({ error: "ponte não autorizada" }, { status: 401 });
  }
  let sinal: Sinal;
  try {
    sinal = (await req.json()) as Sinal;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }
  return NextResponse.json(await receberSinal(sinal ?? {}));
}
