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
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
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
  horariosFixos: MaterializeReport;
  assinaturasExpiradas: number;
};

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
