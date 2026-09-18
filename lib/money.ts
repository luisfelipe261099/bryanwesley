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

/**
 * Texto digitado → centavos.
 *
 * O dono digita "199,90", "199.90", "1.299,00" ou "1299". A regra antiga
 * apagava todo ponto e só aceitava vírgula: quem digitasse "199.90"
 * cadastrava um plano de R$ 19.990,00 — e o preço ia direto para a
 * vitrine. Aqui o ÚLTIMO separador manda; o outro é milhar.
 */
export function parseMoneyToCents(raw: string): number {
  const limpo = String(raw ?? "")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!limpo) return 0;

  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  const corte = Math.max(ultimaVirgula, ultimoPonto);

  let normalizado: string;
  if (corte === -1) {
    normalizado = limpo;
  } else {
    const decimais = limpo.slice(corte + 1);
    // "1.299" ou "1,299": três casas depois do separador é milhar, não
    // centavo — ninguém escreve um preço com três decimais.
    if (decimais.length === 3 && /^\d+$/.test(decimais)) {
      normalizado = limpo.replace(/[.,]/g, "");
    } else {
      normalizado =
        limpo.slice(0, corte).replace(/[.,]/g, "") + "." + decimais;
    }
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
