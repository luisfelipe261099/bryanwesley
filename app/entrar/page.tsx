import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

const ERROS: Record<string, string> = {
  "sem-permissao": "Sua conta não tem acesso a essa área.",
};

export default async function Entrar({
  searchParams,
}: {
  searchParams: { proximo?: string; erro?: string };
}) {
  // Já logado? Vai direto para o painel do papel.
  const session = await getSession();
  if (session && !searchParams.erro) {
    if (session.role === "ADMIN") redirect("/admin");
    if (session.role === "BARBER") redirect("/barbeiro");
    redirect("/cliente");
  }

  const proximo = searchParams.proximo?.startsWith("/")
    ? searchParams.proximo
    : "";

  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-16">
        <Reveal>
          <Link href="/" className="mb-8">
            <Logo />
          </Link>
        </Reveal>

        <Reveal delay={0.06} className="w-full">
          <div className="mb-7 text-center">
            <span className="label text-electric">Acesso</span>
            <h1 className="mt-3 font-display text-3xl text-white">
              Bem-vindo de volta
            </h1>
            <p className="mt-2 text-sm text-steel-400">
              Entre para ver seus agendamentos, seu plano ou o painel da
              barbearia.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.12} className="w-full">
          <LoginForm
            proximo={proximo}
            erroInicial={
              searchParams.erro ? ERROS[searchParams.erro] : undefined
            }
          />
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mt-6 flex items-center gap-2 text-xs text-steel-400">
            <ShieldCheck className="h-3.5 w-3.5 text-electric" />
            Sessão protegida · seus dados ficam só com a barbearia
          </p>
        </Reveal>

        <Reveal delay={0.26}>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-steel-400 transition-colors hover:text-electric"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o início
          </Link>
        </Reveal>
      </main>
    </>
  );
}
