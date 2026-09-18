/**
 * Caminho interno de retorno, quando ele é seguro.
 *
 * Só aceita rota do próprio site. "//site.de.fora" e "/\site" começam com
 * barra mas o navegador trata como endereço absoluto: seria um
 * redirecionamento aberto, que serve de isca em golpe de phishing —
 * o link sai do domínio da barbearia e a vítima não percebe.
 */
export function safeNext(raw: unknown): string | null {
  const next = String(raw ?? "");
  // Caractere de controle (TAB, LF, CR, NUL...) some no parser de URL do
  // navegador: "/\thttps://golpe.com" vira um endereço de fora depois de
  // passar por aqui parecendo caminho interno.
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  // Backslash também é normalizado para barra: "/\\/golpe.com" escapa.
  if (next.includes("\\")) return null;
  return next;
}
