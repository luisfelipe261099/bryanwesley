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

/**
 * Uma mensagem pronta para a Cloud API — texto simples, lista de opções
 * ou botões. É o que o atendente do WhatsApp monta para o cliente
 * escolher serviço, dia e horário sem sair da conversa.
 */
export type MensagemSaida =
  | { tipo: "texto"; texto: string }
  | {
      tipo: "lista";
      corpo: string;
      rodape?: string;
      /** Texto do botão que abre a lista (máx. 20 caracteres). */
      botao: string;
      secoes: {
        titulo?: string;
        linhas: { id: string; titulo: string; descricao?: string }[];
      }[];
    }
  | { tipo: "botoes"; corpo: string; botoes: { id: string; titulo: string }[] };

/** Limites da Cloud API — passar deles faz a Meta recusar a mensagem. */
const LIM = { titulo: 24, descricao: 72, botao: 20, id: 200, corpo: 1024 };

const corta = (t: string, n: number) =>
  t.length <= n ? t : `${t.slice(0, n - 1)}…`;

/** Traduz a mensagem para o formato que a Meta espera. */
export function paraCloudApi(to: string, m: MensagemSaida) {
  const base = { messaging_product: "whatsapp", to } as const;
  if (m.tipo === "texto") {
    return { ...base, type: "text", text: { preview_url: true, body: corta(m.texto, 4096) } };
  }
  if (m.tipo === "botoes") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: corta(m.corpo, LIM.corpo) },
        action: {
          // No máximo três botões; o resto vira lista.
          buttons: m.botoes.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: corta(b.id, LIM.id), title: corta(b.titulo, LIM.botao) },
          })),
        },
      },
    };
  }
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: corta(m.corpo, LIM.corpo) },
      ...(m.rodape ? { footer: { text: corta(m.rodape, 60) } } : {}),
      action: {
        button: corta(m.botao, LIM.botao),
        sections: m.secoes.map((s) => ({
          ...(s.titulo ? { title: corta(s.titulo, LIM.titulo) } : {}),
          rows: s.linhas.map((l) => ({
            id: corta(l.id, LIM.id),
            title: corta(l.titulo, LIM.titulo),
            ...(l.descricao ? { description: corta(l.descricao, LIM.descricao) } : {}),
          })),
        })),
      },
    },
  };
}

/** Manda uma mensagem montada (texto, lista ou botões). */
export async function sendWhatsappMessage(
  phoneDigits: string,
  m: MensagemSaida
): Promise<SendResult> {
  return enviar(phoneDigits, paraCloudApi(destino(phoneDigits), m));
}

export async function sendWhatsapp(
  phoneDigits: string,
  body: string
): Promise<SendResult> {
  return enviar(
    phoneDigits,
    paraCloudApi(destino(phoneDigits), { tipo: "texto", texto: body })
  );
}

/** Brasil: E.164 exige o 55 na frente. */
function destino(phoneDigits: string) {
  return phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
}

async function enviar(
  phoneDigits: string,
  payload: Record<string, unknown>
): Promise<SendResult> {
  if (!isWhatsappConfigured()) {
    return {
      sent: false,
      reason: "WhatsApp não configurado (WHATSAPP_TOKEN ausente).",
      retryable: false,
    };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // A varredura manda em série dentro do tempo da função (30–60 s):
        // uma chamada pendurada não pode consumir a janela inteira.
        signal: AbortSignal.timeout(10_000),
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
