"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Gem,
  Link2,
  Loader2,
  Phone,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, Feedback, notify, type Msg } from "@/components/admin/Feedback";
import { PlanRequests, type RequestRow } from "../PlanRequests";
import { PlanoForm, NovoPlano, type PlanoEditavel, type PlanoServico } from "../PlanoForm";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { subscriptionStatus } from "@/lib/status";
import {
  cancelSubscription,
  createSubscriptionCharge,
  renewSubscription,
} from "../actions";

type Assinante = {
  subscriptionId: number;
  userId: number;
  name: string;
  phone: string;
  phonePending: boolean;
  planId: number;
  planName: string;
  status: string;
  cycle: string;
  monthlyCents: number;
  startedAt: string;
  renewsAt: string;
  vencida: boolean;
};

type Resumo = {
  mrrCents: number;
  ativos: number;
  vencidos: number;
  cancelados: number;
  vencendo: number;
  porPlano: { planId: number; name: string; ativos: number; mrrCents: number }[];
};

const SITUACOES = [
  { valor: "ativos", label: "Ativos" },
  { valor: "vencidos", label: "Vencidos" },
  { valor: "cancelados", label: "Cancelados" },
  { valor: "todos", label: "Todos" },
] as const;

type Situacao = (typeof SITUACOES)[number]["valor"];

function urlDoClube(a: {
  situacao: Situacao;
  planId: number | null;
  busca: string;
  pagina: number;
}) {
  const p = new URLSearchParams();
  if (a.situacao !== "ativos") p.set("situacao", a.situacao);
  if (a.planId) p.set("plano", String(a.planId));
  if (a.busca) p.set("q", a.busca);
  if (a.pagina > 1) p.set("pagina", String(a.pagina));
  const qs = p.toString();
  return qs ? `/admin/clube?${qs}` : "/admin/clube";
}

export function ClubeManager({
  resumo,
  pedidos,
  planos,
  servicos,
  assinantes,
  situacao,
  planId,
  busca,
  pagina,
  porPagina,
  total,
}: {
  resumo: Resumo;
  pedidos: RequestRow[];
  planos: PlanoEditavel[];
  servicos: PlanoServico[];
  assinantes: Assinante[];
  situacao: Situacao;
  planId: number | null;
  busca: string;
  pagina: number;
  porPagina: number;
  total: number;
}) {
  const router = useRouter();
  const [navegando, start] = useTransition();
  const estado = { situacao, planId, busca, pagina };

  function aplicar(mudanca: Partial<typeof estado>) {
    start(() => router.push(urlDoClube({ ...estado, pagina: 1, ...mudanca })));
  }

  const primeiro = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);
  const ultimaPagina = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="space-y-5">
      {/* ── Resumo ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Numero
          icon={<TrendingUp className="h-4 w-4 sm:h-5 sm:w-5" />}
          valor={formatBRL(resumo.mrrCents)}
          rotulo="Entra por mês"
          dica="Soma dos planos ativos"
        />
        <Numero
          icon={<Users className="h-4 w-4 sm:h-5 sm:w-5" />}
          valor={String(resumo.ativos)}
          rotulo="Membros ativos"
          dica={`${resumo.vencendo} renova(m) em 7 dias`}
        />
        <Numero
          icon={<Crown className="h-4 w-4 sm:h-5 sm:w-5" />}
          valor={String(resumo.vencidos)}
          rotulo="Planos vencidos"
          dica="Cobrança em atraso"
        />
        <Numero
          icon={<Gem className="h-4 w-4 sm:h-5 sm:w-5" />}
          valor={String(resumo.cancelados)}
          rotulo="Cancelados"
          dica="Histórico do clube"
        />
      </div>

      {resumo.porPlano.length > 0 && (
        <Card title="Por plano" desc="Quantos membros e quanto cada plano traz por mês.">
          <ul className="space-y-2">
            {resumo.porPlano.map((p) => (
              <li
                key={p.planId}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-3.5 py-3"
              >
                {/* No celular o nome fica com a linha inteira: espremido
                    entre a contagem e o valor virava "Plan…". */}
                <span className="w-full truncate font-medium text-white sm:w-auto sm:min-w-0 sm:flex-1">
                  {p.name}
                </span>
                <span className="mr-auto text-xs text-steel-400 sm:mr-0">
                  {p.ativos} membro(s)
                </span>
                <span className="font-display text-base text-white">
                  {formatBRL(p.mrrCents)}
                  <span className="ml-1 text-xs text-steel-400">/mês</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pedidos.length > 0 && <PlanRequests requests={pedidos} />}

      {/* ── Planos ── */}
      <Card
        title="Planos e valores"
        desc="O que você salvar aqui aparece na hora na vitrine e no agendamento. Os serviços marcados saem sem cobrança para o membro."
        icon={<Gem className="h-5 w-5" />}
      >
        <div className="space-y-5">
          {planos.map((p) => (
            <PlanoForm key={p.id} plan={p} services={servicos} />
          ))}
        </div>
        <div className="mt-5 border-t border-white/8 pt-5">
          <NovoPlano services={servicos} />
        </div>
        <Link
          href="/planos"
          className="label mt-4 inline-flex items-center gap-1.5 text-electric hover:underline"
        >
          Ver a vitrine como o cliente vê
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </Card>

      {/* ── Assinantes ── */}
      <Card
        title="Membros do clube"
        desc={
          total === 0
            ? "Ninguém nesta lista por enquanto."
            : `Mostrando ${primeiro}–${ultimo} de ${total}`
        }
        icon={<Users className="h-5 w-5" />}
      >
        <Busca inicial={busca} onBuscar={(t) => aplicar({ busca: t })} />

        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {SITUACOES.map((s) => (
            <button
              key={s.valor}
              type="button"
              onClick={() => aplicar({ situacao: s.valor })}
              aria-pressed={situacao === s.valor}
              className={`label rounded-full border px-3 py-2 transition-colors ${
                situacao === s.valor
                  ? "border-electric/45 bg-electric/12 text-electric"
                  : "border-white/10 text-steel-300 hover:border-white/25 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-xs text-steel-400">
            Plano
            <select
              value={planId ?? ""}
              onChange={(e) =>
                aplicar({ planId: e.target.value ? Number(e.target.value) : null })
              }
              aria-label="Filtrar por plano"
              className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-electric/60"
            >
              <option value="">Todos</option>
              {planos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {assinantes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhum membro encontrado.
          </p>
        ) : (
          <ul className={`space-y-2 ${navegando ? "opacity-60" : ""}`}>
            {assinantes.map((a) => (
              <LinhaAssinante key={a.subscriptionId} assinante={a} />
            ))}
          </ul>
        )}

        {total > porPagina && (
          <nav
            aria-label="Páginas de membros"
            className="mt-4 flex flex-wrap items-center justify-center gap-3 border-t border-white/8 pt-4 sm:justify-between"
          >
            <PaginaBtn
              href={urlDoClube({ ...estado, pagina: pagina - 1 })}
              desabilitado={pagina <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </PaginaBtn>
            <span className="order-first w-full text-center text-xs text-steel-400 sm:order-none sm:w-auto">
              Página {pagina} de {ultimaPagina}
            </span>
            <PaginaBtn
              href={urlDoClube({ ...estado, pagina: pagina + 1 })}
              desabilitado={pagina >= ultimaPagina}
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </PaginaBtn>
          </nav>
        )}
      </Card>
    </div>
  );
}

function Numero({
  icon,
  valor,
  rotulo,
  dica,
}: {
  icon: React.ReactNode;
  valor: string;
  rotulo: string;
  dica: string;
}) {
  return (
    <div className="glass h-full rounded-2xl p-4 sm:p-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric sm:h-10 sm:w-10">
        {icon}
      </span>
      <div className="mt-3 font-display text-xl text-white sm:mt-4 sm:text-2xl">
        {valor}
      </div>
      <div className="mt-1 text-[13px] text-steel-400 sm:text-sm">{rotulo}</div>
      <div className="mt-1 text-[11px] leading-snug text-steel-400/80 sm:text-xs">
        {dica}
      </div>
    </div>
  );
}

function LinhaAssinante({ assinante }: { assinante: Assinante }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [cobranca, setCobranca] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const st = subscriptionStatus[assinante.status];

  function renovar() {
    setMsg(null);
    start(async () => {
      setMsg(notify(await renewSubscription(assinante.userId), "Renovação registrada."));
    });
  }

  function cancelar() {
    setMsg(null);
    start(async () => {
      setMsg(notify(await cancelSubscription(assinante.userId), "Plano cancelado."));
    });
  }

  function cobrar() {
    setMsg(null);
    start(async () => {
      const r = await createSubscriptionCharge(assinante.userId);
      if (r.ok) setCobranca(r.url);
      else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <li className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-royal-grad font-display text-base text-white">
          {assinante.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1 basis-[55%]">
          <Link
            href={`/admin/clientes/${assinante.userId}`}
            className="block truncate font-medium text-white hover:text-electric"
          >
            {assinante.name}
          </Link>
          <span
            className={`mt-0.5 flex items-center gap-1 text-xs ${
              assinante.phonePending ? "text-amber-300" : "text-steel-400"
            }`}
          >
            <Phone className="h-3 w-3 flex-none" />
            {assinante.phonePending ? "Sem telefone" : formatPhone(assinante.phone)}
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="label inline-flex items-center gap-1 rounded-full bg-electric/10 px-2.5 py-1.5 text-electric">
              <Crown className="h-3 w-3" />
              {assinante.planName.replace("Plano ", "")}
            </span>
            <span className={`label rounded-full px-2.5 py-1.5 ${st?.cls ?? ""}`}>
              {st?.label ?? assinante.status}
            </span>
            <span className="text-xs text-steel-400">
              {assinante.cycle === "ANUAL" ? "Anual" : "Mensal"} ·{" "}
              {formatBRL(assinante.monthlyCents)}/mês ·{" "}
              {assinante.status === "CANCELADA"
                ? `desde ${assinante.startedAt}`
                : `${assinante.vencida ? "venceu" : "renova"} ${assinante.renewsAt}`}
            </span>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:flex-none">
          {assinante.status !== "CANCELADA" && (
            <>
              <button
                type="button"
                onClick={renovar}
                disabled={pending}
                title="Registrar o pagamento do ciclo e estender o plano"
                className="label inline-flex items-center gap-1.5 rounded-full border border-electric/40 bg-electric/10 px-3 py-2 text-electric disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Renovar
              </button>
              {cobranca ? (
                <a
                  href={cobranca}
                  target="_blank"
                  rel="noreferrer"
                  className="label inline-flex items-center gap-1.5 rounded-full border border-neon/40 bg-neon/10 px-3 py-2 text-neon"
                >
                  <Link2 className="h-3 w-3" />
                  Abrir cobrança
                </a>
              ) : (
                <button
                  type="button"
                  onClick={cobrar}
                  disabled={pending}
                  title="Gerar link de pagamento do próximo ciclo"
                  className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-electric/45 hover:text-white disabled:opacity-50"
                >
                  <Link2 className="h-3 w-3" />
                  Cobrar
                </button>
              )}
              {assinante.status === "ATIVA" && (
                <button
                  type="button"
                  onClick={cancelar}
                  disabled={pending}
                  className="label rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
            </>
          )}
          <Link
            href={`/admin/clientes/${assinante.userId}`}
            className="label inline-flex items-center gap-1 rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:border-electric/40 hover:text-white"
          >
            Ficha
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <Feedback msg={msg} />
    </li>
  );
}

function Busca({
  inicial,
  onBuscar,
}: {
  inicial: string;
  onBuscar: (termo: string) => void;
}) {
  const [q, setQ] = useState(inicial);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(() => onBuscar(q.trim()));
      }}
      className="mb-4 flex gap-2"
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar membro por nome ou telefone…"
        aria-label="Buscar membro"
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn-royal label flex-none rounded-xl px-5 text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
      </button>
      {inicial && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            start(() => onBuscar(""));
          }}
          className="label flex-none rounded-xl border border-white/12 px-4 text-steel-300 hover:text-white"
        >
          Limpar
        </button>
      )}
    </form>
  );
}

function PaginaBtn({
  href,
  desabilitado,
  children,
}: {
  href: string;
  desabilitado: boolean;
  children: React.ReactNode;
}) {
  const classe =
    "label inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5";
  if (desabilitado) {
    return (
      <span aria-disabled="true" className={`${classe} border-white/8 text-steel-400/50`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${classe} border-white/12 text-steel-300 hover:border-electric/40 hover:text-white`}
    >
      {children}
    </Link>
  );
}
