import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lerEventoWaha, chaveDaMensagem } from "@/lib/whatsapp-inbox";
import { processarMensagem, pausarAtendente } from "@/lib/whatsapp-bot";
import { paraTexto } from "@/lib/providers/whatsapp";
import {
  wahaConfigurado,
  wahaSessao,
  wahaEnviarTexto,
  wahaMarcarLida,
  wahaDigitando,
  wahaTelefoneDoLid,
} from "@/lib/providers/waha";
import { queueFreeText } from "@/lib/notifications";
import { hitRateLimit } from "@/lib/rate-limit";
import { publicBaseUrl } from "@/lib/qr";
import { linkDeAgendamento } from "@/lib/whatsapp-link";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Entrada de mensagens do WAHA (o WhatsApp da barbearia conectado por QR
 * code num servidor próprio — veja deploy/waha).
 *
 * Cada mensagem que chega passa pelo atendente (lib/whatsapp-bot) e a
 * resposta volta pelo WAHA como texto numerado. O que a barbearia manda
 * pelo celular também chega aqui: é o sinal para o atendente se calar
 * naquela conversa e deixar a pessoa falar com gente.
 *
 * O painel (Mensagens → Conectar) cria a sessão no WAHA já apontando para
 * esta rota, com a chave WAHA_HMAC_KEY. Sem as variáveis, 503.
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

  const ev = lerEventoWaha(corpo, wahaSessao());
  if (ev.tipo === "ignorar") return NextResponse.json({ ignorada: ev.motivo });

  // O WAHA reenvia quando a resposta demora: a mesma mensagem não pode
  // virar duas respostas (nem duas tentativas de marcar o mesmo horário).
  const primeira = await hitRateLimit(chaveDaMensagem(ev.id), 1, 24 * 3600_000);
  if (!primeira.ok) return NextResponse.json({ repetida: true });

  try {
    const fone =
      ev.de ?? (ev.chatId.endsWith("@lid") ? await wahaTelefoneDoLid(ev.chatId) : null);

    if (ev.tipo === "humano") {
      const ate = fone ? await pausarAtendente(fone) : null;
      return NextResponse.json({ pausado: Boolean(ate) });
    }

    if (!fone) {
      // Sem o número não há como achar o cadastro nem marcar em nome de
      // alguém. O link do site resolve — uma vez a cada 15 minutos.
      const vez = await hitRateLimit(`walid:${ev.chatId}`, 1, 15 * 60_000);
      if (vez.ok) {
        await wahaEnviarTexto(
          ev.chatId,
          `Oi! Para marcar seu horário, é por aqui: ${linkDeAgendamento(publicBaseUrl())}`
        );
      }
      return NextResponse.json({ semTelefone: true });
    }

    const saidas = await processarMensagem({
      de: fone,
      texto: ev.texto,
      nomeDoPerfil: ev.nomeDoPerfil,
      midia: ev.midia,
    });

    let respondidas = 0;
    if (saidas.length) {
      // Visto, "digitando…", uma pausa curta: o jeito de gente responder,
      // que é o que o WAHA recomenda para o número não parecer robô.
      await wahaMarcarLida(ev.chatId);
      await wahaDigitando(ev.chatId, true);
      await espera(900 + Math.random() * 900);
      await wahaDigitando(ev.chatId, false);

      for (const [i, s] of saidas.entries()) {
        if (i > 0) await espera(500 + Math.random() * 500);
        const r = await wahaEnviarTexto(ev.chatId, paraTexto(s.mensagem));
        if (r.sent) {
          respondidas++;
        } else if (s.mensagem.tipo === "texto") {
          // Texto (como a confirmação com o código) não se perde: vai para
          // a fila e sai na próxima varredura. Menu, não — um menu de
          // horários entregue depois já estaria velho.
          await queueFreeText({ phone: fone, body: s.mensagem.texto });
        }
      }
    }
    return NextResponse.json({ respondidas });
  } catch (e) {
    // Sempre 200: para o WAHA, erro é motivo para reenviar — e a mensagem
    // já foi marcada como vista.
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
