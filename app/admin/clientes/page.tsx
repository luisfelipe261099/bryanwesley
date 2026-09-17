import {
  listClients,
  countClients,
  type OrdemCliente,
  type SituacaoCliente,
} from "@/lib/queries";
import { utcToShopParts, labelDayMonth } from "@/lib/time";
import { ClientesManager } from "./ClientesManager";

export const dynamic = "force-dynamic";

/** Quantos cabem numa página do painel. */
const POR_PAGINA = 25;

const SITUACOES: SituacaoCliente[] = [
  "todos",
  "assinantes",
  "inadimplentes",
  "avulsos",
  "sem-telefone",
  "com-conta",
  "fixo",
];
const ORDENS: OrdemCliente[] = ["recentes", "nome", "visitas", "ultima-visita"];

export default async function AdminClientes({
  searchParams,
}: {
  searchParams: { q?: string; situacao?: string; ordem?: string; pagina?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  // Valor que não existe vira o padrão, em vez de derrubar a consulta.
  const situacao = SITUACOES.includes(searchParams.situacao as SituacaoCliente)
    ? (searchParams.situacao as SituacaoCliente)
    : "todos";
  const ordem = ORDENS.includes(searchParams.ordem as OrdemCliente)
    ? (searchParams.ordem as OrdemCliente)
    : "recentes";
  const pedida = Number(searchParams.pagina ?? 1);
  const pagina = Number.isFinite(pedida) && pedida > 0 ? Math.floor(pedida) : 1;

  const filtro = { q, situacao, ordem };
  const total = await countClients(filtro);
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  // Filtro novo com a página antiga na URL deixaria a tela vazia sem explicar.
  const atual = Math.min(pagina, ultimaPagina);

  const clients = await listClients({
    ...filtro,
    limit: POR_PAGINA,
    offset: (atual - 1) * POR_PAGINA,
  });

  return (
    <ClientesManager
      busca={q}
      situacao={situacao}
      ordem={ordem}
      pagina={atual}
      porPagina={POR_PAGINA}
      total={total}
      clients={clients.map((c) => ({
        ...c,
        lastVisit: c.lastVisit
          ? labelDayMonth(utcToShopParts(c.lastVisit).dateKey)
          : null,
        renewsAt: c.renewsAt
          ? labelDayMonth(utcToShopParts(c.renewsAt).dateKey)
          : null,
      }))}
    />
  );
}
