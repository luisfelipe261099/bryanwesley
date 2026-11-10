import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cancelPayment, settleCobrancaRecorrente, settlePayment } from "@/lib/payments";

export const dynamic = "force-dynamic";
// Confere a cobrança na API do Asaas e avisa no celular: mais que o padrão.
export const maxDuration = 30;

/** O token cadastrado no webhook do Asaas, comparado sem vazar tempo. */
function tokenConfere(recebido: string | null) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook do Asaas. O Asaas pausa a fila depois de muitas respostas de
 * erro, então tudo que não é falha passageira responde 200 — inclusive
 * eventos que não interessam e avisos que a conferência recusou.
 */
export async function POST(req: Request) {
  if (!tokenConfere(req.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let body: {
    event?: string;
    payment?: { id?: string; externalReference?: string | null; subscription?: string | null };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignorado: "corpo inválido" });
  }

  const evento = String(body.event ?? "");
  const paymentId = body.payment?.id ? String(body.payment.id) : undefined;
  const orderNsu = body.payment?.externalReference ? String(body.payment.externalReference) : "";

  // Cobrança da assinatura do cartão (a do mês seguinte nasce lá sem
  // registro aqui): baixa pela assinatura, conferida na API.
  const assinaturaAsaas = body.payment?.subscription ? String(body.payment.subscription) : "";
  if (assinaturaAsaas && paymentId && (evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED")) {
    const res = await settleCobrancaRecorrente({ paymentId, asaasSubscriptionId: assinaturaAsaas });
    if (!res.ok) {
      console.error("Webhook Asaas (cartão recorrente) não deu baixa:", evento, paymentId, res.error);
      if ("temporario" in res && res.temporario) {
        return NextResponse.json({ error: res.error }, { status: 503 });
      }
    }
    return NextResponse.json({ ok: true });
  }
  // Cobrança sem a nossa referência (feita direto no painel do Asaas).
  if (!orderNsu) return NextResponse.json({ ok: true, ignorado: "sem referência" });

  if (evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED") {
    const res = await settlePayment({ orderNsu, paymentId });
    if (!res.ok) {
      console.error("Webhook Asaas não deu baixa:", evento, orderNsu, res.error);
      // Só a falha ao falar com o Asaas pede nova tentativa.
      if ("temporario" in res && res.temporario) {
        return NextResponse.json({ error: res.error }, { status: 503 });
      }
    }
    return NextResponse.json({ ok: true });
  }
  if (evento === "PAYMENT_DELETED") {
    await cancelPayment({ orderNsu, paymentId });
    return NextResponse.json({ ok: true });
  }
  if (evento === "PAYMENT_REFUNDED" || evento.startsWith("PAYMENT_CHARGEBACK")) {
    // Estorno não desfaz o plano sozinho: o dono decide no painel.
    console.error("Asaas: estorno/contestação de cobrança do clube:", evento, orderNsu, paymentId);
  }
  return NextResponse.json({ ok: true });
}
