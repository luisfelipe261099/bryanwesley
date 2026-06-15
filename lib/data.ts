// ───────────────────────────────────────────────────────────
// Dados-mock do protótipo. Sem backend ainda: tudo aqui é fixo
// para o cliente navegar e aprovar o visual. Depois trocamos por
// banco/API real (ex.: Postgres na Vercel + auth).
// ───────────────────────────────────────────────────────────

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
    name: "Corte de Cabelo",
    description: "Tesoura e máquina, finalização e styling.",
    price: 45,
    durationMin: 40,
    popular: true,
  },
  {
    id: "barba",
    name: "Barba",
    description: "Modelagem, navalha e toalha quente.",
    price: 35,
    durationMin: 30,
  },
  {
    id: "combo",
    name: "Cabelo + Barba",
    description: "O combo completo. Visual fechado.",
    price: 70,
    durationMin: 70,
    popular: true,
    tag: "Mais pedido",
  },
  {
    id: "pezinho",
    name: "Pézinho / Acabamento",
    description: "Aquele retoque entre os cortes.",
    price: 20,
    durationMin: 15,
  },
  {
    id: "sobrancelha",
    name: "Sobrancelha",
    description: "Alinhamento na navalha.",
    price: 15,
    durationMin: 10,
  },
  {
    id: "platinado",
    name: "Platinado / Luzes",
    description: "Descoloração e tonalização. Inclui hidratação.",
    price: 120,
    durationMin: 120,
    tag: "Premium",
  },
  {
    id: "pigmentacao",
    name: "Pigmentação",
    description: "Camuflagem de falhas e grisalhos.",
    price: 60,
    durationMin: 45,
  },
  {
    id: "hidratacao",
    name: "Hidratação Capilar",
    description: "Tratamento e nutrição do fio.",
    price: 40,
    durationMin: 30,
  },
];

export type Plan = {
  id: string;
  name: string;
  price: number;
  tagline: string;
  features: string[];
  // Serviços que o plano cobre — o assinante agenda só estes (sem ver preço).
  includedServices: string[];
  highlight?: boolean;
  badge?: string;
};

export const plans: Plan[] = [
  {
    id: "essencial",
    name: "Essencial",
    price: 99,
    tagline: "Pra quem mantém o cabelo sempre em dia.",
    includedServices: ["corte", "pezinho"],
    features: [
      "4 cortes de cabelo por mês",
      "Pézinho liberado entre cortes",
      "Agendamento prioritário",
      "10% off em serviços avulsos",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: 149,
    tagline: "Cabelo e barba impecáveis o mês inteiro.",
    highlight: true,
    badge: "Mais popular",
    includedServices: ["corte", "barba", "sobrancelha"],
    features: [
      "Cabelo e Barba ILIMITADOS",
      "Sobrancelha inclusa",
      "Horários reservados toda semana",
      "15% off em serviços premium",
      "Cancele quando quiser",
    ],
  },
  {
    id: "vip",
    name: "VIP Black",
    price: 229,
    tagline: "A experiência completa, sem limites.",
    badge: "Top",
    includedServices: ["corte", "barba", "sobrancelha", "hidratacao"],
    features: [
      "Tudo do Premium, sem limite",
      "1 hidratação capilar por mês",
      "Prioridade máxima na agenda",
      "20% off em platinado e pigmentação",
      "Bebida cortesia na visita",
    ],
  },
];

export type ApptStatus = "confirmado" | "pendente" | "concluido";

export type Appointment = {
  id: string;
  client: string;
  serviceId: string;
  serviceName: string;
  time: string; // "HH:MM"
  durationMin: number;
  status: ApptStatus;
  kind: "avulso" | "assinante";
  price: number;
};

// Agenda de "hoje" para o painel do admin
export const todayAppointments: Appointment[] = [
  {
    id: "a1",
    client: "Rafael Lima",
    serviceId: "combo",
    serviceName: "Cabelo + Barba",
    time: "09:00",
    durationMin: 70,
    status: "concluido",
    kind: "assinante",
    price: 0,
  },
  {
    id: "a2",
    client: "Diego Souza",
    serviceId: "corte",
    serviceName: "Corte de Cabelo",
    time: "10:30",
    durationMin: 40,
    status: "concluido",
    kind: "avulso",
    price: 45,
  },
  {
    id: "a3",
    client: "Marcos Vianna",
    serviceId: "platinado",
    serviceName: "Platinado / Luzes",
    time: "11:30",
    durationMin: 120,
    status: "confirmado",
    kind: "avulso",
    price: 120,
  },
  {
    id: "a4",
    client: "João Pedro",
    serviceId: "barba",
    serviceName: "Barba",
    time: "14:00",
    durationMin: 30,
    status: "confirmado",
    kind: "assinante",
    price: 0,
  },
  {
    id: "a5",
    client: "Lucas Andrade",
    serviceId: "corte",
    serviceName: "Corte de Cabelo",
    time: "15:00",
    durationMin: 40,
    status: "confirmado",
    kind: "avulso",
    price: 45,
  },
  {
    id: "a6",
    client: "Henrique Dias",
    serviceId: "combo",
    serviceName: "Cabelo + Barba",
    time: "16:30",
    durationMin: 70,
    status: "pendente",
    kind: "avulso",
    price: 70,
  },
];

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
  { id: "c1", name: "Rafael Lima", phone: "(11) 9 8812-2031", plan: "VIP Black", visits: 38, lastVisit: "Hoje", status: "ativo" },
  { id: "c2", name: "João Pedro", phone: "(11) 9 9921-7744", plan: "Premium", visits: 22, lastVisit: "Hoje", status: "ativo" },
  { id: "c3", name: "Diego Souza", phone: "(11) 9 9100-5532", plan: null, visits: 6, lastVisit: "Hoje", status: "ativo" },
  { id: "c4", name: "Bruno Carvalho", phone: "(11) 9 9740-1188", plan: "Essencial", visits: 14, lastVisit: "3 dias atrás", status: "ativo" },
  { id: "c5", name: "Marcos Vianna", phone: "(11) 9 9655-9043", plan: null, visits: 2, lastVisit: "Hoje", status: "ativo" },
  { id: "c6", name: "Felipe Nunes", phone: "(11) 9 9483-2210", plan: "Premium", visits: 19, lastVisit: "8 dias atrás", status: "atrasado" },
];

// KPIs do dia/mês para o painel admin
export const adminStats = {
  faturamentoHoje: 280,
  faturamentoMes: 8740,
  metaMes: 12000,
  agendamentosHoje: todayAppointments.length,
  assinantesAtivos: 42,
  taxaOcupacao: 78, // %
};

// Faturamento dos últimos 7 dias (para o mini-gráfico)
export const weeklyRevenue = [
  { day: "Seg", value: 420 },
  { day: "Ter", value: 560 },
  { day: "Qua", value: 380 },
  { day: "Qui", value: 690 },
  { day: "Sex", value: 920 },
  { day: "Sáb", value: 1180 },
  { day: "Dom", value: 280 },
];

// Slots de horário para o fluxo de agendamento
export const timeSlots = [
  { time: "09:00", free: true },
  { time: "09:40", free: false },
  { time: "10:30", free: true },
  { time: "11:30", free: false },
  { time: "13:30", free: true },
  { time: "14:00", free: false },
  { time: "15:00", free: true },
  { time: "15:40", free: true },
  { time: "16:30", free: true },
  { time: "17:10", free: true },
  { time: "18:00", free: true },
  { time: "18:40", free: true },
];

// Dias fechados da barbearia: 0 = Domingo, 1 = Segunda
export const closedWeekdays = [0, 1];

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

export function formatDuration(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`;
}
