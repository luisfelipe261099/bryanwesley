// Como cada situação aparece na tela. Mora fora das páginas porque o
// painel, a agenda do barbeiro e a ficha do cliente mostram as mesmas
// situações — com nomes diferentes elas pareceriam coisas diferentes.

export const appointmentStatus: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  CONCLUIDO: { label: "Concluído", cls: "bg-neon/10 text-neon", dot: "bg-neon" },
  CONFIRMADO: { label: "Confirmado", cls: "bg-electric/10 text-electric", dot: "bg-electric" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-royal/20 text-electric", dot: "bg-electric" },
  PENDENTE: { label: "Pendente", cls: "bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  CANCELADO: { label: "Cancelado", cls: "bg-white/5 text-steel-400", dot: "bg-steel-400" },
  NO_SHOW: { label: "Faltou", cls: "bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
};

export const paymentStatus: Record<string, { label: string; cls: string }> = {
  PAGO: { label: "Pago", cls: "bg-neon/10 text-neon" },
  PENDENTE: { label: "Aguardando", cls: "bg-amber-400/10 text-amber-300" },
  EXPIRADO: { label: "Expirado", cls: "bg-white/5 text-steel-400" },
  CANCELADO: { label: "Cancelado", cls: "bg-white/5 text-steel-400" },
};

export const subscriptionStatus: Record<string, { label: string; cls: string }> = {
  ATIVA: { label: "Ativa", cls: "bg-neon/10 text-neon" },
  INADIMPLENTE: { label: "Vencida", cls: "bg-amber-400/10 text-amber-300" },
  CANCELADA: { label: "Cancelada", cls: "bg-white/5 text-steel-400" },
};
