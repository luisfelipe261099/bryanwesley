import Link from "next/link";
import {
  CalendarPlus,
  Gem,
  UserRound,
  BarChart3,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";

const roles = [
  {
    href: "/agendar",
    icon: CalendarPlus,
    title: "Cliente avulso",
    desc: "Quero agendar um serviço pontual: corte, barboterapia, combo…",
    cta: "Agendar serviço",
    highlight: false,
  },
  {
    href: "/cliente",
    icon: Gem,
    title: "Membro Clube VIP",
    desc: "Tenho assinatura. Quero ver meu plano, benefícios e marcar horário.",
    cta: "Entrar no clube",
    highlight: true,
  },
  {
    href: "/barbeiro",
    icon: UserRound,
    title: "Barbeiro",
    desc: "Quero ver minha agenda do dia, comissão e atendimentos.",
    cta: "Abrir minha agenda",
    highlight: false,
  },
  {
    href: "/admin",
    icon: BarChart3,
    title: "Administrador",
    desc: "Quero acompanhar faturamento, equipe e a operação da unidade.",
    cta: "Abrir dashboard",
    highlight: false,
  },
];

export default function Entrar() {
  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-6xl flex-col items-center justify-center px-5 py-16">
        <Reveal>
          <Link href="/" className="mb-2">
            <Logo />
          </Link>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="mt-8 text-center">
            <span className="label text-electric">Acesso</span>
            <h1 className="mt-3 font-display text-4xl text-white sm:text-5xl">
              Como você quer entrar?
            </h1>
            <p className="mx-auto mt-3 max-w-md text-steel-400">
              Escolha o perfil para ver a experiência. É uma demonstração — pode
              clicar à vontade.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid w-full gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((r, i) => (
            <Reveal key={r.href} delay={0.12 + i * 0.07}>
              <Link
                href={r.href}
                className={`group flex h-full flex-col rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-1 ${
                  r.highlight
                    ? "border border-electric/45 bg-surface shadow-glow"
                    : "glass glass-hover"
                }`}
              >
                <div
                  className={`grid h-12 w-12 place-items-center rounded-2xl ${
                    r.highlight
                      ? "bg-royal-grad text-white"
                      : "border border-electric/25 bg-electric/10 text-electric"
                  }`}
                >
                  <r.icon className="h-6 w-6" strokeWidth={1.7} />
                </div>
                <h2 className="mt-5 font-display text-xl text-white">
                  {r.title}
                </h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-steel-400">
                  {r.desc}
                </p>
                <span className="label mt-6 inline-flex items-center gap-2 text-electric">
                  {r.cta}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.42}>
          <Link
            href="/"
            className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-steel-400 transition-colors hover:text-electric"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o início
          </Link>
        </Reveal>
      </main>
    </>
  );
}
