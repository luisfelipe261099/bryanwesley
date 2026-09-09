import { NextResponse } from "next/server";
import {
  pendingNotifications,
  markSent,
  markFailed,
} from "@/lib/notifications";
import { sendWhatsapp, isWhatsappConfigured } from "@/lib/providers/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despacha as notificações vencidas.
 * Chamado pelo Vercel Cron (vercel.json). Protegido por CRON_SECRET —
 * a Vercel envia o header Authorization automaticamente.
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  const fila = await pendingNotifications(50);

  if (!isWhatsappConfigured()) {
    // Sem provedor: não marca como erro nem consome tentativas.
    // As mensagens seguem na fila até o número ser configurado.
    return NextResponse.json({
      configurado: false,
      pendentes: fila.length,
      mensagem:
        "Provedor de WhatsApp não configurado. As mensagens ficam na fila.",
    });
  }

  let enviadas = 0;
  let falhas = 0;

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

  return NextResponse.json({ configurado: true, enviadas, falhas });
}

export const GET = handler;
export const POST = handler;
