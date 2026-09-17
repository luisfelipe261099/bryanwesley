import {
  clubOverview,
  listPlans,
  listSubscribers,
  countSubscribers,
  openPlanRequests,
  type SituacaoAssinante,
} from "@/lib/queries";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { services as servicesTable } from "@/db/schema";
import { utcToShopParts, labelDayMonth } from "@/lib/time";
import { ClubeManager } from "./ClubeManager";

export const dynamic = "force-dynamic";

const POR_PAGINA = 25;
const SITUACOES: SituacaoAssinante[] = ["ativos", "vencidos", "cancelados", "todos"];

export default async function AdminClube({
  searchParams,
}: {
  searchParams: { situacao?: string; plano?: string; q?: string; pagina?: string };
}) {
  const situacao = SITUACOES.includes(searchParams.situacao as SituacaoAssinante)
    ? (searchParams.situacao as SituacaoAssinante)
    : "ativos";
  const planoPedido = Number(searchParams.plano ?? 0);
  const planId = Number.isInteger(planoPedido) && planoPedido > 0 ? planoPedido : null;
  const q = (searchParams.q ?? "").trim();
  const pedida = Number(searchParams.pagina ?? 1);
  const pagina = Number.isFinite(pedida) && pedida > 0 ? Math.floor(pedida) : 1;

  const filtro = { situacao, planId, q };
  const [resumo, planos, servicos, pedidos, total] = await Promise.all([
    clubOverview(),
    listPlans({ todos: true }),
    db.select().from(servicesTable).orderBy(asc(servicesTable.sortOrder)),
    openPlanRequests(),
    countSubscribers(filtro),
  ]);

  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(pagina, ultimaPagina);
  const assinantes = await listSubscribers({
    ...filtro,
    limit: POR_PAGINA,
    offset: (atual - 1) * POR_PAGINA,
  });

  return (
    <ClubeManager
      resumo={resumo}
      pedidos={pedidos}
      planos={planos.map((p) => ({
        id: p.id,
        name: p.name,
        kicker: p.kicker,
        tagline: p.tagline,
        priceCents: p.priceCents,
        annualPriceCents: p.annualPriceCents,
        features: p.features,
        highlight: p.highlight,
        badge: p.badge,
        active: p.active,
        serviceIds: p.covers.map((c) => c.id),
      }))}
      servicos={servicos.map((s) => ({ id: s.id, name: s.name }))}
      assinantes={assinantes.map((a) => ({
        ...a,
        startedAt: labelDayMonth(utcToShopParts(a.startedAt).dateKey),
        renewsAt: labelDayMonth(utcToShopParts(a.renewsAt).dateKey),
        vencida: a.status === "ATIVA" && a.renewsAt.getTime() < Date.now(),
      }))}
      situacao={situacao}
      planId={planId}
      busca={q}
      pagina={atual}
      porPagina={POR_PAGINA}
      total={total}
    />
  );
}
