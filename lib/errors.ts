/**
 * redirect() e notFound() do Next não retornam: eles lançam uma exceção
 * marcada com `digest` que o framework captura mais acima para responder
 * com o redirecionamento ou o 404. Um `catch (e)` genérico numa Server
 * Action engole essa exceção e a transforma em erro comum — a sessão
 * expirada, por exemplo, viraria "não foi possível concluir" em vez de
 * mandar a pessoa para o login. Todo catch de ação deve repassar esses.
 */
export function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}
