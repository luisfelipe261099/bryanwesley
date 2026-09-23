// ───────────────────────────────────────────────────────────
// Adaptador de envio. Fala com um de dois WhatsApps:
//
//   - WAHA (lib/providers/waha): o número de sempre, conectado por QR
//     code num servidor da barbearia. Grátis, não oficial.
//   - Cloud API da Meta: número aprovado pela Meta. Oficial; responder
//     quem escreveu é grátis, lembrete tem custo por mensagem.
//
// Com os dois configurados, WHATSAPP_PROVIDER decide ("waha" ou "meta").
// Sem nenhum, o adaptador entra em modo "registro": a mensagem fica
// gravada e visível no painel, mas nada é enviado. Assim o sistema
// funciona antes de o número estar conectado.
// ───────────────────────────────────────────────────────────
import { wahaConfigurado, wahaEnviarParaTelefone } from "./waha";

export type SendResult =
  | { sent: true; providerId?: string }
  | { sent: false; reason: string; retryable: boolean };

export type Provedor = "waha" | "meta";

export function isMetaConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

/** Qual WhatsApp está ligado agora — ou null, se nenhum. */
export function provedorAtivo(): Provedor | null {
  const pedido = (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (pedido === "meta") return isMetaConfigured() ? "meta" : null;
  if (pedido === "waha") return wahaConfigurado() ? "waha" : null;
  if (wahaConfigurado()) return "waha";
  if (isMetaConfigured()) return "meta";
  return null;
}

export function isWhatsappConfigured() {
  return provedorAtivo() !== null;
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

/**
 * As opções de uma mensagem, na ordem em que aparecem. É a mesma ordem da
 * numeração do texto — e o atendente guarda exatamente esta lista para
 * saber que "2" é a segunda.
 */
export function opcoesDe(m: MensagemSaida): { id: string; titulo: string }[] {
  if (m.tipo === "lista") {
    return m.secoes.flatMap((s) => s.linhas.map((l) => ({ id: l.id, titulo: l.titulo })));
  }
  if (m.tipo === "botoes") return m.botoes.map((b) => ({ id: b.id, titulo: b.titulo }));
  return [];
}

/**
 * A mesma mensagem em texto puro, com as opções numeradas.
 *
 * É o formato do WAHA: número comum de WhatsApp não mostra lista nem
 * botão, então o menu vira "1. Corte · 2. Barba" e a pessoa responde com
 * o número (ou escreve, que o atendente entende).
 */
export function paraTexto(m: MensagemSaida): string {
  if (m.tipo === "texto") return m.texto;
  const linhas =
    m.tipo === "lista"
      ? m.secoes.flatMap((s) => s.linhas)
      : m.botoes.map((b) => ({ ...b, descricao: undefined as string | undefined }));
  const itens = linhas.map(
    (l, i) => `*${i + 1}.* ${l.titulo}${l.descricao ? ` — ${l.descricao}` : ""}`
  );
  const partes = [m.corpo, itens.join("\n")];
  if (m.tipo === "lista" && m.rodape) partes.push(`_${m.rodape}_`);
  partes.push("Responda com o número 👆");
  return partes.join("\n\n");
}

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

/**
 * Manda uma mensagem montada (texto, lista ou botões) pelo WhatsApp que
 * estiver ligado. No WAHA, lista e botões viram texto numerado.
 */
export async function sendWhatsappMessage(
  phoneDigits: string,
  m: MensagemSaida
): Promise<SendResult> {
  const provedor = provedorAtivo();
  if (provedor === "waha") return wahaEnviarParaTelefone(phoneDigits, paraTexto(m));
  if (provedor === "meta") return sendMetaMessage(phoneDigits, m);
  return {
    sent: false,
    reason: "WhatsApp não configurado (nem WAHA, nem Cloud API).",
    retryable: false,
  };
}

export async function sendWhatsapp(
  phoneDigits: string,
  body: string
): Promise<SendResult> {
  return sendWhatsappMessage(phoneDigits, { tipo: "texto", texto: body });
}

/** Pela Cloud API, qualquer que seja o provedor ativo (resposta ao webhook da Meta). */
export async function sendMetaMessage(
  phoneDigits: string,
  m: MensagemSaida
): Promise<SendResult> {
  return enviar(paraCloudApi(destino(phoneDigits), m));
}

/** Brasil: E.164 exige o 55 na frente. */
function destino(phoneDigits: string) {
  return phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
}

async function enviar(payload: Record<string, unknown>): Promise<SendResult> {
  if (!isMetaConfigured()) {
    return {
      sent: false,
      reason: "Cloud API não configurada (WHATSAPP_TOKEN ausente).",
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
