// ───────────────────────────────────────────────────────────
// Leitura da base de clientes vinda de outro sistema.
//
// Só o planejamento mora aqui: ler o arquivo, validar, resolver telefone
// repetido e dizer o que entra. Quem fala com o banco é a Server Action —
// assim esta parte, que é onde moram as decisões, roda em teste.
// ───────────────────────────────────────────────────────────
import { parseCsv, mapHeader } from "./csv";
import { normalizePhone, isValidPhone, formatPhone, isPlaceholderPhone } from "./phone";

export type ClienteImportado = {
  name: string;
  /** Vazio quando o cadastro antigo não tinha telefone utilizável. */
  phone: string;
  email: string | null;
  /** Entra na base com telefone reservado, para o dono completar depois. */
  pendente?: true;
};

export type PlanoImportacao =
  | { ok: false; error: string }
  | { ok: true; candidatos: ClienteImportado[]; skipped: string[] };

/** Nome comparável: sem acento, sem caixa, sem espaço sobrando. */
export function chaveNome(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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
  // Sem telefone a chave possível é o nome: duas linhas iguais no mesmo
  // arquivo são a mesma pessoa cadastrada duas vezes, não duas pessoas.
  const pendentes = new Map<string, ClienteImportado>();

  // E-mail é único no banco: duas linhas do arquivo com o mesmo e-mail
  // derrubavam o INSERT do lote inteiro e a importação parava no meio,
  // com parte da base dentro. Só a primeira linha leva o e-mail.
  const emailsVistos = new Set<string>();
  const emailDe = (raw: string) => {
    if (!raw.includes("@")) return null;
    const email = raw.toLowerCase();
    if (emailsVistos.has(email)) return null;
    emailsVistos.add(email);
    return email;
  };

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
    // Sem telefone utilizável a pessoa entra assim mesmo, com número
    // reservado: perder o cliente da base é pior do que ter um cadastro
    // para completar. Quem atribui o número é a ação, que conhece os que
    // já existem.
    if (!rawPhone || !isValidPhone(rawPhone)) {
      const motivo = !rawPhone
        ? "sem telefone no cadastro antigo"
        : `telefone incompleto (${rawPhone})`;
      const chave = chaveNome(name);
      if (pendentes.has(chave)) {
        skipped.push(`Linha ${linhaNum}: ${name} — repetido sem telefone, já entrou`);
        return;
      }
      pendentes.set(chave, { name, phone: "", email: emailDe(rawEmail), pendente: true });
      skipped.push(`Linha ${linhaNum}: ${name} — ${motivo}; entrou para completar depois`);
      return;
    }

    const phone = normalizePhone(rawPhone);
    if (isPlaceholderPhone(phone)) {
      // Número da faixa reservada veio no arquivo: trata como pendente.
      const chave = chaveNome(name);
      if (pendentes.has(chave)) {
        skipped.push(`Linha ${linhaNum}: ${name} — repetido sem telefone, já entrou`);
        return;
      }
      pendentes.set(chave, { name, phone: "", email: emailDe(rawEmail), pendente: true });
      skipped.push(`Linha ${linhaNum}: ${name} — telefone reservado pelo sistema; entrou para completar depois`);
      return;
    }
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

    porTelefone.set(phone, { name, phone, email: emailDe(rawEmail) });
  });

  const candidatos = [...porTelefone.values(), ...pendentes.values()];
  if (candidatos.length === 0) {
    return { ok: false, error: "Nenhuma linha com nome e telefone válidos." };
  }
  // Nenhum telefone válido no arquivo inteiro quase sempre significa coluna
  // errada — sem esta trava, um CSV de outra coisa viraria centenas de
  // cadastros pendentes que alguém teria de apagar um a um.
  if (porTelefone.size === 0) {
    return {
      ok: false,
      error:
        "Nenhuma linha tem telefone válido. Confira se a coluna de telefone está certa no arquivo — do jeito que está, a importação criaria cadastros vazios.",
    };
  }
  return { ok: true, candidatos, skipped };
}
