// ───────────────────────────────────────────────────────────
// Leitura de CSV exportado de outro sistema.
//
// O formato que chega nunca é o que a gente pediu: separador vira ponto e
// vírgula no Excel pt-BR, as colunas vêm em qualquer ordem, sobram colunas
// que não interessam (CPF, endereço, datas) e o arquivo pode ter BOM. Em
// vez de exigir um formato, a gente lê o que veio.
// ───────────────────────────────────────────────────────────

/** Divide respeitando aspas: "Silva, Jr" é um campo só, não dois. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const limpo = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(limpo);
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        // "" dentro de um campo entre aspas é uma aspa literal.
        if (limpo[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      dentroDeAspas = true;
    } else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      // \r\n conta como uma quebra só.
      if (c === "\r" && limpo[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  return linhas
    .map((l) => l.map((v) => v.trim()))
    .filter((l) => l.some((v) => v !== ""));
}

/** O separador é o candidato que mais aparece fora das aspas na 1ª linha. */
function detectDelimiter(text: string): string {
  const primeira = text.split(/\r?\n/, 1)[0] ?? "";
  let melhor = ",";
  let max = -1;
  for (const cand of [",", ";", "\t", "|"]) {
    let n = 0;
    let aspas = false;
    for (const c of primeira) {
      if (c === '"') aspas = !aspas;
      else if (c === cand && !aspas) n++;
    }
    if (n > max) {
      max = n;
      melhor = cand;
    }
  }
  return melhor;
}

function semAcento(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Nomes que cada coluna costuma ter nos sistemas por aí. */
const SINONIMOS = {
  nome: ["nome", "name", "cliente", "nome completo", "nome do cliente", "razao social"],
  telefone: [
    "telefone",
    "celular",
    "whatsapp",
    "whats",
    "fone",
    "tel",
    "telefone celular",
    "contato",
    "phone",
    "mobile",
  ],
  email: ["email", "e-mail", "mail", "correio eletronico"],
} as const;

export type ColunaAlvo = keyof typeof SINONIMOS;

/**
 * Descobre em que posição está cada coluna que interessa.
 * Sem cabeçalho reconhecível, cai no formato documentado na tela:
 * nome, telefone e (opcional) e-mail, nessa ordem.
 */
export function mapHeader(
  primeiraLinha: string[]
): { mapa: Record<ColunaAlvo, number>; temCabecalho: boolean } {
  const normalizada = primeiraLinha.map(semAcento);
  const mapa: Record<ColunaAlvo, number> = { nome: -1, telefone: -1, email: -1 };

  for (const alvo of Object.keys(SINONIMOS) as ColunaAlvo[]) {
    // Primeiro o nome exato; só depois "contém", para "Data de cadastro"
    // não roubar a coluna de nome.
    let i = normalizada.findIndex((h) => (SINONIMOS[alvo] as readonly string[]).includes(h));
    if (i === -1) {
      i = normalizada.findIndex((h) =>
        (SINONIMOS[alvo] as readonly string[]).some((s) => h === s || h.startsWith(s + " "))
      );
    }
    mapa[alvo] = i;
  }

  const temCabecalho = mapa.nome !== -1 || mapa.telefone !== -1;
  if (!temCabecalho) return { mapa: { nome: 0, telefone: 1, email: 2 }, temCabecalho: false };
  return { mapa, temCabecalho: true };
}
