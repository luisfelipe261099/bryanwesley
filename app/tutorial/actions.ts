"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { TOURS, type Tour } from "@/lib/tutorial";

/** Marca o tutorial da tela como visto (concluído ou pulado). */
export async function marcarTutorialVisto(tour: Tour): Promise<{ ok: boolean }> {
  try {
    const session = await getSession();
    if (!session || !TOURS.includes(tour)) return { ok: false };
    const u = await db.query.users.findFirst({
      columns: { tutoriais: true },
      where: eq(users.id, session.id),
    });
    const vistos = new Set(u?.tutoriais ?? []);
    if (vistos.has(tour)) return { ok: true };
    vistos.add(tour);
    await db.update(users).set({ tutoriais: Array.from(vistos) }).where(eq(users.id, session.id));
    return { ok: true };
  } catch (e) {
    console.error("Tutorial: não foi possível marcar como visto:", e);
    return { ok: false };
  }
}
