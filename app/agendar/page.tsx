import Link from "next/link";
import { ArrowLeft, Ban } from "lucide-react";
import { eq } from "drizzle-orm";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSettings, listOpenDays } from "@/lib/schedule";
import { listServices, listPlans, listTeam, activeSubscription } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { BookingForm } from "./BookingForm";

// A agenda muda a todo instante — nada de cache.
export const dynamic = "force-dynamic";

export default async function Agendar() {
  const session = await getSession();

  const [settings, services, team, plans] = await Promise.all([
    getSettings(),
    listServices(),
    listTeam(),
    // Inclui os planos desativados: quem assinou um plano que saiu da
    // vitrine continua membro, e o servidor continua cobrindo os serviços
    // dele. Sem isso a tela cobrava o preço cheio de quem não ia pagar.
    listPlans({ todos: true }),
  ]);

  const days = listOpenDays(settings, 10);

  // Assinante ativo agenda pelo plano; os serviços cobertos saem sem preço.
  const subscription =
    session?.role === "CLIENT" ? await activeSubscription(session.id) : null;
  const plan = subscription
    ? plans.find((p) => p.id === subscription.planId) ?? null
    : null;

  // Só o cliente logado tem os próprios dados preenchidos; barbeiro ou
  // admin fazendo um encaixe começam com o formulário vazio.
  const viewer =
    session?.role === "CLIENT"
      ? await db.query.users
        .findFirst({ where: eq(users.id, session.id) })
        .then((u) =>
          u ? { name: u.name, phone: formatPhone(u.phone) } : null
        )
    : null;

  return (
    <>
      <Background />
      <TopBar planName={plan?.name} backHref={homeFor(session?.role ?? null)} />

      <main className="mx-auto max-w-5xl px-5 pb-28 pt-24 lg:px-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl text-white sm:text-4xl">
            {plan ? "Agendamento VIP" : "Agendamento Rápido"}
          </h1>
          <p className="mt-2 text-sm text-steel-400">
            {plan
              ? `Seu ${plan.name} cobre os serviços marcados como inclusos.`
              : "Apenas nome e WhatsApp para confirmar. Sem cadastro, sem senha."}
          </p>
        </div>

        {!settings.acceptingBookings ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-4 text-sm text-amber-200">
            <Ban className="mt-0.5 h-5 w-5 flex-none" />
            <span>
              A agenda está temporariamente fechada para novos agendamentos.
              Fale com a barbearia pelo WhatsApp ou tente novamente mais tarde.
            </span>
          </div>
        ) : days.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhuma data disponível no momento.
          </p>
        ) : (
          <BookingForm
            services={services}
            team={team.map((b) => ({
              id: b.id,
              shortName: b.shortName,
              name: b.user.name,
            }))}
            days={days}
            plan={plan}
            viewer={viewer}
            minAdvanceHours={settings.minAdvanceHours}
          />
        )}
      </main>

      <BottomNav active="inicio" role={session?.role ?? null} />
    </>
  );
}

/** Para onde o "voltar" leva: a casa de quem está logado. Mandar o
 * barbeiro para /cliente o jogava direto em "sem permissão". */
function homeFor(role: "ADMIN" | "BARBER" | "CLIENT" | null) {
  if (role === "ADMIN") return "/admin";
  if (role === "BARBER") return "/barbeiro";
  if (role === "CLIENT") return "/cliente";
  return "/";
}

function TopBar({
  planName,
  backHref,
}: {
  planName?: string;
  backHref: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-ink-800/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={backHref}
            aria-label="Voltar"
            className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-white/10 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/" className="min-w-0">
            <Logo />
          </Link>
        </div>
        <span
          className={`label flex-none rounded-full px-3 py-2 ${
            planName
              ? "bg-royal-grad text-white"
              : "border border-electric/30 bg-electric/10 text-electric"
          }`}
        >
          {planName ? planName.replace("Plano ", "") : "Sem cadastro"}
        </span>
      </div>
    </header>
  );
}
