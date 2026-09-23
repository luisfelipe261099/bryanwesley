// ───────────────────────────────────────────────────────────
// O que fazer com um evento do WAHA — comum às duas formas de ligar.
//
// Direto (o site fala com o WAHA por HTTPS) ou pela ponte (o servidor da
// barbearia busca tudo no site): a decisão é a mesma. Aqui o evento vira
// uma lista de ações — "mande este texto para esta conversa" — e quem
// chamou executa: a rota direta manda pelo WAHA; a ponte devolve as
// ações para o servidor mandar.
// ───────────────────────────────────────────────────────────
import { lerEventoWaha, chaveDaMensagem } from "./whatsapp-inbox";
import { processarMensagem, pausarAtendente } from "./whatsapp-bot";
import { paraTexto } from "./providers/whatsapp";
import { hitRateLimit } from "./rate-limit";
import { publicBaseUrl } from "./qr";
import { linkDeAgendamento } from "./whatsapp-link";

export type Acao = {
  /** A conversa, exatamente como veio (pode ser um "@lid"). */
  chatId: string;
  /** O telefone, quando se sabe — para guardar na fila se o envio falhar. */
  fone: string | null;
  texto: string;
  /**
   * Texto que não pode se perder (a confirmação com o código): se o envio
   * falhar, vai para a fila. Menu, não — um menu de horários entregue
   * depois já estaria velho.
   */
  guardarSeFalhar: boolean;
};

export type Atendimento = {
  acoes: Acao[];
  ignorada?: string;
  repetida?: boolean;
  pausado?: boolean;
  semTelefone?: boolean;
};

export async function atenderEventoWaha(
  corpo: unknown,
  opts: {
    sessao: string;
    /** Descobre o telefone por trás de um "@lid" (null se não der). */
    telefoneDoLid: (lid: string) => Promise<string | null>;
  }
): Promise<Atendimento> {
  const ev = lerEventoWaha(corpo, opts.sessao);
  if (ev.tipo === "ignorar") return { acoes: [], ignorada: ev.motivo };

  // A mesma mensagem reenviada não vira duas respostas (nem duas
  // tentativas de marcar o mesmo horário).
  const primeira = await hitRateLimit(chaveDaMensagem(ev.id), 1, 24 * 3600_000);
  if (!primeira.ok) return { acoes: [], repetida: true };

  const fone =
    ev.de ?? (ev.chatId.endsWith("@lid") ? await opts.telefoneDoLid(ev.chatId) : null);

  if (ev.tipo === "humano") {
    const ate = fone ? await pausarAtendente(fone) : null;
    return { acoes: [], pausado: Boolean(ate) };
  }

  if (!fone) {
    // Sem o número não há como achar o cadastro nem marcar em nome de
    // alguém. O link do site resolve — uma vez a cada 15 minutos.
    const vez = await hitRateLimit(`walid:${ev.chatId}`, 1, 15 * 60_000);
    return {
      semTelefone: true,
      acoes: vez.ok
        ? [
            {
              chatId: ev.chatId,
              fone: null,
              texto: `Oi! Para marcar seu horário, é por aqui: ${linkDeAgendamento(publicBaseUrl())}`,
              guardarSeFalhar: false,
            },
          ]
        : [],
    };
  }

  const saidas = await processarMensagem({
    de: fone,
    texto: ev.texto,
    nomeDoPerfil: ev.nomeDoPerfil,
    midia: ev.midia,
  });
  return {
    acoes: saidas.map((s) => ({
      chatId: ev.chatId,
      fone,
      texto: paraTexto(s.mensagem),
      guardarSeFalhar: s.mensagem.tipo === "texto",
    })),
  };
}
