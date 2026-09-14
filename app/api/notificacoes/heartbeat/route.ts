import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  claimDispatchSlot,
  runDispatch,
  HEARTBEAT_INTERVAL_MS,
} from "@/lib/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Batida do painel da equipe.
 *
 * O <Heartbeat /> do /admin e do /barbeiro chama aqui ao abrir a tela e a
 * cada poucos minutos. Só sessão de equipe passa, e só uma varredura a
 * cada HEARTBEAT_INTERVAL_MS acontece de fato — as outras batidas voltam
 * na hora com `skipped`. Assim os lembretes saem no ritmo da barbearia,
 * sem agendador externo e sem custo quando ninguém está usando o sistema.
 */
export async function POST() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "BARBER")) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const vez = await claimDispatchSlot(HEARTBEAT_INTERVAL_MS);
  if (!vez) return NextResponse.json({ skipped: true });

  // Lote menor que o do cron: a batida roda enquanto a pessoa navega.
  const report = await runDispatch(20);
  return NextResponse.json({ skipped: false, ...report });
}
