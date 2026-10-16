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
import { and, eq, like, lt, notLike, sql } from "drizzle-orm";
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

/**
 * Só confere, sem contar: o teto da janela já foi atingido? Para freios
 * que contam apenas as falhas (o login conta senha errada, não acerto).
 */
export async function rateLimitEsgotado(
  chave: string,
  teto: number,
  janelaMs: number,
  agora = new Date()
): Promise<boolean> {
  try {
    const [row] = await db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.chave, chave.slice(0, 80)))
      .limit(1);
    if (!row) return false;
    if (row.windowStart.getTime() < agora.getTime() - janelaMs) return false;
    return row.hits >= teto;
  } catch (e) {
    console.error("Freio: não deu para conferir:", e);
    return false;
  }
}

/**
 * Freios com janela maior que a limpeza diária. O "avisa uma vez só" do
 * horário fixo em conflito vale 40 dias; apagado com 24 h, o mesmo aviso
 * voltava ao celular do dono todo dia enquanto o conflito durasse.
 */
const JANELAS_LONGAS = [{ prefixo: "push:fixo:", ms: 41 * 86400_000 }];

/** Limpa janelas antigas para a tabela não crescer sem fim. */
export async function purgeRateLimits(antesDe: Date) {
  const [res] = await db
    .delete(rateLimits)
    .where(
      and(
        lt(rateLimits.windowStart, antesDe),
        ...JANELAS_LONGAS.map((j) => notLike(rateLimits.chave, `${j.prefixo}%`))
      )
    );
  let apagadas = res.affectedRows;
  for (const j of JANELAS_LONGAS) {
    const [longa] = await db
      .delete(rateLimits)
      .where(
        and(
          like(rateLimits.chave, `${j.prefixo}%`),
          lt(rateLimits.windowStart, new Date(Date.now() - j.ms))
        )
      );
    apagadas += longa.affectedRows;
  }
  return apagadas;
}
