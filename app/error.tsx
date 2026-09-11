"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-amber-400/15">
        <AlertTriangle className="h-8 w-8 text-amber-300" />
      </div>
      <h1 className="mt-6 font-display text-2xl text-white">
        Algo deu errado por aqui
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-steel-400">
        Já registramos o problema. Tente de novo — se continuar, fale com a
        barbearia pelo WhatsApp.
      </p>
      {error.digest && (
        <p className="label mt-3 text-steel-400/60">ref. {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-6 py-4 text-white"
        >
          <RotateCcw className="h-4 w-4" />
          Tentar de novo
        </button>
        <Link
          href="/"
          className="label inline-flex items-center rounded-full border border-white/12 px-6 py-4 text-steel-200 hover:border-electric/45"
        >
          Início
        </Link>
      </div>
    </main>
  );
}
