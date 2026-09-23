// ───────────────────────────────────────────────────────────
// WAHA — WhatsApp HTTP API (https://waha.devlike.pro), no servidor da
// própria barbearia.
//
// É o WhatsApp Web rodando numa máquina ligada 24h: conecta no número de
// sempre lendo um QR code (ou digitando um código), sem aprovação da Meta
// e sem custo por mensagem. Em troca, não é oficial — o WhatsApp pode
// bloquear número que pareça robô de spam — e alguém precisa manter a
// máquina de pé.
//
// Este arquivo só fala HTTP com o WAHA. A conversa é de lib/whatsapp-bot;
// a leitura do que chega, de lib/whatsapp-inbox.
// ───────────────────────────────────────────────────────────
import type { SendResult } from "./whatsapp";
import { telefoneDoWhatsapp } from "../phone";

export function wahaConfigurado() {
  return Boolean(process.env.WAHA_URL && process.env.WAHA_API_KEY);
}

export function wahaSessao() {
  return process.env.WAHA_SESSION || "default";
}

function base() {
  return (process.env.WAHA_URL ?? "").replace(/\/+$/, "");
}

async function chamar(
  caminho: string,
  init: { method?: string; body?: unknown; accept?: string; timeoutMs?: number } = {}
) {
  return fetch(`${base()}${caminho}`, {
    method: init.method ?? "GET",
    headers: {
      "X-Api-Key": process.env.WAHA_API_KEY ?? "",
      accept: init.accept ?? "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    // Uma chamada pendurada não pode consumir o tempo inteiro da função.
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
  });
}

const S = () => encodeURIComponent(wahaSessao());

/** Brasil: o WhatsApp quer o 55 na frente. */
function comDdi(phoneDigits: string) {
  return phoneDigits.startsWith("55") && phoneDigits.length > 11 ? phoneDigits : `55${phoneDigits}`;
}

/**
 * O endereço de conversa certo para um telefone.
 *
 * Não dá para montar "55…@c.us" na mão: celular antigo de Curitiba está
 * no WhatsApp sem o nono dígito, e mandar para o id errado é mandar para
 * ninguém. Quem sabe o id certo é o próprio WhatsApp.
 */
export async function wahaChatIdDoTelefone(
  phoneDigits: string
): Promise<{ chatId: string } | { chatId: null; erro: string; retryable: boolean }> {
  try {
    const res = await chamar(
      `/api/contacts/check-exists?phone=${comDdi(phoneDigits)}&session=${S()}`
    );
    if (!res.ok) {
      return {
        chatId: null,
        erro: `WAHA HTTP ${res.status} ao conferir o número`,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const j = (await res.json()) as { numberExists?: boolean; chatId?: string };
    if (!j.numberExists) {
      return { chatId: null, erro: "Esse número não tem WhatsApp.", retryable: false };
    }
    return { chatId: j.chatId || `${comDdi(phoneDigits)}@c.us` };
  } catch (e) {
    return {
      chatId: null,
      erro: e instanceof Error ? e.message : "WAHA fora do ar",
      retryable: true,
    };
  }
}

/** Manda texto para uma conversa já conhecida (a resposta a quem escreveu). */
export async function wahaEnviarTexto(chatId: string, texto: string): Promise<SendResult> {
  try {
    const res = await chamar("/api/sendText", {
      method: "POST",
      body: { session: wahaSessao(), chatId, text: texto, linkPreview: false },
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      return {
        sent: false,
        reason: `WAHA HTTP ${res.status}: ${detalhe.slice(0, 200)}`,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    const j = (await res.json().catch(() => ({}))) as {
      id?: string | { _serialized?: string; id?: string };
      key?: { id?: string };
    };
    const id =
      typeof j.id === "string" ? j.id : j.id?._serialized ?? j.id?.id ?? j.key?.id ?? undefined;
    return { sent: true, providerId: id };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "WAHA fora do ar",
      retryable: true,
    };
  }
}

/** Lembrete, confirmação do site: primeiro descobre a conversa, depois manda. */
export async function wahaEnviarParaTelefone(
  phoneDigits: string,
  texto: string
): Promise<SendResult> {
  const destino = await wahaChatIdDoTelefone(phoneDigits);
  if (destino.chatId === null) {
    return { sent: false, reason: destino.erro, retryable: destino.retryable };
  }
  return wahaEnviarTexto(destino.chatId, texto);
}

/**
 * "Visto" e "digitando…" antes de responder. É o que o próprio WAHA
 * recomenda para o número não parecer robô — e falha aqui não impede a
 * resposta.
 */
export async function wahaMarcarLida(chatId: string) {
  await chamar("/api/sendSeen", {
    method: "POST",
    body: { session: wahaSessao(), chatId },
    timeoutMs: 4_000,
  }).catch(() => undefined);
}

export async function wahaDigitando(chatId: string, ligado: boolean) {
  await chamar(ligado ? "/api/startTyping" : "/api/stopTyping", {
    method: "POST",
    body: { session: wahaSessao(), chatId },
    timeoutMs: 4_000,
  }).catch(() => undefined);
}

/**
 * O telefone por trás de um "@lid" — o id que o WhatsApp usa para
 * esconder o número. Sem ele não dá para achar o cliente no cadastro.
 */
export async function wahaTelefoneDoLid(lid: string): Promise<string | null> {
  try {
    const res = await chamar(`/api/${S()}/lids/${encodeURIComponent(lid)}`, { timeoutMs: 5_000 });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { pn?: string | null } | null;
    return j?.pn ? telefoneDoWhatsapp(j.pn) : null;
  } catch {
    return null;
  }
}

export type StatusWaha = {
  alcancavel: boolean;
  /** STOPPED, STARTING, SCAN_QR_CODE, WORKING, FAILED… ou NAO_EXISTE. */
  status: string;
  numero: string | null;
  nome: string | null;
  /** O webhook desta sessão aponta para este site? */
  webhookCerto: boolean | null;
  erro?: string;
};

export async function wahaStatus(urlDoWebhook?: string): Promise<StatusWaha> {
  try {
    const res = await chamar(`/api/sessions/${S()}`, { timeoutMs: 6_000 });
    if (res.status === 404) {
      return { alcancavel: true, status: "NAO_EXISTE", numero: null, nome: null, webhookCerto: null };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        alcancavel: true,
        status: "SEM_ACESSO",
        numero: null,
        nome: null,
        webhookCerto: null,
        erro: "O WAHA recusou a chave (WAHA_API_KEY).",
      };
    }
    if (!res.ok) {
      return {
        alcancavel: true,
        status: "ERRO",
        numero: null,
        nome: null,
        webhookCerto: null,
        erro: `HTTP ${res.status}`,
      };
    }
    const j = (await res.json()) as {
      status?: string;
      me?: { id?: string; pushName?: string } | null;
      config?: { webhooks?: { url?: string }[] } | null;
    };
    const ganchos = j.config?.webhooks ?? null;
    return {
      alcancavel: true,
      status: j.status ?? "DESCONHECIDO",
      numero: j.me?.id ? telefoneDoWhatsapp(j.me.id) : null,
      nome: j.me?.pushName ?? null,
      webhookCerto:
        urlDoWebhook && ganchos ? ganchos.some((g) => g.url === urlDoWebhook) : null,
    };
  } catch (e) {
    return {
      alcancavel: false,
      status: "FORA_DO_AR",
      numero: null,
      nome: null,
      webhookCerto: null,
      erro: e instanceof Error ? e.message : "sem resposta",
    };
  }
}

/** A configuração do webhook que manda as mensagens para este site. */
export function configDoWebhook(url: string) {
  return {
    webhooks: [
      {
        url,
        // "message.any" traz também o que a barbearia manda pelo celular —
        // é assim que o atendente sabe que alguém assumiu a conversa.
        events: ["message.any"],
        hmac: { key: process.env.WAHA_HMAC_KEY ?? "" },
        retries: { policy: "exponential", delaySeconds: 2, attempts: 4 },
      },
    ],
  };
}

/**
 * Cria a sessão (ou atualiza a que existe) já com o webhook deste site e
 * liga. É o botão "Conectar" do painel: a dona não precisa abrir o WAHA.
 */
export async function wahaConectar(urlDoWebhook: string): Promise<{ ok: boolean; erro?: string }> {
  const config = configDoWebhook(urlDoWebhook);
  try {
    const atual = await chamar(`/api/sessions/${S()}`, { timeoutMs: 6_000 });
    if (atual.status === 404) {
      const criar = await chamar("/api/sessions", {
        method: "POST",
        body: { name: wahaSessao(), start: true, config },
        timeoutMs: 20_000,
      });
      if (!criar.ok) return { ok: false, erro: `Criar sessão: HTTP ${criar.status}` };
      return { ok: true };
    }
    if (!atual.ok) return { ok: false, erro: `Ler sessão: HTTP ${atual.status}` };

    const atualizar = await chamar(`/api/sessions/${S()}`, {
      method: "PUT",
      body: { config },
      timeoutMs: 20_000,
    });
    if (!atualizar.ok) return { ok: false, erro: `Atualizar sessão: HTTP ${atualizar.status}` };

    const { status } = (await atual.json().catch(() => ({}))) as { status?: string };
    if (status === "STOPPED" || status === "FAILED") {
      const ligar = await chamar(`/api/sessions/${S()}/start`, { method: "POST", timeoutMs: 20_000 });
      if (!ligar.ok) return { ok: false, erro: `Ligar sessão: HTTP ${ligar.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "WAHA fora do ar" };
  }
}

/** O QR code para parear, em PNG. */
export async function wahaQr(): Promise<Response | null> {
  try {
    const res = await chamar(`/api/${S()}/auth/qr?format=image`, {
      accept: "image/png",
      timeoutMs: 8_000,
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Pareamento por código — para quando o painel está aberto no mesmo
 * celular do WhatsApp e não dá para escanear a própria tela.
 */
export async function wahaCodigoDePareamento(
  phoneDigits: string
): Promise<{ codigo: string } | { codigo: null; erro: string }> {
  try {
    const res = await chamar(`/api/${S()}/auth/request-code`, {
      method: "POST",
      body: { phoneNumber: comDdi(phoneDigits) },
      timeoutMs: 15_000,
    });
    if (!res.ok) return { codigo: null, erro: `HTTP ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    return j.code ? { codigo: j.code } : { codigo: null, erro: "O WhatsApp não devolveu código." };
  } catch (e) {
    return { codigo: null, erro: e instanceof Error ? e.message : "WAHA fora do ar" };
  }
}
