// ───────────────────────────────────────────────────────────
// Varredura da fila: expira assinaturas vencidas, materializa os
// horários fixos e entrega as notificações que venceram.
//
// Quem chama: o cron da Vercel (diário, limite do plano Hobby), um
// agendador externo opcional e o heartbeat do painel da equipe — toda
// vez que alguém abre o /admin ou o /barbeiro. A barbearia abre o painel
// o dia inteiro, então os lembretes de 24h e 2h saem sem depender de
// nada de fora.
//
// Duas varreduras ao mesmo tempo mandariam a mesma mensagem duas vezes.
// A trava é um compare-and-swap em settings.last_dispatch_at: só quem
// conseguir avançar o carimbo executa; o resto pula.
// ───────────────────────────────────────────────────────────
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, settings } from "@/db/schema";
import { getSettings } from "./schedule";
import { pendingNotifications, markSent, markFailed } from "./notifications";
import { sendWhatsapp, isWhatsappConfigured, provedorAtivo } from "./providers/whatsapp";
import { wahaStatus } from "./providers/waha";
import { pontePareada } from "./ponte";
import { materializeRecurring, type MaterializeReport } from "./recurring";
import { expireOverdueSubscriptions } from "./subscriptions";
import { purgeRateLimits } from "./rate-limit";
import { limparSessoesVelhas } from "./whatsapp-bot";

/** Intervalo mínimo entre varreduras disparadas pelo painel. */
export const HEARTBEAT_INTERVAL_MS = 10 * 60_000;

/** Intervalo mínimo entre varreduras do cron/agendador externo. */
export const CRON_INTERVAL_MS = 60_000;

/**
 * Tempo máximo gasto entregando mensagens numa varredura. A rota tem
 * maxDuration de 60s; parar bem antes deixa margem para a última chamada
 * ao provedor terminar e para a resposta sair.
 */
export const DISPATCH_BUDGET_MS = 30_000;

export type DispatchReport = {
  configurado: boolean;
  /**
   * O WAHA está configurado, mas o número não está conectado (QR code
   * pendente, celular desligado): a fila espera, sem gastar tentativa.
   */
  desconectado?: boolean;
  /** Instalado pela ponte: o servidor da barbearia busca a fila sozinho. */
  ponte?: boolean;
  enviadas: number;
  falhas: number;
  pendentes: number;
  descartadas: number;
  /** A varredura parou no meio por tempo: o resto sai na próxima. */
  interrompida: boolean;
  horariosFixos: MaterializeReport;
  assinaturasExpiradas: number;
};

/** DATETIME(3) em UTC para SQL cru (o driver está em timezone "Z"). */
function sqlDate(d: Date) {
  return d.toISOString().slice(0, 23).replace("T", " ");
}

/**
 * Mensagem que perdeu o sentido não sai atrasada. Acontece quando ninguém
 * abre o painel por horas: um "seu horário é daqui a pouco" entregue depois
 * do corte só confunde. Cada regra marca como CANCELADA com o motivo.
 */
export async function discardStaleNotifications(now = new Date()): Promise<number> {
  let total = 0;
  const vencer = async (
    kinds: (typeof notifications.$inferSelect)["kind"][],
    antesDe: Date,
    motivo: string
  ) => {
    const [res] = await db
      .update(notifications)
      .set({ status: "CANCELADA", error: motivo })
      .where(
        and(
          eq(notifications.status, "PENDENTE"),
          inArray(notifications.kind, kinds),
          lt(notifications.scheduledFor, antesDe)
        )
      );
    total += res.affectedRows;
  };

  // Lembrete de 24h com mais de 12h de atraso: o de 2h cobre o que resta.
  await vencer(["LEMBRETE_24H"], new Date(now.getTime() - 12 * 3600_000), "Vencida: lembrete de 24h atrasado demais");

  // O lembrete de 2h vale até a hora do atendimento. A regra antiga o
  // matava com 90 minutos de atraso, e no plano Hobby a varredura do cron
  // roda uma vez por dia: o lembrete nunca ficava "na hora" e era
  // descartado sem nunca ter sido tentado. Atrasado ele ainda serve —
  // depois que o horário começa, não serve mais.
  const [resLembrete] = await db.execute(sql`
    UPDATE notifications n
    JOIN appointments a ON a.id = n.appointment_id
    SET n.status = 'CANCELADA', n.error = 'Vencida: o horário já começou'
    WHERE n.status = 'PENDENTE'
      AND n.kind = 'LEMBRETE_2H'
      AND a.starts_at < ${sqlDate(now)}
  `);
  total += Number((resLembrete as { affectedRows?: number }).affectedRows ?? 0);

  // Qualquer aviso de um horário que já começou há mais de 1h.
  const [res] = await db.execute(sql`
    UPDATE notifications n
    JOIN appointments a ON a.id = n.appointment_id
    SET n.status = 'CANCELADA', n.error = 'Vencida: o horário já passou'
    WHERE n.status = 'PENDENTE'
      AND n.kind IN ('AGENDAMENTO_CRIADO','AGENDAMENTO_REMARCADO','AGENDAMENTO_CANCELADO','LEMBRETE_24H','LEMBRETE_2H')
      AND a.starts_at < ${sqlDate(new Date(now.getTime() - 3600_000))}
  `);
  total += Number((res as { affectedRows?: number }).affectedRows ?? 0);
  return total;
}

/**
 * Tenta reservar a vez de varrer a fila. Devolve true para exatamente um
 * chamador a cada janela; os demais recebem false e não fazem nada.
 */
export async function claimDispatchSlot(
  minIntervalMs: number,
  now = new Date()
): Promise<boolean> {
  // Garante a linha única de configurações (primeiro acesso de um banco vazio).
  await getSettings();
  const limite = new Date(now.getTime() - minIntervalMs);
  const [res] = await db
    .update(settings)
    .set({ lastDispatchAt: now })
    .where(
      and(
        eq(settings.id, 1),
        or(isNull(settings.lastDispatchAt), lt(settings.lastDispatchAt, limite))
      )
    );
  return res.affectedRows === 1;
}

/** Varre a fila. Não trava: quem chama decide se deve rodar (claimDispatchSlot). */
export async function runDispatch(limit = 50): Promise<DispatchReport> {
  const assinaturasExpiradas = await expireOverdueSubscriptions();
  const descartadas = await discardStaleNotifications();

  // Horários fixos das próximas semanas entram antes da entrega, para que
  // os lembretes deles também saiam nesta rodada.
  const horariosFixos = await materializeRecurring();

  // Janelas de freio já vencidas não servem para nada e a tabela cresceria
  // para sempre.
  await purgeRateLimits(new Date(Date.now() - 24 * 3600_000));

  // Conversas do WhatsApp abandonadas no meio também não servem: quem
  // volta amanhã começa do menu, não de um "qual seu nome?" perdido.
  await limparSessoesVelhas();

  const fila = await pendingNotifications(limit);

  // Instalado pela ponte: quem entrega é o servidor da barbearia, que
  // busca a fila a cada sinal. Daqui não se manda nada.
  if (!process.env.WHATSAPP_PROVIDER && (await pontePareada())) {
    return {
      configurado: true,
      ponte: true,
      enviadas: 0,
      falhas: 0,
      pendentes: fila.length,
      descartadas,
      interrompida: false,
      horariosFixos,
      assinaturasExpiradas,
    };
  }

  let configurado = isWhatsappConfigured();
  let desconectado = false;
  // Com o número desconectado, o WAHA não recusa o envio: ele fica
  // pendurado até estourar o tempo. Cada mensagem gastaria 10s e uma
  // tentativa — em quatro varreduras, a fila inteira virava erro.
  if (configurado && fila.length > 0 && provedorAtivo() === "waha") {
    const { status } = await wahaStatus();
    if (status !== "WORKING") {
      configurado = false;
      desconectado = true;
    }
  }

  let enviadas = 0;
  let falhas = 0;
  let interrompida = false;
  if (configurado) {
    const limiteDeTempo = Date.now() + DISPATCH_BUDGET_MS;
    // No WAHA (número comum), rajada de mensagens é o que faz o WhatsApp
    // desconfiar de robô: entre uma e outra, uma pausa de gente.
    const intervalo = provedorAtivo() === "waha" ? () => 1500 + Math.random() * 2500 : null;
    let primeira = true;
    for (const n of fila) {
      // O envio é em série e cada chamada ao provedor pode demorar. Com a
      // fila cheia, a função estourava o tempo da Vercel e era morta no
      // meio de um envio — a mensagem saía e continuava PENDENTE, para
      // sair de novo na próxima varredura. Parando antes do corte, o que
      // sobrou fica para a rodada seguinte, inteiro.
      if (Date.now() > limiteDeTempo) {
        interrompida = true;
        break;
      }
      if (intervalo && !primeira) await new Promise((r) => setTimeout(r, intervalo()));
      primeira = false;
      const res = await sendWhatsapp(n.phone, n.body);
      if (res.sent) {
        await markSent(n.id);
        enviadas++;
      } else {
        await markFailed(n.id, res.reason, n.attempts, !res.retryable);
        falhas++;
      }
    }
  }
  // Sem provedor as mensagens seguem na fila, sem consumir tentativa.

  return {
    configurado,
    ...(desconectado ? { desconectado } : {}),
    enviadas,
    falhas,
    pendentes: configurado ? fila.length - enviadas : fila.length,
    descartadas,
    interrompida,
    horariosFixos,
    assinaturasExpiradas,
  };
}

/** Quando foi a última varredura, para o painel. */
export async function lastDispatchAt(): Promise<Date | null> {
  const [row] = await db
    .select({ at: settings.lastDispatchAt })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return row?.at ?? null;
}
