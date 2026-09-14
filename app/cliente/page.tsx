import Link from "next/link";
import {
  CalendarPlus,
  Crown,
  Scissors,
  Clock,
  ArrowRight,
  Check,
  CalendarDays,
  History,
  Gift,
  Gem,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { Reveal } from "@/components/Reveal";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { recurringSlots, planServices } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSettings } from "@/lib/schedule";
import { listTeam, listServices } from "@/lib/queries";
import { HorarioFixo } from "./HorarioFixo";
import {
  activeSubscription,
  upcomingForUser,
  historyForUser,
  countForUser,
} from "@/lib/queries";
import { formatBRL, formatDuration } from "@/lib/money";
import { formatShopTime, utcToShopParts, labelFullDate, shopToday } from "@/lib/time";
import { checkinQrSvg, publicBaseUrl } from "@/lib/qr";
import { CheckinQR } from "./CheckinQR";
import { CancelButton, EmptyState, ChangePassword } from "./MeusHorarios";
import { Remarcar } from "./Remarcar";
import { listOpenDays } from "@/lib/schedule";
import { KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

/** "Hoje, às 17:30" ou "sexta-feira, 18 de setembro às 17:30". */
function whenLabel(date: Date) {
  const parts = utcToShopParts(date);
  const hora = formatShopTime(date);
  if (parts.dateKey === shopToday()) return `Hoje, às ${hora}`;
  return `${labelFullDate(parts.dateKey)} às ${hora}`;
}

function countdown(date: Date) {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "Agora";
  const h = Math.floor(diff / 3600_000);
  const m = Math.floor((diff % 3600_000) / 60_000);
  if (h >= 24) return `Em ${Math.floor(h / 24)} dia(s)`;
  return h > 0 ? `Em ${h}h ${m}min` : `Em ${m}min`;
}

export default async function ClienteDashboard({
  searchParams,
}: {
  searchParams: { assinatura?: string; pagamento?: string };
}) {
  const session = await requireRole(["CLIENT", "ADMIN"]);

  const [subscription, upcoming, history, totalVisits, fixo, team, services, settings] =
    await Promise.all([
      activeSubscription(session.id),
      upcomingForUser(session.id),
      historyForUser(session.id),
      countForUser(session.id),
      db.query.recurringSlots.findFirst({
        where: and(
          eq(recurringSlots.userId, session.id),
          eq(recurringSlots.active, true)
        ),
      }),
      listTeam(),
      listServices(),
      getSettings(),
    ]);
  const days = listOpenDays(settings, 10);
  const teamChips = team.map((b) => ({ id: b.id, shortName: b.shortName }));

  const proximo = upcoming[0];
  const plan = subscription?.plan;

  // Serviços que o plano cobre — o horário fixo só pode usar esses.
  const covered = plan
    ? (
        await db.query.planServices.findMany({
          where: eq(planServices.planId, plan.id),
        })
      ).map((ps) => ps.serviceId)
    : [];

  // Ciclo de cobrança: quanto já passou desde a última renovação.
  let cicloPct = 0;
  let diasParaRenovar = 0;
  if (subscription) {
    const total = subscription.renewsAt.getTime() - subscription.startedAt.getTime();
    const feito = Date.now() - subscription.startedAt.getTime();
    cicloPct = Math.max(0, Math.min(100, Math.round((feito / total) * 100)));
    diasParaRenovar = Math.max(
      0,
      Math.ceil((subscription.renewsAt.getTime() - Date.now()) / 86400_000)
    );
  }

  const qrSvg = proximo?.checkinToken
    ? await checkinQrSvg(publicBaseUrl(), proximo.checkinToken)
    : null;

  const atendimentosNoMes = history.filter((h) => {
    const p = utcToShopParts(h.startsAt);
    const now = utcToShopParts(new Date());
    return (
      h.status === "CONCLUIDO" && p.year === now.year && p.month === now.month
    );
  }).length;

  const economiaNoMes = history
    .filter((h) => h.kind === "ASSINANTE" && h.status === "CONCLUIDO")
    .reduce((acc, h) => acc + h.items.reduce((a, i) => a + i.priceCents, 0), 0);

  return (
    <>
      <Background />
      <AppHeader
        badge={plan ? "Membro VIP" : "Cliente"}
        user={{ name: session.name, initial: session.name.charAt(0) }}
      />

      <main className="mx-auto max-w-7xl px-5 pb-28 pt-24 lg:px-8">
        <Reveal>
          <span className="label text-electric">Ateliê Cajuru</span>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl text-white sm:text-4xl">
              Olá, {session.name.split(" ")[0]}
            </h1>
            {plan && (
              <span className="label inline-flex items-center gap-1.5 rounded-full bg-royal-grad px-3 py-2 text-white shadow-glow-sm">
                <Gem className="h-3 w-3" />
                {plan.name.replace("Plano ", "")}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-steel-400">
            {proximo
              ? "Seu próximo horário está confirmado."
              : "Você não tem horário marcado. Bora agendar?"}
          </p>
        </Reveal>

        {searchParams.assinatura === "pedida" && (
          <Reveal delay={0.02}>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-neon/30 bg-neon/[0.07] px-4 py-4 text-sm text-neon">
              <Gem className="mt-0.5 h-5 w-5 flex-none" />
              <span>
                Pedido de assinatura registrado. A barbearia confirma com você
                pelo WhatsApp e libera os benefícios — enquanto isso, você já
                pode agendar normalmente.
              </span>
            </div>
          </Reveal>
        )}

        {searchParams.pagamento === "ok" && (
          <Reveal delay={0.02}>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-neon/30 bg-neon/[0.07] px-4 py-4 text-sm text-neon">
              <Check className="mt-0.5 h-5 w-5 flex-none" strokeWidth={3} />
              <span>
                Pagamento recebido. Assim que a confirmação cair, seu plano fica
                ativo — costuma ser na hora.
              </span>
            </div>
          </Reveal>
        )}

        {/* Próximo horário + check-in */}
        {proximo && (
          <Reveal delay={0.04}>
            <div className="glass mt-6 rounded-2xl border-electric/25 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="label inline-flex items-center gap-1.5 text-electric">
                  <span className="h-1.5 w-1.5 rounded-full bg-neon" />
                  {whenLabel(proximo.startsAt)}
                </span>
                <span className="text-xs font-medium text-steel-400">
                  {countdown(proximo.startsAt)}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-royal-grad text-white">
                    <Scissors className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-lg text-white">
                      {proximo.items.map((i) => i.name).join(" + ")}
                    </p>
                    <p className="text-sm text-steel-400">
                      {proximo.barber.user.name} ·{" "}
                      {formatDuration(proximo.durationMin)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {qrSvg && (
                    <CheckinQR
                      svg={qrSvg}
                      code={proximo.code}
                      service={proximo.items.map((i) => i.name).join(" + ")}
                    />
                  )}
                  {proximo.status !== "EM_ANDAMENTO" && (
                    <Remarcar
                      appointmentId={proximo.id}
                      durationMin={proximo.durationMin}
                      barberId={proximo.barberId}
                      days={days}
                      team={teamChips}
                    />
                  )}
                  <CancelButton appointmentId={proximo.id} />
                </div>
              </div>
            </div>
          </Reveal>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {/* Assinatura */}
          <Reveal className="lg:col-span-2">
            <div className="glass relative h-full overflow-hidden rounded-3xl p-7">
              <div
                aria-hidden="true"
                className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-electric/15 blur-3xl"
              />
              {plan && subscription ? (
                <>
                  <div className="relative flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <span className="label text-electric">Sua assinatura</span>
                      <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1">
                        <h2 className="font-display text-3xl text-white">
                          {plan.name}
                        </h2>
                        <span className="mb-1 text-sm text-steel-400">
                          {formatBRL(
                            subscription.cycle === "ANUAL"
                              ? plan.annualPriceCents
                              : plan.priceCents
                          )}
                          /mês
                        </span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neon/10 px-3 py-1.5 text-xs font-semibold text-neon">
                      <span className="h-1.5 w-1.5 rounded-full bg-neon" />
                      Ativa
                    </span>
                  </div>

                  <div className="relative mt-7">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-steel-300">Renovação</span>
                      <span className="font-medium text-white">
                        em {diasParaRenovar} dias
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-royal-grad"
                        style={{ width: `${cicloPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="relative mt-7 grid grid-cols-3 gap-4 border-t border-white/8 pt-6">
                    <MiniStat
                      icon={Scissors}
                      value={String(atendimentosNoMes)}
                      label="Atendimentos no mês"
                    />
                    <MiniStat
                      icon={Gift}
                      value={formatBRL(economiaNoMes)}
                      label="Economia acumulada"
                      accent
                    />
                    <MiniStat
                      icon={Crown}
                      value={String(totalVisits)}
                      label="Visitas no total"
                    />
                  </div>
                </>
              ) : (
                <div className="relative">
                  <span className="label text-electric">Clube VIP</span>
                  <h2 className="mt-2 font-display text-2xl text-white">
                    Você ainda não é membro
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-steel-400">
                    Assine um plano e tenha cortes ilimitados, prioridade na
                    agenda e benefícios exclusivos todo mês.
                  </p>
                  <div className="mt-6 grid grid-cols-3 gap-4 border-t border-white/8 pt-6">
                    <MiniStat
                      icon={Scissors}
                      value={String(atendimentosNoMes)}
                      label="Atendimentos no mês"
                    />
                    <MiniStat
                      icon={History}
                      value={String(totalVisits)}
                      label="Visitas no total"
                    />
                    <MiniStat
                      icon={Gem}
                      value="—"
                      label="Plano ativo"
                    />
                  </div>
                  <Link
                    href="/planos"
                    className="btn-royal label mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-white"
                  >
                    Conhecer os planos
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </div>
          </Reveal>

          {/* Próximos horários */}
          <Reveal delay={0.08}>
            <div className="glass flex h-full flex-col rounded-3xl p-7">
              <span className="label text-electric">Próximos horários</span>
              {upcoming.length === 0 ? (
                <div className="mt-5 flex-1">
                  <EmptyState>Nenhum horário marcado ainda.</EmptyState>
                </div>
              ) : (
                <ul className="mt-5 flex-1 space-y-3">
                  {upcoming.slice(0, 3).map((a) => (
                    <li
                      key={a.id}
                      className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
                    >
                      <p className="truncate text-sm font-semibold text-white">
                        {a.items.map((i) => i.name).join(" + ")}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-steel-400">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3 text-electric" />
                          {whenLabel(a.startsAt)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3 text-electric" />
                          {formatDuration(a.durationMin)}
                        </span>
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-xs text-steel-400">
                          {a.barber.user.name}
                        </p>
                        {a.id !== proximo?.id && a.status !== "EM_ANDAMENTO" && (
                          <span className="flex items-center gap-2">
                            <Remarcar
                              appointmentId={a.id}
                              durationMin={a.durationMin}
                              barberId={a.barberId}
                              days={days}
                              team={teamChips}
                            />
                            <CancelButton appointmentId={a.id} />
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/agendar"
                className="btn-royal label mt-5 inline-flex items-center justify-center gap-2 rounded-xl py-4 text-white"
              >
                <CalendarPlus className="h-4 w-4" />
                Agendar horário
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Horário fixo — benefício de assinante */}
        {plan && (
          <Reveal delay={0.12}>
            <div className="mt-5">
              <HorarioFixo
                team={team.map((b) => ({ id: b.id, name: b.user.name }))}
                services={services
                  .filter((s) => covered.includes(s.id))
                  .map((s) => ({ id: s.id, name: s.name }))}
                existing={
                  fixo
                    ? {
                        frequency: fixo.frequency,
                        weekday: fixo.weekday,
                        dayOfMonth: fixo.dayOfMonth,
                        minutesOfDay: fixo.minutesOfDay,
                        barberId: fixo.barberId,
                        serviceIds: fixo.serviceIds ?? [],
                      }
                    : null
                }
                closedWeekdays={settings.closedWeekdays}
              />
            </div>
          </Reveal>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* Benefícios */}
          {plan && (
            <Reveal>
              <div className="glass h-full rounded-3xl p-7">
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-electric" />
                  <h3 className="font-display text-lg text-white">
                    Benefícios do seu plano
                  </h3>
                </div>
                <ul className="mt-5 grid gap-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-electric/15">
                        <Check
                          className="h-3 w-3 text-electric"
                          strokeWidth={3}
                        />
                      </span>
                      <span className="text-steel-300">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          )}

          {/* Histórico */}
          <Reveal delay={0.08} className={plan ? "" : "lg:col-span-2"}>
            <div className="glass h-full rounded-3xl p-7">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg text-white">
                  Seus atendimentos
                </h3>
                <span className="text-sm text-steel-400">
                  {totalVisits} concluídos
                </span>
              </div>
              {history.length === 0 ? (
                <div className="mt-5">
                  <EmptyState>
                    Seu histórico aparece aqui depois do primeiro corte.
                  </EmptyState>
                </div>
              ) : (
                <ul className="mt-5 space-y-1">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-white/5 text-steel-300">
                        <Scissors className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">
                          {h.items.map((i) => i.name).join(" + ")}
                        </span>
                        <span className="text-xs text-steel-400">
                          {whenLabel(h.startsAt)} · {h.barber.user.name}
                        </span>
                      </span>
                      <span
                        className={`label flex-none rounded-full px-2.5 py-1.5 ${
                          h.status === "CANCELADO"
                            ? "bg-white/5 text-steel-400"
                            : h.kind === "ASSINANTE"
                              ? "bg-electric/10 text-electric"
                              : "bg-neon/10 text-neon"
                        }`}
                      >
                        {h.status === "CANCELADO"
                          ? "Cancelado"
                          : h.kind === "ASSINANTE"
                            ? "Incluso"
                            : formatBRL(h.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.16}>
          <div className="glass mt-5 rounded-3xl p-7">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-electric" />
              <h3 className="font-display text-lg text-white">Minha conta</h3>
            </div>
            <p className="mt-1.5 text-sm text-steel-400">
              Login pelo WhatsApp cadastrado. Aqui você troca a senha.
            </p>
            <div className="mt-5 max-w-sm">
              <ChangePassword />
            </div>
          </div>
        </Reveal>
      </main>

      <BottomNav active="cliente" role={session.role} />
    </>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <Icon className={`h-5 w-5 ${accent ? "text-neon" : "text-electric"}`} />
      <div
        className={`mt-2 font-display text-xl ${
          accent ? "text-neon" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-snug text-steel-400">{label}</div>
    </div>
  );
}
