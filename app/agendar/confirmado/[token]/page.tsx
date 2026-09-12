import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Crown, PartyPopper, Sparkles } from "lucide-react";
import { Background } from "@/components/Background";
import { BottomNav } from "@/components/BottomNav";
import { Logo } from "@/components/Logo";
import { db } from "@/db/client";
import { appointments } from "@/db/schema";
import { attachDetails } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/schedule";
import { shopFrom } from "@/lib/shop";
import { formatBRL, formatDuration } from "@/lib/money";
import {
  formatShopTime,
  labelFullDate,
  utcToShopParts,
  shopToday,
} from "@/lib/time";
import { checkinQrSvg, publicBaseUrl } from "@/lib/qr";
import { CheckinQR } from "@/app/cliente/CheckinQR";

export const dynamic = "force-dynamic";

// Reforço do robots.txt: a URL tem o token do check-in, então nem buscador
// nem pré-visualização de link devem guardar essa página.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Confirmação do agendamento.
 *
 * Endereçada pelo token do check-in (32 caracteres), não pelo código curto:
 * o link é impossível de adivinhar, então pode ser aberto de novo, salvo
 * nos favoritos ou mandado no WhatsApp sem expor a agenda de ninguém.
 */
export default async function Confirmado({
  params,
}: {
  params: { token: string };
}) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.checkinToken, params.token))
    .limit(1);
  if (!row) notFound();

  const [appt] = await attachDetails([row]);
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  const info = shopFrom(settings);

  const p = utcToShopParts(appt.startsAt);
  const quando =
    p.dateKey === shopToday()
      ? `Hoje, às ${formatShopTime(appt.startsAt)}`
      : `${labelFullDate(p.dateKey)} às ${formatShopTime(appt.startsAt)}`;

  const qrSvg =
    appt.checkinToken && appt.status !== "CANCELADO"
      ? await checkinQrSvg(publicBaseUrl(), appt.checkinToken)
      : null;

  const servicos = appt.items.map((i) => i.name).join(" + ");
  const cancelado = appt.status === "CANCELADO" || appt.status === "NO_SHOW";

  return (
    <>
      <Background />
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-ink-800/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-lg items-center px-5 lg:px-8">
          <Link href="/">
            <Logo subtitle={info.unit} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 pb-28 pt-24 text-center lg:px-8">
        <div
          className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${
            cancelado ? "bg-white/5" : "bg-royal-grad shadow-glow"
          }`}
        >
          <PartyPopper
            className={`h-10 w-10 ${cancelado ? "text-steel-400" : "text-white"}`}
          />
        </div>

        <h1 className="mt-6 font-display text-3xl text-white sm:text-4xl">
          {cancelado
            ? "Agendamento cancelado"
            : `Tá marcado, ${appt.clientName.split(" ")[0]}!`}
        </h1>
        <p className="mt-3 text-steel-300">
          {cancelado
            ? "Esse horário foi cancelado. Quando quiser, é só marcar outro."
            : "Seu horário está reservado. Enviamos a confirmação no WhatsApp."}
        </p>

        <div className="glass mt-8 rounded-2xl p-6 text-left">
          <div className="label flex items-center justify-between text-electric">
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Detalhes
            </span>
            <span className="rounded-full bg-electric/10 px-2.5 py-1.5">
              {appt.code}
            </span>
          </div>
          <div className="mt-4 space-y-2.5 text-sm">
            <Line label="Quando">{quando}</Line>
            <Line label="Barbeiro">{appt.barber.user.name}</Line>
            <Line label="Serviço">{servicos}</Line>
            <Line label="Duração">{formatDuration(appt.durationMin)}</Line>
            <Line label="Onde">{info.address}</Line>
            <div className="flex items-center justify-between gap-4 border-t border-white/8 pt-3">
              <span className="text-steel-400">
                {appt.kind === "ASSINANTE" ? "Cobrança" : "Total"}
              </span>
              {appt.kind === "ASSINANTE" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-electric">
                  <Crown className="h-4 w-4" />
                  Incluso no plano
                </span>
              ) : (
                <span className="font-display text-2xl text-white">
                  {formatBRL(appt.totalCents)}
                </span>
              )}
            </div>
          </div>

          {qrSvg && (
            <div className="mt-5 flex justify-center border-t border-white/8 pt-5">
              <CheckinQR svg={qrSvg} code={appt.code} service={servicos} />
            </div>
          )}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-steel-400">
          Guarde este link: ele abre a confirmação quando você quiser.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/cliente"
            className="label inline-flex items-center justify-center gap-2 rounded-full border border-white/12 px-6 py-4 text-steel-200 transition-colors hover:border-electric/45 hover:text-white"
          >
            Meus horários
          </Link>
          <Link
            href="/"
            className="btn-royal label inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-white"
          >
            Voltar ao início
          </Link>
        </div>
      </main>

      <BottomNav active="inicio" role={session?.role ?? null} />
    </>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="flex-none text-steel-400">{label}</span>
      <span className="text-right font-semibold text-white">{children}</span>
    </div>
  );
}
