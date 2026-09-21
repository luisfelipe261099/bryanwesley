"use client";

// A tela da agenda: o que está marcado, em três recortes — o dia, a
// semana e tudo o que ainda vai acontecer.
//
// O estado mora na URL (?v=&dia=&barbeiro=&situacao=&q=&pagina=), como no
// resto do painel: dá para mandar o link de um dia específico para outra
// pessoa e voltar pelo botão do navegador.

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  Loader2,
  Phone,
  Plus,
  Repeat,
  Search,
  Ban,
  Sunrise,
  Sun,
  Moon,
  X,
} from "lucide-react";
import { formatBRL, formatDuration } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { appointmentStatus as statusStyles } from "@/lib/status";
import type { RecorteAgenda } from "@/lib/queries";
import { ApptControls } from "../AgendaHoje";
import { RemarcarAdmin } from "./RemarcarAdmin";
import { EditarServicos, type ServicoDoCatalogo } from "./EditarServicos";

export type VisaoAgenda = "dia" | "semana" | "proximos";

export type LinhaAgenda = {
  id: number;
  dateKey: string;
  hora: string;
  minutos: number;
  fim: string;
  durationMin: number;
  clientName: string;
  clientPhone: string;
  clientUserId: number | null;
  barberId: number;
  barberName: string;
  servicos: string;
  servicoIds: number[];
  totalCents: number;
  assinante: boolean;
  fixo: boolean;
  status: string;
  code: string;
  notes: string | null;
};

/** Uma linha da agenda: um atendimento ou um bloqueio. */
type ItemAgenda =
  | { tipo: "atendimento"; minutos: number; dateKey: string; a: LinhaAgenda }
  | { tipo: "bloqueio"; minutos: number; dateKey: string; b: LinhaBloqueio };

export type LinhaBloqueio = {
  id: number;
  dateKey: string;
  minutos: number;
  hora: string;
  fim: string;
  motivo: string | null;
  /** Nome do profissional, ou null quando o bloqueio é da loja toda. */
  barberName: string | null;
};

type DiaChip = {
  dateKey: string;
  weekday: string;
  numero: string;
  hoje: boolean;
  fechado: boolean;
  /** Atendimentos marcados nesse dia (já com o filtro de barbeiro). */
  quantos: number;
};

const VISOES: { valor: VisaoAgenda; label: string }[] = [
  { valor: "dia", label: "Dia" },
  { valor: "semana", label: "Semana" },
  { valor: "proximos", label: "Próximos" },
];

const RECORTES: { valor: RecorteAgenda; label: string }[] = [
  { valor: "tudo", label: "Tudo" },
  { valor: "ativos", label: "Por atender" },
  { valor: "concluidos", label: "Concluídos" },
  { valor: "cancelados", label: "Cancelados" },
];

/** Manhã, tarde e noite: o dia lido como a barbearia trabalha. */
const PERIODOS = [
  { label: "Manhã", icone: Sunrise, ate: 12 * 60 },
  { label: "Tarde", icone: Sun, ate: 18 * 60 },
  { label: "Noite", icone: Moon, ate: 24 * 60 },
];

type Estado = {
  visao: VisaoAgenda;
  dia: string;
  barbeiro: number | null;
  recorte: RecorteAgenda;
  busca: string;
  pagina: number;
};

function urlDaAgenda(e: Estado) {
  const p = new URLSearchParams();
  if (e.visao !== "dia") p.set("v", e.visao);
  if (e.dia) p.set("dia", e.dia);
  if (e.barbeiro) p.set("barbeiro", String(e.barbeiro));
  if (e.recorte !== "tudo") p.set("situacao", e.recorte);
  if (e.busca) p.set("q", e.busca);
  if (e.pagina > 1) p.set("pagina", String(e.pagina));
  const qs = p.toString();
  return qs ? `/admin/agenda?${qs}` : "/admin/agenda";
}

export function AgendaManager({
  visao,
  dia,
  hoje,
  barbeiro,
  recorte,
  busca,
  pagina,
  porPagina,
  total,
  ultimaPagina,
  dias,
  diaFechado,
  rotuloDoDia,
  rotuloDaSemana,
  expediente,
  resumo,
  equipe,
  servicos,
  linhas,
  bloqueios,
}: {
  visao: VisaoAgenda;
  dia: string;
  hoje: string;
  barbeiro: number | null;
  recorte: RecorteAgenda;
  busca: string;
  pagina: number;
  porPagina: number;
  total: number;
  ultimaPagina: number;
  dias: DiaChip[];
  diaFechado: boolean;
  rotuloDoDia: string;
  rotuloDaSemana: string;
  expediente: string;
  resumo: {
    total: number;
    ativos: number;
    concluidos: number;
    cancelados: number;
    previstoCents: number;
    minutosVendidos: number;
    capacidadeMin: number;
  };
  equipe: { id: number; shortName: string }[];
  /** O catálogo ativo, para trocar os serviços de um atendimento. */
  servicos: ServicoDoCatalogo[];
  linhas: LinhaAgenda[];
  bloqueios: LinhaBloqueio[];
}) {
  const router = useRouter();
  const [navegando, start] = useTransition();
  const estado: Estado = { visao, dia, barbeiro, recorte, busca, pagina };
  const [termo, setTermo] = useState(busca);
  useEffect(() => setTermo(busca), [busca]);

  function aplicar(mudanca: Partial<Estado>) {
    start(() => router.push(urlDaAgenda({ ...estado, pagina: 1, ...mudanca })));
  }

  const ocupacao =
    resumo.capacidadeMin > 0
      ? Math.min(100, Math.round((resumo.minutosVendidos / resumo.capacidadeMin) * 100))
      : null;

  const contagem: Record<RecorteAgenda, number> = {
    tudo: resumo.total,
    ativos: resumo.ativos,
    concluidos: resumo.concluidos,
    cancelados: resumo.cancelados,
  };

  // Atendimentos e bloqueios na mesma linha do tempo: um almoço marcado
  // aparece entre os horários, e não como um buraco sem explicação.
  const itens: ItemAgenda[] = [
    ...linhas.map((a) => ({ tipo: "atendimento" as const, minutos: a.minutos, dateKey: a.dateKey, a })),
    ...bloqueios.map((b) => ({ tipo: "bloqueio" as const, minutos: b.minutos, dateKey: b.dateKey, b })),
  ].sort((x, y) => (x.dateKey === y.dateKey ? x.minutos - y.minutos : x.dateKey < y.dateKey ? -1 : 1));

  // Na semana e em "próximos" a lista é quebrada por data; no dia, por
  // período. É o que deixa a leitura rápida em vez de uma fila só.
  const porData = agruparPorData(itens);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="label inline-flex items-center gap-1.5 text-electric">
            <CalendarDays className="h-3.5 w-3.5" />
            {visao === "dia"
              ? dia === hoje
                ? "Hoje"
                : "Dia escolhido"
              : visao === "semana"
                ? "Sete dias"
                : "Tudo que está por vir"}
          </span>
          <h1 className="mt-2 font-display text-3xl text-white sm:text-4xl">Agenda</h1>
          <p className="mt-1.5 text-sm text-steel-400">
            <span className="first-letter:uppercase">
              {visao === "dia"
                ? rotuloDoDia
                : visao === "semana"
                  ? rotuloDaSemana
                  : "a partir de agora"}
            </span>
            {" · loja "}
            {expediente}
          </p>
        </div>
        <Link
          href="/agendar"
          className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-white"
        >
          <Plus className="h-4 w-4" />
          Novo agendamento
        </Link>
      </div>

      {/* Visão: dia, semana ou tudo que vem pela frente */}
      <div className="flex flex-wrap gap-2">
        {VISOES.map((v) => (
          <button
            key={v.valor}
            type="button"
            aria-pressed={visao === v.valor}
            onClick={() => aplicar({ visao: v.valor })}
            className={`label rounded-full px-4 py-2.5 transition-all ${
              visao === v.valor
                ? "btn-royal text-white"
                : "border border-white/10 bg-surface/70 text-steel-300 hover:border-electric/40 hover:text-white"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Números do período, com o filtro já aplicado */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Agendamentos" valor={String(resumo.total)} />
        <Numero rotulo="Por atender" valor={String(resumo.ativos)} destaque />
        <Numero
          rotulo={visao === "dia" ? "Previsto no dia" : "Previsto"}
          valor={formatBRL(resumo.previstoCents)}
        />
        <Numero
          rotulo={visao === "dia" ? "Ocupação" : "Concluídos"}
          valor={visao === "dia" ? (ocupacao === null ? "—" : `${ocupacao}%`) : String(resumo.concluidos)}
        />
      </div>

      <div className="glass rounded-3xl p-5 sm:p-6">
        {/* Dias: só faz sentido quando a lista é de um dia ou de uma semana */}
        {visao !== "proximos" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Dia anterior"
                  onClick={() => aplicar({ dia: somaDias(dia, visao === "semana" ? -7 : -1) })}
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Próximo dia"
                  onClick={() => aplicar({ dia: somaDias(dia, visao === "semana" ? 7 : 1) })}
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {dia !== hoje && (
                  <button
                    type="button"
                    onClick={() => aplicar({ dia: hoje })}
                    className="label rounded-full border border-electric/40 px-3.5 py-2.5 text-electric"
                  >
                    Hoje
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2">
                <span className="label text-steel-400">Ir para</span>
                <input
                  type="date"
                  value={dia}
                  onChange={(e) => e.target.value && aplicar({ dia: e.target.value })}
                  className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-white outline-none [color-scheme:dark] focus:border-electric/60"
                />
              </label>
            </div>

            <div className="rail mt-4 -mx-5 px-5 sm:-mx-6 sm:px-6">
              {dias.map((d) => {
                const on = d.dateKey === dia;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    aria-pressed={on}
                    data-dia={d.dateKey}
                    data-quantos={d.quantos}
                    onClick={() => aplicar({ dia: d.dateKey })}
                    className={`flex min-w-[58px] flex-none flex-col items-center gap-1 rounded-xl border py-2.5 transition-colors ${
                      on
                        ? "border-electric/60 bg-electric/[0.08]"
                        : d.fechado
                          ? "border-white/6 bg-white/[0.01] opacity-50"
                          : "border-white/8 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <span className={`label capitalize ${on ? "text-electric" : "text-steel-400"}`}>
                      {d.weekday}
                    </span>
                    <span className="font-display text-base text-white">{d.numero}</span>
                    {d.quantos > 0 ? (
                      <span
                        className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                          on ? "bg-electric/20 text-electric" : "bg-white/8 text-steel-300"
                        }`}
                      >
                        {d.quantos}
                      </span>
                    ) : (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          d.hoje ? "bg-electric" : "bg-transparent"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Quem atende */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip ativo={!barbeiro} onClick={() => aplicar({ barbeiro: null })}>
            Todos
          </Chip>
          {equipe.map((b) => (
            <Chip
              key={b.id}
              ativo={barbeiro === b.id}
              onClick={() => aplicar({ barbeiro: b.id })}
            >
              {b.shortName}
            </Chip>
          ))}
        </div>

        {/* Situação + busca */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {RECORTES.map((r) => (
            <Chip
              key={r.valor}
              ativo={recorte === r.valor}
              onClick={() => aplicar({ recorte: r.valor })}
            >
              {r.label}
              <span className="ml-1.5 tabular-nums opacity-70">{contagem[r.valor]}</span>
            </Chip>
          ))}
          <form
            className="ml-auto flex min-w-[210px] flex-1 items-center gap-2 sm:flex-none"
            onSubmit={(e) => {
              e.preventDefault();
              aplicar({ busca: termo.trim() });
            }}
          >
            <span className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" />
              <input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Cliente ou telefone"
                aria-label="Procurar na agenda"
                className="w-full rounded-full border border-white/10 bg-surface-2 py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-steel-400/70 focus:border-electric/60"
              />
              {termo && (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  onClick={() => {
                    setTermo("");
                    aplicar({ busca: "" });
                  }}
                  className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-steel-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </form>
        </div>

        {/* A lista */}
        <div className="mt-5">
          {navegando && (
            <p className="mb-3 flex items-center gap-2 text-xs text-steel-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando…
            </p>
          )}

          {itens.length === 0 ? (
            <Vazio
              visao={visao}
              busca={busca}
              recorte={recorte}
              diaFechado={diaFechado && visao === "dia"}
              procurarEmTudo={() => aplicar({ visao: "proximos", recorte: "tudo" })}
            />
          ) : visao === "dia" ? (
            <ListaPorPeriodo itens={itens} equipe={equipe} servicos={servicos} />
          ) : (
            <div className="space-y-6">
              {porData.map(([dateKey, doDia]) => (
                <div key={dateKey}>
                  <h3 className="label sticky top-0 z-10 -mx-1 mb-2.5 bg-surface/80 px-1 py-1.5 capitalize text-electric backdrop-blur">
                    {rotuloCurto(dateKey)}
                    <span className="ml-2 text-steel-400">
                      {contarAtendimentos(doDia)} agendamento
                      {contarAtendimentos(doDia) === 1 ? "" : "s"}
                    </span>
                  </h3>
                  <ul className="space-y-2">
                    {doDia.map((i) =>
                      i.tipo === "atendimento" ? (
                        <Item
                          key={`a${i.a.id}`}
                          a={i.a}
                          equipe={equipe}
                          servicos={servicos}
                        />
                      ) : (
                        <Bloqueio key={`b${i.b.id}`} b={i.b} />
                      )
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Paginação: vale para qualquer visão, porque um sábado cheio
            também passa de uma página */}
        {total > porPagina && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
            <span className="text-xs text-steel-400">
              {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pagina <= 1}
                onClick={() => start(() => router.push(urlDaAgenda({ ...estado, pagina: pagina - 1 })))}
                className="label inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2.5 text-steel-300 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
              <button
                type="button"
                disabled={pagina >= ultimaPagina}
                onClick={() => start(() => router.push(urlDaAgenda({ ...estado, pagina: pagina + 1 })))}
                className="label inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2.5 text-steel-300 disabled:opacity-40"
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ListaPorPeriodo({
  itens,
  equipe,
  servicos,
}: {
  itens: ItemAgenda[];
  equipe: { id: number; shortName: string }[];
  servicos: ServicoDoCatalogo[];
}) {
  let inicio = 0;
  return (
    <div className="space-y-6">
      {PERIODOS.map((p) => {
        const doPeriodo = itens.filter(
          (i) => i.minutos >= inicio && i.minutos < p.ate
        );
        inicio = p.ate;
        if (doPeriodo.length === 0) return null;
        return (
          <div key={p.label}>
            <h3 className="label mb-2.5 flex items-center gap-2 text-electric">
              <p.icone className="h-3.5 w-3.5" />
              {p.label}
              <span className="text-steel-400">{contarAtendimentos(doPeriodo)}</span>
            </h3>
            <ul className="space-y-2">
              {doPeriodo.map((i) =>
                i.tipo === "atendimento" ? (
                  <Item key={`a${i.a.id}`} a={i.a} equipe={equipe} servicos={servicos} />
                ) : (
                  <Bloqueio key={`b${i.b.id}`} b={i.b} />
                )
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A linha de um bloqueio: some da agenda do cliente, aparece na do dono. */
function Bloqueio({ b }: { b: LinhaBloqueio }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-dashed border-amber-400/25 bg-amber-400/[0.04] p-3 sm:flex-nowrap sm:gap-4 sm:p-3.5">
      <div className="flex w-16 flex-none flex-col items-center">
        <span className="font-display text-base leading-none text-amber-200">{b.hora}</span>
        <span className="mt-1 text-[10px] text-amber-200/60">até {b.fim}</span>
      </div>
      <div className="hidden h-10 w-px bg-amber-400/20 sm:block" />
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold text-amber-100">
          <Ban className="h-3.5 w-3.5 flex-none" />
          {b.motivo?.trim() || "Horário bloqueado"}
        </span>
        <span className="mt-0.5 block text-sm text-amber-200/70">
          {b.barberName ? `Só ${b.barberName}` : "Barbearia toda"} · não entra na agenda do cliente
        </span>
      </div>
      <Link
        href="/admin/ajustes"
        className="label rounded-full border border-amber-400/30 px-3 py-2 text-amber-200 transition-colors hover:bg-amber-400/10"
      >
        Gerenciar
      </Link>
    </li>
  );
}

/** Conta só os atendimentos — bloqueio não é agendamento. */
function contarAtendimentos(itens: ItemAgenda[]) {
  return itens.filter((i) => i.tipo === "atendimento").length;
}

function Item({
  a,
  equipe,
  servicos,
}: {
  a: LinhaAgenda;
  equipe: { id: number; shortName: string }[];
  servicos: ServicoDoCatalogo[];
}) {
  const st = statusStyles[a.status];
  const caiu = ["CANCELADO", "NO_SHOW"].includes(a.status);
  return (
    <li
      className={`rounded-2xl border p-3 transition-colors sm:p-3.5 ${
        caiu
          ? "border-white/5 bg-white/[0.01] opacity-60"
          : "border-white/6 bg-white/[0.02] hover:border-electric/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap sm:gap-4">
        <div className="flex w-16 flex-none flex-col items-center">
          <span className="font-display text-lg leading-none text-white">{a.hora}</span>
          <span className="mt-1 text-[10px] text-steel-400">
            {formatDuration(a.durationMin)}
          </span>
        </div>
        <div className="hidden h-10 w-px bg-white/8 sm:block" />
        <div className="min-w-0 flex-1 basis-[55%]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {a.clientUserId ? (
              <Link
                href={`/admin/clientes/${a.clientUserId}`}
                className="truncate font-semibold text-white underline-offset-4 hover:text-electric hover:underline"
              >
                {a.clientName}
              </Link>
            ) : (
              <span className="truncate font-semibold text-white">{a.clientName}</span>
            )}
            {a.assinante && <Crown className="h-3.5 w-3.5 flex-none text-gold" />}
            {a.fixo && (
              <span
                title="Horário fixo do plano"
                className="inline-flex items-center gap-1 rounded-full bg-electric/10 px-2 py-0.5 text-[10px] font-semibold text-electric"
              >
                <Repeat className="h-3 w-3" />
                fixo
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-sm text-steel-400">
            {a.servicos} · {a.barberName}
          </span>
          <a
            href={`https://wa.me/55${a.clientPhone}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-xs text-steel-400 transition-colors hover:text-electric"
          >
            <Phone className="h-3 w-3" />
            {formatPhone(a.clientPhone)}
          </a>
        </div>
        <div className="flex w-full flex-row flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-none sm:flex-col sm:items-end sm:gap-1.5">
          <span className="text-sm font-semibold tabular-nums text-white">
            {a.assinante ? "Plano" : formatBRL(a.totalCents)}
          </span>
          <span className={`label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 ${st.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
          <ApptControls id={a.id} status={a.status}>
            <EditarServicos
              variante="menu"
              appointmentId={a.id}
              servicos={servicos}
              atuais={a.servicoIds}
              resumo={`${a.clientName} · ${a.hora}`}
            />
            <RemarcarAdmin
              variante="menu"
              appointmentId={a.id}
              dateKey={a.dateKey}
              durationMin={a.durationMin}
              barberId={a.barberId}
              equipe={equipe}
              resumo={`${a.clientName} · ${a.hora}`}
            />
          </ApptControls>
        </div>
      </div>
      {a.notes && !(a.fixo && /^hor.rio fixo do plano$/i.test(a.notes.trim())) && (
        <p className="mt-2 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2 text-xs text-steel-300">
          {a.notes}
        </p>
      )}
    </li>
  );
}

function Vazio({
  visao,
  busca,
  recorte,
  diaFechado,
  procurarEmTudo,
}: {
  visao: VisaoAgenda;
  busca: string;
  recorte: RecorteAgenda;
  diaFechado: boolean;
  /** Leva a busca para a lista do que está por vir. */
  procurarEmTudo: () => void;
}) {
  const texto = busca
    ? `Nenhum agendamento de "${busca}" nesse período.`
    : diaFechado
      ? "A barbearia não abre nesse dia."
      : recorte !== "tudo"
        ? "Nenhum agendamento nesse filtro. Tente 'Tudo'."
        : visao === "proximos"
          ? "Nenhum horário marcado daqui para a frente."
          : "Nenhum agendamento nesse período.";
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-12 text-center text-sm text-steel-400">
      <p>{texto}</p>
      {/* Procurar um cliente dentro de um dia só quase nunca acha. O
          caminho útil é procurar no que está por vir. */}
      {busca && visao !== "proximos" && (
        <button
          type="button"
          onClick={procurarEmTudo}
          className="btn-outline label mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-electric"
        >
          Procurar em todos os próximos
        </button>
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <span className="label block text-steel-400">{rotulo}</span>
      <span
        className={`mt-1.5 block font-display text-2xl ${
          destaque ? "text-electric" : "text-white"
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

function Chip({
  children,
  ativo,
  onClick,
}: {
  children: React.ReactNode;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`label rounded-full px-3.5 py-2.5 transition-all ${
        ativo
          ? "border border-electric/50 bg-electric/10 text-electric"
          : "border border-white/10 text-steel-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/** Agrupa por data mantendo a ordem de horário. */
function agruparPorData(itens: ItemAgenda[]) {
  const mapa = new Map<string, ItemAgenda[]>();
  for (const i of itens) {
    const atual = mapa.get(i.dateKey);
    if (atual) atual.push(i);
    else mapa.set(i.dateKey, [i]);
  }
  return Array.from(mapa.entries());
}

/** "seg, 22/09" — cabeçalho de cada dia nas listas longas. */
function rotuloCurto(dateKey: string) {
  const [ano, mes, dia] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12));
  const semana = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" });
  return `${semana.replace(".", "")}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

/** Soma dias a uma data "YYYY-MM-DD" sem sair do calendário. */
function somaDias(dateKey: string, dias: number) {
  const [ano, mes, dia] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}
