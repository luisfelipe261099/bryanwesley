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
import { sendWhatsapp, isWhatsappConfigured } from "./providers/whatsapp";
import { materializeRecurring, type MaterializeReport } from "./recurring";
import { expireOverdueSubscriptions } from "./subscriptions";

/** Intervalo mínimo entre varreduras disparadas pelo painel. */
export const HEARTBEAT_INTERVAL_MS = 10 * 60_000;

/** Intervalo mínimo entre varreduras do cron/agendador externo. */
export const CRON_INTERVAL_MS = 60_000;

export type DispatchReport = {
  configurado: boolean;
  enviadas: number;
  falhas: number;
  pendentes: number;
  descartadas: number;
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

  // Lembrete de 2h com mais de 90 min de atraso: o cliente já chegou (ou já foi).
  await vencer(["LEMBRETE_2H"], new Date(now.getTime() - 90 * 60_000), "Vencida: lembrete de 2h atrasado demais");
  // Lembrete de 24h com mais de 12h de atraso: o de 2h cobre o que resta.
  await vencer(["LEMBRETE_24H"], new Date(now.getTime() - 12 * 3600_000), "Vencida: lembrete de 24h atrasado demais");

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

  const fila = await pendingNotifications(limit);
  const configurado = isWhatsappConfigured();

  let enviadas = 0;
  let falhas = 0;
  if (configurado) {
    for (const n of fila) {
      const res = await sendWhatsapp(n.phone, n.body);
      if (res.sent) {
        await markSent(n.id);
        enviadas++;
      } else {
        await markFailed(n.id, res.reason, res.retryable ? n.attempts : 99);
        falhas++;
      }
    }
  }
  // Sem provedor as mensagens seguem na fila, sem consumir tentativa.

  return {
    configurado,
    enviadas,
    falhas,
    pendentes: configurado ? fila.length - enviadas : fila.length,
    descartadas,
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
