import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { ArrowLeft, Gem } from "lucide-react";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { db } from "@/db/client";
import { plans } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/schedule";
import { shopFrom } from "@/lib/shop";
import { AssinarForm } from "./AssinarForm";

export const dynamic = "force-dynamic";

export default async function Assinar({
  params,
}: {
  params: { slug: string };
}) {
  const session = await getSession();
  // Precisa de conta para vincular a assinatura a alguém.
  if (!session) {
    redirect(`/entrar?proximo=${encodeURIComponent(`/assinar/${params.slug}`)}`);
  }

  const [plan, settings] = await Promise.all([
    db.query.plans.findFirst({
      where: and(eq(plans.slug, params.slug), eq(plans.active, true)),
    }),
    getSettings(),
  ]);
  if (!plan) notFound();

  const info = shopFrom(settings);

  return (
    <>
      <Background />
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-ink-800/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-2.5 px-5 lg:px-8">
          <Link
            href="/planos"
            aria-label="Voltar"
            className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-white/10 text-steel-300 hover:border-electric/40 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/">
            <Logo subtitle={info.unit} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-28 pt-24 lg:px-8">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-royal-grad text-white">
            <Gem className="h-6 w-6" strokeWidth={1.7} />
          </span>
          <div>
            <span className="label text-electric">{plan.kicker}</span>
            <h1 className="mt-1 font-display text-2xl text-white sm:text-3xl">
              {plan.name}
            </h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-steel-400">{plan.tagline}</p>

        <AssinarForm
          planId={plan.id}
          planName={plan.name}
          priceCents={plan.priceCents}
          annualCents={plan.annualPriceCents}
          features={plan.features}
        />
      </main>

      <BottomNav active="planos" role={session.role} />
    </>
  );
}
