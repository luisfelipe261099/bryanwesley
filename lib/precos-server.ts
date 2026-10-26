// Preço por turno no servidor: carrega as regras do banco.
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { servicePriceRules, services } from "@/db/schema";
import { precoNoHorario, type RegraPreco } from "./precos";
import { utcToShopParts } from "./time";

export async function carregarRegras(serviceIds?: number[]): Promise<RegraPreco[]> {
  if (serviceIds && serviceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(servicePriceRules)
    .where(serviceIds ? inArray(servicePriceRules.serviceId, serviceIds) : undefined);
  return rows.map((r) => ({ ...r, weekdays: r.weekdays ?? [] }));
}

/** Preço de cada serviço num instante (fuso da loja). */
export async function precosNoInstante(serviceIds: number[], instante: Date) {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return new Map<number, number>();
  const [catalogo, regras] = await Promise.all([
    db.select({ id: services.id, priceCents: services.priceCents }).from(services).where(inArray(services.id, ids)),
    carregarRegras(ids),
  ]);
  const p = utcToShopParts(instante);
  return new Map(catalogo.map((s) => [s.id, precoNoHorario(s, regras, p.weekday, p.minutesOfDay)]));
}
