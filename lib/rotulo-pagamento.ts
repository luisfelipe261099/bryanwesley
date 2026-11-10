// Etiqueta curta do pagamento de um horário, para a agenda da equipe:
// o barbeiro precisa saber, antes de cobrar, se o cliente já pagou no app.

export function rotuloPagamento(a: {
  kind: string;
  totalCents: number;
  paymentMethod: string | null;
  pagamentoOnline: "PAGO" | "PENDENTE" | null;
  mensalista?: boolean;
  formaPaga?: string | null;
}): { texto: string; cls: string } | null {
  if (a.kind === "ASSINANTE" || a.totalCents <= 0) return null;
  const forma = a.paymentMethod === "CARTAO" ? "cartão" : "Pix";
  if (a.pagamentoOnline === "PAGO") {
    const texto =
      a.formaPaga === "DINHEIRO" ? "Pago em dinheiro"
      : a.formaPaga === "PIX_BALCAO" ? "Pago no Pix (balcão)"
      : a.formaPaga === "CARTAO_BALCAO" ? "Pago no cartão (balcão)"
      : a.formaPaga === "PIX" ? "Pago no Pix"
      : a.formaPaga?.startsWith("CREDIT_CARD") ? "Pago no cartão"
      : `Pago no ${forma}`;
    return { texto, cls: "bg-emerald-400/15 text-emerald-200" };
  }
  if (a.pagamentoOnline === "PENDENTE") {
    return { texto: `Aguardando ${forma}`, cls: "bg-amber-400/15 text-amber-200" };
  }
  if (a.paymentMethod === "BALCAO" || a.mensalista) {
    // Mensalista não paga em dinheiro: o barbeiro cobra Pix ou cartão.
    return a.mensalista
      ? { texto: "Paga na hora · Pix/cartão", cls: "bg-white/8 text-steel-200" }
      : { texto: "Paga na hora", cls: "bg-white/8 text-steel-300" };
  }
  return null;
}
