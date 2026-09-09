import { Check, Minus, HelpCircle } from "lucide-react";
import { Background } from "@/components/Background";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { PlanCard } from "@/components/PlanCard";
import { listPlans } from "@/lib/queries";
import { PlanosGrid } from "./PlanosGrid";

const comparison = [
  { feature: "Cortes de cabelo", silver: "2/mês", gold: "Ilimitado", diamond: "Ilimitado" },
  { feature: "Barboterapia", silver: "—", gold: "Semanal", diamond: "Ilimitada" },
  { feature: "Sobrancelha", silver: "—", gold: "Inclusa", diamond: "Inclusa" },
  { feature: "Spa capilar", silver: "—", gold: "—", diamond: "1/mês" },
  { feature: "Prioridade na agenda", silver: true, gold: true, diamond: true },
  { feature: "Lounge VIP privativo", silver: false, gold: false, diamond: true },
  { feature: "Convidado mensal grátis", silver: false, gold: false, diamond: true },
  { feature: "OFF em produtos", silver: "10%", gold: "20%", diamond: "25%" },
];

const faq = [
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim. Sem fidelidade e sem multa. Você cancela direto pela sua conta.",
  },
  {
    q: "Como funcionam os cortes ilimitados?",
    a: "Você agenda quantas vezes precisar no mês, respeitando a disponibilidade da agenda.",
  },
  {
    q: "Posso trocar de plano depois?",
    a: "Pode fazer upgrade ou downgrade a qualquer momento. O valor é ajustado no próximo ciclo.",
  },
  {
    q: "O plano vale para outras pessoas?",
    a: "O plano é individual, vinculado ao seu cadastro e WhatsApp. O Diamond dá 1 convidado por mês.",
  },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true)
    return <Check className="mx-auto h-5 w-5 text-electric" strokeWidth={2.5} />;
  if (value === false)
    return <Minus className="mx-auto h-5 w-5 text-steel-400/40" />;
  return <span className="text-sm text-steel-200">{value}</span>;
}

export const revalidate = 60;

export default async function Planos() {
  const plans = await listPlans();

  return (
    <>
      <Background />
      <Navbar />

      <main className="mx-auto max-w-7xl px-5 pb-10 pt-28 lg:px-8 lg:pt-36">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="label text-electric">Membros privados</span>
            <h1 className="mt-4 font-display text-4xl text-white sm:text-5xl">
              Clube de Assinatura
              <br />
              <span className="text-gradient">Bryan Wesley</span>
            </h1>
            <p className="mt-4 text-lg text-steel-300">
              Cortes ilimitados, prioridade de agenda e experiências exclusivas
              sob medida.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <PlanosGrid plans={plans} />
        </Reveal>

        {/* Tabela comparativa */}
        <Reveal>
          <div className="mt-20">
            <h2 className="text-center font-display text-3xl text-white">
              Compare os planos
            </h2>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="label w-1/3 pb-4 text-left text-steel-400">
                      Benefício
                    </th>
                    {plans.map((p) => (
                      <th
                        key={p.id}
                        className={`pb-4 text-center font-display text-lg ${
                          p.highlight ? "text-electric" : "text-white"
                        }`}
                      >
                        {p.name.replace("Plano ", "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={row.feature}>
                      <td
                        className={`py-3.5 text-sm font-medium text-steel-200 ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        {row.feature}
                      </td>
                      <td
                        className={`py-3.5 text-center ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        <Cell value={row.silver} />
                      </td>
                      <td
                        className={`bg-electric/[0.05] py-3.5 text-center ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        <Cell value={row.gold} />
                      </td>
                      <td
                        className={`py-3.5 text-center ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        <Cell value={row.diamond} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        {/* FAQ */}
        <Reveal>
          <div className="mt-20">
            <h2 className="text-center font-display text-3xl text-white">
              Perguntas frequentes
            </h2>
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
              {faq.map((item) => (
                <div key={item.q} className="glass rounded-2xl p-5">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 flex-none text-electric" />
                    <h3 className="font-display text-base text-white">
                      {item.q}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-steel-400">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </main>

      <Footer />
    </>
  );
}
