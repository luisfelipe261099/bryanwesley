// Etiqueta curta do pagamento de um horário, para a agenda da equipe:
// o barbeiro precisa saber, antes de cobrar, se o cliente já pagou no app.

export function rotuloPagamento(a: {
  kind: string;
  totalCents: number;
  paymentMethod: string | null;
  pagamentoOnline: "PAGO" | "PENDENTE" | null;
  mensalista?: boolean;
  formaPaga?: string | null;
  /** Com o status, o atendimento já feito e não pago vira alerta vermelho. */
  status?: string;
}): { texto: string; cls: string } | null {
  if (a.kind === "ASSINANTE" || a.totalCents <= 0) return null;
  if (a.status && devendo({ ...a, status: a.status })) {
    return {
      texto: a.pagamentoOnline === "PENDENTE" ? "Não pago · Pix em aberto" : "Não pago",
      cls: "bg-red-500 text-white ring-2 ring-red-400/40",
    };
  }
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

/** Ainda há valor a receber neste horário (não pago, não cancelado). */
export function aReceber(a: { kind: string; totalCents: number; pagamentoOnline: "PAGO" | "PENDENTE" | null; status: string }) {
  return (
    a.kind !== "ASSINANTE" &&
    a.totalCents > 0 &&
    a.pagamentoOnline !== "PAGO" &&
    !["CANCELADO", "NO_SHOW"].includes(a.status)
  );
}

/** Já atendido (ou na cadeira) e ainda não pago: o cliente não pode sair assim. */
export function devendo(a: { kind: string; totalCents: number; pagamentoOnline: "PAGO" | "PENDENTE" | null; status: string }) {
  return aReceber(a) && (a.status === "EM_ANDAMENTO" || a.status === "CONCLUIDO");
}
