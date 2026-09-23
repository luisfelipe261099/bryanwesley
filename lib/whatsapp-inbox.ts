// ───────────────────────────────────────────────────────────
// A porta de entrada do WhatsApp.
//
// Aqui só se LÊ o envelope que chega — da Cloud API da Meta ou do WAHA:
// quem escreveu, o que escreveu e, quando a pessoa tocou numa opção da
// lista, qual foi. O que responder é decisão de lib/whatsapp-bot.
//
// Separado da rota de propósito: assim dá para testar a conversa inteira
// sem subir servidor nem falar com ninguém.
// ───────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { telefoneDoWhatsapp } from "./phone";

/**
 * A chave que marca uma mensagem como já respondida. A Meta e o WAHA
 * reenviam quando a resposta demora; com a chave, a mesma mensagem não
 * vira duas respostas. Vai com hash porque o id pode ser comprido e a
 * tabela de freios corta em 80 caracteres — cortado, dois ids diferentes
 * com o mesmo começo virariam a mesma mensagem.
 */
export function chaveDaMensagem(id: string) {
  return `wamsg:${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

export type MensagemRecebida = {
  /** Id da mensagem no WhatsApp — a Meta reenvia, e a mesma não pode valer duas vezes. */
  id?: string;
  /** Telefone de quem escreveu, só dígitos, já com o nono dígito. */
  de: string;
  /** O texto, como veio (vazio quando a pessoa só tocou num botão). */
  texto?: string;
  /** Id da opção escolhida numa lista ou botão — "svc:3", "day:2026-09-26". */
  escolha?: string;
  /** Nome do perfil no WhatsApp, quando a Meta manda. */
  nomeDoPerfil?: string | null;
  /** Áudio, foto, figurinha: falou, mas não dá para ler. */
  midia?: boolean;
};

/**
 * Lê o corpo do webhook da Cloud API e devolve só o que é conversa.
 * Status de entrega, reações, áudio e ecos do próprio número caem fora.
 */
export function extrairMensagens(corpo: unknown): MensagemRecebida[] {
  const out: MensagemRecebida[] = [];
  const entradas = (corpo as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entradas)) return out;

  for (const entrada of entradas) {
    const mudancas = (entrada as { changes?: unknown[] })?.changes;
    if (!Array.isArray(mudancas)) continue;
    for (const mudanca of mudancas) {
      const valor = (mudanca as { value?: Record<string, unknown> })?.value;
      if (!valor) continue;
      const mensagens = valor.messages;
      if (!Array.isArray(mensagens)) continue;

      // O nome do perfil vem numa lista à parte, casada pelo wa_id.
      const contatos = Array.isArray(valor.contacts)
        ? (valor.contacts as { wa_id?: string; profile?: { name?: string } }[])
        : [];

      for (const m of mensagens as Record<string, unknown>[]) {
        const waId = String(m.from ?? "");
        if (!waId) continue;
        const de = telefoneDoWhatsapp(waId);
        const id = typeof m.id === "string" ? m.id : undefined;
        const perfil = contatos.find((c) => c.wa_id === waId)?.profile?.name ?? null;

        if (m.type === "text") {
          const texto = String(
            (m.text as { body?: string } | undefined)?.body ?? ""
          ).trim();
          out.push({ id, de, texto, nomeDoPerfil: perfil });
          continue;
        }

        if (m.type === "interactive") {
          const escolha = idDaEscolha(m.interactive);
          if (!escolha) continue;
          out.push({ id, de, escolha, nomeDoPerfil: perfil });
          continue;
        }

        // Áudio, figurinha, localização: a pessoa falou, mas não dá para
        // ler. O atendente responde com o menu (ou pede para escrever).
        if (["audio", "image", "sticker", "video", "document", "location"].includes(
          String(m.type)
        )) {
          out.push({ id, de, texto: "", nomeDoPerfil: perfil, midia: true });
        }
      }
    }
  }
  return out;
}

/** Toque numa linha da lista ou num botão de resposta. */
function idDaEscolha(interativo: unknown): string | null {
  const i = interativo as
    | {
        type?: string;
        list_reply?: { id?: string };
        button_reply?: { id?: string };
      }
    | undefined;
  const id = i?.list_reply?.id ?? i?.button_reply?.id;
  return id ? String(id).trim() || null : null;
}

// ───────────────────────── WAHA ─────────────────────────

/** O que um evento do WAHA pede. */
export type EventoWaha =
  | {
      tipo: "mensagem";
      id: string;
      /** Para onde responder: o id da conversa, exatamente como veio. */
      chatId: string;
      /** Telefone, se deu para saber; null quando só veio um "@lid". */
      de: string | null;
      texto: string;
      midia: boolean;
      nomeDoPerfil: string | null;
    }
  | {
      /** Alguém da barbearia respondeu pelo celular. */
      tipo: "humano";
      id: string;
      chatId: string;
      de: string | null;
    }
  | { tipo: "ignorar"; motivo: string };

/**
 * Lê um evento do WAHA. Grupo, status, canal e o que o próprio sistema
 * mandou pela API ficam de fora; o que a barbearia mandou pelo celular
 * vira sinal para o atendente se calar.
 */
export function lerEventoWaha(corpo: unknown, sessaoEsperada?: string): EventoWaha {
  const ev = corpo as {
    event?: string;
    session?: string;
    payload?: Record<string, unknown>;
  } | null;
  if (!ev || (ev.event !== "message" && ev.event !== "message.any")) {
    return { tipo: "ignorar", motivo: `evento ${ev?.event ?? "?"}` };
  }
  if (sessaoEsperada && ev.session && ev.session !== sessaoEsperada) {
    return { tipo: "ignorar", motivo: `sessão ${ev.session}` };
  }
  const p = ev.payload;
  if (!p) return { tipo: "ignorar", motivo: "sem payload" };

  const id = idDaMensagemWaha(p.id);
  if (!id) return { tipo: "ignorar", motivo: "sem id" };

  const deMim = p.fromMe === true;
  const chatId = String((deMim ? p.to : p.from) ?? "");
  if (!chatId) return { tipo: "ignorar", motivo: "sem conversa" };
  if (/@(g\.us|newsletter|broadcast)$/.test(chatId) || chatId.startsWith("status@")) {
    return { tipo: "ignorar", motivo: "grupo, canal ou status" };
  }

  const de = telefoneDaConversa(chatId, p, deMim);

  if (deMim) {
    // "api" é o próprio sistema falando; "app" é gente no celular.
    if (p.source === "app") return { tipo: "humano", id, chatId, de };
    return { tipo: "ignorar", motivo: "enviada pelo sistema" };
  }

  const dados = (p._data ?? {}) as Record<string, unknown>;
  const info = (dados.Info ?? {}) as Record<string, unknown>;
  const nome =
    [dados.notifyName, dados.pushName, dados.PushName, info.PushName].find(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    ) ?? null;

  return {
    tipo: "mensagem",
    id,
    chatId,
    de,
    texto: typeof p.body === "string" ? p.body.trim() : "",
    midia: p.hasMedia === true,
    nomeDoPerfil: nome,
  };
}

function idDaMensagemWaha(id: unknown): string | null {
  if (typeof id === "string" && id) return id;
  const obj = id as { _serialized?: string; id?: string } | null;
  return obj?._serialized ?? obj?.id ?? null;
}

/**
 * O telefone da conversa. Com "@c.us" é direto; com "@lid" (o id que o
 * WhatsApp usa para esconder o número) procura o número alternativo que
 * cada motor do WAHA manda num lugar — e, se não achar, devolve null
 * para a rota perguntar ao WAHA.
 */
function telefoneDaConversa(chatId: string, p: Record<string, unknown>, deMim: boolean) {
  if (/@(c\.us|s\.whatsapp\.net)$/.test(chatId)) return telefoneDoWhatsapp(chatId);
  if (!chatId.endsWith("@lid")) return null;
  const dados = (p._data ?? {}) as Record<string, unknown>;
  const chave = (dados.key ?? {}) as Record<string, unknown>;
  const info = (dados.Info ?? {}) as Record<string, unknown>;
  const candidatos = deMim
    ? [chave.remoteJidAlt, info.RecipientAlt, info.ChatAlt]
    : [chave.remoteJidAlt, chave.senderPn, chave.participantAlt, info.SenderAlt, info.ChatAlt];
  const achado = candidatos.find(
    (x): x is string => typeof x === "string" && /@(c\.us|s\.whatsapp\.net)$/.test(x)
  );
  return achado ? telefoneDoWhatsapp(achado) : null;
}
