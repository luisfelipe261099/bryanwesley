// Trava e varredura da fila de notificações, e o repasse dos erros de
// controle de fluxo do Next pelos helpers de ação.
import "../db/load-env";
import { db, pool } from "../db/client";
import { settings, notifications } from "../db/schema";
import {
  claimDispatchSlot,
  runDispatch,
  lastDispatchAt,
  HEARTBEAT_INTERVAL_MS,
} from "../lib/dispatch";
import { isNextControlFlow } from "../lib/errors";
import { BookingError } from "../lib/appointments";
import { labelAgo } from "../lib/time";
import { eq } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

async function main() {
  console.log("\n1. Trava da varredura (compare-and-swap)");
  {
    await db.update(settings).set({ lastDispatchAt: null }).where(eq(settings.id, 1));
    const a = await claimDispatchSlot(HEARTBEAT_INTERVAL_MS);
    ok("primeira batida ganha a vez", a === true);
    const b = await claimDispatchSlot(HEARTBEAT_INTERVAL_MS);
    ok("segunda batida logo em seguida é pulada", b === false);

    // Duas batidas "simultâneas": só uma pode vencer.
    await db.update(settings).set({ lastDispatchAt: null }).where(eq(settings.id, 1));
    const corrida = await Promise.all([
      claimDispatchSlot(HEARTBEAT_INTERVAL_MS),
      claimDispatchSlot(HEARTBEAT_INTERVAL_MS),
      claimDispatchSlot(HEARTBEAT_INTERVAL_MS),
    ]);
    ok("em corrida, exatamente uma vence", corrida.filter(Boolean).length === 1, JSON.stringify(corrida));

    // Janela vencida: volta a liberar.
    const antes = new Date(Date.now() - HEARTBEAT_INTERVAL_MS - 1000);
    await db.update(settings).set({ lastDispatchAt: antes }).where(eq(settings.id, 1));
    ok("depois do intervalo libera de novo", (await claimDispatchSlot(HEARTBEAT_INTERVAL_MS)) === true);

    const carimbo = await lastDispatchAt();
    ok("carimbo atualizado para agora", !!carimbo && Date.now() - carimbo.getTime() < 5000);
  }

  console.log("\n2. Varredura sem provedor não consome tentativas");
  {
    const antes = await db
      .select({ id: notifications.id, attempts: notifications.attempts, status: notifications.status })
      .from(notifications)
      .where(eq(notifications.status, "PENDENTE"));
    const r = await runDispatch(50);
    ok("reporta provedor não configurado", r.configurado === false);
    ok("conta as pendentes da fila", typeof r.pendentes === "number" && r.pendentes >= 0);
    const depois = await db
      .select({ id: notifications.id, attempts: notifications.attempts, status: notifications.status })
      .from(notifications)
      .where(eq(notifications.status, "PENDENTE"));
    // A varredura também materializa horários fixos, que enfileiram
    // notificações novas — por isso a comparação é por id, não por contagem.
    const mesmo = antes.every((a) => {
      const d = depois.find((x) => x.id === a.id);
      return d?.status === "PENDENTE" && d.attempts === a.attempts;
    });
    ok("pendentes continuam pendentes, sem tentativa gasta", mesmo);
  }

  console.log("\n3. Helpers de ação repassam redirect()/notFound()");
  {
    ok("NEXT_REDIRECT é controle de fluxo", isNextControlFlow({ digest: "NEXT_REDIRECT;push;/entrar;307;" }));
    ok("NEXT_NOT_FOUND é controle de fluxo", isNextControlFlow({ digest: "NEXT_NOT_FOUND" }));
    ok("Error comum não é", !isNextControlFlow(new Error("x")));
    ok("BookingError não é", !isNextControlFlow(new BookingError("x")));
    ok("null/undefined não quebram", !isNextControlFlow(null) && !isNextControlFlow(undefined));
    ok("digest de outro tipo não é", !isNextControlFlow({ digest: 12345 }));
  }

  console.log("\n4. labelAgo");
  {
    const agora = new Date();
    ok("agora", labelAgo(new Date(agora.getTime() - 10_000), agora) === "agora");
    ok("há 3 min", labelAgo(new Date(agora.getTime() - 3 * 60_000), agora) === "há 3 min");
    ok("há 2 h", labelAgo(new Date(agora.getTime() - 2 * 3600_000), agora) === "há 2 h");
    ok("há 1 dia", labelAgo(new Date(agora.getTime() - 24 * 3600_000), agora) === "há 1 dia");
    ok("há 3 dias", labelAgo(new Date(agora.getTime() - 72 * 3600_000), agora) === "há 3 dias");
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
