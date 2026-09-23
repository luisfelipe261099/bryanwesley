import { NextResponse } from "next/server";
import { autenticarPonte } from "@/lib/ponte";
import { atenderEventoWaha } from "@/lib/whatsapp-atendimento";
import { telefoneDoWhatsapp } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mensagem que chegou no WAHA, repassada pela ponte. A resposta diz o que
 * mandar — a ponte manda, com "visto" e "digitando…" antes.
 *
 * Número escondido ("@lid"): a ponte já pergunta ao WAHA e manda o
 * telefone em payload._ponte.pn, porque daqui não dá para falar com o
 * WAHA.
 */
export async function POST(req: Request) {
  if (!(await autenticarPonte(req))) {
    return NextResponse.json({ error: "ponte não autorizada" }, { status: 401 });
  }
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }
  const pn = (corpo as { payload?: { _ponte?: { pn?: unknown } } })?.payload?._ponte?.pn;
  const r = await atenderEventoWaha(corpo, {
    sessao: "default",
    telefoneDoLid: async () => (typeof pn === "string" && pn ? telefoneDoWhatsapp(pn) : null),
  });
  return NextResponse.json(r);
}
