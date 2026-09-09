// ───────────────────────────────────────────────────────────
// Adaptador de envio. Hoje fala com a Cloud API do WhatsApp;
// trocar de provedor é trocar este arquivo, nada mais.
//
// Sem credenciais configuradas o adaptador entra em modo "registro":
// a mensagem fica gravada e visível no painel, mas nada é enviado.
// Assim o sistema funciona antes de o número ser aprovado.
// ───────────────────────────────────────────────────────────

export type SendResult =
  | { sent: true; providerId?: string }
  | { sent: false; reason: string; retryable: boolean };

export function isWhatsappConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export async function sendWhatsapp(
  phoneDigits: string,
  body: string
): Promise<SendResult> {
  if (!isWhatsappConfigured()) {
    return {
      sent: false,
      reason: "WhatsApp não configurado (WHATSAPP_TOKEN ausente).",
      retryable: false,
    };
  }

  // Brasil: E.164 exige o 55 na frente.
  const to = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return {
        sent: false,
        reason: `HTTP ${res.status}: ${detail.slice(0, 200)}`,
        // 4xx é erro nosso (número inválido, template); 5xx vale retentar.
        retryable: res.status >= 500,
      };
    }

    const json = (await res.json()) as { messages?: { id: string }[] };
    return { sent: true, providerId: json.messages?.[0]?.id };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "Falha de rede",
      retryable: true,
    };
  }
}
