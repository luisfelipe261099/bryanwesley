import Link from "next/link";
import { Scissors } from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
        <Link href="/" className="mb-10">
          <Logo />
        </Link>
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-electric/25 bg-electric/10 text-electric">
          <Scissors className="h-8 w-8" strokeWidth={1.6} />
        </div>
        <p className="label mt-6 text-electric">Erro 404</p>
        <h1 className="mt-3 font-display text-2xl text-white">
          Essa página não existe
        </h1>
        <p className="mt-3 text-sm text-steel-400">
          O link pode ter mudado. Vamos te levar de volta.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/agendar"
            className="btn-royal label rounded-full px-6 py-4 text-white"
          >
            Agendar horário
          </Link>
          <Link
            href="/"
            className="label rounded-full border border-white/12 px-6 py-4 text-steel-200 hover:border-electric/45"
          >
            Início
          </Link>
        </div>
      </main>
    </>
  );
}
