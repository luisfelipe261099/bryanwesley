import Link from "next/link";
import { AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { Background } from "@/components/Background";
import { Logo } from "@/components/Logo";
import { requireRole } from "@/lib/auth";
import { checkIn } from "../../actions";

// Destino do QR: o barbeiro aponta a câmera e cai direto aqui.
export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: { token: string };
}) {
  await requireRole(["BARBER", "ADMIN"]);
  const res = await checkIn({ token: params.token });

  return (
    <>
      <Background />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-16 text-center">
        <Link href="/" className="mb-10">
          <Logo />
        </Link>

        <div
          className={`grid h-20 w-20 place-items-center rounded-full ${
            res.ok ? "bg-royal-grad shadow-glow" : "bg-amber-400/15"
          }`}
        >
          {res.ok ? (
            <CheckCircle2 className="h-10 w-10 text-white" />
          ) : (
            <AlertCircle className="h-10 w-10 text-amber-300" />
          )}
        </div>

        <h1 className="mt-6 font-display text-2xl text-white">
          {res.ok ? "Check-in confirmado" : "Não foi possível validar"}
        </h1>
        <p className="mt-3 text-steel-300">
          {res.ok ? res.message : res.error}
        </p>

        <Link
          href="/barbeiro"
          className="btn-royal label mt-8 inline-flex items-center gap-2 rounded-full px-6 py-4 text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para a agenda
        </Link>
      </main>
    </>
  );
}
