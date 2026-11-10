// O salão agora: a agenda do dia de cada barbeiro, lado a lado, com os
// comandos à mão (iniciar, finalizar, cobrar). Pedido do Bryan: no painel
// ele via a lista geral, mas não os três ao mesmo tempo, nem quem já
// pagou ou ainda está na cadeira.
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Crown, Scissors } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { appointmentsOfDay, listTeam } from "@/lib/queries";
import { liberarHorariosSemPagamento } from "@/lib/payments";
import { aReceber, devendo, rotuloPagamento } from "@/lib/rotulo-pagamento";
import { appointmentStatus as statusStyles } from "@/lib/status";
import { formatBRL, formatDuration } from "@/lib/money";
import { addDays, formatShopTime, labelFullDate, shopToday } from "@/lib/time";
import { AppointmentActions } from "@/app/barbeiro/AgendaActions";
import { CobrarAtendimento } from "@/app/barbeiro/CobrarAtendimento";
import { AtualizaSozinho } from "@/components/AtualizaSozinho";

export const dynamic = "force-dynamic";

const ATIVOS = ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"];

export default async function SalaoPage({ searchParams }: { searchParams: { dia?: string } }) {
  await requireRole(["ADMIN"]);
  const hoje = shopToday();
  const dia =
    searchParams.dia && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dia) && addDays(searchParams.dia, 0) === searchParams.dia
      ? searchParams.dia
      : hoje;
  const podeAgir = dia <= hoje;

  await liberarHorariosSemPagamento().catch((e) => console.error("Liberar horários:", e));
  const [equipe, agenda] = await Promise.all([listTeam(), appointmentsOfDay(dia)]);

  const semPagar = agenda.filter((a) => devendo(a));
  const recebido = agenda
    .filter((a) => a.pagamentoOnline === "PAGO")
    .reduce((t, a) => t + a.totalCents, 0);
  const naCadeira = agenda.filter((a) => a.status === "EM_ANDAMENTO").length;
  const concluidos = agenda.filter((a) => a.status === "CONCLUIDO").length;

  // Quem não tem horário no dia também aparece (coluna vazia), e quem saiu
  // da equipe mas tem horário no dia não some.
  const colunas = equipe.map((b) => ({ id: b.id, nome: b.shortName }));
  for (const a of agenda) {
    if (!colunas.some((c) => c.id === a.barberId)) colunas.push({ id: a.barberId, nome: a.barber.shortName });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="label inline-flex items-center gap-1.5 text-electric">
            <Scissors className="h-3.5 w-3.5" />
            {dia === hoje ? "Hoje" : "Dia escolhido"}
          </span>
          <h1 className="mt-2 font-display text-3xl text-white sm:text-4xl">Salão</h1>
          <p className="mt-1.5 text-sm text-steel-400 first-letter:uppercase">{labelFullDate(dia)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/salao?dia=${addDays(dia, -1)}`}
            aria-label="Dia anterior"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-steel-300 hover:border-electric/40 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {dia !== hoje && (
            <Link href="/admin/salao" className="label rounded-full border border-electric/40 px-4 py-2.5 text-electric">
              Hoje
            </Link>
          )}
          <Link
            href={`/admin/salao?dia=${addDays(dia, 1)}`}
            aria-label="Próximo dia"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-steel-300 hover:border-electric/40 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Atendimentos" valor={String(agenda.filter((a) => !["CANCELADO", "NO_SHOW"].includes(a.status)).length)} />
        <Numero rotulo="Na cadeira agora" valor={String(naCadeira)} />
        <Numero rotulo="Concluídos" valor={String(concluidos)} />
        <Numero rotulo="Recebido" valor={formatBRL(recebido)} />
      </div>

      {semPagar.length > 0 && (
        <div className="rounded-2xl border-2 border-red-500/70 bg-red-500/15 p-4">
          <p className="flex items-center gap-2 font-semibold text-red-100">
            <AlertTriangle className="h-4 w-4 flex-none text-red-300" />
            {semPagar.length === 1
              ? "1 atendimento ainda não foi pago"
              : `${semPagar.length} atendimentos ainda não foram pagos`}{" "}
            · {formatBRL(semPagar.reduce((t, a) => t + a.totalCents, 0))}
          </p>
          <p className="mt-1 text-sm text-red-50">
            {semPagar.map((a) => `${formatShopTime(a.startsAt)} ${a.clientName} (${a.barber.shortName})`).join(" · ")}
          </p>
        </div>
      )}

      <div className={`grid gap-4 ${colunas.length >= 3 ? "lg:grid-cols-3" : colunas.length === 2 ? "lg:grid-cols-2" : ""}`}>
        {colunas.map((c) => {
          const doBarbeiro = agenda.filter((a) => a.barberId === c.id);
          const ativos = doBarbeiro.filter((a) => ATIVOS.includes(a.status) || devendo(a));
          const fechados = doBarbeiro.filter((a) => !ativos.includes(a));
          const agora = doBarbeiro.find((a) => a.status === "EM_ANDAMENTO");
          const devendoAqui = doBarbeiro.filter((a) => devendo(a)).length;
          return (
            <section key={c.id} className="glass rounded-3xl p-4">
              <header className="flex items-start justify-between gap-2 border-b border-white/8 pb-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-xl text-white">{c.nome}</h2>
                  <p className="mt-0.5 text-xs text-steel-400">
                    {agora ? (
                      <span className="text-electric">Atendendo {agora.clientName.split(" ")[0]}</span>
                    ) : (
                      "Livre agora"
                    )}
                    {" · "}
                    {ativos.length} na fila
                  </p>
                </div>
                {devendoAqui > 0 && (
                  <span className="label rounded-full bg-red-500 px-2.5 py-1.5 text-white">
                    {devendoAqui} não pago{devendoAqui > 1 ? "s" : ""}
                  </span>
                )}
              </header>

              {doBarbeiro.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-steel-400">
                  Nenhum atendimento.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {[...ativos, ...fechados].map((a) => {
                    const st = statusStyles[a.status];
                    const pg = rotuloPagamento(a);
                    const naoPago = devendo(a);
                    const caiu = ["CANCELADO", "NO_SHOW"].includes(a.status);
                    return (
                      <li
                        key={a.id}
                        className={`rounded-2xl border p-3 ${
                          naoPago
                            ? "border-2 border-red-500/70 bg-red-500/[0.07]"
                            : a.status === "EM_ANDAMENTO"
                              ? "border-electric/50 bg-electric/[0.06]"
                              : caiu
                                ? "border-white/5 opacity-50"
                                : "border-white/6 bg-white/[0.02]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-12 flex-none text-center">
                            <span className="font-display text-base leading-none text-white">{formatShopTime(a.startsAt)}</span>
                            <span className="mt-1 block text-[10px] text-steel-400">{formatDuration(a.durationMin)}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate font-semibold text-white">
                              {a.clientUserId ? (
                                <Link href={`/admin/clientes/${a.clientUserId}`} className="truncate hover:text-electric">
                                  {a.clientName}
                                </Link>
                              ) : (
                                <span className="truncate">{a.clientName}</span>
                              )}
                              {a.kind === "ASSINANTE" && <Crown className="h-3.5 w-3.5 flex-none text-gold" />}
                            </p>
                            <p className="truncate text-xs text-steel-400">{a.items.map((i) => i.name).join(" + ")}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold tabular-nums text-white">
                                {a.kind === "ASSINANTE" ? "Plano" : formatBRL(a.totalCents)}
                              </span>
                              {pg && <span className={`label rounded-full px-2 py-1 ${pg.cls}`}>{pg.texto}</span>}
                              <span className={`label rounded-full px-2 py-1 ${st.cls}`}>{st.label}</span>
                            </div>
                          </div>
                        </div>
                        {podeAgir && (ATIVOS.includes(a.status) || aReceber(a)) && (
                          <div className="mt-2.5 flex flex-wrap items-start justify-end gap-2">
                            {ATIVOS.includes(a.status) && (
                              <AppointmentActions
                                id={a.id}
                                status={a.status}
                                depoisDoInicio={a.startsAt.getTime() <= Date.now()}
                                naoPagoCents={aReceber(a) ? a.totalCents : 0}
                              />
                            )}
                            {aReceber(a) && (
                              <CobrarAtendimento
                                id={a.id}
                                token={a.checkinToken}
                                totalCents={a.totalCents}
                                mensalista={a.mensalista}
                                ajustes={a.items
                                  .filter((i) => i.serviceId === null)
                                  .map((i) => ({ id: i.id, name: i.name, priceCents: i.priceCents }))}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <AtualizaSozinho />
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <span className="label text-steel-400">{rotulo}</span>
      <p className="mt-1.5 font-display text-2xl text-white">{valor}</p>
    </div>
  );
}
