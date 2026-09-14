// Testes das proteções de segurança. Cada bloco cobre um furo que já foi
// encontrado numa revisão — se algum voltar, é aqui que estoura.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions,
  notifications, payments, subscriptions, users, plans,
  services as sv,
} from "../db/schema";
import { createBooking, BookingError } from "../lib/appointments";
import { settlePayment } from "../lib/payments";
import { toCsv } from "../lib/reports";
import { safeNext } from "../lib/url";
import { verifySession, signSession } from "../lib/auth/session";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { getSettings } from "../lib/schedule";
import { eq } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

/** Primeiro dia à frente em que a barbearia abre. */
async function diaAberto(desde: number) {
  const s = await getSettings();
  for (let i = desde; i < desde + 14; i++) {
    const d = addDays(shopToday(), i);
    if (!s.closedWeekdays.includes(weekdayOf(d))) return d;
  }
  throw new Error("sem dia aberto");
}

async function main() {
  await db.delete(appointmentCommissions);
  await db.delete(notifications);
  await db.delete(appointmentServices);
  await db.delete(appointments);
  await db.delete(payments);

  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;

  console.log("\n1. Teto de horários abertos por telefone");
  {
    const telefone = "11960002222";
    const dia = await diaAberto(1);
    const horas = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
    let criados = 0;
    let barrado = "";
    for (const time of horas) {
      try {
        await createBooking({
          serviceIds: [corte.id], dateKey: dia, time,
          barberId: null, clientName: "Spam da Silva", clientPhone: telefone,
        });
        criados++;
      } catch (e) {
        if (e instanceof BookingError && e.message.includes("já tem")) {
          barrado = e.message;
          break;
        }
        throw e;
      }
    }
    ok("para no teto de 4 avulsos", criados === 4, `criou ${criados}`);
    ok("explica o motivo ao cliente", barrado.includes("Cancele um antes"), barrado);

    // Outro telefone não herda o teto do primeiro.
    let outro = false;
    try {
      await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: "17:00",
        barberId: null, clientName: "Outro Cliente", clientPhone: "11960003333",
      });
      outro = true;
    } catch { /* ignora */ }
    ok("teto é por telefone, não global", outro);
  }

  console.log("\n2. Webhook de pagamento não dá baixa sem conferência");
  {
    const cliente = (await db.query.users.findFirst())!;
    const plano = (await db.query.plans.findFirst({ where: eq(plans.slug, "gold") }))!;
    await db.delete(subscriptions).where(eq(subscriptions.userId, cliente.id));
    await db.insert(subscriptions).values({
      userId: cliente.id, planId: plano.id, cycle: "MENSAL",
      status: "INADIMPLENTE", renewsAt: new Date(),
    });
    const sub = (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, cliente.id),
    }))!;
    await db.insert(payments).values({
      orderNsu: "BWTESTE01", userId: cliente.id, subscriptionId: sub.id,
      kind: "ASSINATURA", amountCents: plano.priceCents, description: "teste",
    });

    // Callback "pelado": é o que um atacante conseguiria montar sozinho.
    const r = await settlePayment({ orderNsu: "BWTESTE01" });
    ok("recusa callback sem transaction_nsu/slug", r.ok === false);

    const pago = await db.query.payments.findFirst({
      where: eq(payments.orderNsu, "BWTESTE01"),
    });
    ok("cobrança continua pendente", pago?.status === "PENDENTE", pago?.status);

    const depois = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) });
    ok("assinatura não é ativada de graça", depois?.status === "INADIMPLENTE", depois?.status);

    const desconhecida = await settlePayment({
      orderNsu: "NAO-EXISTE", transactionNsu: "x", slug: "y",
    });
    ok("order_nsu desconhecido é recusado", desconhecida.ok === false);
  }

  console.log("\n3. Redirecionamento de login não sai do site");
  {
    ok("aceita rota interna", safeNext("/admin") === "/admin");
    ok("recusa //dominio.externo", safeNext("//evil.com") === null);
    ok("recusa /\\dominio.externo", safeNext("/\\evil.com") === null);
    ok("recusa URL absoluta", safeNext("https://evil.com") === null);
    ok("recusa vazio", safeNext("") === null);
  }

  console.log("\n4. CSV não carrega fórmula");
  {
    const csv = toCsv([{ Nome: "=HYPERLINK(\"http://x\")", Visitas: 3 }]);
    ok("nome com '=' vira texto", csv.includes("'=HYPERLINK"), csv);
    ok("número continua número", /;3(\r|$)/m.test(csv), csv);
  }

  console.log("\n5. Sessão só aceita papel conhecido");
  {
    const bom = await signSession({ id: 1, name: "Teste", role: "ADMIN", v: 0 });
    ok("papel válido passa", (await verifySession(bom))?.role === "ADMIN");

    // Token assinado com papel fora da lista (regressão de versão antiga).
    const torto = await signSession({
      id: 1, name: "Teste", role: "SUPERADMIN" as never, v: 0,
    });
    ok("papel desconhecido é rejeitado", (await verifySession(torto)) === null);
    ok("token adulterado é rejeitado", (await verifySession(bom + "x")) === null);
    ok("sem token não vira sessão", (await verifySession(undefined)) === null);
  }

  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
