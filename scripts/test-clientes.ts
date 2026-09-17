// Lista de clientes do painel: filtros, ordenação, paginação e ficha.
//
// Tudo isso virou SQL — com quase mil cadastros, filtrar no navegador
// esconderia a maioria das pessoas. Estes testes batem no banco de
// verdade justamente para pegar erro de consulta, que typecheck não pega.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  payments, recurringSlots, subscriptions, users, plans, services as sv,
} from "../db/schema";
import { listClients, countClients, clientDetail } from "../lib/queries";
import { createBooking, transitionAppointment } from "../lib/appointments";
import { shopToday, addDays, weekdayOf } from "../lib/time";
import { getSettings, getAvailability } from "../lib/schedule";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZTeste";

async function limpar() {
  const antigos = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = antigos.map((u) => u.id);
  if (ids.length) {
    const appts = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(inArray(appointments.clientUserId, ids));
    const apptIds = appts.map((a) => a.id);
    if (apptIds.length) {
      await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, apptIds));
      await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, apptIds));
      await db.delete(notifications).where(inArray(notifications.appointmentId, apptIds));
      await db.delete(appointments).where(inArray(appointments.id, apptIds));
    }
    await db.delete(payments).where(inArray(payments.userId, ids));
    await db.delete(recurringSlots).where(inArray(recurringSlots.userId, ids));
    await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

async function main() {
  await limpar();

  const gold = (await db.query.plans.findFirst({ where: eq(plans.slug, "gold") }))!;
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
  const barbeiro = (await db.query.barbers.findFirst())!;

  // Quatro pessoas, uma para cada recorte que o balcão pede.
  const base = [
    { name: `${MARCA} Assinante`, phone: "11970002001" },
    { name: `${MARCA} Vencido`, phone: "11970002002" },
    { name: `${MARCA} Avulso`, phone: "11970002003" },
    { name: `${MARCA} Sem Fone`, phone: "00999000001" },
  ];
  await db.insert(users).values(base.map((b) => ({ ...b, role: "CLIENT" as const })));
  const criados = await db.select().from(users).where(like(users.name, `${MARCA}%`));
  const achar = (sufixo: string) => criados.find((u) => u.name.endsWith(sufixo))!;

  const renova = new Date();
  renova.setMonth(renova.getMonth() + 1);
  await db.insert(subscriptions).values([
    { userId: achar("Assinante").id, planId: gold.id, renewsAt: renova },
    {
      userId: achar("Vencido").id, planId: gold.id, renewsAt: new Date(Date.now() - 864e5),
      status: "INADIMPLENTE" as const,
    },
  ]);
  await db.insert(recurringSlots).values({
    userId: achar("Assinante").id, barberId: barbeiro.id, frequency: "SEMANAL",
    weekday: 4, minutesOfDay: 9 * 60, serviceIds: [corte.id], startsOn: shopToday(),
  });

  console.log("\n1. Busca por nome e telefone");
  {
    const porNome = await listClients({ q: `${MARCA} Avulso` });
    ok("acha pelo nome", porNome.length === 1 && porNome[0].name.endsWith("Avulso"), String(porNome.length));
    const porFone = await listClients({ q: "11970002003" });
    ok("acha pelo telefone", porFone.some((c) => c.name.endsWith("Avulso")));
    const formatado = await listClients({ q: "(11) 9 7000-2003" });
    ok("telefone formatado também acha", formatado.some((c) => c.name.endsWith("Avulso")));
    ok("contagem bate com a lista", (await countClients({ q: `${MARCA} Avulso` })) === 1);
  }

  console.log("\n2. Filtro por situação");
  {
    const assinantes = await listClients({ q: MARCA, situacao: "assinantes" });
    ok("assinantes traz só quem tem plano ativo",
      assinantes.length === 1 && assinantes[0].name.endsWith("Assinante"),
      assinantes.map((c) => c.name).join(", "));

    const vencidos = await listClients({ q: MARCA, situacao: "inadimplentes" });
    ok("vencidos traz só quem está devendo",
      vencidos.length === 1 && vencidos[0].name.endsWith("Vencido"),
      vencidos.map((c) => c.name).join(", "));

    const avulsos = await listClients({ q: MARCA, situacao: "avulsos" });
    ok("avulsos exclui quem tem plano ativo",
      !avulsos.some((c) => c.name.endsWith("Assinante")) && avulsos.length === 3,
      avulsos.map((c) => c.name).join(", "));
    ok("quem está com plano vencido conta como avulso",
      avulsos.some((c) => c.name.endsWith("Vencido")));

    const semFone = await listClients({ q: MARCA, situacao: "sem-telefone" });
    ok("sem telefone traz só os pendentes",
      semFone.length === 1 && semFone[0].phonePending === true,
      semFone.map((c) => c.name).join(", "));

    const comFixo = await listClients({ q: MARCA, situacao: "fixo" });
    ok("horário fixo traz quem tem reserva",
      comFixo.length === 1 && comFixo[0].hasFixedSlot === true,
      comFixo.map((c) => c.name).join(", "));

    const comConta = await listClients({ q: MARCA, situacao: "com-conta" });
    ok("com conta não traz quem nunca criou senha", comConta.length === 0, String(comConta.length));

    ok("a contagem usa o mesmo filtro",
      (await countClients({ q: MARCA, situacao: "assinantes" })) === 1);
  }

  console.log("\n3. Paginação");
  {
    const todos = await listClients({ q: MARCA, ordem: "nome" });
    ok("os quatro aparecem sem limite", todos.length === 4, String(todos.length));

    const pagina1 = await listClients({ q: MARCA, ordem: "nome", limit: 2, offset: 0 });
    const pagina2 = await listClients({ q: MARCA, ordem: "nome", limit: 2, offset: 2 });
    ok("primeira página tem o tamanho pedido", pagina1.length === 2);
    ok("segunda página continua de onde parou", pagina2.length === 2);
    ok("ninguém aparece nas duas",
      pagina1.every((c) => !pagina2.some((o) => o.id === c.id)));
    ok("juntas dão o total",
      new Set([...pagina1, ...pagina2].map((c) => c.id)).size === 4);
    ok("passar do fim devolve vazio",
      (await listClients({ q: MARCA, limit: 2, offset: 10 })).length === 0);
  }

  console.log("\n4. Ordenação");
  {
    const porNome = await listClients({ q: MARCA, ordem: "nome" });
    const nomes = porNome.map((c) => c.name);
    ok("nome vem em ordem alfabética",
      JSON.stringify(nomes) === JSON.stringify([...nomes].sort((a, b) => a.localeCompare(b))),
      nomes.join(" | "));

    const recentes = await listClients({ q: MARCA, ordem: "recentes" });
    ok("recentes começa pelo último cadastrado",
      recentes[0].id === Math.max(...recentes.map((c) => c.id)), String(recentes[0].name));
    // Todos entraram no mesmo instante: sem desempate, a ordem mudaria a
    // cada consulta e a paginação repetiria gente.
    const denovo = await listClients({ q: MARCA, ordem: "recentes" });
    ok("mesma ordem quando a data empata",
      JSON.stringify(recentes.map((c) => c.id)) === JSON.stringify(denovo.map((c) => c.id)));
  }

  console.log("\n5. Ficha do cliente");
  {
    const cliente = achar("Avulso");
    // Um atendimento concluído, para o histórico e o total gasto. O dia e
    // a hora saem da disponibilidade real: cravar "11:30" quebrava quando
    // outro teste já tinha ocupado esse horário.
    const settings = await getSettings();
    let appt = null;
    for (let i = 1; i <= 10 && !appt; i++) {
      const dia = addDays(shopToday(), i);
      if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
      const { slots } = await getAvailability({
        dateKey: dia, durationMin: corte.durationMin, barberId: barbeiro.id,
      });
      const livre = slots.find((s) => s.available);
      if (!livre) continue;
      appt = await createBooking({
        serviceIds: [corte.id], dateKey: dia, time: livre.time, barberId: barbeiro.id,
        clientName: cliente.name, clientPhone: cliente.phone, userId: cliente.id,
      });
    }
    if (!appt) throw new Error("nenhum horário livre para montar o teste");

    const antes = (await clientDetail(cliente.id))!;
    ok("a ficha existe", !!antes);
    ok("traz o cadastro", antes.cliente.name === cliente.name);
    ok("o horário marcado aparece em 'próximos'",
      antes.proximos.some((a) => a.id === appt.id), String(antes.proximos.length));
    ok("a lista mostra o mesmo horário em aberto",
      (await listClients({ q: `${MARCA} Avulso` }))[0].upcoming === 1);
    ok("ainda não conta como atendimento", antes.concluidos === 0);
    ok("sem plano, sem assinatura na ficha", antes.assinatura === null);

    await transitionAppointment(appt.id, "EM_ANDAMENTO");
    await transitionAppointment(appt.id, "CONCLUIDO");
    const depois = (await clientDetail(cliente.id))!;
    ok("depois de concluir entra no histórico",
      depois.historico.some((a) => a.id === appt.id));
    ok("e some dos próximos", !depois.proximos.some((a) => a.id === appt.id));
    ok("conta como atendimento", depois.concluidos === 1);
    ok("soma o que o cliente gastou", depois.gasto === corte.priceCents,
      `${depois.gasto} vs ${corte.priceCents}`);

    const comPlano = (await clientDetail(achar("Assinante").id))!;
    ok("assinante mostra o plano ativo", comPlano.assinatura?.sub.status === "ATIVA");
    ok("e o horário fixo", comPlano.fixo?.minutesOfDay === 9 * 60, JSON.stringify(comPlano.fixo));

    const vencido = (await clientDetail(achar("Vencido").id))!;
    ok("plano vencido aparece como vencido",
      vencido.assinatura?.sub.status === "INADIMPLENTE");

    ok("ficha de quem não existe volta nula", (await clientDetail(999999)) === null);
    const equipe = await db.query.users.findFirst({ where: eq(users.role, "BARBER") });
    ok("ficha de barbeiro não abre como cliente",
      equipe ? (await clientDetail(equipe.id)) === null : true);
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main();
