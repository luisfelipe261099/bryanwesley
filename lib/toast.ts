// ───────────────────────────────────────────────────────────
// Avisos que sobrevivem à revalidação.
//
// Toda ação do painel chama revalidatePath, o que remonta a árvore da
// rota e apagaria uma mensagem guardada em useState. A fila fica aqui,
// em módulo — fora do React —, então o Toaster relê ao remontar.
// ───────────────────────────────────────────────────────────
export type Toast = { id: number; text: string; tone: "ok" | "erro" };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  // Nova referência para o useSyncExternalStore perceber a mudança.
  toasts = [...toasts];
  listeners.forEach((l) => l());
}

/** `duracaoMs` 0 = fica na tela até a pessoa fechar no X. */
export function toast(text: string, tone: "ok" | "erro" = "ok", duracaoMs = 4500) {
  const id = ++seq;
  toasts.push({ id, text, tone });
  emit();
  if (duracaoMs > 0) setTimeout(() => dismiss(id), duracaoMs);
  return id;
}

export function dismiss(id: number) {
  const antes = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== antes) emit();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts() {
  return toasts;
}

const VAZIO: Toast[] = [];
/** No servidor não há fila; devolve sempre a mesma referência. */
export function getServerToasts() {
  return VAZIO;
}
