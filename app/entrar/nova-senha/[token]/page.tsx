import Link from "next/link";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { linkDeSenhaValido } from "@/lib/senha-link";
import { NovaSenhaForm } from "./NovaSenhaForm";

export const dynamic = "force-dynamic";
// O link tem o token: nem buscador nem prévia de link guardam a página.
export const metadata = { robots: { index: false, follow: false, nocache: true } };

/** Aberta pelo link que a barbearia manda no WhatsApp. */
export default async function NovaSenha({ params }: { params: { token: string } }) {
  const link = await linkDeSenhaValido(params.token);
  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-16">
        <Link href="/" className="mb-8">
          <Logo />
        </Link>
        <div className="glass w-full rounded-3xl p-7">
          {link ? (
            <>
              <span className="label text-electric">Nova senha</span>
              <h1 className="mt-2 font-display text-2xl text-white">Olá, {link.name.split(" ")[0]}!</h1>
              <p className="mt-1 text-sm text-steel-400">Escolha sua senha nova. Depois de salvar, você já entra.</p>
              <NovaSenhaForm token={params.token} />
            </>
          ) : (
            <div className="text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-amber-300" />
              <h1 className="mt-4 font-display text-xl text-white">Link vencido ou já usado</h1>
              <p className="mt-2 text-sm text-steel-400">
                Cada link vale por 24 horas e uma vez só. Peça um novo na barbearia ou em “Esqueci minha senha”.
              </p>
              <Link href="/entrar" className="btn-royal label mt-6 inline-flex rounded-full px-6 py-3.5 text-white">
                Ir para entrar
              </Link>
            </div>
          )}
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-steel-400">
          <ShieldCheck className="h-3.5 w-3.5 text-electric" />
          Sessão protegida · seus dados ficam só com a barbearia
        </p>
      </main>
    </>
  );
}
