// Etiqueta curta do pagamento de um horário, para a agenda da equipe:
// o barbeiro precisa saber, antes de cobrar, se o cliente já pagou no app.

export function rotuloPagamento(a: {
  kind: string;
  totalCents: number;
  paymentMethod: string | null;
  pagamentoOnline: "PAGO" | "PENDENTE" | null;
}): { texto: string; cls: string } | null {
  if (a.kind === "ASSINANTE" || a.totalCents <= 0) return null;
  const forma = a.paymentMethod === "CARTAO" ? "cartão" : "Pix";
  if (a.pagamentoOnline === "PAGO") {
    return { texto: `Pago no ${forma}`, cls: "bg-emerald-400/15 text-emerald-200" };
  }
  if (a.pagamentoOnline === "PENDENTE") {
    return { texto: `Aguardando ${forma}`, cls: "bg-amber-400/15 text-amber-200" };
  }
  if (a.paymentMethod === "BALCAO") {
    return { texto: "Paga na hora", cls: "bg-white/8 text-steel-300" };
  }
  return null;
}
