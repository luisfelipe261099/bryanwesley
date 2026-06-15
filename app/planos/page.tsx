import { Check, Minus, HelpCircle } from "lucide-react";
import { Background } from "@/components/Background";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { PlanCard } from "@/components/PlanCard";
import { plans } from "@/lib/data";

const comparison = [
  { feature: "Cortes de cabelo", essencial: "4/mês", premium: "Ilimitado", vip: "Ilimitado" },
  { feature: "Barba", essencial: "—", premium: "Ilimitado", vip: "Ilimitado" },
  { feature: "Sobrancelha", essencial: "—", premium: "Inclusa", vip: "Inclusa" },
  { feature: "Hidratação capilar", essencial: "—", premium: "—", vip: "1/mês" },
  { feature: "Prioridade na agenda", essencial: true, premium: true, vip: true },
  { feature: "Horário fixo semanal", essencial: false, premium: true, vip: true },
  { feature: "Bebida cortesia", essencial: false, premium: false, vip: true },
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
    a: "O plano é individual, vinculado ao seu cadastro e WhatsApp.",
  },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true)
    return <Check className="mx-auto h-5 w-5 text-electric" strokeWidth={2.5} />;
  if (value === false)
    return <Minus className="mx-auto h-5 w-5 text-steel-400/40" />;
  return <span className="text-sm text-steel-200">{value}</span>;
}

export default function Planos() {
  return (
    <>
      <Background />
      <Navbar />

      <main className="mx-auto max-w-7xl px-5 pb-10 pt-28 lg:px-8 lg:pt-36">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.28em] text-electric">
              Planos de assinatura
            </span>
            <h1 className="mt-3 font-display text-6xl text-white sm:text-7xl">
              Vire <span className="text-gradient">mensalista</span>
            </h1>
            <p className="mt-4 text-lg text-steel-300">
              Escolha o plano que combina com sua rotina. Economize, ganhe
              prioridade e mantenha o visual sempre em dia.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.id} delay={i * 0.08}>
              <PlanCard plan={p} />
            </Reveal>
          ))}
        </div>

        {/* Tabela comparativa */}
        <Reveal>
          <div className="mt-20">
            <h2 className="text-center font-display text-4xl text-white">
              Compare os planos
            </h2>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="w-1/3 pb-4 text-left text-sm font-medium text-steel-400">
                      Benefício
                    </th>
                    {plans.map((p) => (
                      <th
                        key={p.id}
                        className={`pb-4 text-center font-display text-2xl ${
                          p.highlight ? "text-electric" : "text-white"
                        }`}
                      >
                        {p.name}
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
                        <Cell value={row.essencial} />
                      </td>
                      <td
                        className={`bg-royal/[0.06] py-3.5 text-center ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        <Cell value={row.premium} />
                      </td>
                      <td
                        className={`py-3.5 text-center ${
                          i === 0 ? "" : "border-t border-white/6"
                        }`}
                      >
                        <Cell value={row.vip} />
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
            <h2 className="text-center font-display text-4xl text-white">
              Perguntas frequentes
            </h2>
            <div className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
              {faq.map((item) => (
                <div key={item.q} className="glass rounded-2xl p-5">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 flex-none text-electric" />
                    <h3 className="font-semibold text-white">{item.q}</h3>
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
