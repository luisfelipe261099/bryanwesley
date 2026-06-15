import Link from "next/link";
import {
  CalendarPlus,
  Crown,
  Scissors,
  Clock,
  ArrowRight,
  Check,
  TrendingDown,
  CalendarDays,
  History,
  Gift,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { Reveal } from "@/components/Reveal";
import { plans, formatBRL } from "@/lib/data";

const me = {
  name: "Rafael Lima",
  initial: "R",
  planId: "vip",
  renovaEmDias: 12,
  cicloPct: 60, // % do ciclo de cobrança decorrido
  cortesNoMes: 5,
  economiaNoMes: 180,
};

const proximo = {
  service: "Cabelo + Barba",
  dia: "Sexta, 18",
  hora: "15:00",
};

const historico = [
  { service: "Cabelo + Barba", date: "Hoje", time: "09:00" },
  { service: "Barba", date: "Há 5 dias", time: "16:30" },
  { service: "Corte de Cabelo", date: "Há 11 dias", time: "10:30" },
  { service: "Cabelo + Barba", date: "Há 18 dias", time: "14:00" },
];

export default function ClienteDashboard() {
  const plan = plans.find((p) => p.id === me.planId)!;

  return (
    <>
      <Background />
      <AppHeader badge="Assinante" user={{ name: me.name, initial: me.initial }} />

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-24 lg:px-8">
        <Reveal>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-5xl text-white sm:text-6xl">
              Olá, {me.name.split(" ")[0]}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-royal-grad px-3 py-1.5 text-sm font-semibold text-white shadow-glow-sm">
              <Crown className="h-4 w-4" />
              {plan.name}
            </span>
          </div>
          <p className="mt-2 text-steel-400">
            Seu visual está em dia. Bora marcar o próximo?
          </p>
        </Reveal>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {/* Status do plano */}
          <Reveal className="lg:col-span-2">
            <div className="glass relative overflow-hidden rounded-3xl p-7">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-royal/20 blur-3xl" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-electric">
                    Seu plano
                  </span>
                  <div className="mt-1 flex items-end gap-2">
                    <h2 className="font-display text-4xl text-white">
                      {plan.name}
                    </h2>
                    <span className="mb-1 text-sm text-steel-400">
                      {formatBRL(plan.price)}/mês
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Ativo
                </span>
              </div>

              {/* Ciclo de cobrança */}
              <div className="relative mt-7">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-steel-300">Renovação</span>
                  <span className="font-medium text-white">
                    em {me.renovaEmDias} dias
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-royal-grad"
                    style={{ width: `${me.cicloPct}%` }}
                  />
                </div>
              </div>

              <div className="relative mt-7 grid grid-cols-3 gap-4 border-t border-white/8 pt-6">
                <MiniStat
                  icon={Scissors}
                  value={String(me.cortesNoMes)}
                  label="Atendimentos no mês"
                />
                <MiniStat
                  icon={TrendingDown}
                  value={formatBRL(me.economiaNoMes)}
                  label="Economia no mês"
                  accent
                />
                <MiniStat icon={Crown} value="Ilimitado" label="Cortes restantes" />
              </div>
            </div>
          </Reveal>

          {/* Próximo agendamento */}
          <Reveal delay={0.08}>
            <div className="glass flex h-full flex-col rounded-3xl p-7">
              <span className="text-xs font-semibold uppercase tracking-wider text-electric">
                Próximo horário
              </span>
              <div className="mt-4 flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-royal-grad text-white shadow-glow-sm">
                  <Scissors className="h-6 w-6" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="font-semibold text-white">{proximo.service}</p>
                  <p className="text-sm text-steel-400">Bryan Wesley</p>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-steel-300">
                  <CalendarDays className="h-4 w-4 text-electric" />
                  {proximo.dia}
                </span>
                <span className="inline-flex items-center gap-1.5 text-steel-300">
                  <Clock className="h-4 w-4 text-electric" />
                  {proximo.hora}
                </span>
              </div>
              <Link
                href={`/agendar?plano=${me.planId}`}
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 py-3 text-sm font-semibold text-white transition-colors hover:border-electric/40"
              >
                Remarcar
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Ações rápidas */}
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Reveal delay={0.04}>
            <QuickAction
              href={`/agendar?plano=${me.planId}`}
              icon={CalendarPlus}
              title="Agendar agora"
              desc="Marque seu próximo corte"
              primary
            />
          </Reveal>
          <Reveal delay={0.08}>
            <QuickAction
              href="/planos"
              icon={Crown}
              title="Gerenciar plano"
              desc="Faça upgrade ou troque"
            />
          </Reveal>
          <Reveal delay={0.12}>
            <QuickAction
              href="#historico"
              icon={History}
              title="Histórico"
              desc="Veja seus atendimentos"
            />
          </Reveal>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* Benefícios */}
          <Reveal>
            <div className="glass h-full rounded-3xl p-7">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-electric" />
                <h3 className="text-lg font-semibold text-white">
                  Benefícios do seu plano
                </h3>
              </div>
              <ul className="mt-5 grid gap-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-royal/20">
                      <Check className="h-3 w-3 text-electric" strokeWidth={3} />
                    </span>
                    <span className="text-steel-200">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Histórico */}
          <Reveal delay={0.08}>
            <div id="historico" className="glass h-full scroll-mt-24 rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  Seus atendimentos
                </h3>
                <span className="text-sm text-steel-400">38 no total</span>
              </div>
              <ul className="mt-5 space-y-1">
                {historico.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-white/5 text-steel-300">
                      <Scissors className="h-4 w-4" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-white">
                        {h.service}
                      </span>
                      <span className="text-xs text-steel-400">
                        {h.date} · {h.time}
                      </span>
                    </span>
                    <span className="rounded-full bg-royal/10 px-2.5 py-1 text-[11px] font-semibold text-electric">
                      incluso
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </main>
    </>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <Icon
        className={`h-5 w-5 ${accent ? "text-emerald-400" : "text-electric"}`}
      />
      <div
        className={`mt-2 font-display text-2xl ${
          accent ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-steel-400">{label}</div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
  primary,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5 ${
        primary ? "bg-royal-grad shadow-glow-sm" : "glass glass-hover"
      }`}
    >
      <span
        className={`grid h-12 w-12 flex-none place-items-center rounded-xl ${
          primary ? "bg-white/15 text-white" : "bg-royal-grad text-white"
        }`}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <span className="flex-1">
        <span className="block font-semibold text-white">{title}</span>
        <span
          className={`text-sm ${primary ? "text-white/80" : "text-steel-400"}`}
        >
          {desc}
        </span>
      </span>
      <ArrowRight
        className={`h-5 w-5 transition-transform group-hover:translate-x-1 ${
          primary ? "text-white" : "text-electric"
        }`}
      />
    </Link>
  );
}
