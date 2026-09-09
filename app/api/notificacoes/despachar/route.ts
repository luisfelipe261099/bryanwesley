import { NextResponse } from "next/server";
import {
  pendingNotifications,
  markSent,
  markFailed,
} from "@/lib/notifications";
import { sendWhatsapp, isWhatsappConfigured } from "@/lib/providers/whatsapp";
import { materializeRecurring } from "@/lib/recurring";
import { expireOverdueSubscriptions } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Despacha as notificações vencidas.
 * Chamado pelo Vercel Cron (vercel.json). Protegido por CRON_SECRET —
 * a Vercel envia o header Authorization automaticamente.
 */
async function handler(req: Request) {
  // Em produção o segredo é obrigatório: sem ele qualquer um dispararia
  // envios (que custam dinheiro) à vontade. Aceita header ou ?token=
  // para os agendadores externos que não enviam Authorization.
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado" },
      { status: 503 }
    );
  }
  if (secret) {
    const auth = req.headers.get("authorization");
    const token = new URL(req.url).searchParams.get("token");
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  // Assinaturas vencidas perdem o benefício até a renovação ser registrada.
  const expiradas = await expireOverdueSubscriptions();

  // Garante os horários fixos das próximas semanas antes de notificar,
  // para que a confirmação deles também saia nesta rodada.
  const fixos = await materializeRecurring();

  const fila = await pendingNotifications(50);

  if (!isWhatsappConfigured()) {
    // Sem provedor: não marca como erro nem consome tentativas.
    // As mensagens seguem na fila até o número ser configurado.
    return NextResponse.json({
      configurado: false,
      pendentes: fila.length,
      horariosFixos: fixos,
      assinaturasExpiradas: expiradas,
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

  return NextResponse.json({
    configurado: true,
    enviadas,
    falhas,
    horariosFixos: fixos,
    assinaturasExpiradas: expiradas,
  });
}

export const GET = handler;
export const POST = handler;
