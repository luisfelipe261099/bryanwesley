"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { hitRateLimit } from "@/lib/rate-limit";
import { enviarPush } from "@/lib/push";

const HOME = { ADMIN: "/admin", BARBER: "/barbeiro", CLIENT: "/cliente" } as const;

export type TesteResult =
  | { ok: true; enviadas: number; aparelhos: number }
  | { ok: false; error: string };

/**
 * "Enviar aviso de teste": a pessoa confere, no próprio aparelho, que o
 * caminho inteiro funciona — antes de depender dele para o agendamento.
 */
export async function testarAvisoPush(): Promise<TesteResult> {
  const session = await requireRole(["ADMIN", "BARBER", "CLIENT"]);
  const freio = await hitRateLimit(`push:teste:${session.id}`, 10, 3600_000);
  if (!freio.ok) return { ok: false, error: "Muitos testes seguidos. Espere um pouco." };

  const r = await enviarPush([session.id], {
    titulo: "Avisos ligados ✓",
    corpo: `Oi, ${session.name.split(" ")[0]}! É assim que os avisos vão chegar.`,
    url: HOME[session.role],
    tag: "teste",
  });
  if (r.aparelhos === 0) {
    return { ok: false, error: "Nenhum aparelho com avisos ligados nesta conta. Ligue os avisos primeiro." };
  }
  if (r.enviadas === 0) {
    return {
      ok: false,
      error: "O serviço de push não aceitou o envio. Desligue e ligue os avisos de novo neste aparelho.",
    };
  }
  return { ok: true, enviadas: r.enviadas, aparelhos: r.aparelhos };
}

/** Tira um aparelho da lista (um celular antigo, por exemplo). */
export async function esquecerAparelho(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireRole(["ADMIN", "BARBER", "CLIENT"]);
  const [res] = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, session.id)));
  if (res.affectedRows === 0) return { ok: false, error: "Esse aparelho já não está na lista." };
  revalidatePath("/conta");
  revalidatePath("/admin/notificacoes");
  return { ok: true };
}
