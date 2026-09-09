// ───────────────────────────────────────────────────────────
// Dados-mock do protótipo. Sem backend ainda: tudo aqui é fixo
// para o cliente navegar e aprovar o visual. Depois trocamos por
// banco/API real (ex.: Postgres na Vercel + auth).
// ───────────────────────────────────────────────────────────

export const barbershop = {
  name: "Bryan Wesley",
  unit: "Unidade Jardins",
  instagram: "@bryanwesley.barbearia",
  phone: "(11) 9 9999-0000",
  address: "Rua Haddock Lobo, 1240 — Jardins",
};

// ───────────────────────── Serviços ─────────────────────────

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number;
  durationMin: number;
  popular?: boolean;
  tag?: string;
};

export const services: Service[] = [
  {
    id: "corte",
    name: "Corte Signature",
    description: "Degradê, tesoura e finalização com styling.",
    price: 90,
    durationMin: 40,
    popular: true,
  },
  {
    id: "barba",
    name: "Barboterapia",
    description: "Toalha quente, navalha e óleos essenciais.",
    price: 75,
    durationMin: 35,
  },
  {
    id: "combo",
    name: "Combo Completo",
    description: "Corte Signature + Barboterapia Premium.",
    price: 150,
    durationMin: 75,
    popular: true,
    tag: "Mais pedido",
  },
  {
    id: "lavagem",
    name: "Corte & Lavagem",
    description: "Massagem capilar inclusa e finalização.",
    price: 90,
    durationMin: 45,
  },
  {
    id: "pezinho",
    name: "Pézinho / Acabamento",
    description: "Aquele retoque entre os cortes.",
    price: 35,
    durationMin: 15,
  },
  {
    id: "sobrancelha",
    name: "Sobrancelha",
    description: "Alinhamento na navalha.",
    price: 30,
    durationMin: 10,
  },
  {
    id: "platinado",
    name: "Platinado / Luzes",
    description: "Descoloração e tonalização. Inclui hidratação.",
    price: 220,
    durationMin: 120,
    tag: "Premium",
  },
  {
    id: "hidratacao",
    name: "Spa Capilar",
    description: "Tratamento, nutrição e reconstrução do fio.",
    price: 80,
    durationMin: 30,
  },
];

// ───────────────────────── Barbeiros ─────────────────────────

export type Barber = {
  id: string;
  name: string;
  short: string;
  role: string;
  initial: string;
  rating: number;
  commissionPct: number;
};

export const barbers: Barber[] = [
  {
    id: "bryan",
    name: "Bryan Wesley",
    short: "Bryan W.",
    role: "Master Barber & Founder",
    initial: "B",
    rating: 5.0,
    commissionPct: 45,
  },
  {
    id: "lucas",
    name: "Lucas Silva",
    short: "Lucas S.",
    role: "Barbeiro Sênior",
    initial: "L",
    rating: 4.9,
    commissionPct: 40,
  },
  {
    id: "matheus",
    name: "Matheus Fontes",
    short: "Matheus F.",
    role: "Especialista em Barba",
    initial: "M",
    rating: 4.8,
    commissionPct: 40,
  },
];

export function barberById(id?: string | null) {
  return barbers.find((b) => b.id === id);
}

// ───────────────────────── Planos ─────────────────────────

export type Plan = {
  id: string;
  name: string;
  kicker: string; // rótulo acima do nome ("Entrada exclusiva")
  price: number; // mensal
  annualPrice: number; // por mês, no plano anual (2 meses off)
  tagline: string;
  features: string[];
  // Serviços que o plano cobre — o assinante agenda só estes (sem ver preço).
  includedServices: string[];
  highlight?: boolean;
  badge?: string;
};

export const plans: Plan[] = [
  {
    id: "silver",
    name: "Plano Silver",
    kicker: "Entrada exclusiva",
    price: 139,
    annualPrice: 116,
    tagline: "Pra quem mantém o cabelo sempre em dia.",
    includedServices: ["corte", "pezinho"],
    features: [
      "2 cortes de cabelo por mês",
      "Pézinho liberado entre os cortes",
      "10% OFF em produtos e cosméticos",
      "Barber Bar com café espresso & chopp",
    ],
  },
  {
    id: "gold",
    name: "Plano Gold Black",
    kicker: "Experiência insígnia",
    price: 229,
    annualPrice: 191,
    tagline: "Cabelo e barba impecáveis o mês inteiro.",
    highlight: true,
    badge: "Mais escolhido",
    includedServices: ["corte", "barba", "sobrancelha", "lavagem"],
    features: [
      "Cortes ilimitados durante todo o mês",
      "Barboterapia semanal inclusa",
      "Prioridade máxima na agenda VIP",
      "Bar liberado & 20% OFF em produtos",
    ],
  },
  {
    id: "diamond",
    name: "Diamond Royalty",
    kicker: "Nível soberano",
    price: 319,
    annualPrice: 266,
    tagline: "A experiência completa, sem limites.",
    badge: "Top",
    includedServices: [
      "corte",
      "barba",
      "sobrancelha",
      "lavagem",
      "hidratacao",
    ],
    features: [
      "Cortes & barba ilimitados + toalha quente",
      "Acesso privativo ao Lounge VIP",
      "1 convidado mensal grátis",
      "Spa capilar e 25% OFF em coloração",
    ],
  },
];

// Meses cobrados no plano anual (base do selo "2 meses off")
export const annualMonthsCharged = 10;

// ───────────────────────── Agendamentos ─────────────────────────

export type ApptStatus = "confirmado" | "pendente" | "concluido";

export type Appointment = {
  id: string;
  client: string;
  serviceId: string;
  serviceName: string;
  barberId: string;
  time: string; // "HH:MM"
  durationMin: number;
  status: ApptStatus;
  kind: "avulso" | "assinante";
  price: number;
};

// Agenda de "hoje" para os painéis do barbeiro e do admin
export const todayAppointments: Appointment[] = [
  {
    id: "a1",
    client: "Ricardo Mendes",
    serviceId: "corte",
    serviceName: "Corte Signature",
    barberId: "bryan",
    time: "13:00",
    durationMin: 40,
    status: "concluido",
    kind: "assinante",
    price: 0,
  },
  {
    id: "a2",
    client: "Thiago Castro",
    serviceId: "barba",
    serviceName: "Barboterapia & Navalha",
    barberId: "bryan",
    time: "14:15",
    durationMin: 35,
    status: "concluido",
    kind: "avulso",
    price: 75,
  },
  {
    id: "a3",
    client: "Gabriel Rocha",
    serviceId: "combo",
    serviceName: "Cabelo & Barboterapia",
    barberId: "bryan",
    time: "15:30",
    durationMin: 75,
    status: "confirmado",
    kind: "avulso",
    price: 150,
  },
  {
    id: "a4",
    client: "Fernando Souza",
    serviceId: "corte",
    serviceName: "Corte Degradê",
    barberId: "lucas",
    time: "16:45",
    durationMin: 40,
    status: "confirmado",
    kind: "assinante",
    price: 0,
  },
  {
    id: "a5",
    client: "Marcos Vianna",
    serviceId: "platinado",
    serviceName: "Platinado / Luzes",
    barberId: "matheus",
    time: "17:30",
    durationMin: 120,
    status: "confirmado",
    kind: "avulso",
    price: 220,
  },
  {
    id: "a6",
    client: "Henrique Dias",
    serviceId: "lavagem",
    serviceName: "Corte & Lavagem",
    barberId: "lucas",
    time: "19:00",
    durationMin: 45,
    status: "pendente",
    kind: "avulso",
    price: 90,
  },
];

// ───────────────────────── Clientes ─────────────────────────

export type Client = {
  id: string;
  name: string;
  phone: string;
  plan: string | null;
  visits: number;
  lastVisit: string;
  status: "ativo" | "atrasado";
};

export const clients: Client[] = [
  { id: "c1", name: "Ricardo Mendes", phone: "(11) 9 8812-2031", plan: "Diamond Royalty", visits: 38, lastVisit: "Hoje", status: "ativo" },
  { id: "c2", name: "Fernando Souza", phone: "(11) 9 9921-7744", plan: "Plano Gold Black", visits: 22, lastVisit: "Hoje", status: "ativo" },
  { id: "c3", name: "Thiago Castro", phone: "(11) 9 9100-5532", plan: null, visits: 6, lastVisit: "Hoje", status: "ativo" },
  { id: "c4", name: "Bruno Carvalho", phone: "(11) 9 9740-1188", plan: "Plano Silver", visits: 14, lastVisit: "3 dias atrás", status: "ativo" },
  { id: "c5", name: "Gabriel Rocha", phone: "(11) 9 9655-9043", plan: null, visits: 2, lastVisit: "Hoje", status: "ativo" },
  { id: "c6", name: "Felipe Nunes", phone: "(11) 9 9483-2210", plan: "Plano Gold Black", visits: 19, lastVisit: "8 dias atrás", status: "atrasado" },
];

// ───────────────────────── Painel do barbeiro ─────────────────────────

export const barberStats = {
  barberId: "bryan",
  comissaoMes: 5180,
  metaMes: 7000,
  ganhoHoje: 460,
  atendimentosHoje: 7,
  atendimentosFeitos: 2,
  proximoIntervalo: "19:30",
};

// ───────────────────────── Painel administrativo ─────────────────────────

export const adminStats = {
  faturamentoHoje: 3820,
  faturamentoHojeTrend: "+18,4%",
  mrr: 38400,
  mrrTrend: "+9,4%",
  taxaOcupacao: 88,
  ocupacaoTrend: "Alta procura",
  faturamentoMes: 87400,
  metaMes: 110000,
  assinantesAtivos: 168,
  agendamentosHoje: todayAppointments.length,
};

export type TeamPerformance = {
  barberId: string;
  faturamento: number;
  comissao: number;
};

export const teamPerformance: TeamPerformance[] = [
  { barberId: "bryan", faturamento: 14200, comissao: 6390 },
  { barberId: "lucas", faturamento: 11500, comissao: 4600 },
  { barberId: "matheus", faturamento: 9800, comissao: 3920 },
];

export type OperationalAlert = {
  id: string;
  title: string;
  detail: string;
  action: string;
  severity: "alta" | "media";
};

export const operationalAlerts: OperationalAlert[] = [
  {
    id: "op1",
    title: "Reposição: Pomada Matte",
    detail: "Estoque crítico na bancada central — restam 3 unidades.",
    action: "Pedir",
    severity: "alta",
  },
  {
    id: "op2",
    title: "Comissões de outubro",
    detail: "Fechamento pendente de aprovação para 3 barbeiros.",
    action: "Revisar",
    severity: "media",
  },
];

// Faturamento dos últimos 7 dias (para o mini-gráfico)
export const weeklyRevenue = [
  { day: "Seg", value: 2140 },
  { day: "Ter", value: 2860 },
  { day: "Qua", value: 2380 },
  { day: "Qui", value: 3190 },
  { day: "Sex", value: 4120 },
  { day: "Sáb", value: 5180 },
  { day: "Dom", value: 1480 },
];

// ───────────────────────── Agenda ─────────────────────────

// Slots de horário para o fluxo de agendamento
export const timeSlots = [
  { time: "09:00", free: true },
  { time: "09:40", free: false },
  { time: "10:30", free: true },
  { time: "11:30", free: false },
  { time: "13:30", free: true },
  { time: "14:00", free: false },
  { time: "15:30", free: true },
  { time: "16:30", free: true },
  { time: "17:30", free: true },
  { time: "18:10", free: true },
  { time: "19:00", free: true },
  { time: "19:40", free: true },
];

// Dias fechados da barbearia: 0 = Domingo, 1 = Segunda
export const closedWeekdays = [0, 1];

// ───────────────────────── Helpers ─────────────────────────

export function getPlan(id?: string | null) {
  return plans.find((p) => p.id === id);
}

export function serviceById(id: string) {
  return services.find((s) => s.id === id);
}

export function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Versão compacta para KPIs: R$ 38,4k
export function formatCompactBRL(value: number) {
  if (value < 1000) return formatBRL(value);
  const k = value / 1000;
  return `R$ ${k.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
}

export function formatDuration(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`;
}
