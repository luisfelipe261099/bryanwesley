// ───────────────────────────────────────────────────────────
// Freio por origem para o que é aberto ao público.
//
// A agenda não pede cadastro — de propósito: o cliente marca com nome e
// WhatsApp e pronto. Sem nenhum freio, porém, um script marca o dia
// inteiro com telefones inventados, tranca as cadeiras e ainda enche a
// base de clientes fantasma. O teto por telefone (lib/appointments) não
// pega isso, porque cada pedido usa um telefone novo.
//
// O contador vive no banco porque em serverless não há memória
// compartilhada entre instâncias.
// ───────────────────────────────────────────────────────────
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimits } from "@/db/schema";

export type RateVerdict = { ok: true } | { ok: false; retryInMs: number };

/**
 * Conta mais um uso de `chave` na janela. Devolve ok=false quando o teto
 * da janela já foi atingido.
 */
export async function hitRateLimit(
  chave: string,
  teto: number,
  janelaMs: number,
  agora = new Date()
): Promise<RateVerdict> {
  const inicioValido = new Date(agora.getTime() - janelaMs);

  // Janela vencida (ou primeira vez): recomeça a contagem em 1.
  await db
    .insert(rateLimits)
    .values({ chave: chave.slice(0, 80), hits: 1, windowStart: agora })
    .onDuplicateKeyUpdate({
      set: {
        hits: sql`if(${rateLimits.windowStart} < ${inicioValido}, 1, ${rateLimits.hits} + 1)`,
        windowStart: sql`if(${rateLimits.windowStart} < ${inicioValido}, ${agora}, ${rateLimits.windowStart})`,
      },
    });

  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.chave, chave.slice(0, 80)))
    .limit(1);
  if (!row) return { ok: true };
  if (row.hits <= teto) return { ok: true };
  return {
    ok: false,
    retryInMs: Math.max(0, row.windowStart.getTime() + janelaMs - agora.getTime()),
  };
}

/** Limpa janelas antigas para a tabela não crescer sem fim. */
export async function purgeRateLimits(antesDe: Date) {
  const [res] = await db.delete(rateLimits).where(lt(rateLimits.windowStart, antesDe));
  return res.affectedRows;
}
