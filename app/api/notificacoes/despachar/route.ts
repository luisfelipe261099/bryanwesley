import { NextResponse } from "next/server";
import { claimDispatchSlot, runDispatch, CRON_INTERVAL_MS } from "@/lib/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despacho pelo cron da Vercel (vercel.json) ou por um agendador externo.
 * Protegido por CRON_SECRET — a Vercel envia o header Authorization
 * sozinha; agendadores que não enviam usam o header x-cron-secret.
 *
 * O dia a dia é coberto pelo heartbeat do painel (/api/notificacoes/heartbeat);
 * esta rota é a rede de segurança para os dias em que ninguém abre o sistema.
 */
async function handler(req: Request) {
  // Em produção o segredo é obrigatório: sem ele qualquer um dispararia
  // envios (que custam dinheiro) à vontade.
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado" },
      { status: 503 }
    );
  }
  if (secret) {
    // Só por cabeçalho. Na query string o segredo entra no log de acesso
    // da Vercel e vaza pelo Referer — e log de acesso não é lugar de
    // segredo. Agendador que não manda Authorization usa x-cron-secret.
    const auth = req.headers.get("authorization");
    const header = req.headers.get("x-cron-secret");
    if (auth !== `Bearer ${secret}` && header !== secret) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  // Duas execuções coladas (cron + agendador externo, ou retry do
  // agendador) não podem entregar a mesma mensagem duas vezes.
  const vez = await claimDispatchSlot(CRON_INTERVAL_MS);
  if (!vez) {
    return NextResponse.json({
      skipped: true,
      mensagem: "Outra varredura rodou há menos de um minuto.",
    });
  }

  const report = await runDispatch(50);
  return NextResponse.json({
    skipped: false,
    ...report,
    ...(report.configurado
      ? {}
      : {
          mensagem: report.desconectado
            ? "WhatsApp (WAHA) desconectado. As mensagens ficam na fila."
            : "Provedor de WhatsApp não configurado. As mensagens ficam na fila.",
        }),
  });
}

export const GET = handler;
export const POST = handler;
