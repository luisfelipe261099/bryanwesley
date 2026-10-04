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
// quando chega aqui.
// ───────────────────────────────────────────────────────────
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointmentServices, appointments, barbers, plans, users } from "@/db/schema";
import { enviarPush, ZERO, type ResultadoPush } from "./push";
import { formatShopTime, labelDayMonth, labelWeekday, utcToShopParts, labelAgo } from "./time";
import { hitRateLimit } from "./rate-limit";
import { estadoDaPonte } from "./ponte";

type Appt = typeof appointments.$inferSelect;

/** "sex 10/10 às 14:00" — curto, cabe na notificação. */
export function quandoCurto(d: Date) {
  const { dateKey } = utcToShopParts(d);
  return `${labelWeekday(dateKey)} ${labelDayMonth(dateKey)} às ${formatShopTime(d)}`;
}

/** Contas de administrador ativas. */
export async function idsDosAdmins() {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
  return rows.map((r) => r.id);
}

/** A conta do barbeiro, para avisá-lo da própria agenda. */
async function idDoBarbeiro(barberId: number) {
  const row = await db.query.barbers.findFirst({
    columns: { userId: true },
    where: eq(barbers.id, barberId),
  });
  return row?.userId ?? null;
}

async function nomeDoBarbeiro(barberId: number) {
  const row = await db.query.barbers.findFirst({
    columns: { shortName: true },
    where: eq(barbers.id, barberId),
  });
  return row?.shortName ?? null;
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

/**
 * Avisos à equipe por cliente, por hora. Marcar e desmarcar em loop
 * (um script, ou alguém de birra) não pode virar uma rajada no celular
 * do barbeiro: passou do teto, a agenda muda e o aviso fica de fora.
 */
export const TETO_AVISOS_POR_CLIENTE_HORA = 6;

const TITULO_EQUIPE: Record<EventoDaAgenda, string> = {
  criado: "Novo agendamento",
  cancelado: "Horário cancelado",
  remarcado: "Horário remarcado",
};

/**
 * Mudou a agenda: avisa os admins e o barbeiro do horário. O admin abre
 * a agenda do dia; o barbeiro, a dele. Quem fez a mudança fica de fora.
 */
export async function avisarEquipe(
  evento: EventoDaAgenda,
  appt: Appt,
  ctx: { autorUserId?: number | null; barberName?: string | null } = {}
): Promise<ResultadoPush> {
  try {
    const freio = await hitRateLimit(`push:equipe:${appt.clientPhone}`, TETO_AVISOS_POR_CLIENTE_HORA, 3600_000);
    if (!freio.ok) return { ...ZERO };
    const [admins, barbeiroUserId, barberName, servicos] = await Promise.all([
      idsDosAdmins(),
      idDoBarbeiro(appt.barberId),
      ctx.barberName ? Promise.resolve(ctx.barberName) : nomeDoBarbeiro(appt.barberId),
      servicosDo(appt.id),
    ]);
    const { dateKey } = utcToShopParts(appt.startsAt);
    const partes = [appt.clientName, servicos, quandoCurto(appt.startsAt)];
    if (barberName) partes.push(`com ${barberName}`);
    const aviso = {
      titulo: TITULO_EQUIPE[evento],
      corpo: partes.filter(Boolean).join(" · "),
      tag: `agendamento-${appt.id}`,
    };

    // O barbeiro que também é admin recebe uma vez só, a versão do admin.
    const soBarbeiro =
      barbeiroUserId !== null && !admins.includes(barbeiroUserId) ? [barbeiroUserId] : [];
    const excluir = [ctx.autorUserId];
    const [a, b] = await Promise.all([
      enviarPush(admins, { ...aviso, url: `/admin/agenda?dia=${dateKey}` }, { excluir }),
      enviarPush(soBarbeiro, { ...aviso, url: `/barbeiro?dia=${dateKey}` }, { excluir }),
    ]);
    return soma(a, b);
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
  ctx: { autorUserId?: number | null; barberName?: string | null } = {}
): Promise<ResultadoPush> {
  if (!appt.clientUserId || appt.clientUserId === ctx.autorUserId) return { ...ZERO };
  try {
    const barberName = ctx.barberName ?? (await nomeDoBarbeiro(appt.barberId));
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
    return await enviarPush([appt.clientUserId], {
      ...aviso,
      url: "/cliente",
      tag: `agendamento-${appt.id}`,
    });
  } catch (e) {
    console.error("Aviso ao cliente falhou:", e);
    return { ...ZERO };
  }
}

/** O cliente pediu um plano pelo site e a cobrança é no balcão. */
export async function avisarPedidoDePlano(p: {
  nomeCliente: string;
  nomePlano: string;
  ciclo: "MENSAL" | "ANUAL";
}): Promise<ResultadoPush> {
  try {
    return await enviarPush(await idsDosAdmins(), {
      titulo: "Pedido de plano",
      corpo: `${p.nomeCliente} quer o ${p.nomePlano} (${p.ciclo === "ANUAL" ? "anual" : "mensal"}). Ative no painel.`,
      url: "/admin",
      tag: "pedido-de-plano",
    });
  } catch (e) {
    console.error("Aviso de pedido de plano falhou:", e);
    return { ...ZERO };
  }
}

/** Pagamento online confirmado: o admin fica sabendo e o cliente também. */
export async function avisarPagamento(p: {
  userId: number;
  nomeCliente: string;
  nomePlano: string;
}): Promise<ResultadoPush> {
  try {
    const [a, b] = await Promise.all([
      enviarPush(await idsDosAdmins(), {
        titulo: "Pagamento recebido",
        corpo: `${p.nomeCliente} pagou o ${p.nomePlano}. Plano ativo.`,
        url: "/admin/clube",
      }),
      enviarPush([p.userId], {
        titulo: "Plano ativo",
        corpo: `Pagamento confirmado: seu ${p.nomePlano} já vale. Bom corte!`,
        url: "/cliente",
      }),
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
  nomePlano: string;
  renovacao?: boolean;
}): Promise<ResultadoPush> {
  try {
    return await enviarPush([p.userId], {
      titulo: p.renovacao ? "Plano renovado" : "Plano ativo",
      corpo: p.renovacao
        ? `Sua assinatura do ${p.nomePlano} foi renovada. Bom corte!`
        : `Seu ${p.nomePlano} está ativo. Bom corte!`,
      url: "/cliente",
    });
  } catch (e) {
    console.error("Aviso de plano ativado falhou:", e);
    return { ...ZERO };
  }
}

/** Silêncio da ponte que vira alerta — mais folgado que o do painel. */
export const PONTE_ALERTA_MS = 15 * 60_000;

/**
 * O WhatsApp instalado pela ponte parou: o servidor sumiu, ou o número
 * desconectou e precisa do QR de novo. Avisa os admins uma vez a cada
 * 12 horas — a varredura roda a toda hora, e o problema costuma durar.
 */
export async function alertarWhatsappCaido(agora = new Date()): Promise<ResultadoPush> {
  try {
    const ponte = await estadoDaPonte();
    if (!ponte?.pareadaEm) return { ...ZERO };
    const visto = ponte.vistoEm ?? ponte.pareadaEm;
    const semSinal = agora.getTime() - visto.getTime() > PONTE_ALERTA_MS;
    const desconectado = !semSinal && ponte.status !== null && ponte.status !== "WORKING" && ponte.status !== "STARTING";
    if (!semSinal && !desconectado) return { ...ZERO };

    const vez = await hitRateLimit("push:whatsapp-caido", 1, 12 * 3600_000, agora);
    if (!vez.ok) return { ...ZERO };

    return await enviarPush(await idsDosAdmins(), {
      titulo: "WhatsApp fora do ar",
      corpo: semSinal
        ? `O servidor do WhatsApp não dá sinal ${labelAgo(visto, agora).replace("há", "há mais de")}. As mensagens ficam na fila.`
        : "O número desconectou. Abra Mensagens e leia o QR code de novo.",
      url: "/admin/notificacoes",
      tag: "whatsapp-caido",
    });
  } catch (e) {
    console.error("Alerta do WhatsApp falhou:", e);
    return { ...ZERO };
  }
}

/** Nomes de cliente e plano para montar os avisos de assinatura. */
export async function nomesParaAviso(userId: number, planId: number) {
  const [u, p] = await Promise.all([
    db.query.users.findFirst({ columns: { name: true }, where: eq(users.id, userId) }),
    db.query.plans.findFirst({ columns: { name: true }, where: eq(plans.id, planId) }),
  ]);
  return { nomeCliente: u?.name ?? "Cliente", nomePlano: p?.name ?? "plano" };
}
