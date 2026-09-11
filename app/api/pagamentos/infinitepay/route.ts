import { NextResponse } from "next/server";
import { settlePayment } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * Webhook da InfinitePay. Responde 200 no sucesso e 400 para que o
 * provedor tente de novo — é o contrato documentado por eles.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const orderNsu = String(body.order_nsu ?? body.orderNsu ?? "");
  if (!orderNsu) {
    return NextResponse.json({ error: "order_nsu ausente" }, { status: 400 });
  }

  const res = await settlePayment({
    orderNsu,
    transactionNsu: body.transaction_nsu ? String(body.transaction_nsu) : undefined,
    slug: body.slug ? String(body.slug) : undefined,
    receiptUrl: body.receipt_url ? String(body.receipt_url) : undefined,
  });

  if (!res.ok) {
    console.error("Webhook InfinitePay recusado:", orderNsu, res.error);
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
