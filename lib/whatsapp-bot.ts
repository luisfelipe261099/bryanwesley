// ───────────────────────────────────────────────────────────
// O atendente do WhatsApp.
//
// A conversa inteira acontece lá: o cliente escolhe o serviço, vê os dias
// abertos, vê os horários realmente livres e fecha — e o agendamento entra
// aqui como qualquer outro, com código, lugar na agenda, comissão e os
// lembretes de 24h e 2h.
//
// Funciona com os dois jeitos de ligar o WhatsApp. Na Cloud API da Meta
// as opções chegam como lista e botões; no WAHA (número comum) viram texto
// numerado — "1. Corte · 2. Barba" — e a pessoa responde "2". Ela também
// pode escrever: "sábado", "15h", "sim", "meu nome é João". E, com o
// Gemini ligado, frases inteiras: "quero cortar sábado de tarde".
//
// A regra mora neste arquivo e não na rota: `processarMensagem` recebe o
// que a pessoa mandou e devolve o que responder, sem tocar em rede. É o
// que deixa a conversa inteira testável sem falar com a Meta nem com o
// WAHA.
//
// Onde cada um parou fica em `whatsapp_sessions` (uma linha por telefone,
// esquecida depois de meia hora), junto com as opções da última pergunta
// na ordem em que foram numeradas.
// ───────────────────────────────────────────────────────────
import { and, eq, gt, gte, inArray, asc, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, users, whatsappSessions } from "@/db/schema";
import { opcoesDe, type MensagemSaida } from "./providers/whatsapp";
import { createBooking, transitionAppointment, BookingError } from "./appointments";
import { getAvailability, getSettings, listOpenDays } from "./schedule";
import { listServices } from "./queries";
import { normalizePhone } from "./phone";
import { formatBRL, formatDuration } from "./money";
import { hitRateLimit } from "./rate-limit";
import { formatShopTime, utcToShopParts, labelFullDate, shopToday, addDays } from "./time";
import {
  casarOpcao,
  dataDigitada,
  diaDaSemana,
  ehAtalhoDeMenu,
  horaDigitada,
  intencaoPorPalavras,
  limparNome,
  servicosCitados,
  servicosParecidos,
  tituloDoDia,
  type Opcao,
} from "./whatsapp-texto";
import { iaConfigurada, interpretar } from "./whatsapp-ia";

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

/**
 * Freios do Gemini. O plano grátis tem teto diário; gastar tudo com um
 * número só deixaria o resto do dia sem intérprete.
 */
const IA_TETO_DIA = Number(process.env.GEMINI_TETO_DIARIO) || 400;
const IA_TETO_POR_NUMERO_HORA = 20;

/**
 * Quando alguém da barbearia responde pelo celular, o atendente se cala
 * nessa conversa por este tempo (WHATSAPP_PAUSA_HUMANO_MIN; 0 desliga).
 */
export function pausaHumanoMs() {
  const min = Number(process.env.WHATSAPP_PAUSA_HUMANO_MIN ?? 240);
  return Number.isFinite(min) && min > 0 ? min * 60_000 : 0;
}

export type EntradaBot = {
  /** Telefone de quem escreveu (com ou sem 55). */
  de: string;
  /** Texto livre, quando a pessoa digitou. */
  texto?: string;
  /** Id da opção escolhida numa lista ou botão (Cloud API). */
  escolha?: string;
  /** Nome do perfil do WhatsApp, quando vem. */
  nomeDoPerfil?: string | null;
  /** Áudio, foto, figurinha: a pessoa falou, mas não dá para ler. */
  midia?: boolean;
};

export type SaidaBot = {
  para: string;
  mensagem: MensagemSaida;
  /**
   * "Não entendi": a pergunta de antes continua valendo — as opções
   * numeradas não podem se perder, senão o "2" certo da próxima
   * tentativa cairia no menu.
   */
  mantemOpcoes?: boolean;
};

type Etapa = "menu" | "servico" | "dia" | "hora" | "confirmar" | "nome";
type Dados = {
  serviceIds?: number[];
  dateKey?: string;
  time?: string;
  nome?: string;
  offset?: number;
};
type Sessao = { etapa: Etapa; dados: Dados; opcoes: Opcao[]; pausado: boolean };

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
  const texto = (e.texto ?? "").trim();

  // Alguém da barbearia assumiu a conversa pelo celular: o atendente fica
  // quieto para não atropelar. Só "menu" traz ele de volta antes da hora.
  if (sessao?.pausado && (e.escolha || !ehAtalhoDeMenu(texto))) return [];

  const saidas = await responder(fone, e, texto, sessao);
  await registrarOpcoes(fone, saidas);
  return saidas;
}

async function responder(
  fone: string,
  e: EntradaBot,
  texto: string,
  sessao: Sessao | null
): Promise<SaidaBot[]> {
  let escolha = (e.escolha ?? "").trim();

  if (!escolha && ehAtalhoDeMenu(texto)) return menuInicial(fone, e.nomeDoPerfil);

  // "2", "corte", "sábado", "sim": a resposta a uma das opções da última
  // pergunta. No WAHA é o único jeito de escolher; na Meta também vale.
  if (!escolha && sessao && sessao.etapa !== "nome" && sessao.opcoes.length) {
    escolha = casarOpcao(texto, sessao.opcoes) ?? "";
  }
  if (escolha) return porEscolha(fone, escolha, sessao, e.nomeDoPerfil);

  if (sessao?.etapa === "nome") {
    const nome = limparNome(texto);
    if (!nome) return [texto_(fone, "Me diz seu nome completo, por favor 🙂")];
    return fecharAgendamento(fone, { ...sessao.dados, nome });
  }

  const emAndamento = Boolean(sessao && sessao.etapa !== "menu" && sessao.opcoes.length);

  if (e.midia && !texto) {
    if (!emAndamento) return menuInicial(fone, e.nomeDoPerfil);
    return [
      texto_(
        fone,
        "Ainda não consigo ouvir áudio nem ver foto por aqui 🙏 Responde com o *número* da opção — ou manda *menu*.",
        { mantemOpcoes: true }
      ),
    ];
  }

  // Dia ou horário digitado no meio da conversa ("dia 30", "18h").
  const direto = await entenderDataEHora(fone, texto, sessao);
  if (direto) return direto;

  // Frase inteira: o Gemini tenta entender (se estiver ligado).
  const ia = await entenderComIa(fone, texto, sessao, e.nomeDoPerfil);
  if (ia) return ia;

  // Sem IA (ou ela não soube): as palavras-chave e o que dá para tirar
  // da frase — serviço pelo nome, dia e hora.
  const palavras = await entenderPorPalavras(fone, texto, sessao);
  if (palavras) return palavras;

  if (emAndamento) {
    return [
      texto_(
        fone,
        "Não entendi 🤔 Responde com o *número* de uma das opções aí em cima — ou manda *menu* para recomeçar.",
        { mantemOpcoes: true }
      ),
    ];
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
      rodape: iaConfigurada()
        ? 'Ou escreve do seu jeito: "corte sábado às 15h"'
        : undefined,
      botao: "Ver opções",
      secoes: [{ linhas }],
    }),
  ];
}

async function porEscolha(
  fone: string,
  escolha: string,
  sessao: Sessao | null,
  nomeDoPerfil?: string | null
): Promise<SaidaBot[]> {
  const dados = sessao?.dados ?? {};

  if (escolha === "menu:agendar") return pedirServico(fone, {});
  if (escolha === "menu:meus") return meusHorarios(fone);
  if (escolha === "menu:endereco") return endereco(fone);
  if (escolha === "menu:voltar") return menuInicial(fone, nomeDoPerfil);

  if (escolha.startsWith("svc:")) {
    const id = Number(escolha.slice(4));
    const existe = (await listServices()).some((s) => s.id === id);
    if (!existe) return pedirServico(fone, dados);
    return proximoPasso(fone, { ...dados, serviceIds: [id], offset: 0 });
  }

  if (escolha.startsWith("day:")) {
    const dateKey = escolha.slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return pedirDia(fone, dados);
    return proximoPasso(fone, { ...dados, dateKey, offset: 0 });
  }

  if (escolha.startsWith("mais:")) {
    const offset = Number(escolha.slice(5));
    return pedirHora(fone, { ...dados, offset: Number.isFinite(offset) ? offset : 0 });
  }

  if (escolha.startsWith("time:")) {
    const time = escolha.slice(5);
    if (!/^\d{2}:\d{2}$/.test(time)) return pedirHora(fone, dados);
    return confirmarOuPedirNome(fone, { ...dados, time });
  }

  if (escolha === "confirmar:sim") {
    if (!dados.serviceIds?.length || !dados.dateKey || !dados.time) {
      return proximoPasso(fone, dados);
    }
    return confirmarOuPedirNome(fone, dados);
  }
  if (escolha === "confirmar:outro") {
    return pedirHora(fone, { ...dados, time: undefined, offset: 0 });
  }

  if (escolha.startsWith("cancelar:")) {
    return pedirConfirmacaoCancelamento(fone, Number(escolha.slice(9)));
  }
  if (escolha.startsWith("cancelarsim:")) {
    return cancelar(fone, Number(escolha.slice(12)));
  }

  return menuInicial(fone, nomeDoPerfil);
}

/** Vai para o primeiro passo que ainda falta. */
async function proximoPasso(fone: string, dados: Dados): Promise<SaidaBot[]> {
  if (!dados.serviceIds?.length) return pedirServico(fone, dados);
  if (!dados.dateKey) return pedirDia(fone, dados);
  if (!(await diaAberto(dados.dateKey))) {
    return [
      texto_(fone, "Esse dia não está aberto para agendar 🙏 Escolhe um destes:"),
      ...(await pedirDia(fone, { ...dados, dateKey: undefined, time: undefined })),
    ];
  }
  if (!dados.time) return pedirHora(fone, dados);
  return verificarEConfirmar(fone, dados);
}

async function pedirServico(
  fone: string,
  dados: Dados,
  opts: { apenas?: number[] } = {}
): Promise<SaidaBot[]> {
  const settings = await getSettings();
  if (!settings.acceptingBookings) {
    return [
      texto_(
        fone,
        "A agenda online está pausada no momento. Me manda uma mensagem que a gente resolve na mão 🙂"
      ),
    ];
  }

  const servicos = await listServices();
  if (servicos.length === 0) {
    return [texto_(fone, "O catálogo está vazio no momento.")];
  }
  await salvarSessao(fone, "servico", { ...dados, serviceIds: undefined });

  // "corte" com dois cortes no catálogo: mostra só os dois, e deixa o
  // caminho para a lista inteira.
  const filtro = opts.apenas?.length ? new Set(opts.apenas) : null;
  const mostrar = filtro ? servicos.filter((s) => filtro.has(s.id)) : servicos;
  const linhas = mostrar.slice(0, filtro ? 9 : 10).map((s) => ({
    id: `svc:${s.id}`,
    titulo: s.name,
    descricao: `${formatBRL(s.priceCents)} · ${formatDuration(s.durationMin)}`,
  }));
  if (filtro) {
    linhas.push({ id: "menu:agendar", titulo: "Ver todos os serviços", descricao: "O catálogo inteiro" });
  }

  return [
    msg(fone, {
      tipo: "lista",
      corpo: filtro ? "Qual deles?" : "Qual serviço você quer marcar?",
      rodape: "Depois a gente escolhe o dia e a hora",
      botao: "Ver serviços",
      secoes: [{ linhas }],
    }),
  ];
}

async function pedirDia(fone: string, dados: Dados): Promise<SaidaBot[]> {
  const settings = await getSettings();
  const dias = listOpenDays(settings, 9);
  if (dias.length === 0) {
    return [texto_(fone, "Não achei dias abertos por aqui. Me chama que a gente resolve.")];
  }
  await salvarSessao(fone, "dia", dados);

  const hoje = shopToday();
  const nome = await nomeDoServico(dados.serviceIds);
  return [
    msg(fone, {
      tipo: "lista",
      corpo: `${nome} 👌 Para que dia?`,
      rodape: "Ou digite a data, ex.: 10/10",
      botao: "Ver dias",
      secoes: [
        {
          linhas: dias.map((d) => ({
            id: `day:${d.dateKey}`,
            titulo: tituloDoDia(d.dateKey, hoje),
            descricao:
              d.dateKey === hoje || d.dateKey === addDays(hoje, 1)
                ? diaDaSemana(d.dateKey)
                : undefined,
          })),
        },
      ],
    }),
  ];
}

async function pedirHora(
  fone: string,
  dados: Dados,
  opts: { aPartirDe?: string } = {}
): Promise<SaidaBot[]> {
  if (!dados.serviceIds?.length) return pedirServico(fone, dados);
  if (!dados.dateKey) return pedirDia(fone, dados);

  const { livres, closed, motivo, duracao } = await horariosLivres(dados);
  if (closed || livres.length === 0) {
    const porque = closed
      ? motivo === "sem-equipe"
        ? "Não temos ninguém atendendo nesse dia."
        : "A barbearia não abre nesse dia."
      : "Esse dia já lotou.";
    return [
      texto_(fone, `${porque} Escolhe outro dia 👇`),
      ...(await pedirDia(fone, { ...dados, dateKey: undefined, time: undefined })),
    ];
  }

  let offset = Math.min(Math.max(dados.offset ?? 0, 0), Math.max(livres.length - 1, 0));
  if (opts.aPartirDe) {
    const i = livres.findIndex((t) => t >= opts.aPartirDe!);
    offset = i >= 0 ? i : Math.max(livres.length - HORARIOS_POR_PAGINA, 0);
  }
  const pagina = livres.slice(offset, offset + HORARIOS_POR_PAGINA);
  const temMais = livres.length > offset + HORARIOS_POR_PAGINA;
  await salvarSessao(fone, "hora", { ...dados, time: undefined, offset });

  const linhas = pagina.map((t) => ({ id: `time:${t}`, titulo: t, descricao: periodoDe(t) }));
  if (temMais) {
    linhas.push({
      id: `mais:${offset + HORARIOS_POR_PAGINA}`,
      titulo: "Ver mais horários",
      descricao: `Mais ${livres.length - offset - HORARIOS_POR_PAGINA} no dia`,
    });
  } else if (offset > 0) {
    linhas.push({ id: "mais:0", titulo: "Voltar ao começo", descricao: "Os primeiros do dia" });
  }

  return [
    msg(fone, {
      tipo: "lista",
      corpo: `${primeiraMaiuscula(labelFullDate(dados.dateKey))} — estes horários estão livres:`,
      rodape: `${formatDuration(duracao)} de atendimento · ou digite a hora, ex.: 15h`,
      botao: "Ver horários",
      secoes: [{ linhas }],
    }),
  ];
}

/** Hora digitada (ou vinda do Gemini): confere na agenda antes de oferecer. */
async function verificarEConfirmar(fone: string, dados: Dados): Promise<SaidaBot[]> {
  const { livres } = await horariosLivres(dados);
  if (!livres.includes(dados.time!)) return horaIndisponivel(fone, dados, dados.time!, livres);

  await salvarSessao(fone, "confirmar", dados);
  const nome = await nomeDoServico(dados.serviceIds);
  return [
    msg(fone, {
      tipo: "botoes",
      corpo: [
        "Fechado assim?",
        "",
        `✂️ ${nome}`,
        `📅 ${primeiraMaiuscula(labelFullDate(dados.dateKey!))}`,
        `🕒 ${dados.time}`,
      ].join("\n"),
      botoes: [
        { id: "confirmar:sim", titulo: "Confirmar" },
        { id: "confirmar:outro", titulo: "Outro horário" },
      ],
    }),
  ];
}

async function horaIndisponivel(
  fone: string,
  dados: Dados,
  hora: string,
  livres: string[]
): Promise<SaidaBot[]> {
  const semHora = { ...dados, time: undefined };
  if (livres.length === 0) return pedirHora(fone, semHora);
  // A página começa um horário antes do pedido, para mostrar o que tem
  // dos dois lados.
  const i = livres.findIndex((t) => t >= hora);
  const inicio = i < 0 ? livres[Math.max(livres.length - HORARIOS_POR_PAGINA, 0)] : livres[Math.max(i - 1, 0)];
  return [
    texto_(fone, `${hora} não está livre nesse dia 😕 Olha os mais perto:`),
    ...(await pedirHora(fone, semHora, { aPartirDe: inicio })),
  ];
}

async function confirmarOuPedirNome(fone: string, dados: Dados): Promise<SaidaBot[]> {
  const cliente = await db.query.users.findFirst({ where: eq(users.phone, fone) });
  const nome = cliente?.name?.trim();
  if (nome) return fecharAgendamento(fone, { ...dados, nome });

  await salvarSessao(fone, "nome", dados);
  return [
    texto_(fone, "Quase lá! Como é seu nome completo? (é só para eu deixar na agenda)"),
  ];
}

async function fecharAgendamento(fone: string, dados: Dados): Promise<SaidaBot[]> {
  if (!dados.serviceIds?.length || !dados.dateKey || !dados.time || !dados.nome) {
    return pedirServico(fone, {});
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
      texto_(
        fone,
        [
          `Tá marcado! ✂️`,
          `${primeiraMaiuscula(quando)}.`,
          valor,
          `Seu código: ${appt.code}`,
          "",
          "Se precisar remarcar ou cancelar, é só mandar *menu* por aqui.",
        ].join("\n")
      ),
    ];
  } catch (err) {
    const motivo =
      err instanceof BookingError
        ? err.message
        : "Não consegui fechar esse horário agora. Tenta de novo em instantes.";
    // Volta para a escolha do dia: o horário caiu, mas a conversa segue.
    return [
      texto_(fone, motivo),
      ...(await pedirDia(fone, { ...dados, dateKey: undefined, time: undefined })),
    ];
  }
}

async function meusHorarios(fone: string): Promise<SaidaBot[]> {
  const cliente = await db.query.users.findFirst({ where: eq(users.phone, fone) });
  const proximos = cliente ? await proximosDe(cliente.id) : [];
  if (proximos.length === 0) {
    return [texto_(fone, "Você não tem horário marcado. Manda *menu* para marcar um.")];
  }

  const hoje = shopToday();
  const linhas = proximos.slice(0, 9).map((a) => ({
    id: `cancelar:${a.id}`,
    titulo: `${tituloDoDia(utcToShopParts(a.startsAt).dateKey, hoje)} ${formatShopTime(a.startsAt)}`,
    descricao: `Código ${a.code}`,
  }));

  return [
    msg(fone, {
      tipo: "lista",
      corpo:
        proximos.length === 1
          ? "Esse é o seu horário marcado. Para cancelar, é só escolher:"
          : `Você tem ${proximos.length} horários marcados. Para cancelar um, é só escolher:`,
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
  const appt = Number.isFinite(id)
    ? await db.query.appointments.findFirst({ where: eq(appointments.id, id) })
    : undefined;
  if (!appt || normalizePhone(appt.clientPhone) !== fone) {
    return [texto_(fone, "Não achei esse horário no seu nome.")];
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
  const appt = Number.isFinite(id)
    ? await db.query.appointments.findFirst({ where: eq(appointments.id, id) })
    : undefined;
  // Confere o dono pelo telefone da conversa: o id vem de um botão, e
  // botão é coisa que se pode forjar.
  if (!appt || normalizePhone(appt.clientPhone) !== fone) {
    return [texto_(fone, "Não achei esse horário no seu nome.")];
  }
  if (appt.startsAt.getTime() - Date.now() < 2 * 3600_000) {
    return [
      texto_(
        fone,
        "Faltam menos de 2h para esse horário — não dá para cancelar por aqui. Me manda uma mensagem que a gente vê isso."
      ),
    ];
  }
  try {
    await transitionAppointment(appt.id, "CANCELADO");
  } catch {
    return [texto_(fone, "Não consegui cancelar agora. Tenta de novo.")];
  }
  return [texto_(fone, "Cancelado. Quando quiser marcar de novo, é só mandar *menu* 🙂")];
}

async function endereco(fone: string): Promise<SaidaBot[]> {
  const s = await getSettings();
  return [
    texto_(
      fone,
      [
        `*${s.shopName}* — ${s.shopUnit}`,
        s.shopAddress,
        s.shopHoursLabel,
        "",
        "Para marcar, manda *menu* 🙂",
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ];
}

// ─────────────────── Entendendo o que foi digitado ───────────────────

/** "dia 30", "amanhã", "18h", "sábado 15h" — sem IA, no meio da conversa. */
async function entenderDataEHora(
  fone: string,
  texto: string,
  sessao: Sessao | null
): Promise<SaidaBot[] | null> {
  if (!sessao?.dados.serviceIds?.length) return null;
  const dados = sessao.dados;
  const hoje = shopToday();

  if (sessao.etapa === "dia") {
    const dia = dataDigitada(texto, hoje, { numeroSolto: true });
    if (!dia) return null;
    const hora = horaDigitada(texto);
    return proximoPasso(fone, { ...dados, dateKey: dia, time: hora ?? undefined, offset: 0 });
  }

  if ((sessao.etapa === "hora" || sessao.etapa === "confirmar") && dados.dateKey) {
    const dia = dataDigitada(texto, hoje);
    const hora = horaDigitada(texto);
    if (dia && dia !== dados.dateKey) {
      return proximoPasso(fone, { ...dados, dateKey: dia, time: hora ?? undefined, offset: 0 });
    }
    if (!hora) return null;
    if (sessao.etapa === "confirmar") return verificarEConfirmar(fone, { ...dados, time: hora });
    // Na lista de horários, digitar a hora é o mesmo que escolher.
    const { livres } = await horariosLivres(dados);
    if (livres.includes(hora)) return confirmarOuPedirNome(fone, { ...dados, time: hora });
    return horaIndisponivel(fone, dados, hora, livres);
  }
  return null;
}

/** "quero marcar corte sábado 15h", "cancelar meu horário", "onde fica?" — sem IA. */
async function entenderPorPalavras(
  fone: string,
  texto: string,
  sessao: Sessao | null
): Promise<SaidaBot[] | null> {
  const intencao = intencaoPorPalavras(texto);
  if (intencao === "meus") return meusHorarios(fone);
  if (intencao === "endereco") return endereco(fone);

  const servicos = await listServices();
  let serviceIds = servicosCitados(texto, servicos);
  const parecidos = serviceIds.length ? [] : servicosParecidos(texto, servicos);
  if (parecidos.length === 1) serviceIds = parecidos;
  const hoje = shopToday();
  const dia = dataDigitada(texto, hoje);
  const hora = horaDigitada(texto);
  if (intencao !== "agendar" && !serviceIds.length && !parecidos.length && !dia && !hora) {
    return null;
  }

  const antes = sessao?.dados ?? {};
  const dados: Dados = {
    serviceIds: serviceIds.length ? serviceIds : antes.serviceIds,
    dateKey: dia ?? antes.dateKey,
    time: hora ?? undefined,
    offset: 0,
  };
  // Mais de um serviço com a palavra: pergunta qual, guardando dia e hora.
  if (!serviceIds.length && parecidos.length > 1) {
    return pedirServico(fone, { ...dados, serviceIds: undefined }, { apenas: parecidos });
  }
  return proximoPasso(fone, dados);
}

/** Frase inteira: pergunta ao Gemini — e confere tudo o que ele disser. */
async function entenderComIa(
  fone: string,
  texto: string,
  sessao: Sessao | null,
  nomeDoPerfil?: string | null
): Promise<SaidaBot[] | null> {
  if (!iaConfigurada() || !/\p{L}{2,}/u.test(texto)) return null;

  const doDia = await hitRateLimit("ia:dia", IA_TETO_DIA, 24 * 3600_000);
  if (!doDia.ok) return null;
  const doNumero = await hitRateLimit(`ia:${fone}`, IA_TETO_POR_NUMERO_HORA, 3600_000);
  if (!doNumero.ok) return null;

  const hoje = shopToday();
  const servicos = await listServices();
  const calendario = Array.from({ length: 21 }, (_, i) => {
    const dateKey = addDays(hoje, i);
    return { dateKey, semana: diaDaSemana(dateKey) };
  });
  const r = await interpretar(texto, {
    hoje,
    calendario,
    servicos: servicos.map((s) => ({ id: s.id, nome: s.name })),
    etapa: sessao?.etapa ?? "menu",
  });
  if (!r) return null;

  switch (r.intencao) {
    case "meus_horarios":
    case "cancelar":
      return meusHorarios(fone);
    case "endereco":
      return endereco(fone);
    case "saudacao":
      return menuInicial(fone, nomeDoPerfil);
    case "agendar": {
      const antes = sessao?.dados ?? {};
      const dados: Dados = {
        serviceIds: r.servicoIds.length ? r.servicoIds : antes.serviceIds,
        dateKey: r.dateKey ?? antes.dateKey,
        time: r.hora ?? undefined,
        offset: 0,
      };
      if (!r.hora && r.periodo && dados.serviceIds?.length && dados.dateKey) {
        if (!(await diaAberto(dados.dateKey))) return proximoPasso(fone, dados);
        const inicio = { manha: "00:00", tarde: "12:00", noite: "18:00" }[r.periodo];
        return pedirHora(fone, dados, { aPartirDe: inicio });
      }
      return proximoPasso(fone, dados);
    }
    default:
      return null;
  }
}

// ───────────────────────── Apoio ─────────────────────────

function msg(para: string, mensagem: MensagemSaida): SaidaBot {
  return { para, mensagem };
}

function texto_(para: string, texto: string, opts: { mantemOpcoes?: boolean } = {}): SaidaBot {
  return { para, mensagem: { tipo: "texto", texto }, ...(opts.mantemOpcoes ? { mantemOpcoes: true } : {}) };
}

async function horariosLivres(dados: Dados) {
  const servicos = await listServices();
  const duracao = servicos
    .filter((s) => dados.serviceIds!.includes(s.id))
    .reduce((a, s) => a + s.durationMin, 0);
  const { slots, closed, motivo } = await getAvailability({
    dateKey: dados.dateKey!,
    durationMin: Math.max(duracao, 1),
    barberId: null,
  });
  return {
    livres: slots.filter((s) => s.available).map((s) => s.time),
    closed,
    motivo,
    duracao,
  };
}

/** Dentro do limite de dias e num dia da semana em que a barbearia abre. */
async function diaAberto(dateKey: string) {
  const settings = await getSettings();
  return listOpenDays(settings, 400).some((d) => d.dateKey === dateKey);
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

// ───────────────────────── Sessão ─────────────────────────

async function carregarSessao(fone: string): Promise<Sessao | null> {
  const linha = await db.query.whatsappSessions.findFirst({
    where: eq(whatsappSessions.phone, fone),
  });
  if (!linha) return null;
  const agora = Date.now();
  const pausado = Boolean(linha.pausadoAte && linha.pausadoAte.getTime() > agora);
  // Conversa velha não vale: quem volta no dia seguinte começa do menu,
  // e não de um "qual seu nome?" perdido no tempo.
  if (!pausado && agora - linha.updatedAt.getTime() > VALIDADE_SESSAO_MS) {
    await limparSessao(fone);
    return null;
  }
  return {
    etapa: linha.etapa as Etapa,
    dados: (linha.dados ?? {}) as Dados,
    opcoes: linha.opcoes ?? [],
    pausado,
  };
}

async function salvarSessao(fone: string, etapa: Etapa, dados: Dados) {
  const agora = new Date();
  await db
    .insert(whatsappSessions)
    .values({ phone: fone, etapa, dados, updatedAt: agora })
    .onDuplicateKeyUpdate({ set: { etapa, dados, pausadoAte: null, updatedAt: agora } });
}

/** Guarda as opções da última pergunta, na ordem em que foram numeradas. */
async function registrarOpcoes(fone: string, saidas: SaidaBot[]) {
  if (saidas.length && saidas.every((s) => s.mantemOpcoes)) {
    // Só renova o relógio: a pergunta de antes segue valendo.
    await db
      .update(whatsappSessions)
      .set({ updatedAt: new Date() })
      .where(eq(whatsappSessions.phone, fone));
    return;
  }
  const ultima = [...saidas].reverse().find((s) => s.mensagem.tipo !== "texto");
  const opcoes = ultima ? opcoesDe(ultima.mensagem) : [];
  if (opcoes.length) {
    const agora = new Date();
    await db
      .insert(whatsappSessions)
      .values({ phone: fone, etapa: "menu", dados: {}, opcoes, updatedAt: agora })
      .onDuplicateKeyUpdate({ set: { opcoes, updatedAt: agora } });
  } else {
    await db
      .update(whatsappSessions)
      .set({ opcoes: null })
      .where(eq(whatsappSessions.phone, fone));
  }
}

async function limparSessao(fone: string) {
  await db.delete(whatsappSessions).where(eq(whatsappSessions.phone, fone));
}

/**
 * Alguém da barbearia respondeu pelo celular: o atendente se cala nessa
 * conversa para não falar por cima de gente.
 */
export async function pausarAtendente(fone: string, agora = new Date()) {
  const ms = pausaHumanoMs();
  if (ms <= 0) return null;
  const ate = new Date(agora.getTime() + ms);
  await db
    .insert(whatsappSessions)
    .values({ phone: fone, etapa: "menu", dados: {}, pausadoAte: ate, updatedAt: agora })
    .onDuplicateKeyUpdate({
      set: { etapa: "menu", dados: {}, opcoes: null, pausadoAte: ate, updatedAt: agora },
    });
  return ate;
}

/** Devolve a conversa ao atendente antes da hora (botão do painel). */
export async function retomarAtendente(fone: string) {
  await db
    .update(whatsappSessions)
    .set({ pausadoAte: null, updatedAt: new Date(0) })
    .where(eq(whatsappSessions.phone, normalizePhone(fone)));
}

/** Conversas em que alguém da barbearia assumiu, para o painel. */
export async function conversasPausadas(agora = new Date()) {
  return db
    .select({ phone: whatsappSessions.phone, ate: whatsappSessions.pausadoAte })
    .from(whatsappSessions)
    .where(gt(whatsappSessions.pausadoAte, agora))
    .orderBy(asc(whatsappSessions.pausadoAte))
    .limit(50);
}

/** Varre as conversas esquecidas (roda junto do despacho). */
export async function limparSessoesVelhas(agora = new Date()) {
  const [res] = await db
    .delete(whatsappSessions)
    .where(
      and(
        lt(whatsappSessions.updatedAt, new Date(agora.getTime() - VALIDADE_SESSAO_MS)),
        or(isNull(whatsappSessions.pausadoAte), lt(whatsappSessions.pausadoAte, agora))
      )
    );
  return res.affectedRows;
}
