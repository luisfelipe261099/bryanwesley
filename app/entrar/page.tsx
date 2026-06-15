import Link from "next/link";
import {
  CalendarPlus,
  Crown,
  ShieldCheck,
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
    desc: "Quero agendar um serviço pontual: corte, barba, combo, platinado…",
    cta: "Agendar serviço",
    highlight: false,
  },
  {
    href: "/cliente",
    icon: Crown,
    title: "Assinante / Mensalista",
    desc: "Tenho um plano. Quero ver minha agenda, créditos e marcar horário.",
    cta: "Entrar na minha conta",
    highlight: true,
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    title: "Administrador",
    desc: "Sou o barbeiro. Quero gerenciar agenda, clientes e faturamento.",
    cta: "Abrir painel",
    highlight: false,
  },
];

export default function Entrar() {
  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center px-5 py-16">
        <Reveal>
          <Link href="/" className="mb-2">
            <Logo />
          </Link>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="mt-8 text-center">
            <h1 className="font-display text-5xl text-white sm:text-6xl">
              Como você quer entrar?
            </h1>
            <p className="mx-auto mt-3 max-w-md text-steel-400">
              Escolha o perfil para ver a experiência. É uma demonstração — pode
              clicar à vontade.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid w-full gap-5 md:grid-cols-3">
          {roles.map((r, i) => (
            <Reveal key={r.href} delay={0.12 + i * 0.07}>
              <Link
                href={r.href}
                className={`group flex h-full flex-col rounded-3xl p-7 transition-transform duration-300 hover:-translate-y-1 ${
                  r.highlight
                    ? "bg-royal-grad text-white shadow-glow"
                    : "glass glass-hover"
                }`}
              >
                <div
                  className={`grid h-14 w-14 place-items-center rounded-2xl ${
                    r.highlight
                      ? "bg-white/15 text-white"
                      : "bg-royal-grad text-white shadow-glow-sm"
                  }`}
                >
                  <r.icon className="h-7 w-7" strokeWidth={1.6} />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-white">
                  {r.title}
                </h2>
                <p
                  className={`mt-2 flex-1 text-sm leading-relaxed ${
                    r.highlight ? "text-white/85" : "text-steel-400"
                  }`}
                >
                  {r.desc}
                </p>
                <span
                  className={`mt-6 inline-flex items-center gap-2 text-sm font-semibold ${
                    r.highlight ? "text-white" : "text-electric"
                  }`}
                >
                  {r.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.36}>
          <Link
            href="/"
            className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-steel-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o início
          </Link>
        </Reveal>
      </main>
    </>
  );
}
