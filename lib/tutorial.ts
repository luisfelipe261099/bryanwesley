// Tutorial de primeiro acesso: cada tela principal (painel do dono,
// agenda do barbeiro, área do cliente) tem o seu. Fica gravado na conta,
// então não volta a aparecer em outro aparelho depois de visto.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

// "preco-turno" é novidade: aparece uma vez para o dono que já usa o painel.
export const TOURS = ["admin", "barbeiro", "cliente", "preco-turno"] as const;
export type Tour = (typeof TOURS)[number];

/** A pessoa ainda não viu o tutorial dessa tela? */
export async function tutorialPendente(userId: number, tour: Tour): Promise<boolean> {
  try {
    const u = await db.query.users.findFirst({
      columns: { tutoriais: true },
      where: eq(users.id, userId),
    });
    return !(u?.tutoriais ?? []).includes(tour);
  } catch (e) {
    // Banco sem a coluna (migração ainda não aplicada) não pode derrubar a
    // tela principal: sem tutorial, a página segue normal.
    console.error("Tutorial: não foi possível ler a conta:", e);
    return false;
  }
}
