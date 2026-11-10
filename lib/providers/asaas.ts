// ───────────────────────────────────────────────────────────
// Asaas — cobranças (Pix, boleto ou cartão, à escolha do cliente na
// fatura do próprio Asaas).
//
// Configuração (variáveis de ambiente):
//   ASAAS_API_KEY        chave da API ($aact_prod_… ou $aact_hmlg_… no sandbox)
//   ASAAS_WEBHOOK_TOKEN  o "token de autenticação" cadastrado no webhook do
//                        Asaas; chega no cabeçalho asaas-access-token
//   ASAAS_API_URL        opcional; sem ela, a chave de sandbox (_hmlg_) vai
//                        para o sandbox e as outras para a produção
//
// Sem ASAAS_API_KEY o adaptador fica inerte: nada é cobrado e a ativação
// dos planos segue manual no painel.
// ───────────────────────────────────────────────────────────

const PRODUCAO = "https://api.asaas.com/v3";
const SANDBOX = "https://api-sandbox.asaas.com/v3";

export function isAsaasConfigured() {
  return Boolean(process.env.ASAAS_API_KEY);
}

function baseUrl() {
  if (process.env.ASAAS_API_URL) return process.env.ASAAS_API_URL.replace(/\/$/, "");
  return (process.env.ASAAS_API_KEY ?? "").includes("_hmlg_") ? SANDBOX : PRODUCAO;
}

type Resposta<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

async function chamar<T>(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) return { ok: false, error: "Asaas não configurado (ASAAS_API_KEY ausente)." };
  try {
    const res = await fetch(`${baseUrl()}${caminho}`, {
      method: metodo,
      headers: {
        access_token: chave,
        "Content-Type": "application/json",
        // O Asaas recusa chamadas sem User-Agent em contas novas.
        "User-Agent": "bryanwesley-barbearia",
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const erros = Array.isArray(json.errors) ? (json.errors as { description?: string }[]) : [];
      const texto = erros.map((e) => e.description).filter(Boolean).join(" ");
      console.error("Asaas:", metodo, caminho, res.status, texto || json);
      return { ok: false, status: res.status, error: texto || `O Asaas recusou a cobrança (erro ${res.status}).` };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    console.error("Asaas fora do ar:", e);
    return { ok: false, error: "Não deu para falar com o Asaas agora. Tente de novo em instantes." };
  }
}

export type AsaasCustomer = { id: string };

/** Cria o cliente no Asaas, ou atualiza o que já existe (nome, CPF, contato). */
export async function salvarCliente(input: {
  asaasId?: string | null;
  nome: string;
  cpf: string;
  telefone?: string | null;
  email?: string | null;
  referencia: string;
}): Promise<Resposta<AsaasCustomer>> {
  const telefone = (input.telefone ?? "").replace(/\D/g, "");
  const corpo = {
    name: input.nome,
    cpfCnpj: input.cpf,
    email: input.email || undefined,
    // Número reservado ("00…", cliente sem telefone) não vai.
    mobilePhone: telefone && !telefone.startsWith("00") ? telefone : undefined,
    externalReference: input.referencia,
  };
  if (input.asaasId) {
    const r = await chamar<AsaasCustomer>("POST", `/customers/${encodeURIComponent(input.asaasId)}`, corpo);
    // Cliente apagado lá no Asaas: cria de novo.
    if (r.ok || r.status !== 404) return r;
  }
  return chamar<AsaasCustomer>("POST", "/customers", corpo);
}

export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  externalReference?: string | null;
  invoiceUrl?: string | null;
  transactionReceiptUrl?: string | null;
  deleted?: boolean;
  /** Cobrança gerada por uma assinatura do Asaas (cartão recorrente). */
  subscription?: string | null;
};

/**
 * Cria uma cobrança. Sem `tipo`, o cliente escolhe Pix, boleto ou cartão
 * na fatura; com PIX ou CREDIT_CARD a fatura já abre nessa forma.
 */
export function criarCobranca(input: {
  cliente: string;
  valorCents: number;
  vencimento: string; // AAAA-MM-DD
  descricao: string;
  referencia: string;
  tipo?: "UNDEFINED" | "PIX" | "CREDIT_CARD";
}) {
  return chamar<AsaasPayment>("POST", "/payments", {
    customer: input.cliente,
    billingType: input.tipo ?? "UNDEFINED",
    value: Number((input.valorCents / 100).toFixed(2)),
    dueDate: input.vencimento,
    description: input.descricao.slice(0, 500),
    externalReference: input.referencia,
  });
}

export type AsaasPix = { encodedImage: string; payload: string; expirationDate?: string | null };

/** QR do Pix de uma cobrança (imagem em base64 e o "copia e cola"). */
export function pixDaCobranca(id: string) {
  return chamar<AsaasPix>("GET", `/payments/${encodeURIComponent(id)}/pixQrCode`);
}

/** Apaga uma cobrança ainda não paga (o cliente desistiu ou trocou a forma). */
export function apagarCobranca(id: string) {
  return chamar<{ deleted: boolean }>("DELETE", `/payments/${encodeURIComponent(id)}`);
}

export type AsaasSubscription = { id: string; status?: string };

/**
 * Assinatura no cartão: o cliente informa o cartão na primeira fatura e o
 * Asaas cobra sozinho a cada ciclo, à vista (assinatura não parcela).
 */
export function criarAssinaturaCartao(input: {
  cliente: string;
  valorCents: number;
  ciclo: "MONTHLY" | "YEARLY";
  primeiroVencimento: string; // AAAA-MM-DD
  descricao: string;
  referencia: string;
}) {
  return chamar<AsaasSubscription>("POST", "/subscriptions", {
    customer: input.cliente,
    billingType: "CREDIT_CARD",
    value: Number((input.valorCents / 100).toFixed(2)),
    nextDueDate: input.primeiroVencimento,
    cycle: input.ciclo,
    description: input.descricao.slice(0, 500),
    externalReference: input.referencia,
  });
}

/** Cobranças de uma assinatura (a mais recente primeiro, na prática a 1ª). */
export function cobrancasDaAssinatura(id: string) {
  return chamar<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(id)}/payments?limit=10`);
}

/** Encerra a assinatura no Asaas: o cartão não é mais cobrado. */
export function cancelarAssinaturaAsaas(id: string) {
  return chamar<{ deleted: boolean }>("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
}

export function consultarCobranca(id: string) {
  return chamar<AsaasPayment>("GET", `/payments/${encodeURIComponent(id)}`);
}

/** Situações em que o dinheiro entrou (ou o cartão foi aprovado). */
export function cobrancaPaga(status: string) {
  return status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH";
}
