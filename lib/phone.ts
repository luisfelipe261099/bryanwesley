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

export function formatPhone(digits: string) {
  const d = normalizePhone(digits);
  if (d.length === 11)
    return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

export function isValidPhone(input: string) {
  const d = normalizePhone(input);
  return d.length === 10 || d.length === 11;
}
