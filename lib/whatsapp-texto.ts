// ───────────────────────────────────────────────────────────
// O que a pessoa digitou no WhatsApp, sem IA.
//
// Número comum de WhatsApp não mostra botão nem lista: a pessoa responde
// "2", "corte", "sábado", "15h", "sim", "meu nome é João". Estas funções
// transformam isso na escolha certa. São puras — sem banco, sem rede —
// para dar para testar cada frase. O que não entendem segue para o
// Gemini (se estiver ligado) ou volta para o menu numerado.
// ───────────────────────────────────────────────────────────
import { addDays, parseDateKey, weekdayOf } from "./time";

export type Opcao = { id: string; titulo: string };

const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const DIAS_ROTULO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_EXTENSO = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** Minúsculas, sem acento, sem pontuação (menos ":" e "/"), espaço simples. */
export function normalizar(t: string) {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[+&]/g, " e ")
    .replace(/[^\p{L}\p{N}:/\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "oi", "menu", "voltar": recomeça a conversa em qualquer ponto. */
export function ehAtalhoDeMenu(texto: string) {
  return /^(menu|oi+|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|inicio|comecar|recomecar|voltar|cancelar tudo)$/.test(
    normalizar(texto)
  );
}

const SIM =
  /^(sim|s|ss|sim sim|pode|pode sim|pode ser|pode marcar|confirma|confirmo|confirmar|confirmado|ok|okay|isso|isso mesmo|blz|beleza|fechado|fechou|bora|quero|marca|claro|com certeza|certo|perfeito|show|top|sim por favor)$/;
const NAO =
  /^(nao|n|nn|nao quero|outro|outra|outro horario|outra hora|outro dia|mudar|trocar|manter|nao cancela|nao cancelar|deixa|deixa assim)$/;

/**
 * A resposta a uma das opções da última pergunta: o número, o nome da
 * opção (inteiro ou um pedaço que só ela tem), o horário ("15h") ou um
 * "sim"/"não" diante de uma confirmação. Devolve o id da opção.
 */
export function casarOpcao(texto: string, opcoes: Opcao[]): string | null {
  if (!opcoes.length) return null;
  const bruto = (texto ?? "").trim();
  if (/^👍/u.test(bruto)) return idDeConfirmacao(opcoes, true);

  const t = normalizar(bruto).replace(/^(opcao|numero|num|n|no|item)\s+(?=\d)/, "");
  if (!t) return null;

  const numero = t.match(/^(\d{1,2})$/);
  if (numero) return opcoes[Number(numero[1]) - 1]?.id ?? null;

  if (SIM.test(t)) {
    const id = idDeConfirmacao(opcoes, true);
    if (id) return id;
  }
  if (NAO.test(t)) {
    const id = idDeConfirmacao(opcoes, false);
    if (id) return id;
  }

  const hora = horaDigitada(bruto);
  if (hora) {
    const o = opcoes.find((x) => x.titulo === hora);
    if (o) return o.id;
  }

  const exatas = opcoes.filter((o) => normalizar(o.titulo) === t);
  if (exatas.length === 1) return exatas[0].id;

  if (t.length >= 3) {
    const parciais = opcoes.filter((o) => {
      const n = normalizar(o.titulo);
      return n.startsWith(t) || ` ${n} `.includes(` ${t} `);
    });
    if (parciais.length === 1) return parciais[0].id;
  }
  return null;
}

function idDeConfirmacao(opcoes: Opcao[], sim: boolean) {
  const o = sim
    ? opcoes.find((x) => /^cancelarsim:|:sim$/.test(x.id))
    : opcoes.find((x) => x.id === "menu:voltar" || x.id.endsWith(":outro"));
  return o?.id ?? null;
}

/**
 * "15h", "15:30", "15h30", "às 3 da tarde", "15 e meia", "meio-dia".
 * Número solto só vale como hora de 11 a 23 — "9" sozinho é a opção 9.
 */
export function horaDigitada(texto: string): string | null {
  const t = normalizar((texto ?? "").replace(/(\d)\.(\d{2})/g, "$1:$2"))
    .replace(/\b(a partir das|por volta das|depois das|la pelas|pelas|umas|tipo|pras|pra|para|as|a)\b\s*/g, "")
    .trim();
  if (!t) return null;

  if (/^meio ?dia( e meia)?$/.test(t) || /\bmeio ?dia\b/.test(t)) {
    return /meio ?dia e meia/.test(t) ? "12:30" : "12:00";
  }

  const solto = t.match(/^(\d{1,2})$/);
  if (solto) {
    const h = Number(solto[1]);
    return h >= 11 && h <= 23 ? `${h}:00` : null;
  }

  const m =
    t.match(/\b(\d{1,2}):(\d{2})\b(?:\s*(?:h|hs|hrs|horas?))?(?:\s*(?:da|de)\s+(manha|tarde|noite))?/) ??
    t.match(/\b(\d{1,2})\s*(?:h|hs|hrs|horas?)\s*(\d{2})?\b(?:\s*(?:da|de)\s+(manha|tarde|noite))?/) ??
    t.match(/\b(\d{1,2})(?:\s*(e meia))?\s*(?:da|de)\s+(manha|tarde|noite)\b/) ??
    t.match(/^(\d{1,2})\s+(e meia)$/);
  if (!m) return null;

  let h = Number(m[1]);
  const minutos = m[2] === "e meia" ? 30 : m[2] ? Number(m[2]) : 0;
  const periodo = m[3];
  if ((periodo === "tarde" || periodo === "noite") && h >= 1 && h < 12) h += 12;
  if (periodo === "manha" && h === 12) h = 0;
  if (h > 23 || minutos > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

/**
 * "hoje", "amanhã", "sábado", "sábado que vem", "26/09", "dia 26".
 * `numeroSolto`: aceita "26" sozinho como dia do mês (só quando a
 * conversa está perguntando o dia).
 */
export function dataDigitada(
  texto: string,
  hoje: string,
  opts: { numeroSolto?: boolean } = {}
): string | null {
  const t = normalizar(texto);
  if (!t) return null;

  if (/\bdepois de amanha\b/.test(t)) return addDays(hoje, 2);
  if (/\bamanha\b/.test(t)) return addDays(hoje, 1);
  if (/\bhoje\b/.test(t)) return hoje;

  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) return diaDoMes(Number(dm[1]), Number(dm[2]), dm[3] ? Number(dm[3]) : null, hoje);

  const diaN = t.match(/\bdia (\d{1,2})\b/) ?? (opts.numeroSolto ? t.match(/^(\d{1,2})$/) : null);
  if (diaN) return proximoDiaDoMes(Number(diaN[1]), hoje);

  const semana = DIAS.findIndex(
    (d, i) => new RegExp(`\\b${d}\\b`).test(t) || new RegExp(`^${DIAS_CURTOS[i]}$`).test(t)
  );
  if (semana >= 0) {
    const hojeSemana = weekdayOf(hoje);
    let falta = (semana - hojeSemana + 7) % 7;
    if (falta === 0 && /\b(que vem|proxim[oa])\b/.test(t)) falta = 7;
    return addDays(hoje, falta);
  }
  return null;
}

function diaDoMes(dia: number, mes: number, ano: number | null, hoje: string) {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const h = parseDateKey(hoje);
  let a = ano === null ? h.year : ano < 100 ? 2000 + ano : ano;
  let chave = montar(a, mes, dia);
  if (!chave) return null;
  if (ano === null && chave < hoje) {
    a += 1;
    chave = montar(a, mes, dia);
  }
  return chave;
}

function proximoDiaDoMes(dia: number, hoje: string) {
  if (dia < 1 || dia > 31) return null;
  const h = parseDateKey(hoje);
  const neste = montar(h.year, h.month, dia);
  if (neste && neste >= hoje) return neste;
  const mes = h.month === 12 ? 1 : h.month + 1;
  const ano = h.month === 12 ? h.year + 1 : h.year;
  return montar(ano, mes, dia);
}

/** "AAAA-MM-DD", ou null se a data não existe (31/09). */
function montar(ano: number, mes: number, dia: number) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** "Hoje, 23/09", "Amanhã, 24/09", "Sábado, 26/09" — curto e fácil de digitar de volta. */
export function tituloDoDia(dateKey: string, hoje: string) {
  const { month, day } = parseDateKey(dateKey);
  const dm = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  if (dateKey === hoje) return `Hoje, ${dm}`;
  if (dateKey === addDays(hoje, 1)) return `Amanhã, ${dm}`;
  return `${DIAS_ROTULO[weekdayOf(dateKey)]}, ${dm}`;
}

/** "quarta-feira" — para quem precisa do dia da semana por extenso. */
export function diaDaSemana(dateKey: string) {
  return DIAS_EXTENSO[weekdayOf(dateKey)];
}

const PREPOSICOES = new Set(["da", "de", "do", "das", "dos", "e"]);
const NAO_E_NOME =
  /^(ok|okay|sim|nao|oi|ola|opa|blz|beleza|isso|pode|valeu|obrigad[oa]|tudo bem|bom dia|boa tarde|boa noite|menu)$/;

/** O nome digitado: tira "meu nome é", emoji e sobra; "joão da silva" → "João da Silva". */
export function limparNome(texto: string): string | null {
  let t = (texto ?? "")
    .replace(/[^\p{L}\p{N}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(meu nome (é|e)|me chamo|eu me chamo|eu sou (o|a)|sou (o|a)|eu sou|sou|aqui (é|e)( o| a)?|nome:?|é (o|a)|e (o|a))\s+/i,
      ""
    )
    .replace(/[.\s-]+$/, "");
  const letras = (t.match(/\p{L}/gu) ?? []).length;
  if (letras < 2 || NAO_E_NOME.test(normalizar(t))) return null;
  // Só arruma quem escreveu tudo minúsculo ou TUDO MAIÚSCULO: maiúscula
  // no meio ("McDonald", "D'Ávila") foi de propósito e fica como veio.
  if (t === t.toLowerCase() || t === t.toUpperCase()) {
    t = t
      .split(" ")
      .map((p, i) =>
        i > 0 && PREPOSICOES.has(p.toLowerCase())
          ? p.toLowerCase()
          : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
      )
      .join(" ");
  }
  return t.slice(0, 80);
}

/**
 * O assunto da mensagem pelas palavras, sem IA. Grosso, mas acerta o
 * comum: "quero marcar", "cancelar meu horário", "onde fica?".
 */
export function intencaoPorPalavras(texto: string): "agendar" | "meus" | "endereco" | null {
  const t = normalizar(texto);
  if (/\b(desmarcar|cancelar|cancela|remarcar|meus horarios|meu horario|marquei|tenho horario)\b/.test(t)) {
    return "meus";
  }
  if (/\b(endereco|onde fica|onde voces ficam|localizacao|como chego|que horas abre|horario de funcionamento|abre que horas|voces abrem)\b/.test(t)) {
    return "endereco";
  }
  if (/\b(marcar|agendar|agenda|agendamento|cortar|horario livre|horarios livres|tem horario|tem vaga|vaga|encaixe)\b/.test(t)) {
    return "agendar";
  }
  return null;
}

/**
 * Os serviços citados pelo nome. "corte e barba" leva o combo — não o
 * corte e a barba separados — quando o combo existe.
 */
export function servicosCitados(texto: string, servicos: { id: number; name: string }[]) {
  const t = ` ${normalizar(texto)} `;
  const achados = servicos
    .map((s) => ({ id: s.id, nome: normalizar(s.name) }))
    .filter((s) => s.nome.length >= 3 && t.includes(` ${s.nome} `))
    .sort((a, b) => b.nome.length - a.nome.length);
  const ficam: typeof achados = [];
  for (const s of achados) {
    if (!ficam.some((f) => ` ${f.nome} `.includes(` ${s.nome} `))) ficam.push(s);
  }
  return ficam.map((s) => s.id);
}

/**
 * Serviços com alguma palavra em comum com o texto (4+ letras). Quem
 * escreve "corte" não escreve "Corte Signature": com dois cortes no
 * catálogo, a resposta certa é perguntar qual — e mostrar só os dois.
 */
export function servicosParecidos(texto: string, servicos: { id: number; name: string }[]) {
  const palavras = new Set(normalizar(texto).split(" ").filter((w) => w.length >= 4));
  if (!palavras.size) return [];
  return servicos
    .filter((s) => normalizar(s.name).split(" ").some((w) => w.length >= 4 && palavras.has(w)))
    .map((s) => s.id);
}
