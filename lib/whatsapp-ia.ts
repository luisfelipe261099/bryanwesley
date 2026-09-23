// ───────────────────────────────────────────────────────────
// O intérprete do WhatsApp (Gemini — opcional).
//
// Serve para uma coisa só: transformar "quero cortar sábado à tarde,
// umas 3h" em escolhas que o atendente já sabe fazer — serviço, dia e
// hora. Quem decide continua sendo o código: tudo o que volta daqui é
// conferido contra o catálogo e a agenda de verdade, e nada é marcado
// sem o cliente confirmar. Sem chave, fora do ar, lento ou no limite do
// plano grátis, o atendente segue pelo menu numerado como se nada fosse.
//
// Privacidade: vai para o Google só o que a pessoa escreveu, os nomes dos
// serviços e o calendário. Telefone, cadastro e histórico não saem daqui
// — no plano grátis o Google pode usar o conteúdo para melhorar produtos.
// ───────────────────────────────────────────────────────────

export type Intencao =
  | "agendar"
  | "meus_horarios"
  | "cancelar"
  | "endereco"
  | "saudacao"
  | "outro";

export type Interpretacao = {
  intencao: Intencao;
  /** Só ids que existem no catálogo passado. */
  servicoIds: number[];
  /** "AAAA-MM-DD" dentro do calendário passado. */
  dateKey: string | null;
  /** "HH:MM", 24h. */
  hora: string | null;
  periodo: "manha" | "tarde" | "noite" | null;
};

export type ContextoIa = {
  /** "AAAA-MM-DD" de hoje, no fuso da barbearia. */
  hoje: string;
  /** Os próximos dias, com o nome do dia da semana ("sábado"). */
  calendario: { dateKey: string; semana: string }[];
  servicos: { id: number; nome: string }[];
  /** Onde a conversa está ("dia", "hora"...), para desempatar. */
  etapa: string;
};

const INTENCOES: Intencao[] = [
  "agendar",
  "meus_horarios",
  "cancelar",
  "endereco",
  "saudacao",
  "outro",
];

/** Modelo padrão: o Flash-Lite estável com plano grátis. Troca por GEMINI_MODEL. */
export const MODELO_PADRAO = "gemini-3.5-flash-lite";
const TEMPO_MAXIMO_MS = 8_000;

export function iaConfigurada() {
  return Boolean(process.env.GEMINI_API_KEY);
}

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    intencao: { type: "STRING", enum: INTENCOES },
    servicos: { type: "ARRAY", items: { type: "INTEGER" } },
    data: { type: "STRING", nullable: true },
    hora: { type: "STRING", nullable: true },
    periodo: { type: "STRING", enum: ["manha", "tarde", "noite"], nullable: true },
  },
  required: ["intencao", "servicos", "data", "hora", "periodo"],
};

function instrucoes(ctx: ContextoIa) {
  const dias = ctx.calendario
    .map((d, i) => {
      const extra = i === 0 ? " (hoje)" : i === 1 ? " (amanhã)" : "";
      return `- ${d.dateKey}: ${d.semana}${extra}`;
    })
    .join("\n");
  const servicos = ctx.servicos.map((s) => `- ${s.id}: ${s.nome}`).join("\n");
  return [
    "Você lê mensagens de clientes de uma barbearia no WhatsApp e devolve só JSON.",
    "Não converse, não explique: extraia o pedido.",
    "",
    `Hoje é ${ctx.hoje}. Calendário:`,
    dias,
    "",
    "Serviços (id: nome):",
    servicos,
    "",
    "Campos:",
    '- intencao: "agendar" (marcar, agendar, cortar, fazer a barba, ver horário livre), "meus_horarios" (ver o que já marcou), "cancelar" (desmarcar, cancelar, remarcar), "endereco" (onde fica, endereço, que horas abre), "saudacao" (só cumprimentou), "outro".',
    '- servicos: ids dos serviços pedidos; vazio se não disse. "corte e barba" é o combo, se existir um.',
    '- data: "AAAA-MM-DD" do dia pedido (hoje, amanhã, sábado, dia 10, 10/10), usando o calendário; null se não disse.',
    '- hora: "HH:MM" em 24h se disse a hora ("3 da tarde" = "15:00", "meio-dia" = "12:00"); null se não disse.',
    '- periodo: "manha", "tarde" ou "noite" se disse só o período; null se não disse.',
    "Nunca invente: na dúvida, null (ou lista vazia).",
    `A conversa está na etapa: ${ctx.etapa}.`,
  ].join("\n");
}

/**
 * Pergunta ao Gemini o que a pessoa quis dizer. Devolve null quando não
 * dá para confiar na resposta — e aí o atendente volta para o menu.
 */
export async function interpretar(
  texto: string,
  ctx: ContextoIa,
  opts: { fetch?: typeof fetch } = {}
): Promise<Interpretacao | null> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return null;
  const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
  const chamar = opts.fetch ?? fetch;

  const corpo = (comEsquema: boolean) => ({
    systemInstruction: { parts: [{ text: instrucoes(ctx) }] },
    contents: [{ role: "user", parts: [{ text: texto.slice(0, 500) }] }],
    generationConfig: {
      temperature: 0,
      // Folga para o "pensamento" mínimo do modelo, que conta no teto.
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      ...(comEsquema ? { responseSchema: ESQUEMA } : {}),
    },
  });

  try {
    let res = await pedir(chamar, modelo, chave, corpo(true));
    // Esquema recusado (400) por mudança da API: tenta de novo só com o
    // "responda em JSON" — a validação daqui de baixo segura o resto.
    if (res.status === 400) res = await pedir(chamar, modelo, chave, corpo(false));
    if (!res.ok) {
      console.warn(`Gemini respondeu ${res.status}; seguindo pelo menu.`);
      return null;
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const bruto = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return validar(JSON.parse(limparJson(bruto)), ctx);
  } catch (e) {
    console.warn("Gemini indisponível; seguindo pelo menu:", e instanceof Error ? e.message : e);
    return null;
  }
}

function pedir(chamar: typeof fetch, modelo: string, chave: string, corpo: unknown) {
  // GEMINI_API_BASE só existe para os testes apontarem para um Gemini de mentira.
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  return chamar(
    `${base}/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    }
  );
}

/** Às vezes o modelo embrulha o JSON em ```json ... ```. */
function limparJson(t: string) {
  return t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/** Nada do que o modelo disse passa sem conferir. */
export function validar(r: unknown, ctx: ContextoIa): Interpretacao | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const intencao = INTENCOES.includes(o.intencao as Intencao) ? (o.intencao as Intencao) : null;
  if (!intencao) return null;

  const validos = new Set(ctx.servicos.map((s) => s.id));
  const servicoIds = Array.isArray(o.servicos)
    ? [...new Set(o.servicos.map(Number).filter((n) => validos.has(n)))]
    : [];

  const dias = new Set(ctx.calendario.map((d) => d.dateKey));
  const data = typeof o.data === "string" && dias.has(o.data) ? o.data : null;

  const hora =
    typeof o.hora === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.hora) ? o.hora : null;

  const periodo = ["manha", "tarde", "noite"].includes(o.periodo as string)
    ? (o.periodo as Interpretacao["periodo"])
    : null;

  return { intencao, servicoIds, dateKey: data, hora, periodo };
}
