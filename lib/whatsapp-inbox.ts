// ───────────────────────────────────────────────────────────
// A porta de entrada do WhatsApp.
//
// Aqui só se LÊ o envelope que a Meta manda: quem escreveu, o que
// escreveu e — quando a pessoa tocou numa opção da lista ou num botão —
// qual opção foi. O que responder é decisão de lib/whatsapp-bot.
//
// Separado da rota de propósito: assim dá para testar a conversa inteira
// sem subir servidor nem falar com a Meta.
// ───────────────────────────────────────────────────────────

export type MensagemRecebida = {
  /** Telefone de quem escreveu, só dígitos (pode vir com 55 na frente). */
  de: string;
  /** O texto, como veio (vazio quando a pessoa só tocou num botão). */
  texto?: string;
  /** Id da opção escolhida numa lista ou botão — "svc:3", "day:2026-09-26". */
  escolha?: string;
  /** Nome do perfil no WhatsApp, quando a Meta manda. */
  nomeDoPerfil?: string | null;
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
        const de = String(m.from ?? "");
        if (!de) continue;
        const perfil = contatos.find((c) => c.wa_id === de)?.profile?.name ?? null;

        if (m.type === "text") {
          const texto = String(
            (m.text as { body?: string } | undefined)?.body ?? ""
          ).trim();
          out.push({ de, texto, nomeDoPerfil: perfil });
          continue;
        }

        if (m.type === "interactive") {
          const escolha = idDaEscolha(m.interactive);
          if (!escolha) continue;
          out.push({ de, escolha, nomeDoPerfil: perfil });
          continue;
        }

        // Áudio, figurinha, localização: a pessoa falou, mas não dá para
        // ler. Vale como um "oi" — o atendente responde com o menu.
        if (["audio", "image", "sticker", "video", "document", "location"].includes(
          String(m.type)
        )) {
          out.push({ de, texto: "", nomeDoPerfil: perfil });
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
