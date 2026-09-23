// ───────────────────────────────────────────────────────────
// O atendente do WhatsApp.
//
// A conversa inteira acontece lá: o cliente escolhe o serviço, vê os dias
// abertos, vê os horários realmente livres e fecha — e o agendamento entra
// aqui como qualquer outro, com código, lugar na agenda, comissão e os
// lembretes de 24h e 2h.
//
// A regra mora neste arquivo e não na rota: `processarMensagem` recebe o
// que a pessoa mandou e devolve o que responder, sem tocar em rede. É o
// que deixa a conversa inteira testável sem falar com a Meta.
//
// Onde cada um parou fica em `whatsapp_sessions` (uma linha por telefone,
// esquecida depois de meia hora). O que dá para caber na resposta viaja no
// id do botão — "svc:3", "day:2026-09-26" —, então quase nada depende da
// memória.
// ───────────────────────────────────────────────────────────
import { and, eq, gte, inArray, asc, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, users, whatsappSessions } from "@/db/schema";
import type { MensagemSaida } from "./providers/whatsapp";
import { createBooking, transitionAppointment, BookingError } from "./appointments";
import { getAvailability, getSettings, listOpenDays } from "./schedule";
import { listServices } from "./queries";
import { normalizePhone } from "./phone";
import { formatBRL, formatDuration } from "./money";
import { hitRateLimit } from "./rate-limit";
import {
  formatShopTime,
  utcToShopParts,
  labelFullDate,
  labelDayMonth,
} from "./time";

/** Conversa parada há mais de isto recomeça do zero. */
export const VALIDADE_SESSAO_MS = 30 * 60_000;

/** Quantos horários cabem numa lista (a Meta aceita 10 linhas). */
const HORARIOS_POR_PAGINA = 9;

/**
 * Teto de mensagens por número numa janela. Uma conversa de verdade
 * gasta meia dúzia; isto só existe para o script que tentar usar o
 * atendente como megafone — passando daqui, o robô fica mudo.
 */
const TETO_MENSAGENS = 60;
const JANELA_MS = 15 * 60_000;

export type EntradaBot = {
  /** Telefone de quem escreveu (com ou sem 55). */
  de: string;
  /** Texto livre, quando a pessoa digitou. */
  texto?: string;
  /** Id da opção escolhida numa lista ou botão. */
  escolha?: string;
  /** Nome do perfil do WhatsApp, quando a Meta manda. */
  nomeDoPerfil?: string | null;
};

export type SaidaBot = { para: string; mensagem: MensagemSaida };

type Etapa = "menu" | "servico" | "dia" | "hora" | "nome";
type Dados = {
  serviceIds?: number[];
  dateKey?: string;
  time?: string;
  nome?: string;
  offset?: number;
};

/**
 * Uma mensagem entra, as respostas saem. Quem chama manda para o
 * WhatsApp — este arquivo não conhece rede.
 */
export async function processarMensagem(e: EntradaBot): Promise<SaidaBot[]> {
  const fone = normalizePhone(e.de);
  if (fone.length < 10) return [];

  const freio = await hitRateLimit(`wa:${fone}`, TETO_MENSAGENS, JANELA_MS);
  if (!freio.ok) return [];

  const sessao = await carregarSessao(fone);
  const escolha = (e.escolha ?? "").trim();
  const texto = (e.texto ?? "").trim();

  // Atalhos que valem a qualquer momento da conversa.
  if (/^(menu|oi|ol[áa]|in[íi]cio|come[çc]ar|voltar)$/i.test(texto) && !escolha) {
    return menuInicial(fone, e.nomeDoPerfil);
  }

  if (escolha) return porEscolha(fone, escolha, sessao, e.nomeDoPerfil);

  // Texto livre: só interessa quando estamos esperando o nome.
  if (sessao?.etapa === "nome") {
    const nome = limparNome(texto);
    if (!nome) {
      return [msg(fone, { tipo: "texto", texto: "Me diz seu nome completo, por favor 🙂" })];
    }
    return fecharAgendamento(fone, { ...(sessao.dados ?? {}), nome });
  }

  return menuInicial(fone, e.nomeDoPerfil);
}

// ───────────────────────── Passos ─────────────────────────

async function menuInicial(
  fone: string,
  nomeDoPerfil?: string | null
): Promise<SaidaBot[]> {
  const settings = await getSettings();
  const cliente = await db.query.users.findFirst({ where: eq(users.phone, fone) });
  const primeiro = (cliente?.name ?? nomeDoPerfil ?? "").trim().split(" ")[0];
  const ola = primeiro ? `Oi, ${primeiro}!` : "Oi!";

  const proximos = cliente ? await proximosDe(cliente.id) : [];
  await salvarSessao(fone, "menu", {});

  const linhas = [
    { id: "menu:agendar", titulo: "Marcar horário", descricao: "Escolher serviço, dia e hora" },
  ];
  if (proximos.length > 0) {
    linhas.push({
      id: "menu:meus",
      titulo: "Meus horários",
      descricao: `${proximos.length} marcado(s) — ver ou cancelar`,
    });
  }
  linhas.push({
    id: "menu:endereco",
    titulo: "Endereço e horário",
    descricao: "Onde fica e quando a gente abre",
  });

  return [
    msg(fone, {
      tipo: "lista",
      corpo: `${ola} Aqui é a ${settings.shopName}. Posso marcar seu horário agora mesmo, por aqui. O que você precisa?`,
      botao: "Ver opções",
      secoes: [{ linhas }],
    }),
  ];
}

async function porEscolha(
  fone: string,
  escolha: string,
  sessao: { etapa: Etapa; dados: Dados } | null,
  nomeDoPerfil?: string | null
): Promise<SaidaBot[]> {
  const dados = sessao?.dados ?? {};

  if (escolha === "menu:agendar") return pedirServico(fone);
  if (escolha === "menu:meus") return meusHorarios(fone);
  if (escolha === "menu:endereco") return endereco(fone);
  if (escolha === "menu:voltar") return menuInicial(fone, nomeDoPerfil);

  if (escolha.startsWith("svc:")) {
    const id = Number(escolha.slice(4));
    if (!Number.isFinite(id)) return pedirServico(fone);
    return pedirDia(fone, { ...dados, serviceIds: [id] });
  }

  if (escolha.startsWith("day:")) {
    const dateKey = escolha.slice(4);
    return pedirHora(fone, { ...dados, dateKey, offset: 0 });
  }

  if (escolha.startsWith("mais:")) {
    const offset = Number(escolha.slice(5));
    return pedirHora(fone, { ...dados, offset: Number.isFinite(offset) ? offset : 0 });
  }

  if (escolha.startsWith("time:")) {
    const time = escolha.slice(5);
    return confirmarOuPedirNome(fone, { ...dados, time });
  }

  if (escolha.startsWith("cancelar:")) {
    const id = Number(escolha.slice(9));
    return pedirConfirmacaoCancelamento(fone, id);
  }

  if (escolha.startsWith("cancelarsim:")) {
    const id = Number(escolha.slice(12));
    return cancelar(fone, id);
  }

  return menuInicial(fone, nomeDoPerfil);
}

async function pedirServico(fone: string): Promise<SaidaBot[]> {
  const settings = await getSettings();
  if (!settings.acceptingBookings) {
    return [
      msg(fone, {
        tipo: "texto",
        texto:
          "A agenda online está pausada no momento. Me manda uma mensagem que a gente resolve na mão 🙂",
      }),
    ];
  }

  const servicos = await listServices();
  if (servicos.length === 0) {
    return [msg(fone, { tipo: "texto", texto: "O catálogo está vazio no momento." })];
  }
  await salvarSessao(fone, "servico", {});

  return [
    msg(fone, {
      tipo: "lista",
      corpo: "Qual serviço você quer marcar?",
      rodape: "Depois a gente escolhe o dia e a hora",
      botao: "Ver serviços",
      secoes: [
        {
          linhas: servicos.slice(0, 10).map((s) => ({
            id: `svc:${s.id}`,
            titulo: s.name,
            descricao: `${formatBRL(s.priceCents)} · ${formatDuration(s.durationMin)}`,
          })),
        },
      ],
    }),
  ];
}

async function pedirDia(fone: string, dados: Dados): Promise<SaidaBot[]> {
  const settings = await getSettings();
  const dias = listOpenDays(settings, 9);
  if (dias.length === 0) {
    return [msg(fone, { tipo: "texto", texto: "Não achei dias abertos por aqui. Me chama que a gente resolve." })];
  }
  await salvarSessao(fone, "dia", dados);

  const nome = await nomeDoServico(dados.serviceIds);
  return [
    msg(fone, {
      tipo: "lista",
      corpo: `${nome} 👌 Para que dia?`,
      botao: "Ver dias",
      secoes: [
        {
          linhas: dias.map((d) => ({
            id: `day:${d.dateKey}`,
            titulo: `${d.weekday}, ${d.dayLabel}`,
          })),
        },
      ],
    }),
  ];
}

async function pedirHora(fone: string, dados: Dados): Promise<SaidaBot[]> {
  if (!dados.dateKey || !dados.serviceIds?.length) return pedirServico(fone);

  const servicos = await listServices();
  const escolhidos = servicos.filter((s) => dados.serviceIds!.includes(s.id));
  const durationMin = escolhidos.reduce((a, s) => a + s.durationMin, 0);

  const { slots, closed, motivo } = await getAvailability({
    dateKey: dados.dateKey,
    durationMin: Math.max(durationMin, 1),
    barberId: null,
  });

  const livres = slots.filter((s) => s.available);
  if (closed || livres.length === 0) {
    const porque = closed
      ? motivo === "sem-equipe"
        ? "Não temos ninguém atendendo nesse dia."
        : "A barbearia não abre nesse dia."
      : "Esse dia já lotou.";
    return [
      msg(fone, { tipo: "texto", texto: `${porque} Escolhe outro dia 👇` }),
      ...(await pedirDia(fone, { ...dados, dateKey: undefined })),
    ];
  }

  const offset = dados.offset ?? 0;
  const pagina = livres.slice(offset, offset + HORARIOS_POR_PAGINA);
  const temMais = livres.length > offset + HORARIOS_POR_PAGINA;
  await salvarSessao(fone, "hora", { ...dados, offset });

  const linhas = pagina.map((s) => ({
    id: `time:${s.time}`,
    titulo: s.time,
    descricao: periodoDe(s.time),
  }));
  if (temMais) {
    linhas.push({
      id: `mais:${offset + HORARIOS_POR_PAGINA}`,
      titulo: "Ver mais horários",
      descricao: `Mais ${livres.length - offset - HORARIOS_POR_PAGINA} no dia`,
    });
  }

  return [
    msg(fone, {
      tipo: "lista",
      corpo: `${primeiraMaiuscula(labelFullDate(dados.dateKey))} — estes horários estão livres:`,
      rodape: `${formatDuration(durationMin)} de atendimento`,
      botao: "Ver horários",
      secoes: [{ linhas }],
    }),
  ];
}

async function confirmarOuPedirNome(fone: string, dados: Dados): Promise<SaidaBot[]> {
  const cliente = await db.query.users.findFirst({ where: eq(users.phone, fone) });
  const nome = cliente?.name?.trim();
  if (nome) return fecharAgendamento(fone, { ...dados, nome });

  await salvarSessao(fone, "nome", dados);
  return [
    msg(fone, {
      tipo: "texto",
      texto: "Quase lá! Como é seu nome completo? (é só para eu deixar na agenda)",
    }),
  ];
}

async function fecharAgendamento(fone: string, dados: Dados): Promise<SaidaBot[]> {
  if (!dados.serviceIds?.length || !dados.dateKey || !dados.time || !dados.nome) {
    return pedirServico(fone);
  }

  try {
    const appt = await createBooking({
      serviceIds: dados.serviceIds,
      dateKey: dados.dateKey,
      time: dados.time,
      barberId: null,
      clientName: dados.nome,
      clientPhone: fone,
      notes: "Agendado pelo WhatsApp",
      // Pedido do cliente: vale a pausa da agenda, a antecedência mínima
      // e o limite de dias — as mesmas regras do site.
      publicRequest: true,
    });
    await limparSessao(fone);

    const quando = `${labelFullDate(utcToShopParts(appt.startsAt).dateKey)} às ${formatShopTime(
      appt.startsAt
    )}`;
    const valor =
      appt.kind === "ASSINANTE" ? "Incluso no seu plano." : `Valor: ${formatBRL(appt.totalCents)}.`;
    return [
      msg(fone, {
        tipo: "texto",
        texto: [
          `Tá marcado! ✂️`,
          `${primeiraMaiuscula(quando)}.`,
          valor,
          `Seu código: ${appt.code}`,
          "",
          "Se precisar remarcar ou cancelar, é só mandar *menu* por aqui.",
        ].join("\n"),
      }),
    ];
  } catch (err) {
    const motivo =
      err instanceof BookingError
        ? err.message
        : "Não consegui fechar esse horário agora. Tenta de novo em instantes.";
    // Volta para a escolha do dia: o horário caiu, mas a conversa segue.
    return [
      msg(fone, { tipo: "texto", texto: motivo }),
      ...(await pedirDia(fone, { ...dados, dateKey: undefined, time: undefined })),
    ];
  }
}

async function meusHorarios(fone: string): Promise<SaidaBot[]> {
  const cliente = await db.query.users.findFirst({ where: eq(users.phone, fone) });
  const proximos = cliente ? await proximosDe(cliente.id) : [];
  if (proximos.length === 0) {
    return [
      msg(fone, { tipo: "texto", texto: "Você não tem horário marcado. Manda *menu* para marcar um." }),
    ];
  }

  const linhas = proximos.slice(0, 9).map((a) => ({
    id: `cancelar:${a.id}`,
    titulo: `${labelDayMonth(utcToShopParts(a.startsAt).dateKey)} ${formatShopTime(a.startsAt)}`,
    descricao: `Código ${a.code} — toque para cancelar`,
  }));

  return [
    msg(fone, {
      tipo: "lista",
      corpo:
        proximos.length === 1
          ? "Esse é o seu horário marcado:"
          : `Você tem ${proximos.length} horários marcados:`,
      rodape: "Para remarcar, cancele e marque outro",
      botao: "Ver horários",
      secoes: [{ linhas }],
    }),
  ];
}

async function pedirConfirmacaoCancelamento(
  fone: string,
  id: number
): Promise<SaidaBot[]> {
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, id),
  });
  if (!appt || normalizePhone(appt.clientPhone) !== fone) {
    return [msg(fone, { tipo: "texto", texto: "Não achei esse horário no seu nome." })];
  }
  const quando = `${labelFullDate(utcToShopParts(appt.startsAt).dateKey)} às ${formatShopTime(
    appt.startsAt
  )}`;
  return [
    msg(fone, {
      tipo: "botoes",
      corpo: `Quer mesmo cancelar o horário de ${quando}?`,
      botoes: [
        { id: `cancelarsim:${appt.id}`, titulo: "Sim, cancelar" },
        { id: "menu:voltar", titulo: "Não, manter" },
      ],
    }),
  ];
}

async function cancelar(fone: string, id: number): Promise<SaidaBot[]> {
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, id),
  });
  // Confere o dono pelo telefone da conversa: o id vem de um botão, e
  // botão é coisa que se pode forjar.
  if (!appt || normalizePhone(appt.clientPhone) !== fone) {
    return [msg(fone, { tipo: "texto", texto: "Não achei esse horário no seu nome." })];
  }
  if (appt.startsAt.getTime() - Date.now() < 2 * 3600_000) {
    return [
      msg(fone, {
        tipo: "texto",
        texto:
          "Faltam menos de 2h para esse horário — não dá para cancelar por aqui. Me manda uma mensagem que a gente vê isso.",
      }),
    ];
  }
  try {
    await transitionAppointment(appt.id, "CANCELADO");
  } catch {
    return [msg(fone, { tipo: "texto", texto: "Não consegui cancelar agora. Tenta de novo." })];
  }
  return [
    msg(fone, {
      tipo: "texto",
      texto: "Cancelado. Quando quiser marcar de novo, é só mandar *menu* 🙂",
    }),
  ];
}

async function endereco(fone: string): Promise<SaidaBot[]> {
  const s = await getSettings();
  return [
    msg(fone, {
      tipo: "texto",
      texto: [
        `*${s.shopName}* — ${s.shopUnit}`,
        s.shopAddress,
        s.shopHoursLabel,
        "",
        "Para marcar, manda *menu* 🙂",
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  ];
}

// ───────────────────────── Apoio ─────────────────────────

function msg(para: string, mensagem: MensagemSaida): SaidaBot {
  return { para, mensagem };
}

async function proximosDe(userId: number) {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clientUserId, userId),
        gte(appointments.endsAt, new Date()),
        inArray(appointments.status, ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"])
      )
    )
    .orderBy(asc(appointments.startsAt))
    .limit(9);
}

async function nomeDoServico(ids?: number[]) {
  if (!ids?.length) return "Show";
  const servicos = await listServices();
  const nomes = servicos.filter((s) => ids.includes(s.id)).map((s) => s.name);
  return nomes.length ? nomes.join(" + ") : "Show";
}

function periodoDe(hhmm: string) {
  if (hhmm < "12:00") return "manhã";
  if (hhmm < "18:00") return "tarde";
  return "noite";
}

function primeiraMaiuscula(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Nome digitado no WhatsApp: tira emoji e espaço sobrando. */
function limparNome(texto: string) {
  const limpo = texto
    .replace(/[^\p{L}\p{N}\s'.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length >= 2 ? limpo.slice(0, 80) : null;
}

// ───────────────────────── Sessão ─────────────────────────

async function carregarSessao(fone: string) {
  const linha = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.phone, fone),
  });
  if (!linha) return null;
  // Conversa velha não vale: quem volta no dia seguinte começa do menu,
  // e não de um "qual seu nome?" perdido no tempo.
  if (Date.now() - linha.updatedAt.getTime() > VALIDADE_SESSAO_MS) {
    await limparSessao(fone);
    return null;
  }
  return { etapa: linha.etapa as Etapa, dados: (linha.dados ?? {}) as Dados };
}

async function salvarSessao(fone: string, etapa: Etapa, dados: Dados) {
  await db
    .insert(whatsappSessions)
    .values({ phone: fone, etapa, dados, updatedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { etapa, dados, updatedAt: new Date() } });
}

async function limparSessao(fone: string) {
  await db.delete(whatsappSessions).where(eq(whatsappSessions.phone, fone));
}

/** Varre as conversas esquecidas (roda junto do despacho). */
export async function limparSessoesVelhas(agora = new Date()) {
  const [res] = await db
    .delete(whatsappSessions)
    .where(lt(whatsappSessions.updatedAt, new Date(agora.getTime() - VALIDADE_SESSAO_MS)));
  return res.affectedRows;
}
