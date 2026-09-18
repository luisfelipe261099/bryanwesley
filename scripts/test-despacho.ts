// Trava e varredura da fila de notificações, e o repasse dos erros de
// controle de fluxo do Next pelos helpers de ação.
import "../db/load-env";
import { db, pool } from "../db/client";
import { appointments, settings, notifications } from "../db/schema";
import {
  claimDispatchSlot,
  runDispatch,
  lastDispatchAt,
  discardStaleNotifications,
  HEARTBEAT_INTERVAL_MS,
} from "../lib/dispatch";
import { nextRenewal } from "../lib/subscriptions";
import { sessionMatchesAccount } from "../lib/auth/session";
import { isNextControlFlow, dbErrorCode } from "../lib/errors";
import { BookingError } from "../lib/appointments";
import { labelAgo } from "../lib/time";
import { eq, gt, inArray } from "drizzle-orm";

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
    // O Drizzle 0.45 embrulha a exceção do driver: o código fica em `cause`.
    ok("dbErrorCode lê code no topo", dbErrorCode({ code: "ER_DUP_ENTRY" }) === "ER_DUP_ENTRY");
    ok("dbErrorCode lê code em cause (DrizzleQueryError)", dbErrorCode({ message: "x", cause: { code: "ER_DUP_ENTRY" } }) === "ER_DUP_ENTRY");
    ok("dbErrorCode desce dois níveis", dbErrorCode({ cause: { cause: { code: "ER_LOCK" } } }) === "ER_LOCK");
    ok("sem código devolve undefined", dbErrorCode(new Error("x")) === undefined && dbErrorCode(null) === undefined);
  }

  console.log("\n2b. Mensagem vencida é descartada, a válida fica");
  {
    // Um agendamento ainda por vir: a regra do lembrete de 2h olha a hora
    // do atendimento, não o atraso da mensagem.
    const appt =
      (await db.query.appointments.findFirst({
        where: gt(appointments.startsAt, new Date()),
      })) ?? (await db.query.appointments.findFirst());
    if (!appt) {
      ok("há agendamento para ancorar a notificação", false);
    } else {
      const agora = Date.now();
      // 24h é o lembrete que vence por atraso (o de 2h só vence quando o
      // horário começa — atrasado ele ainda avisa a pessoa a tempo).
      const [{ id: velha }] = await db.insert(notifications).values({
        appointmentId: appt.id, phone: "11900000000", kind: "LEMBRETE_24H",
        body: "teste vencida", scheduledFor: new Date(agora - 20 * 3600_000),
      }).$returningId();
      const [{ id: nova }] = await db.insert(notifications).values({
        appointmentId: appt.id, phone: "11900000000", kind: "LEMBRETE_2H",
        body: "teste válida", scheduledFor: new Date(agora - 5 * 60_000),
      }).$returningId();
      const n = await discardStaleNotifications();
      const v = await db.query.notifications.findFirst({ where: eq(notifications.id, velha) });
      const w = await db.query.notifications.findFirst({ where: eq(notifications.id, nova) });
      ok("lembrete de 24h com 20h de atraso vira CANCELADA com motivo", v?.status === "CANCELADA" && /Vencida/.test(v.error ?? ""), v?.status);
      ok("lembrete de 2h atrasado continua PENDENTE até a hora do atendimento", w?.status === "PENDENTE", w?.status);
      ok("contagem de descartadas ≥ 1", n >= 1, String(n));
      await db.delete(notifications).where(inArray(notifications.id, [velha, nova]));
    }
  }

  console.log("\n2c. nextRenewal não transborda o mês");
  {
    const jan31 = new Date(2027, 0, 31, 12);
    const r = nextRenewal(jan31, "MENSAL");
    ok("31/jan + 1 mês = 28/fev", r.getMonth() === 1 && r.getDate() === 28, r.toISOString());
    const mar31 = new Date(2027, 2, 31, 12);
    const r2 = nextRenewal(mar31, "MENSAL");
    ok("31/mar + 1 mês = 30/abr", r2.getMonth() === 3 && r2.getDate() === 30, r2.toISOString());
    const fev29 = new Date(2028, 1, 29, 12);
    const r3 = nextRenewal(fev29, "ANUAL");
    ok("29/fev/2028 + 12 meses = 28/fev/2029", r3.getFullYear() === 2029 && r3.getMonth() === 1 && r3.getDate() === 28, r3.toISOString());
    const d15 = new Date(2027, 4, 15, 12);
    ok("dia comum não muda", nextRenewal(d15, "MENSAL").getDate() === 15);
  }

  console.log("\n2d. Sessão só vale enquanto a conta bate com o banco");
  {
    const s = { id: 1, name: "X", role: "BARBER" as const, v: 2 };
    ok("conta ativa, mesmo papel e versão → vale", sessionMatchesAccount(s, { active: true, role: "BARBER", tokenVersion: 2 }));
    ok("conta desativada → cai", !sessionMatchesAccount(s, { active: false, role: "BARBER", tokenVersion: 2 }));
    ok("senha trocada (versão subiu) → cai", !sessionMatchesAccount(s, { active: true, role: "BARBER", tokenVersion: 3 }));
    ok("papel mudou → cai", !sessionMatchesAccount(s, { active: true, role: "CLIENT", tokenVersion: 2 }));
    ok("conta apagada → cai", !sessionMatchesAccount(s, null));
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
