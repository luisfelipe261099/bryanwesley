// ───────────────────────────────────────────────────────────
// InfinitePay — Checkout (link de pagamento).
//
// ATENÇÃO: a API de checkout da InfinitePay cobre apenas cobrança
// AVULSA. Não existe assinatura recorrente nativa (débito automático).
// Para a mensalidade do Clube VIP o caminho é gerar um link novo a cada
// renovação e dar baixa pelo webhook — ou usar um gateway com
// recorrência nativa só para as assinaturas.
//
// Sem INFINITEPAY_HANDLE configurado o adaptador fica inerte: nada é
// cobrado e o sistema segue funcionando com ativação manual no admin.
// ───────────────────────────────────────────────────────────

const API = "https://api.checkout.infinitepay.io";

export type LinkItem = {
  description: string;
  /** Em centavos, como o resto do sistema. */
  price: number;
  quantity: number;
};

export type CreateLinkResult =
  | { ok: true; url: string; orderNsu: string }
  | { ok: false; error: string };

export function isInfinitePayConfigured() {
  return Boolean(process.env.INFINITEPAY_HANDLE);
}

/** Cria um link de pagamento e devolve a URL para enviar ao cliente. */
export async function createPaymentLink(input: {
  items: LinkItem[];
  orderNsu: string;
  customer?: { name?: string; email?: string; phone?: string };
  redirectUrl?: string;
  webhookUrl?: string;
}): Promise<CreateLinkResult> {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    return {
      ok: false,
      error: "InfinitePay não configurada (INFINITEPAY_HANDLE ausente).",
    };
  }

  try {
    const res = await fetch(`${API}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        order_nsu: input.orderNsu,
        items: input.items,
        customer: input.customer,
        redirect_url: input.redirectUrl,
        webhook_url: input.webhookUrl,
      }),
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `InfinitePay respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as { url?: string; link?: string };
    const url = json.url ?? json.link;
    if (!url) return { ok: false, error: "Resposta sem URL de pagamento." };
    return { ok: true, url, orderNsu: input.orderNsu };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha de rede",
    };
  }
}

/** Reconfere um pagamento direto na InfinitePay (não confia só no webhook). */
export async function checkPayment(input: {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}): Promise<{ paid: boolean; error?: string }> {
  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) return { paid: false, error: "InfinitePay não configurada." };

  try {
    const res = await fetch(`${API}/payment_check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle,
        order_nsu: input.orderNsu,
        transaction_nsu: input.transactionNsu,
        slug: input.slug,
      }),
    });
    if (!res.ok) return { paid: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { success?: boolean; paid?: boolean };
    return { paid: Boolean(json.success ?? json.paid) };
  } catch (e) {
    return {
      paid: false,
      error: e instanceof Error ? e.message : "Falha de rede",
    };
  }
}
