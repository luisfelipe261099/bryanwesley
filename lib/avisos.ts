// ───────────────────────────────────────────────────────────
// Quem recebe aviso no celular, e com que palavras.
//
// A equipe (admin e o barbeiro do horário) é avisada do que muda na
// agenda; o cliente, do que muda no horário dele; o admin, do que pede
// atenção (pedido de plano, pagamento, WhatsApp caído). Quem causou a
// mudança não é avisado dela — o admin que marcou o horário não precisa
// de um aviso dizendo que marcou.
//
// Nada aqui lança: o aviso é um extra, e o agendamento já está gravado
// quando chega aqui. Tudo que precisa do banco fica dentro do try.
// ───────────────────────────────────────────────────────────
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointmentServices, appointments, barbers, plans, users } from "@/db/schema";
import { enviarPush, ZERO, type ResultadoPush } from "./push";
import { formatShopTime, labelDayMonth, labelWeekday, utcToShopParts } from "./time";
import { hitRateLimit } from "./rate-limit";
import { estadoDaPonte } from "./ponte";

type Appt = typeof appointments.$inferSelect;

/**
 * O aviso sai dentro da ação de quem agendou (a função da Vercel tem
 * poucos segundos): um serviço de push pendurado não pode levar o
 * agendamento junto. Na prática eles respondem em menos de um segundo.
 */
const PRAZO_NA_ACAO_MS = 2_500;

/** "sáb 10 de out às 14:00" — curto, cabe na notificação. */
export function quandoCurto(d: Date) {
  const { dateKey } = utcToShopParts(d);
  return `${labelWeekday(dateKey)} ${labelDayMonth(dateKey)} às ${formatShopTime(d)}`;
}

/** Horário que já passou há mais de 1h: mexer nele é arrumação, não novidade. */
function jaPassou(appt: Appt, agora = Date.now()) {
  return appt.startsAt.getTime() < agora - 3600_000;
}

/** Contas de administrador ativas. */
export async function idsDosAdmins() {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
  return rows.map((r) => r.id);
}

/** A conta e o nome curto do barbeiro, para avisá-lo da própria agenda. */
async function barbeiro(barberId: number) {
  const row = await db.query.barbers.findFirst({
    columns: { userId: true, shortName: true },
    where: eq(barbers.id, barberId),
  });
  return row ?? null;
}

async function servicosDo(appointmentId: number) {
  const rows = await db
    .select({ name: appointmentServices.name })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, appointmentId));
  return rows.map((r) => r.name).join(" + ");
}

function soma(...rs: ResultadoPush[]): ResultadoPush {
  return rs.reduce(
    (a, b) => ({
      enviadas: a.enviadas + b.enviadas,
      falhas: a.falhas + b.falhas,
      removidas: a.removidas + b.removidas,
      aparelhos: a.aparelhos + b.aparelhos,
    }),
    { ...ZERO }
  );
}

export type EventoDaAgenda = "criado" | "cancelado" | "remarcado";

const TITULO_EQUIPE: Record<EventoDaAgenda, string> = {
  criado: "Novo agendamento",
  cancelado: "Horário cancelado",
  remarcado: "Horário remarcado",
};

/**
 * Avisos à equipe por cliente, por hora, quando a mudança vem do próprio
 * cliente. Marcar e desmarcar em loop (um script, ou alguém de birra)
 * não pode virar uma rajada no celular do barbeiro: passou do teto, a
 * agenda muda e o aviso fica de fora. O balcão (admin, barbeiro) não
 * entra na conta — o pai que marca os quatro filhos no mesmo WhatsApp
 * é atendimento, não abuso — e cancelamento sempre avisa.
 */
export const TETO_AVISOS_POR_CLIENTE_HORA = 6;

export type ContextoDaEquipe = {
  autorUserId?: number | null;
  barberName?: string | null;
  /**
   * Agendamento cuja notificação este aviso substitui no aparelho. Na
   * remarcação é o id antigo: o "Novo agendamento" de antes sai da barra
   * e entra o "Horário remarcado", em vez de os dois ficarem lá parecendo
   * dois horários.
   */
  substituiId?: number;
  /** Remarcação que trocou de barbeiro: o antigo também fica sabendo. */
  barbeiroAnteriorId?: number | null;
};

/**
 * Mudou a agenda: avisa os admins e o barbeiro do horário. O admin abre
 * a agenda do dia; o barbeiro, a dele. Quem fez a mudança fica de fora.
 */
export async function avisarEquipe(
  evento: EventoDaAgenda,
  appt: Appt,
  ctx: ContextoDaEquipe = {}
): Promise<ResultadoPush> {
  try {
    if (evento === "cancelado" && jaPassou(appt)) return { ...ZERO };
    const [admins, barb, servicos] = await Promise.all([
      idsDosAdmins(),
      barbeiro(appt.barberId),
      servicosDo(appt.id),
    ]);
    const daCasa =
      ctx.autorUserId != null &&
      (admins.includes(ctx.autorUserId) || ctx.autorUserId === barb?.userId);
    if (evento !== "cancelado" && !daCasa) {
      const freio = await hitRateLimit(
        `push:equipe:${appt.clientPhone}`,
        TETO_AVISOS_POR_CLIENTE_HORA,
        3600_000
      );
      if (!freio.ok) return { ...ZERO };
    }

    const barberName = ctx.barberName ?? barb?.shortName ?? null;
    const { dateKey } = utcToShopParts(appt.startsAt);
    const partes = [appt.clientName, servicos, quandoCurto(appt.startsAt)];
    if (barberName) partes.push(`com ${barberName}`);
    const aviso = {
      titulo: TITULO_EQUIPE[evento],
      corpo: partes.filter(Boolean).join(" · "),
      tag: `agendamento-${ctx.substituiId ?? appt.id}`,
    };
    const opcoes = { excluir: [ctx.autorUserId], prazoMs: PRAZO_NA_ACAO_MS };

    // O barbeiro que também é admin recebe uma vez só, a versão do admin.
    const barbeiroUserId = barb?.userId ?? null;
    const soBarbeiro =
      barbeiroUserId !== null && !admins.includes(barbeiroUserId) ? [barbeiroUserId] : [];
    const envios = [
      enviarPush(admins, { ...aviso, url: `/admin/agenda?dia=${dateKey}` }, opcoes),
      enviarPush(soBarbeiro, { ...aviso, url: `/barbeiro?dia=${dateKey}` }, opcoes),
    ];

    // Remarcou para outro profissional: o barbeiro antigo perde o horário
    // da agenda e precisa saber — senão segura a cadeira para alguém que
    // vai cortar com o colega.
    if (
      evento === "remarcado" &&
      ctx.barbeiroAnteriorId != null &&
      ctx.barbeiroAnteriorId !== appt.barberId
    ) {
      const antigo = await barbeiro(ctx.barbeiroAnteriorId);
      if (antigo && !admins.includes(antigo.userId)) {
        envios.push(
          enviarPush(
            [antigo.userId],
            {
              titulo: "Horário saiu da sua agenda",
              corpo: `${appt.clientName} remarcou para ${quandoCurto(appt.startsAt)}${
                barberName ? ` com ${barberName}` : ""
              }.`,
              url: `/barbeiro?dia=${dateKey}`,
              tag: aviso.tag,
            },
            opcoes
          )
        );
      }
    }
    return soma(...(await Promise.all(envios)));
  } catch (e) {
    console.error("Aviso à equipe falhou:", e);
    return { ...ZERO };
  }
}

export type EventoDoCliente = "AGENDAMENTO_CRIADO" | "AGENDAMENTO_CANCELADO" | "AGENDAMENTO_REMARCADO";

/**
 * Mudou o horário do cliente: avisa no aparelho dele, se ele ligou os
 * avisos. O WhatsApp continua saindo pela fila — isto é o imediato.
 */
export async function avisarCliente(
  evento: EventoDoCliente,
  appt: Appt,
  ctx: { autorUserId?: number | null; barberName?: string | null; substituiId?: number } = {}
): Promise<ResultadoPush> {
  if (!appt.clientUserId || appt.clientUserId === ctx.autorUserId) return { ...ZERO };
  // A fila do WhatsApp descarta aviso de horário que já passou; o push
  // segue a mesma régua — o admin arrumando a agenda de ontem não manda
  // "é só reagendar" para quem já foi atendido.
  if (jaPassou(appt)) return { ...ZERO };
  try {
    const barberName = ctx.barberName ?? (await barbeiro(appt.barberId))?.shortName ?? null;
    const quando = quandoCurto(appt.startsAt);
    const comQuem = barberName ? ` com ${barberName}` : "";
    const aviso =
      evento === "AGENDAMENTO_CANCELADO"
        ? {
            titulo: "Horário cancelado",
            corpo: `Seu horário de ${quando} foi cancelado. Quando quiser, é só reagendar.`,
          }
        : {
            titulo: evento === "AGENDAMENTO_CRIADO" ? "Horário confirmado" : "Horário remarcado",
            corpo: `${quando}${comQuem} · Código ${appt.code}`,
          };
    return await enviarPush(
      [appt.clientUserId],
      { ...aviso, url: "/cliente", tag: `agendamento-${ctx.substituiId ?? appt.id}` },
      { prazoMs: PRAZO_NA_ACAO_MS }
    );
  } catch (e) {
    console.error("Aviso ao cliente falhou:", e);
    return { ...ZERO };
  }
}

/** Nomes de cliente e plano para montar os avisos de assinatura. */
async function nomes(userId: number, planId: number) {
  const [u, p] = await Promise.all([
    db.query.users.findFirst({ columns: { name: true }, where: eq(users.id, userId) }),
    db.query.plans.findFirst({ columns: { name: true }, where: eq(plans.id, planId) }),
  ]);
  return { nomeCliente: u?.name ?? "Cliente", nomePlano: p?.name ?? "plano" };
}

/** O cliente pediu um plano pelo site e a cobrança é no balcão. */
export async function avisarPedidoDePlano(p: {
  userId: number;
  nomeCliente: string;
  nomePlano: string;
  ciclo: "MENSAL" | "ANUAL";
}): Promise<ResultadoPush> {
  try {
    return await enviarPush(
      await idsDosAdmins(),
      {
        titulo: "Pedido de plano",
        corpo: `${p.nomeCliente} quer o ${p.nomePlano} (${p.ciclo === "ANUAL" ? "anual" : "mensal"}). Ative no painel.`,
        url: "/admin",
        // Por cliente: o pedido da Maria não some quando o João pede depois.
        tag: `pedido-de-plano-${p.userId}`,
      },
      { prazoMs: PRAZO_NA_ACAO_MS }
    );
  } catch (e) {
    console.error("Aviso de pedido de plano falhou:", e);
    return { ...ZERO };
  }
}

/** Pagamento online confirmado: o admin fica sabendo e o cliente também. */
export async function avisarPagamento(p: { userId: number; planId: number }): Promise<ResultadoPush> {
  try {
    const { nomeCliente, nomePlano } = await nomes(p.userId, p.planId);
    const [a, b] = await Promise.all([
      enviarPush(
        await idsDosAdmins(),
        {
          titulo: "Pagamento recebido",
          corpo: `${nomeCliente} pagou o ${nomePlano}. Plano ativo.`,
          url: "/admin/clube",
        },
        { prazoMs: PRAZO_NA_ACAO_MS }
      ),
      enviarPush(
        [p.userId],
        {
          titulo: "Plano ativo",
          corpo: `Pagamento confirmado: seu ${nomePlano} já vale. Bom corte!`,
          url: "/cliente",
        },
        { prazoMs: PRAZO_NA_ACAO_MS }
      ),
    ]);
    return soma(a, b);
  } catch (e) {
    console.error("Aviso de pagamento falhou:", e);
    return { ...ZERO };
  }
}

/** O admin ativou (ou renovou) o plano do cliente pelo painel. */
export async function avisarPlanoAtivado(p: {
  userId: number;
  planId: number;
  renovacao?: boolean;
}): Promise<ResultadoPush> {
  try {
    const { nomePlano } = await nomes(p.userId, p.planId);
    return await enviarPush(
      [p.userId],
      {
        titulo: p.renovacao ? "Plano renovado" : "Plano ativo",
        corpo: p.renovacao
          ? `Sua assinatura do ${nomePlano} foi renovada. Bom corte!`
          : `Seu ${nomePlano} está ativo. Bom corte!`,
        url: "/cliente",
      },
      { prazoMs: PRAZO_NA_ACAO_MS }
    );
  } catch (e) {
    console.error("Aviso de plano ativado falhou:", e);
    return { ...ZERO };
  }
}

/** Silêncio da ponte que vira alerta — mais folgado que o do painel. */
export const PONTE_ALERTA_MS = 15 * 60_000;

/** "há 2 h", "há 40 min" — com piso, para o "há mais de" não exagerar. */
function haPeloMenos(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} dia${d === 1 ? "" : "s"}`;
}

/** Um alerta de WhatsApp a cada 12 h, seja qual for o motivo. */
async function alertarAdmins(corpo: string, agora: Date) {
  const vez = await hitRateLimit("push:whatsapp-caido", 1, 12 * 3600_000, agora);
  if (!vez.ok) return { ...ZERO };
  return enviarPush(await idsDosAdmins(), {
    titulo: "WhatsApp fora do ar",
    corpo,
    url: "/admin/notificacoes",
    tag: "whatsapp-caido",
  });
}

/**
 * O WhatsApp instalado pela ponte parou: o servidor sumiu, ou o número
 * desconectou e precisa do QR de novo. Avisa os admins uma vez a cada
 * 12 horas — a varredura roda a toda hora, e o problema costuma durar.
 *
 * Ponte desligada pelo painel (sem segredo), outro provedor escolhido
 * por WHATSAPP_PROVIDER, instalação em andamento ou número que nunca
 * chegou a conectar não são "caído" — são o caminho normal.
 */
export async function alertarWhatsappCaido(agora = new Date()): Promise<ResultadoPush> {
  try {
    if (process.env.WHATSAPP_PROVIDER) return { ...ZERO };
    const ponte = await estadoDaPonte();
    if (!ponte?.segredoHash || !ponte.pareadaEm || !ponte.vistoEm) return { ...ZERO };
    const semSinal = agora.getTime() - ponte.vistoEm.getTime() > PONTE_ALERTA_MS;
    // "Desconectou" só vale para quem já esteve conectado: enquanto a
    // ponte está nascendo, o QR na tela é o esperado.
    const desconectado =
      !semSinal &&
      ponte.status !== null &&
      !["WORKING", "STARTING", "INSTALANDO"].includes(ponte.status) &&
      agora.getTime() - ponte.pareadaEm.getTime() > 2 * 3600_000;
    if (!semSinal && !desconectado) return { ...ZERO };

    return await alertarAdmins(
      semSinal
        ? `O servidor do WhatsApp não dá sinal há mais de ${haPeloMenos(
            agora.getTime() - ponte.vistoEm.getTime()
          )}. As mensagens ficam na fila.`
        : "O número desconectou. Abra Mensagens e leia o QR code de novo.",
      agora
    );
  } catch (e) {
    console.error("Alerta do WhatsApp falhou:", e);
    return { ...ZERO };
  }
}

/** WAHA próprio (WAHA_URL) com a sessão fora do ar: mesmo alerta, mesma cadência. */
export async function alertarWahaDesconectado(agora = new Date()): Promise<ResultadoPush> {
  try {
    return await alertarAdmins(
      "O número do WhatsApp desconectou do servidor. Abra Mensagens e conecte de novo.",
      agora
    );
  } catch (e) {
    console.error("Alerta do WhatsApp falhou:", e);
    return { ...ZERO };
  }
}
