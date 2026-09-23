import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { atenderEventoWaha } from "@/lib/whatsapp-atendimento";
import {
  wahaConfigurado,
  wahaSessao,
  wahaEnviarTexto,
  wahaMarcarLida,
  wahaDigitando,
  wahaTelefoneDoLid,
} from "@/lib/providers/waha";
import { queueFreeText } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Entrada de mensagens do WAHA ligado direto (o site fala com o WAHA por
 * HTTPS — veja deploy/waha). Quem instalou pela ponte não usa esta rota:
 * lá o servidor da barbearia busca tudo em /api/whatsapp/ponte.
 *
 * Cada mensagem passa pelo atendente e a resposta volta pelo WAHA como
 * texto numerado. O que a barbearia manda pelo celular também chega
 * aqui: é o sinal para o atendente se calar naquela conversa.
 */
export async function POST(req: Request) {
  const cru = await req.text();

  // Este endereço é público: só vale o que vier assinado com a chave que
  // só o WAHA e este site conhecem.
  const chave = process.env.WAHA_HMAC_KEY;
  if (!chave || !wahaConfigurado()) {
    return NextResponse.json(
      { error: "WAHA não configurado (WAHA_URL, WAHA_API_KEY, WAHA_HMAC_KEY)" },
      { status: 503 }
    );
  }
  if (!assinaturaConfere(cru, req.headers.get("x-webhook-hmac"), chave)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(cru);
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  try {
    const r = await atenderEventoWaha(corpo, {
      sessao: wahaSessao(),
      telefoneDoLid: wahaTelefoneDoLid,
    });
    if (r.acoes.length === 0) {
      return NextResponse.json({
        ignorada: r.ignorada,
        repetida: r.repetida,
        pausado: r.pausado,
        semTelefone: r.semTelefone,
      });
    }

    // Visto, "digitando…", uma pausa curta: o jeito de gente responder,
    // que é o que o WAHA recomenda para o número não parecer robô.
    const chatId = r.acoes[0].chatId;
    await wahaMarcarLida(chatId);
    await wahaDigitando(chatId, true);
    await espera(900 + Math.random() * 900);
    await wahaDigitando(chatId, false);

    let respondidas = 0;
    for (const [i, a] of r.acoes.entries()) {
      if (i > 0) await espera(500 + Math.random() * 500);
      const envio = await wahaEnviarTexto(a.chatId, a.texto);
      if (envio.sent) respondidas++;
      else if (a.guardarSeFalhar && a.fone) await queueFreeText({ phone: a.fone, body: a.texto });
    }
    return NextResponse.json({ respondidas, ...(r.semTelefone ? { semTelefone: true } : {}) });
  } catch (e) {
    // Sempre 200: para o WAHA, erro é motivo para reenviar.
    console.error("Falha ao responder mensagem do WAHA:", e);
    return NextResponse.json({ erro: true });
  }
}

function espera(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** X-Webhook-Hmac: HMAC-SHA512 do corpo cru, em hexadecimal. */
function assinaturaConfere(corpo: string, cabecalho: string | null, chave: string) {
  if (!cabecalho || !/^[0-9a-f]+$/i.test(cabecalho)) return false;
  const esperado = createHmac("sha512", chave).update(corpo).digest("hex");
  if (cabecalho.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(cabecalho.toLowerCase(), "hex"), Buffer.from(esperado, "hex"));
}
