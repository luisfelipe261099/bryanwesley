// A agenda do dono: a lista dos agendamentos.
//
// Esta rota era a tela de CONFIGURAÇÃO (dados da barbearia, regras e
// bloqueios) — quem clicava em "Agenda" procurando os horários marcados
// não achava nada, porque a lista só existia espremida num card do
// dashboard. A configuração mudou para /admin/ajustes e aqui ficou o que
// o nome promete.
import {
  agendaDoPeriodo,
  contarAgenda,
  contagemPorDia,
  bloqueiosDoPeriodo,
  resumoDaAgenda,
  listTeam,
  listServices,
  dayBounds,
  type RecorteAgenda,
} from "@/lib/queries";
import { getSettings, capacidadeDoDia } from "@/lib/schedule";
import {
  shopToday,
  addDays,
  weekdayOf,
  utcToShopParts,
  formatShopTime,
  labelFullDate,
  labelWeekday,
  minutesToHHMM,
} from "@/lib/time";
import {
  AgendaManager,
  type VisaoAgenda,
  type LinhaAgenda,
  type LinhaBloqueio,
} from "./AgendaManager";

export const dynamic = "force-dynamic";

/**
 * Quantos agendamentos por página. Vale para todas as visões: antes o dia
 * e a semana traziam até 400 numa tacada e, passando disso, a lista
 * cortava em silêncio — os números do topo diziam 420 e a tela mostrava
 * 400, sem nada avisando.
 */
const POR_PAGINA = 40;

/** Até onde a lista "Próximos" enxerga. */
const HORIZONTE_DIAS = 120;

const VISOES: VisaoAgenda[] = ["dia", "semana", "proximos"];
const RECORTES: RecorteAgenda[] = [
  "tudo",
  "ativos",
  "concluidos",
  "cancelados",
];

export default async function AdminAgenda({
  searchParams,
}: {
  searchParams: {
    v?: string;
    dia?: string;
    barbeiro?: string;
    situacao?: string;
    q?: string;
    pagina?: string;
  };
}) {
  const hoje = shopToday();
  const visao = VISOES.includes(searchParams.v as VisaoAgenda)
    ? (searchParams.v as VisaoAgenda)
    : "dia";
  const dia =
    searchParams.dia && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dia)
      ? searchParams.dia
      : hoje;
  const barbeiroPedido = Number(searchParams.barbeiro);
  const barbeiro =
    Number.isFinite(barbeiroPedido) && barbeiroPedido > 0
      ? barbeiroPedido
      : null;
  const recorte = RECORTES.includes(searchParams.situacao as RecorteAgenda)
    ? (searchParams.situacao as RecorteAgenda)
    : visao === "proximos"
      ? "ativos"
      : "tudo";
  const busca = (searchParams.q ?? "").trim();
  const paginaPedida = Number(searchParams.pagina ?? 1);
  const pagina =
    Number.isFinite(paginaPedida) && paginaPedida > 0
      ? Math.floor(paginaPedida)
      : 1;

  const [settings, equipe, catalogo] = await Promise.all([
    getSettings(),
    listTeam(),
    listServices(),
  ]);

  // A janela de tempo de cada visão. "Próximos" começa AGORA (não no
  // começo do dia): o que já passou hoje não é mais o que está por vir.
  const janela =
    visao === "dia"
      ? dayBounds(dia)
      : visao === "semana"
        ? { start: dayBounds(dia).start, end: dayBounds(addDays(dia, 6)).end }
        : {
            start: new Date(),
            end: dayBounds(addDays(hoje, HORIZONTE_DIAS)).end,
          };

  const filtroBase = {
    de: janela.start,
    ate: janela.end,
    barberId: barbeiro,
    busca,
  };

  const resumo = await resumoDaAgenda(filtroBase);
  const total = await contarAgenda({ ...filtroBase, recorte });
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  const atual = Math.min(pagina, ultimaPagina);

  const linhas = await agendaDoPeriodo({
    ...filtroBase,
    recorte,
    limit: POR_PAGINA,
    offset: (atual - 1) * POR_PAGINA,
  });

  // Bloqueios entram na mesma lista, no horário deles — mas só quando a
  // lista é "o que está marcado". Procurando um cliente, ou filtrando por
  // concluídos/cancelados, eles viram ruído: a busca por um nome devolvia
  // zero atendimentos e três almoços. Também só na primeira página, já
  // que não são paginados junto com os atendimentos.
  const mostrarBloqueios =
    atual === 1 && !busca && (recorte === "tudo" || recorte === "ativos");
  const bloqueios = mostrarBloqueios
    ? (await bloqueiosDoPeriodo(janela.start, janela.end, barbeiro)).map(
        (b): LinhaBloqueio => ({
          id: b.id,
          dateKey: utcToShopParts(b.startsAt).dateKey,
          minutos: utcToShopParts(b.startsAt).minutesOfDay,
          hora: formatShopTime(b.startsAt),
          fim: formatShopTime(b.endsAt),
          motivo: b.reason,
          barberName: b.barberName,
        }),
      )
    : [];

  // Ocupação só faz sentido no dia: é minuto de cadeira sobre a
  // capacidade daquele dia, com a folga da loja e a do profissional.
  const capacidade =
    visao === "dia" ? await capacidadeDoDia(dia, barbeiro, settings) : 0;

  // A tira de dias mostra quantos atendimentos cada dia tem: é o que
  // responde "onde está o movimento" sem precisar clicar dia a dia.
  const primeiroDaTira = addDays(hoje, -3);
  const porDia =
    visao === "proximos"
      ? {}
      : await contagemPorDia(
          dayBounds(primeiroDaTira).start,
          dayBounds(addDays(primeiroDaTira, 13)).end,
          barbeiro,
          busca,
        );
  const dias = Array.from({ length: 14 }, (_, i) => {
    const dateKey = addDays(primeiroDaTira, i);
    return {
      dateKey,
      weekday: labelWeekday(dateKey),
      numero: dateKey.slice(-2),
      hoje: dateKey === hoje,
      fechado: settings.closedWeekdays.includes(weekdayOf(dateKey)),
      quantos: porDia[dateKey] ?? 0,
    };
  });

  return (
    <AgendaManager
      visao={visao}
      dia={dia}
      hoje={hoje}
      barbeiro={barbeiro}
      recorte={recorte}
      busca={busca}
      pagina={atual}
      porPagina={POR_PAGINA}
      total={total}
      ultimaPagina={ultimaPagina}
      dias={dias}
      diaFechado={settings.closedWeekdays.includes(weekdayOf(dia))}
      rotuloDoDia={labelFullDate(dia)}
      rotuloDaSemana={`${labelFullDate(dia)} — ${labelFullDate(addDays(dia, 6))}`}
      expediente={`${minutesToHHMM(settings.openMinute)}—${minutesToHHMM(settings.closeMinute)}`}
      resumo={{ ...resumo, capacidadeMin: capacidade }}
      equipe={equipe.map((b) => ({ id: b.id, shortName: b.shortName }))}
      servicos={catalogo.map((s) => ({
        id: s.id,
        name: s.name,
        priceCents: s.priceCents,
        durationMin: s.durationMin,
      }))}
      linhas={linhas.map(paraLinha)}
      bloqueios={bloqueios}
    />
  );
}

/** O agendamento como a tela precisa dele: já com data e hora prontas. */
function paraLinha(
  a: Awaited<ReturnType<typeof agendaDoPeriodo>>[number],
): LinhaAgenda {
  const partes = utcToShopParts(a.startsAt);
  return {
    id: a.id,
    dateKey: partes.dateKey,
    hora: formatShopTime(a.startsAt),
    minutos: partes.hour * 60 + partes.minute,
    fim: formatShopTime(a.endsAt),
    durationMin: a.durationMin,
    clientName: a.clientName,
    clientPhone: a.clientPhone,
    clientUserId: a.clientUserId,
    barberId: a.barberId,
    barberName: a.barber.shortName,
    servicos: a.items.map((i) => i.name).join(" + "),
    totalCents: a.totalCents,
    servicoIds: a.items
      .map((i) => i.serviceId)
      .filter((id): id is number => id !== null),
    assinante: a.kind === "ASSINANTE",
    fixo: a.recurringSlotId !== null,
    status: a.status,
    code: a.code,
    notes: a.notes,
  };
}
