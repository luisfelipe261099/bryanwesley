import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  Coffee,
  Star,
  Target,
  Wallet,
  Users,
  CalendarPlus,
  Lock,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { Reveal } from "@/components/Reveal";
import { db } from "@/db/client";
import { barbers } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import {
  appointmentsOfDay,
  barberMonthSummary,
  barberTodaySummary,
} from "@/lib/queries";
import { formatBRL, formatDuration } from "@/lib/money";
import { formatShopTime, shopToday, addDays, labelWeekday, labelFullDate } from "@/lib/time";
import { AppointmentActions } from "./AgendaActions";
import { CheckinBox } from "./CheckinBox";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, { label: string; cls: string }> = {
  CONCLUIDO: { label: "Concluído", cls: "bg-neon/10 text-neon" },
  CONFIRMADO: { label: "Confirmado", cls: "bg-electric/10 text-electric" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-royal/20 text-electric" },
  PENDENTE: { label: "Pendente", cls: "bg-amber-400/10 text-amber-300" },
  CANCELADO: { label: "Cancelado", cls: "bg-white/5 text-steel-400" },
  NO_SHOW: { label: "Faltou", cls: "bg-amber-400/10 text-amber-300" },
};

export default async function BarbeiroPanel({
  searchParams,
}: {
  searchParams: { dia?: string };
}) {
  const session = await requireRole(["BARBER", "ADMIN"]);

  // Admin sem cadastro de barbeiro cai no primeiro da equipe.
  const barber = session.barberId
    ? await db.query.barbers.findFirst({
        where: eq(barbers.id, session.barberId),
        with: { user: true },
      })
    : await db.query.barbers.findFirst({ with: { user: true } });

  if (!barber) {
    return (
      <>
        <Background />
        <AppHeader badge="Barbeiro" user={{ name: session.name, initial: session.name.charAt(0) }} />
        <main className="mx-auto max-w-3xl px-5 pb-28 pt-28 lg:px-8">
          <p className="glass rounded-2xl p-6 text-sm text-steel-300">
            Sua conta ainda não está vinculada a um barbeiro. Peça ao
            administrador para fazer o vínculo em Admin → Equipe.
          </p>
        </main>
        <BottomNav active="barbeiro" />
      </>
    );
  }

  const today = shopToday();
  const dateKey =
    searchParams.dia && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dia)
      ? searchParams.dia
      : today;

  const [agenda, mes, hoje] = await Promise.all([
    appointmentsOfDay(dateKey, barber.id),
    barberMonthSummary(barber.id),
    barberTodaySummary(barber.id),
  ]);

  // Meta individual: 100% do que a casa espera desse barbeiro no mês.
  const metaCents = 700000;
  const metaPct = Math.min(
    100,
    Math.round((mes.barberCents / metaCents) * 100)
  );

  const week = Array.from({ length: 6 }, (_, i) => {
    const key = addDays(today, i - 2);
    return { key, weekday: labelWeekday(key), dayNum: key.slice(-2) };
  });

  const emAndamento = agenda.find((a) => a.status === "EM_ANDAMENTO");

  return (
    <>
      <Background />
      <AppHeader
        badge="Barbeiro"
        user={{ name: barber.shortName, initial: barber.user.name.charAt(0) }}
      />

      <main className="mx-auto max-w-3xl px-5 pb-28 pt-24 lg:px-8">
        {/* Identidade */}
        <Reveal>
          <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 flex-none place-items-center rounded-2xl bg-royal-grad font-display text-xl text-white ring-2 ring-electric/30">
                {barber.user.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <p className="font-display text-xl text-white">
                  {barber.user.name}
                </p>
                <p className="label mt-1.5 text-steel-400">{barber.title}</p>
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-gold">
                  <Star className="h-3 w-3 fill-gold" />
                  {(barber.rating / 10).toFixed(1)} · comissão{" "}
                  {barber.commissionPct}%
                </p>
              </div>
            </div>
            <span
              className={`label inline-flex items-center gap-1.5 rounded-full px-3 py-2 ${
                emAndamento
                  ? "bg-neon/10 text-neon"
                  : "border border-white/12 text-steel-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  emAndamento ? "bg-neon" : "bg-steel-400"
                }`}
              />
              {emAndamento ? "Em atendimento" : "Livre"}
            </span>
          </div>
        </Reveal>

        {/* Comissão + atendimentos */}
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Reveal delay={0.04}>
            <div className="glass h-full rounded-2xl p-5">
              <div className="label flex items-center gap-2 text-electric">
                <Wallet className="h-3.5 w-3.5" />
                Comissão do mês
              </div>
              <p className="mt-3 font-display text-3xl text-white">
                {formatBRL(mes.barberCents)}
              </p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-royal-grad"
                  style={{ width: `${metaPct}%` }}
                />
              </div>
              <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-steel-400">
                <Target className="h-3.5 w-3.5 text-electric" />
                Meta {formatBRL(metaCents)} ·{" "}
                <span className="font-semibold text-electric">{metaPct}%</span>
              </p>
              <p className="mt-1.5 text-xs text-steel-400">
                Gerou {formatBRL(mes.baseCents)} para a casa em{" "}
                {mes.atendimentos} atendimento(s).
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="glass h-full rounded-2xl p-5">
              <div className="label flex items-center gap-2 text-electric">
                <Users className="h-3.5 w-3.5" />
                Atendimentos
              </div>
              <p className="mt-3 font-display text-3xl text-white">
                {hoje.total}
                <span className="ml-2 text-base font-normal text-steel-400">
                  hoje
                </span>
              </p>
              <p className="mt-4 text-sm text-steel-300">
                <span className="font-semibold text-neon">
                  {formatBRL(hoje.faturamentoCents)}
                </span>{" "}
                faturados hoje
              </p>
              <p className="mt-1.5 text-xs text-steel-400">
                {hoje.concluidos} concluídos ·{" "}
                {Math.max(0, hoje.total - hoje.concluidos)} na fila
              </p>
            </div>
          </Reveal>
        </div>

        {/* Check-in */}
        <Reveal delay={0.1}>
          <div className="mt-5">
            <CheckinBox />
          </div>
        </Reveal>

        {/* Agenda */}
        <Reveal delay={0.12}>
          <div className="glass mt-5 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg text-white">Agenda diária</h2>
              <span className="label capitalize text-steel-400">
                {labelFullDate(dateKey)}
              </span>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {week.map((d) => {
                const on = d.key === dateKey;
                return (
                  <Link
                    key={d.key}
                    href={`/barbeiro?dia=${d.key}`}
                    scroll={false}
                    className={`flex min-w-[54px] flex-none flex-col items-center gap-1 rounded-xl border py-2.5 transition-colors ${
                      on
                        ? "border-electric/60 bg-electric/[0.08]"
                        : "border-white/8 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span
                      className={`label capitalize ${
                        on ? "text-electric" : "text-steel-400"
                      }`}
                    >
                      {d.weekday}
                    </span>
                    <span className="font-display text-base text-white">
                      {d.dayNum}
                    </span>
                    <span
                      className={`h-1 w-1 rounded-full ${
                        d.key === today ? "bg-electric" : "bg-transparent"
                      }`}
                    />
                  </Link>
                );
              })}
            </div>

            {agenda.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
                Nenhum atendimento nesse dia.
              </p>
            ) : (
              <ul className="mt-5 space-y-2">
                {agenda.map((a) => {
                  const st = statusStyles[a.status];
                  const atual = a.status === "EM_ANDAMENTO";
                  return (
                    <li
                      key={a.id}
                      className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-colors ${
                        atual
                          ? "border-electric/50 bg-electric/[0.06]"
                          : "border-white/6 bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex w-14 flex-none flex-col items-center">
                        {atual && (
                          <span className="label mb-1 text-[8px] text-electric">
                            Agora
                          </span>
                        )}
                        <span className="font-display text-base leading-none text-white">
                          {formatShopTime(a.startsAt)}
                        </span>
                        <span className="mt-1 text-[10px] text-steel-400">
                          {formatDuration(a.durationMin)}
                        </span>
                      </div>
                      <div className="hidden h-10 w-px bg-white/8 sm:block" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-white">
                          {a.clientName}
                        </p>
                        <p className="truncate text-sm text-steel-400">
                          {a.items.map((i) => i.name).join(" + ")}
                        </p>
                        {a.checkedInAt && (
                          <p className="label mt-1 text-neon">Check-in feito</p>
                        )}
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular-nums text-white">
                          {a.kind === "ASSINANTE"
                            ? "Plano"
                            : formatBRL(a.totalCents)}
                        </span>
                        <span className={`label rounded-full px-2.5 py-1.5 ${st.cls}`}>
                          {st.label}
                        </span>
                        <AppointmentActions id={a.id} status={a.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Reveal>

        {/* Ações rápidas */}
        <Reveal delay={0.16}>
          <div className="mt-5">
            <h3 className="label text-steel-400">Ações rápidas</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <QuickAction icon={CalendarPlus} label="Encaixe" href="/agendar" />
              <QuickAction icon={Lock} label="Bloquear" href="/admin#agenda" />
              <QuickAction icon={Receipt} label="Extrato" href="/admin#equipe" />
            </div>
          </div>
        </Reveal>
      </main>

      <BottomNav active="barbeiro" />
    </>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="glass glass-hover flex flex-col items-center gap-2.5 rounded-2xl py-4 text-steel-300 transition-colors hover:text-white"
    >
      <Icon className="h-5 w-5 text-electric" strokeWidth={1.75} />
      <span className="label">{label}</span>
    </Link>
  );
}
