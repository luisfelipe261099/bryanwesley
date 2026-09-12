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
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
