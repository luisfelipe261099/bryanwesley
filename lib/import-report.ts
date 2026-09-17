// ───────────────────────────────────────────────────────────
// Relatório da última importação de clientes.
//
// Mesmo motivo do lib/toast: a ação chama revalidatePath para a lista
// aparecer atualizada, isso remonta a árvore da rota e apagaria um
// useState. E aqui apagar dói: a lista de quem ficou de fora é a única
// forma de o dono saber quais clientes não entraram. Fora do React, ela
// sobrevive ao remonte.
// ───────────────────────────────────────────────────────────
export type RelatorioImportacao = {
  /** O resumo que a ação escreveu, para mostrar do jeito que veio. */
  message: string;
  criados: number;
  atualizados: number;
  skipped: string[];
};

let relatorio: RelatorioImportacao | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setImportReport(r: RelatorioImportacao) {
  // Nova referência a cada vez, para o useSyncExternalStore perceber.
  relatorio = { ...r, skipped: [...r.skipped] };
  emit();
}

export function clearImportReport() {
  if (relatorio === null) return;
  relatorio = null;
  emit();
}

export function subscribeImportReport(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getImportReport() {
  return relatorio;
}

/** No servidor não há relatório; sempre a mesma referência (null). */
export function getServerImportReport(): RelatorioImportacao | null {
  return null;
}
