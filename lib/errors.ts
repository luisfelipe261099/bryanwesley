/**
 * redirect() e notFound() do Next não retornam: eles lançam uma exceção
 * marcada com `digest` que o framework captura mais acima para responder
 * com o redirecionamento ou o 404. Um `catch (e)` genérico numa Server
 * Action engole essa exceção e a transforma em erro comum — a sessão
 * expirada, por exemplo, viraria "não foi possível concluir" em vez de
 * mandar a pessoa para o login. Todo catch de ação deve repassar esses.
 */
/**
 * Código de erro do MySQL (ER_DUP_ENTRY etc.) onde quer que ele esteja.
 * O Drizzle 0.45 embrulha a exceção do driver em DrizzleQueryError e o
 * código fica em `cause` — verificado no MariaDB local. Sem isto, a
 * tolerância a chave duplicada nunca dispara: a corrida rara vira erro
 * genérico e o retry do código curto nunca acontece.
 */
export function dbErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Mensagem do erro raiz, para saber qual índice único estourou. */
export function dbErrorMessage(e: unknown): string {
  let cur: unknown = e;
  let msg = "";
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const m = (cur as { message?: unknown }).message;
    if (typeof m === "string") msg = m;
    cur = (cur as { cause?: unknown }).cause;
  }
  return msg;
}

export function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}
