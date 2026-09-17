// Gestão do Clube: resumo, filtros da lista de membros e efeito das ações.
import "../db/load-env";
import { db, pool } from "../db/client";
import { plans, subscriptions, users } from "../db/schema";
import {
  clubOverview,
  listSubscribers,
  countSubscribers,
} from "../lib/queries";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZClube";

async function limpar() {
  const antigos = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = antigos.map((u) => u.id);
  if (ids.length) {
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

async function main() {
  await limpar();

  const todosPlanos = await db.select().from(plans).orderBy(plans.id);
  const gold = todosPlanos.find((x) => x.slug === "gold") ?? todosPlanos[0];
  const outro = todosPlanos.find((x) => x.id !== gold.id) ?? gold;

  const antes = await clubOverview();

  const daquiA = (dias: number) => new Date(Date.now() + dias * 86400000);
  await db.insert(users).values([
    { name: `${MARCA} Ativo Mensal`, phone: "11970003001", role: "CLIENT" as const },
    { name: `${MARCA} Ativo Anual`, phone: "11970003002", role: "CLIENT" as const },
    { name: `${MARCA} Vencido`, phone: "11970003003", role: "CLIENT" as const },
    { name: `${MARCA} Cancelado`, phone: "11970003004", role: "CLIENT" as const },
  ]);
  const criados = await db.select().from(users).where(like(users.name, `${MARCA}%`));
  const achar = (sufixo: string) => criados.find((u) => u.name.endsWith(sufixo))!;

  await db.insert(subscriptions).values([
    { userId: achar("Ativo Mensal").id, planId: gold.id, cycle: "MENSAL" as const, renewsAt: daquiA(3) },
    { userId: achar("Ativo Anual").id, planId: outro.id, cycle: "ANUAL" as const, renewsAt: daquiA(200) },
    { userId: achar("Vencido").id, planId: gold.id, renewsAt: daquiA(-5), status: "INADIMPLENTE" as const },
    { userId: achar("Cancelado").id, planId: gold.id, renewsAt: daquiA(-30), status: "CANCELADA" as const, canceledAt: daquiA(-30) },
  ]);

  console.log("\n1. Resumo do clube");
  {
    const r = await clubOverview();
    ok("conta os ativos", r.ativos === antes.ativos + 2, `${antes.ativos} -> ${r.ativos}`);
    ok("conta os vencidos", r.vencidos === antes.vencidos + 1);
    ok("conta os cancelados", r.cancelados === antes.cancelados + 1);
    // Anual entra pelo valor por mês: senão um único plano anual faria o
    // número do mês parecer doze vezes maior.
    const esperado = antes.mrrCents + gold.priceCents + outro.annualPriceCents;
    ok("a receita do mês soma o mensal + o anual rateado", r.mrrCents === esperado,
      `${r.mrrCents} vs ${esperado}`);
    ok("quem vence em até 7 dias aparece", r.vencendo >= 1, String(r.vencendo));
    const doGold = r.porPlano.find((x) => x.planId === gold.id);
    ok("agrupa por plano", !!doGold && doGold.ativos >= 1, JSON.stringify(doGold));
  }

  console.log("\n2. Lista de membros");
  {
    const ativos = await listSubscribers({ q: MARCA, situacao: "ativos" });
    ok("ativos traz só quem está em dia",
      ativos.length === 2 && ativos.every((a) => a.status === "ATIVA"),
      ativos.map((a) => a.name).join(", "));

    const vencidos = await listSubscribers({ q: MARCA, situacao: "vencidos" });
    ok("vencidos traz só quem está devendo",
      vencidos.length === 1 && vencidos[0].name.endsWith("Vencido"));

    const cancelados = await listSubscribers({ q: MARCA, situacao: "cancelados" });
    ok("cancelados traz o histórico",
      cancelados.length === 1 && cancelados[0].name.endsWith("Cancelado"));

    const todos = await listSubscribers({ q: MARCA, situacao: "todos" });
    ok("todos traz os quatro", todos.length === 4, String(todos.length));

    const doPlano = await listSubscribers({ q: MARCA, situacao: "todos", planId: gold.id });
    ok("filtra por plano", doPlano.every((a) => a.planId === gold.id) && doPlano.length === 3,
      doPlano.map((a) => a.planName).join(", "));

    const porFone = await listSubscribers({ q: "11970003002", situacao: "todos" });
    ok("acha pelo telefone", porFone.length === 1 && porFone[0].name.endsWith("Ativo Anual"));

    ok("a contagem usa o mesmo filtro",
      (await countSubscribers({ q: MARCA, situacao: "ativos" })) === 2);

    const mensal = todos.find((a) => a.name.endsWith("Ativo Mensal"))!;
    const anual = todos.find((a) => a.name.endsWith("Ativo Anual"))!;
    ok("mostra o valor por mês do mensal", mensal.monthlyCents === gold.priceCents);
    ok("e o valor por mês do anual", anual.monthlyCents === outro.annualPriceCents);

    const ordenados = await listSubscribers({ q: MARCA, situacao: "ativos" });
    ok("quem vence antes aparece primeiro",
      ordenados[0].name.endsWith("Ativo Mensal"), ordenados.map((a) => a.name).join(" | "));
  }

  console.log("\n3. Paginação");
  {
    const pagina1 = await listSubscribers({ q: MARCA, situacao: "todos", limit: 2, offset: 0 });
    const pagina2 = await listSubscribers({ q: MARCA, situacao: "todos", limit: 2, offset: 2 });
    ok("primeira página tem o tamanho pedido", pagina1.length === 2);
    ok("segunda continua de onde parou", pagina2.length === 2);
    ok("ninguém aparece nas duas",
      pagina1.every((a) => !pagina2.some((o) => o.subscriptionId === a.subscriptionId)));
  }

  console.log("\n4. Renovar e cancelar mexem no resumo");
  {
    // As Server Actions exigem sessão e só rodam dentro do Next (o
    // roteiro de navegador cobre os botões). Aqui vale o efeito que elas
    // deixam no banco, que é o que o resumo enxerga.
    const vencido = achar("Vencido");
    await db
      .update(subscriptions)
      .set({ status: "ATIVA", renewsAt: daquiA(30) })
      .where(eq(subscriptions.userId, vencido.id));
    const depois = await clubOverview();
    ok("renovar tira da lista de vencidos",
      (await listSubscribers({ q: MARCA, situacao: "vencidos" })).length === 0);
    ok("e entra na receita do mês", depois.mrrCents > 0);

    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(eq(subscriptions.userId, achar("Ativo Mensal").id));
    const semOMensal = await clubOverview();
    ok("cancelar tira da receita do mês",
      semOMensal.mrrCents === depois.mrrCents - gold.priceCents,
      `${depois.mrrCents} -> ${semOMensal.mrrCents}`);
    ok("e o membro passa para cancelados",
      (await listSubscribers({ q: MARCA, situacao: "cancelados" })).length === 2);
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main();
