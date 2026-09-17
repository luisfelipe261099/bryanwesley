// Telefone é o login do cliente — guardamos só os dígitos para que
// "(11) 9 8812-2031" e "11988122031" sejam a mesma pessoa.
export function normalizePhone(input: string) {
  let d = (input ?? "").replace(/\D/g, "");
  // Código do país não entra na chave: "+55 41 99999-8888" e
  // "41 99999-8888" são a mesma pessoa, e exportação de sistema antigo
  // costuma vir com o 55 na frente. Só corta acima de 11 dígitos — DDD 55
  // existe (Santa Maria/RS) e não pode ser confundido com o país.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d;
}

/**
 * Cliente importado do sistema antigo sem telefone utilizável.
 *
 * A coluna é a chave única do cadastro — é o login do cliente — e não
 * aceita vazio. Em vez de deixar essa gente de fora da base, guardamos um
 * número reservado: DDD "00" não existe no Brasil (vai de 11 a 99), então
 * ele nunca colide com o telefone real de ninguém. O sistema trata esses
 * cadastros como "telefone pendente": não valem para login, não recebem
 * mensagem, e o painel pede para completar.
 */
const PENDENTE = "00";

export function isPlaceholderPhone(input: string) {
  const d = (input ?? "").replace(/\D/g, "");
  return d.startsWith(PENDENTE);
}

/** Próximo número reservado, a partir dos que já existem. */
export function nextPlaceholderPhone(existentes: string[]) {
  const usados = existentes
    .filter((p) => isPlaceholderPhone(p))
    .map((p) => Number(p.slice(2)) || 0);
  const proximo = (usados.length ? Math.max(...usados) : 0) + 1;
  return PENDENTE + String(proximo).padStart(9, "0");
}

export function formatPhone(digits: string) {
  const d = normalizePhone(digits);
  if (isPlaceholderPhone(d)) return "Sem telefone";
  if (d.length === 11)
    return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

export function isValidPhone(input: string) {
  const d = normalizePhone(input);
  // O número reservado nunca é válido: não serve para agendar nem entrar.
  if (isPlaceholderPhone(d)) return false;
  return d.length === 10 || d.length === 11;
}
