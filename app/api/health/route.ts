import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/** Para monitores de disponibilidade. Não expõe nada sensível. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      ok: true,
      db: "ok",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (e) {
    // A mensagem do driver traz host e usuário do banco: fica só no log.
    console.error("healthcheck:", e);
    return NextResponse.json({ ok: false, db: "erro" }, { status: 503 });
  }
}
