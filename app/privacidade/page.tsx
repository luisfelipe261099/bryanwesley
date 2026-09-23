import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Background } from "@/components/Background";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { shopFrom } from "@/lib/shop";
import { getSettings } from "@/lib/schedule";

export const metadata = {
  title: "Privacidade — Bryan Wesley Barbearia",
  description: "Como a barbearia trata seus dados.",
};

const secoes = [
  {
    t: "Quais dados guardamos",
    p: "Nome, WhatsApp e, se você criar conta, uma senha protegida por criptografia. Para membros do Clube VIP, o plano contratado e o histórico de atendimentos. Não guardamos dados de cartão: pagamentos são processados pelo provedor de pagamento.",
  },
  {
    t: "Para que usamos",
    p: "Para reservar e confirmar seus horários, enviar lembretes pelo WhatsApp, administrar sua assinatura e melhorar o atendimento. Não vendemos nem compartilhamos seus dados com terceiros para publicidade.",
  },
  {
    t: "Com quem compartilhamos",
    p: "Somente com os serviços necessários para operar: hospedagem do sistema, envio de mensagens e processamento de pagamento. Cada um recebe apenas o mínimo para sua função.",
  },
  {
    t: "Atendimento pelo WhatsApp",
    p: "Quando você marca horário conversando com a gente no WhatsApp, as mensagens passam pelo nosso atendente automático. Para entender frases escritas do seu jeito, o texto da mensagem pode ser lido por um serviço de inteligência artificial do Google (Gemini) — só o que você escreveu, nunca seu telefone, cadastro ou histórico. Prefere falar com uma pessoa? É só pedir na conversa.",
  },
  {
    t: "Por quanto tempo",
    p: "Enquanto você for cliente e pelo prazo exigido por obrigações fiscais. Você pode pedir a exclusão a qualquer momento.",
  },
  {
    t: "Seus direitos",
    p: "Acesso, correção e exclusão dos seus dados, além de cancelar os lembretes. Basta falar com a barbearia pelo WhatsApp ou no balcão.",
  },
];

export const dynamic = "force-dynamic";

export default async function Privacidade() {
  const shop = shopFrom(await getSettings());
  return (
    <>
      <Background />
      <Navbar unit={shop.unit} />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-28 lg:px-8 lg:pt-36">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-steel-400 hover:text-electric"
        >
          <ArrowLeft className="h-4 w-4" />
          Início
        </Link>
        <div className="mt-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <span className="label text-electric">LGPD</span>
            <h1 className="mt-1 font-display text-3xl text-white">
              Política de privacidade
            </h1>
          </div>
        </div>
        <p className="mt-4 text-steel-300">
          A {shop.legalName} ({shop.unit}) trata seus dados com o cuidado que a
          Lei Geral de Proteção de Dados exige. Em resumo:
        </p>
        <div className="mt-8 space-y-4">
          {secoes.map((s) => (
            <section key={s.t} className="glass rounded-2xl p-6">
              <h2 className="font-display text-lg text-white">{s.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-steel-400">{s.p}</p>
            </section>
          ))}
        </div>
        <p className="mt-8 text-xs text-steel-400">
          Contato para assuntos de privacidade: {shop.phone} · {shop.address}.
        </p>
      </main>
      <Footer />
    </>
  );
}
