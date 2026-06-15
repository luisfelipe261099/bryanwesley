import Link from "next/link";
import {
  CalendarPlus,
  Star,
  ArrowRight,
  Scissors,
  CheckCircle2,
  CalendarCheck,
  Sparkles,
  Quote,
} from "lucide-react";
import { Background } from "@/components/Background";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { ServiceCard } from "@/components/ServiceCard";
import { PlanCard } from "@/components/PlanCard";
import { services, plans, formatBRL } from "@/lib/data";

const steps = [
  {
    icon: Scissors,
    title: "Escolha o serviço",
    text: "Corte, barba, combo, platinado… veja o preço e a duração de cada um.",
  },
  {
    icon: CalendarCheck,
    title: "Pegue o horário",
    text: "Veja a agenda em tempo real e reserve o melhor dia e hora pra você.",
  },
  {
    icon: CheckCircle2,
    title: "Pronto, é seu",
    text: "Recebe a confirmação e um lembrete. Mensalista? É só chegar.",
  },
];

const testimonials = [
  {
    name: "Rafael L.",
    plan: "Mensalista VIP",
    text: "Melhor decisão. Corte e barba sempre em dia e nunca mais fiquei na fila.",
  },
  {
    name: "Diego S.",
    plan: "Cliente avulso",
    text: "Agendei pelo celular em 30 segundos. O platinado ficou absurdo.",
  },
  {
    name: "João P.",
    plan: "Mensalista Premium",
    text: "Atendimento de outro nível. O lance de reservar horário fixo é genial.",
  },
];

export default function Home() {
  return (
    <>
      <Background />
      <Navbar />

      <main className="overflow-x-clip">
        {/* ───────── HERO ───────── */}
        <section className="relative mx-auto max-w-7xl px-5 pb-20 pt-28 lg:px-8 lg:pt-36">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <Reveal>
                <span className="chip inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-steel-300">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-electric opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-electric" />
                  </span>
                  Agendamento online · Planos de assinatura
                </span>
              </Reveal>

              <Reveal delay={0.06}>
                <h1 className="mt-6 font-display text-6xl leading-[0.92] text-white sm:text-7xl lg:text-8xl">
                  Seu estilo,
                  <br />
                  <span className="text-gradient">hora marcada.</span>
                </h1>
              </Reveal>

              <Reveal delay={0.12}>
                <p className="mt-6 max-w-md text-lg leading-relaxed text-steel-300">
                  Agende seu corte em segundos, escolha serviços avulsos ou vire
                  mensalista e tenha visual impecável o mês inteiro. Tudo num só
                  lugar, do jeito Bryan Wesley.
                </p>
              </Reveal>

              <Reveal delay={0.18}>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/entrar"
                    className="btn-royal inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white"
                  >
                    <CalendarPlus className="h-5 w-5" />
                    Agendar agora
                  </Link>
                  <Link
                    href="/planos"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-7 py-3.5 text-base font-semibold text-white transition-colors hover:border-electric/40"
                  >
                    Ver planos
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={0.24}>
                <div className="mt-10 flex items-center gap-7">
                  <Stat value="2.4k+" label="Cortes feitos" />
                  <div className="h-9 w-px bg-white/10" />
                  <Stat value="4.9" label="Avaliação" star />
                  <div className="h-9 w-px bg-white/10" />
                  <Stat value="42" label="Mensalistas" />
                </div>
              </Reveal>
            </div>

            {/* Visual do hero */}
            <Reveal delay={0.15} className="relative">
              <HeroVisual />
            </Reveal>
          </div>
        </section>

        {/* ───────── SERVIÇOS ───────── */}
        <section id="servicos" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 lg:px-8">
          <Reveal>
            <SectionHeading
              kicker="Serviços"
              title="Tudo que você precisa"
              subtitle="Cada serviço com preço e duração na mão. Sem surpresa."
            />
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s, i) => (
              <Reveal key={s.id} delay={i * 0.05}>
                <ServiceCard service={s} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* ───────── COMO FUNCIONA ───────── */}
        <section id="como-funciona" className="relative scroll-mt-20 py-20">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <Reveal>
              <SectionHeading
                kicker="Como funciona"
                title="Agendar nunca foi tão fácil"
                subtitle="Três passos e o horário é seu."
              />
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {steps.map((step, i) => (
                <Reveal key={step.title} delay={i * 0.08}>
                  <div className="glass relative h-full rounded-2xl p-7">
                    <span className="absolute right-6 top-5 font-display text-5xl text-white/5">
                      0{i + 1}
                    </span>
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-royal-grad text-white shadow-glow-sm">
                      <step.icon className="h-6 w-6" strokeWidth={1.75} />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-steel-400">
                      {step.text}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── PLANOS ───────── */}
        <section id="planos" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-20 lg:px-8">
          <Reveal>
            <SectionHeading
              kicker="Assinatura"
              title="Vire mensalista"
              subtitle="Economize, ganhe prioridade e mantenha o visual sempre em dia."
            />
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {plans.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.08}>
                <PlanCard plan={p} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* ───────── DEPOIMENTOS ───────── */}
        <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
          <Reveal>
            <SectionHeading
              kicker="Quem corta com a gente"
              title="A régua é alta"
              subtitle="O que os clientes falam por aí."
            />
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.08}>
                <div className="glass h-full rounded-2xl p-7">
                  <Quote className="h-7 w-7 text-electric/60" />
                  <p className="mt-4 text-[15px] leading-relaxed text-steel-200">
                    “{t.text}”
                  </p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-royal-grad font-display text-lg text-white">
                      {t.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {t.name}
                      </p>
                      <p className="text-xs text-electric/80">{t.plan}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ───────── CTA FINAL ───────── */}
        <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-royal-grad px-8 py-14 text-center shadow-glow sm:px-16 sm:py-20">
              <div className="absolute inset-0 bg-grid-faint bg-[size:40px_40px] opacity-30" />
              <div className="relative">
                <Sparkles className="mx-auto h-8 w-8 text-white" />
                <h2 className="mt-4 font-display text-5xl text-white sm:text-6xl">
                  Bora marcar seu horário?
                </h2>
                <p className="mx-auto mt-3 max-w-lg text-white/85">
                  Leva menos de 30 segundos. Escolha o serviço, o horário e
                  pronto.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    href="/entrar"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-base font-semibold text-royal-600 transition-transform hover:scale-[1.02] active:scale-95"
                  >
                    <CalendarPlus className="h-5 w-5" />
                    Agendar corte
                  </Link>
                  <Link
                    href="/entrar"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    Entrar na conta
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </>
  );
}

function Stat({
  value,
  label,
  star,
}: {
  value: string;
  label: string;
  star?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 font-display text-3xl text-white">
        {value}
        {star && <Star className="h-4 w-4 fill-gold text-gold" />}
      </div>
      <div className="text-xs text-steel-400">{label}</div>
    </div>
  );
}

function SectionHeading({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-semibold uppercase tracking-[0.28em] text-electric">
        {kicker}
      </span>
      <h2 className="mt-3 font-display text-5xl text-white sm:text-6xl">
        {title}
      </h2>
      <p className="mt-3 text-steel-400">{subtitle}</p>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm py-6">
      {/* Card principal: próximo horário */}
      <div className="glass rounded-3xl p-6 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-steel-400">
            Próximo horário livre
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Disponível
          </span>
        </div>

        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="font-display text-6xl leading-none text-white">
              15:00
            </div>
            <div className="mt-1 text-sm text-steel-300">Hoje · Bryan Wesley</div>
          </div>
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-royal-grad text-white shadow-glow-sm">
            <Scissors className="h-7 w-7" strokeWidth={1.75} />
          </div>
        </div>

        <div className="mt-6 space-y-2.5 rounded-2xl bg-white/[0.03] p-4">
          <Row label="Serviço" value="Cabelo + Barba" />
          <Row label="Duração" value="1h10" />
          <Row label="Valor" value={formatBRL(70)} accent />
        </div>

        <Link
          href="/entrar"
          className="btn-royal mt-5 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
        >
          Reservar este horário
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Chips flutuantes */}
      <div className="glass absolute -right-3 -top-2 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 shadow-glow-sm sm:-right-5">
        <Star className="h-4 w-4 fill-gold text-gold" />
        <span className="text-xs font-semibold text-white">+2.400 cortes</span>
      </div>
      <div className="glass absolute -left-3 -bottom-1 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 shadow-glow-sm sm:-left-5">
        <Sparkles className="h-4 w-4 text-electric" />
        <span className="text-xs font-semibold text-white">Plano VIP ativo</span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-steel-400">{label}</span>
      <span
        className={`font-semibold tabular-nums ${
          accent ? "text-electric" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
