import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { extrairMensagens } from "@/lib/whatsapp-inbox";
import { processarMensagem } from "@/lib/whatsapp-bot";
import { sendWhatsappMessage, isWhatsappConfigured } from "@/lib/providers/whatsapp";
import { queueFreeText } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Entrada de mensagens do WhatsApp (Cloud API da Meta).
 *
 * É o outro lado da ponte: até aqui o sistema só FALAVA no WhatsApp
 * (confirmações e lembretes). Agora ele CONVERSA — o cliente escolhe o
 * serviço, vê os dias, vê os horários livres e fecha o agendamento sem
 * sair do WhatsApp, e o horário entra na agenda como qualquer outro.
 *
 * Como ligar (uma vez, no painel da Meta):
 *   1. WhatsApp → Configuração → Webhooks → editar
 *   2. URL de callback: https://SEU-SITE/api/whatsapp/webhook
 *   3. Token de verificação: o valor de WHATSAPP_VERIFY_TOKEN
 *   4. Assinar o campo "messages"
 *
 * Sem as variáveis configuradas a rota responde 503 e nada acontece — o
 * resto do sistema segue funcionando igual.
 */

/** A Meta confere o endereço chamando com GET antes de assinar. */
export async function GET(req: Request) {
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!esperado) {
    return NextResponse.json(
      { error: "WHATSAPP_VERIFY_TOKEN não configurado" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge") ?? "";

  if (modo === "subscribe" && token === esperado) {
    // A Meta espera o desafio de volta em texto puro.
    return new Response(desafio, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "verificação recusada" }, { status: 403 });
}

export async function POST(req: Request) {
  const cru = await req.text();

  // Assinatura: garante que o POST veio mesmo da Meta. Sem o app secret
  // configurado a rota não aceita nada — este endereço é público.
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) {
    return NextResponse.json(
      { error: "WHATSAPP_APP_SECRET não configurado" },
      { status: 503 }
    );
  }
  if (!assinaturaConfere(cru, req.headers.get("x-hub-signature-256"), segredo)) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(cru);
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const mensagens = extrairMensagens(corpo);
  let respondidas = 0;

  for (const msg of mensagens) {
    try {
      const respostas = await processarMensagem(msg);
      for (const r of respostas) {
        // A janela de resposta do WhatsApp está aberta agora (a pessoa
        // acabou de escrever), então a mensagem sai na hora. Se o envio
        // falhar, o que for texto entra na fila e sai na próxima
        // varredura em vez de se perder. Lista e botões não dá: fora da
        // janela de 24h a Meta recusa mensagem interativa, e uma lista
        // de horários entregue amanhã já estaria errada.
        const enviado = isWhatsappConfigured()
          ? await sendWhatsappMessage(r.para, r.mensagem)
          : { sent: false as const, reason: "sem credenciais", retryable: true };
        if (!enviado.sent && r.mensagem.tipo === "texto") {
          await queueFreeText({ phone: r.para, body: r.mensagem.texto });
        }
        respondidas++;
      }
    } catch (e) {
      // Uma mensagem problemática não pode derrubar o lote: a Meta
      // reenvia tudo quando a rota responde erro.
      console.error("Falha ao responder mensagem do WhatsApp:", e);
    }
  }

  // Sempre 200: para a Meta, qualquer outra coisa é motivo para reenviar.
  return NextResponse.json({ recebidas: mensagens.length, respondidas });
}

function assinaturaConfere(
  corpo: string,
  cabecalho: string | null,
  segredo: string
) {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", segredo).update(corpo).digest("hex");
  const veio = cabecalho.slice("sha256=".length);
  if (veio.length !== esperado.length) return false;
  // Comparação de tempo constante: comparar string a string vaza o
  // quanto do prefixo já está certo.
  return timingSafeEqual(Buffer.from(veio, "hex"), Buffer.from(esperado, "hex"));
}
