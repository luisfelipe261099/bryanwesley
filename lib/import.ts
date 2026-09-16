// ───────────────────────────────────────────────────────────
// Leitura da base de clientes vinda de outro sistema.
//
// Só o planejamento mora aqui: ler o arquivo, validar, resolver telefone
// repetido e dizer o que entra. Quem fala com o banco é a Server Action —
// assim esta parte, que é onde moram as decisões, roda em teste.
// ───────────────────────────────────────────────────────────
import { parseCsv, mapHeader } from "./csv";
import { normalizePhone, isValidPhone, formatPhone } from "./phone";

export type ClienteImportado = {
  name: string;
  phone: string;
  email: string | null;
};

export type PlanoImportacao =
  | { ok: false; error: string }
  | { ok: true; candidatos: ClienteImportado[]; skipped: string[] };

/** "Ana Paula" e "Ana Paula Souza" são a mesma pessoa; "Ana" e "Bruno" não. */
export function semelhante(a: string, b: string) {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}

export function planClientImport(csv: string): PlanoImportacao {
  const linhas = parseCsv(csv);
  if (linhas.length === 0) return { ok: false, error: "Arquivo vazio." };

  const { mapa, temCabecalho } = mapHeader(linhas[0]);
  const corpo = temCabecalho ? linhas.slice(1) : linhas;
  if (corpo.length === 0) return { ok: false, error: "O arquivo só tem o cabeçalho." };
  if (mapa.nome === -1 || mapa.telefone === -1) {
    return {
      ok: false,
      error:
        "Não encontrei as colunas de nome e telefone. Renomeie o cabeçalho para 'nome' e 'telefone', ou envie sem cabeçalho nessa ordem.",
    };
  }

  const skipped: string[] = [];
  const porTelefone = new Map<string, ClienteImportado>();

  corpo.forEach((cols, i) => {
    const linhaNum = i + (temCabecalho ? 2 : 1);
    const name = (cols[mapa.nome] ?? "").trim();
    const rawPhone = (cols[mapa.telefone] ?? "").trim();
    const rawEmail = mapa.email >= 0 ? (cols[mapa.email] ?? "").trim() : "";

    if (!name && !rawPhone) return; // linha em branco
    if (!name) {
      skipped.push(`Linha ${linhaNum}: sem nome (${rawPhone || "sem telefone"})`);
      return;
    }
    if (!rawPhone) {
      skipped.push(`Linha ${linhaNum}: ${name} — sem telefone`);
      return;
    }
    if (!isValidPhone(rawPhone)) {
      skipped.push(`Linha ${linhaNum}: ${name} — telefone inválido (${rawPhone})`);
      return;
    }

    const phone = normalizePhone(rawPhone);
    const jaVisto = porTelefone.get(phone);
    if (jaVisto) {
      // Telefone é o login: um número, um cadastro. Duas pessoas no mesmo
      // número (família, casal) não é erro de arquivo — é comum — mas quem
      // ficou de fora precisa aparecer no relatório.
      if (semelhante(jaVisto.name, name)) {
        skipped.push(`Linha ${linhaNum}: ${name} — repetido, já importado`);
      } else {
        skipped.push(
          `Linha ${linhaNum}: ${name} — divide o telefone ${formatPhone(phone)} com ${jaVisto.name}; ficou só o primeiro`
        );
      }
      return;
    }

    porTelefone.set(phone, {
      name,
      phone,
      email: rawEmail.includes("@") ? rawEmail.toLowerCase() : null,
    });
  });

  const candidatos = [...porTelefone.values()];
  if (candidatos.length === 0) {
    return { ok: false, error: "Nenhuma linha com nome e telefone válidos." };
  }
  return { ok: true, candidatos, skipped };
}
