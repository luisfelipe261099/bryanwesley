// Dinheiro trafega em centavos (inteiro) e só vira texto na interface.
export function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatCompactBRL(cents: number) {
  const value = cents / 100;
  if (value < 1000) return formatBRL(cents);
  return `R$ ${(value / 1000).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}k`;
}

export function formatDuration(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
