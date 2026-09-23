// A ponte do WhatsApp: o link pré-preenchido e o atendente que marca
// horário dentro da conversa. Roda tudo sem subir servidor nem falar
// com a Meta.
import "../db/load-env";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  rateLimits, recurringSlots, services as sv, subscriptions, users, whatsappSessions,
} from "../db/schema";
import { createBooking } from "../lib/appointments";
import { getSettings, getAvailability } from "../lib/schedule";
import { shopToday, addDays, weekdayOf, utcToShopParts, formatShopTime } from "../lib/time";
import { linkDeAgendamento, linkWaMe, conviteDeAgendamento } from "../lib/whatsapp-link";
import { extrairMensagens } from "../lib/whatsapp-inbox";
import { processarMensagem, limparSessoesVelhas, VALIDADE_SESSAO_MS } from "../lib/whatsapp-bot";
import { eq, inArray, like } from "drizzle-orm";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZWhats";
const FONE = "41970007001";

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = gente.map((u) => u.id);
  await db.delete(rateLimits).where(like(rateLimits.chave, "wa:%"));
  await db.delete(whatsappSessions).where(like(whatsappSessions.phone, "41970007%"));
  await db.delete(notifications).where(like(notifications.phone, "41970007%"));
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments)
    .where(inArray(appointments.clientUserId, ids));
  const apptIds = appts.map((a) => a.id);
  if (apptIds.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, apptIds));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, apptIds));
    await db.delete(notifications).where(inArray(notifications.appointmentId, apptIds));
    await db.delete(appointments).where(inArray(appointments.id, apptIds));
  }
  await db.delete(recurringSlots).where(inArray(recurringSlots.userId, ids));
  await db.delete(subscriptions).where(inArray(subscriptions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

async function diaComVaga(barberId: number, durationMin: number) {
  const settings = await getSettings();
  for (let i = 1; i <= 14; i++) {
    const dia = addDays(shopToday(), i);
    if (settings.closedWeekdays.includes(weekdayOf(dia))) continue;
    const { slots } = await getAvailability({ dateKey: dia, durationMin, barberId });
    const livre = slots.find((s) => s.available);
    if (livre) return { dia, hora: livre.time };
  }
  throw new Error("sem vaga para montar o teste");
}

async function main() {
  await limpar();
  const BASE = "https://bryanwesley.vercel.app";

  console.log("\n1. O link que a barbearia manda");
  {
    const link = linkDeAgendamento(BASE, {
      nome: "João Silva", fone: "(41) 9 7000-7001", servico: "corte",
    });
    ok("aponta para o /agendar", link.startsWith(`${BASE}/agendar?`), link);
    ok("leva o nome", link.includes("nome=Jo%C3%A3o+Silva"), link);
    ok("leva o telefone só com dígitos", link.includes("fone=41970007001"), link);
    ok("leva o serviço pelo slug", link.includes("servico=corte"), link);

    const vazio = linkDeAgendamento(BASE);
    ok("sem dados, é o /agendar limpo", vazio === `${BASE}/agendar`, vazio);

    const sujo = linkDeAgendamento(BASE, { fone: "123", dia: "amanhã" });
    ok("telefone curto e data inválida não entram", sujo === `${BASE}/agendar`, sujo);

    const comBarra = linkDeAgendamento(`${BASE}/`, { servico: "combo" });
    ok("não duplica a barra da base", comBarra === `${BASE}/agendar?servico=combo`, comBarra);
  }

  console.log("\n2. O atalho para abrir a conversa");
  {
    const wa = linkWaMe("41970007001", "Oi, tudo bem? Link: https://x.com/a b");
    ok("usa o formato internacional", wa.startsWith("https://wa.me/5541970007001"), wa);
    ok("leva o texto pronto e escapado", wa.includes("text=Oi%2C%20tudo%20bem%3F") && !wa.includes(" "), wa);
    const jaCom55 = linkWaMe("5541970007001", "x");
    ok("não repete o 55", jaCom55.startsWith("https://wa.me/5541970007001"), jaCom55);
    const convite = conviteDeAgendamento({ link: "L", nome: "João Silva", shopName: "Bryan Wesley" });
    ok("o convite chama pelo primeiro nome", convite.startsWith("Oi, João!"), convite);
    ok("e traz o link", convite.includes("L"));
  }

  console.log("\n3. Lendo o que a Meta manda");
  {
    const corpo = {
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: "5541970007001", profile: { name: "João" } }],
            messages: [
              { from: "5541970007001", type: "text", text: { body: " oi, tem horário? " } },
              { from: "5541970007001", type: "reaction", reaction: { emoji: "👍" } },
            ],
          },
        }],
      }],
    };
    const msgs = extrairMensagens(corpo);
    ok("pega só as mensagens de texto", msgs.length === 1, String(msgs.length));
    ok("com o número de quem escreveu", msgs[0]?.de === "5541970007001");
    ok("o texto sem espaço sobrando", msgs[0]?.texto === "oi, tem horário?", msgs[0]?.texto);
    ok("e o nome do perfil", msgs[0]?.nomeDoPerfil === "João");

    const toque = extrairMensagens({
      entry: [{ changes: [{ value: { messages: [
        { from: "5541970007001", type: "interactive",
          interactive: { type: "list_reply", list_reply: { id: "svc:3", title: "Corte" } } },
        { from: "5541970007001", type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "menu:voltar", title: "Não" } } },
      ] } }] }],
    });
    ok("o toque na lista vira escolha", toque[0]?.escolha === "svc:3", JSON.stringify(toque[0]));
    ok("o toque no botão também", toque[1]?.escolha === "menu:voltar", JSON.stringify(toque[1]));

    const audio = extrairMensagens({
      entry: [{ changes: [{ value: { messages: [{ from: "5541970007001", type: "audio" }] } }] }],
    });
    ok("áudio vale como um 'oi'", audio.length === 1 && audio[0].texto === "");

    ok("status de entrega não vira mensagem",
      extrairMensagens({ entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] }).length === 0);
    ok("corpo estranho não quebra",
      extrairMensagens({ foo: 1 }).length === 0 && extrairMensagens(null).length === 0);
  }

  console.log("\n4. O atendente abre a conversa com o menu");
  {
    const r = await processarMensagem({ de: "5541970007002", texto: "oi", nomeDoPerfil: "Maria Souza" });
    ok("responde", r.length === 1, String(r.length));
    ok("para o número certo", r[0]?.para === "41970007002", r[0]?.para);
    const m = r[0]?.mensagem;
    ok("com uma lista de opções", m?.tipo === "lista", m?.tipo);
    if (m?.tipo === "lista") {
      ok("chama pelo primeiro nome do perfil", m.corpo.startsWith("Oi, Maria!"), m.corpo.slice(0, 40));
      const ids = m.secoes[0].linhas.map((l) => l.id);
      ok("oferece marcar horário", ids.includes("menu:agendar"), ids.join(","));
      ok("e o endereço", ids.includes("menu:endereco"), ids.join(","));
      ok("sem 'meus horários' para quem não tem nenhum", !ids.includes("menu:meus"), ids.join(","));
      ok("cabe no limite da Meta (10 linhas)", m.secoes[0].linhas.length <= 10);
    }
  }

  console.log("\n5. Marcando do começo ao fim, só pelo WhatsApp");
  {
    const FONE2 = "41970007003";
    const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;

    // Passo 1: pediu para marcar → escolhe o serviço.
    const r1 = await processarMensagem({ de: `55${FONE2}`, escolha: "menu:agendar" });
    const m1 = r1[0]?.mensagem;
    ok("mostra os serviços", m1?.tipo === "lista", m1?.tipo);
    let idDoCorte = "";
    if (m1?.tipo === "lista") {
      const linha = m1.secoes[0].linhas.find((l) => l.id === `svc:${corte.id}`);
      idDoCorte = linha?.id ?? "";
      ok("com o corte na lista", Boolean(linha), m1.secoes[0].linhas.map((l) => l.titulo).join(","));
      ok("com preço e duração", (linha?.descricao ?? "").includes("R$"), linha?.descricao);
      ok("respeitando o limite de 10 linhas", m1.secoes[0].linhas.length <= 10);
    }

    // Passo 2: escolheu o serviço → vê os dias abertos.
    const r2 = await processarMensagem({ de: `55${FONE2}`, escolha: idDoCorte });
    const m2 = r2[0]?.mensagem;
    ok("mostra os dias abertos", m2?.tipo === "lista", m2?.tipo);
    let dia = "";
    if (m2?.tipo === "lista") {
      ok("só dias em que a barbearia abre",
        m2.secoes[0].linhas.every((l) => l.id.startsWith("day:")));
      ok("no máximo 10", m2.secoes[0].linhas.length <= 10);
      // O primeiro dia pode ser hoje já sem vaga; procura um com horários.
      for (const l of m2.secoes[0].linhas) {
        const teste = await processarMensagem({ de: `55${FONE2}`, escolha: l.id });
        if (teste[0]?.mensagem.tipo === "lista") { dia = l.id.slice(4); break; }
      }
      ok("algum dia com horário livre", Boolean(dia), "nenhum");
    }

    // Passo 3: escolheu o dia → vê os horários realmente livres.
    const r3 = await processarMensagem({ de: `55${FONE2}`, escolha: `day:${dia}` });
    const m3 = r3[0]?.mensagem;
    ok("mostra os horários do dia", m3?.tipo === "lista", m3?.tipo);
    let hora = "";
    if (m3?.tipo === "lista") {
      const linhas = m3.secoes[0].linhas.filter((l) => l.id.startsWith("time:"));
      hora = linhas[0]?.id.slice(5) ?? "";
      ok("com horários de verdade", /^\d{2}:\d{2}$/.test(hora), hora);
      ok("e no máximo 10 linhas", m3.secoes[0].linhas.length <= 10, String(m3.secoes[0].linhas.length));

      // O que a lista oferece tem de bater com a disponibilidade real.
      const { slots } = await getAvailability({
        dateKey: dia, durationMin: corte.durationMin, barberId: null,
      });
      const livres = new Set(slots.filter((s) => s.available).map((s) => s.time));
      ok("nenhum horário ocupado na lista",
        linhas.every((l) => livres.has(l.id.slice(5))), linhas.map((l) => l.titulo).join(","));
    }

    // Passo 4: escolheu a hora → como não há cadastro, pede o nome.
    const r4 = await processarMensagem({ de: `55${FONE2}`, escolha: `time:${hora}` });
    ok("pede o nome de quem ainda não é cliente",
      r4[0]?.mensagem.tipo === "texto" &&
      r4[0].mensagem.texto.toLowerCase().includes("nome"),
      JSON.stringify(r4[0]?.mensagem));

    const curto = await processarMensagem({ de: `55${FONE2}`, texto: "👍" });
    ok("nome vazio não fecha nada",
      curto[0]?.mensagem.tipo === "texto" && curto[0].mensagem.texto.includes("nome completo"),
      JSON.stringify(curto[0]?.mensagem));

    // Passo 5: disse o nome → o horário fecha e entra no sistema.
    const r5 = await processarMensagem({ de: `55${FONE2}`, texto: `${MARCA} Zap` });
    const m5 = r5[0]?.mensagem;
    ok("confirma na conversa", m5?.tipo === "texto" && m5.texto.includes("Tá marcado"),
      JSON.stringify(m5));

    const cli = await db.query.users.findFirst({ where: eq(users.phone, FONE2) });
    ok("criou o cliente no sistema", Boolean(cli), FONE2);
    const appt = cli
      ? (await db.select().from(appointments).where(eq(appointments.clientUserId, cli.id)))[0]
      : undefined;
    ok("e o agendamento na agenda", Boolean(appt));
    if (appt && m5?.tipo === "texto") {
      const parts = utcToShopParts(appt.startsAt);
      ok("no dia e hora escolhidos",
        parts.dateKey === dia && formatShopTime(appt.startsAt) === hora,
        `${parts.dateKey} ${formatShopTime(appt.startsAt)} ≠ ${dia} ${hora}`);
      ok("de pé na agenda", ["PENDENTE", "CONFIRMADO"].includes(appt.status), appt.status);
      ok("com o código na resposta", m5.texto.includes(appt.code), m5.texto);
      ok("marcado como vindo do WhatsApp", (appt.notes ?? "").includes("WhatsApp"), appt.notes ?? "");
      ok("com um barbeiro escolhido pelo sistema", appt.barberId > 0, String(appt.barberId));
    }

    // Confirmação e lembretes entram na fila como em qualquer agendamento.
    const fila = appt
      ? await db.select().from(notifications).where(eq(notifications.appointmentId, appt.id))
      : [];
    ok("a confirmação foi enfileirada",
      fila.some((n) => n.kind === "AGENDAMENTO_CRIADO"), fila.map((n) => n.kind).join(","));

    // Passo 6: o horário aparece em "meus horários" e dá para cancelar.
    const r6 = await processarMensagem({ de: `55${FONE2}`, escolha: "menu:meus" });
    const m6 = r6[0]?.mensagem;
    ok("lista o horário marcado", m6?.tipo === "lista", m6?.tipo);
    if (m6?.tipo === "lista" && appt) {
      ok("com o id certo para cancelar",
        m6.secoes[0].linhas.some((l) => l.id === `cancelar:${appt.id}`),
        m6.secoes[0].linhas.map((l) => l.id).join(","));
    }

    if (appt) {
      const r7 = await processarMensagem({ de: `55${FONE2}`, escolha: `cancelar:${appt.id}` });
      ok("pergunta antes de cancelar", r7[0]?.mensagem.tipo === "botoes", r7[0]?.mensagem.tipo);

      // O horário é de outra pessoa: o telefone da conversa manda.
      const intruso = await processarMensagem({ de: "5541970007009", escolha: `cancelarsim:${appt.id}` });
      ok("ninguém cancela o horário alheio",
        intruso[0]?.mensagem.tipo === "texto" &&
        intruso[0].mensagem.texto.includes("no seu nome"),
        JSON.stringify(intruso[0]?.mensagem));
      const aindaLa = await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) });
      ok("e o horário continua de pé",
        ["PENDENTE", "CONFIRMADO"].includes(aindaLa?.status ?? ""), aindaLa?.status);

      const r8 = await processarMensagem({ de: `55${FONE2}`, escolha: `cancelarsim:${appt.id}` });
      ok("o dono cancela", r8[0]?.mensagem.tipo === "texto" &&
        r8[0].mensagem.texto.startsWith("Cancelado"), JSON.stringify(r8[0]?.mensagem));
      const depois = await db.query.appointments.findFirst({ where: eq(appointments.id, appt.id) });
      ok("e o sistema registra o cancelamento", depois?.status === "CANCELADO", depois?.status);
    }
  }

  console.log("\n6. Quem já é cliente não repete o nome");
  {
    const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
    const barbeiro = (await db.query.barbers.findFirst())!;
    await db.insert(users).values({ name: `${MARCA} Cliente`, phone: FONE, role: "CLIENT" });
    const cli = (await db.query.users.findFirst({ where: eq(users.phone, FONE) }))!;
    const { dia, hora } = await diaComVaga(barbeiro.id, corte.durationMin);
    const appt = await createBooking({
      serviceIds: [corte.id], dateKey: dia, time: hora, barberId: barbeiro.id,
      clientName: cli.name, clientPhone: cli.phone, userId: cli.id,
    });

    const menu = await processarMensagem({ de: `55${FONE}`, texto: "oi" });
    const m = menu[0]?.mensagem;
    ok("o menu chama pelo nome do cadastro",
      m?.tipo === "lista" && m.corpo.includes("ZZWhats"), JSON.stringify(m)?.slice(0, 60));
    ok("e oferece 'meus horários'",
      m?.tipo === "lista" && m.secoes[0].linhas.some((l) => l.id === "menu:meus"));

    const meus = await processarMensagem({ de: `55${FONE}`, escolha: "menu:meus" });
    const mm = meus[0]?.mensagem;
    ok("que mostra o código do horário",
      mm?.tipo === "lista" && mm.secoes[0].linhas.some((l) => (l.descricao ?? "").includes(appt.code)),
      JSON.stringify(mm)?.slice(0, 120));
  }

  console.log("\n7. Os limites da conversa");
  {
    const r = await processarMensagem({ de: "123", texto: "oi" });
    ok("número inválido não vira resposta", r.length === 0, JSON.stringify(r));

    // Conversa esquecida no meio do caminho não sobrevive ao dia seguinte.
    await processarMensagem({ de: "5541970007004", escolha: "menu:agendar" });
    const antes = await db.select().from(whatsappSessions)
      .where(eq(whatsappSessions.phone, "41970007004"));
    ok("a conversa fica guardada enquanto está em curso", antes.length === 1);
    await db.update(whatsappSessions)
      .set({ updatedAt: new Date(Date.now() - VALIDADE_SESSAO_MS - 60_000) })
      .where(eq(whatsappSessions.phone, "41970007004"));
    const limpas = await limparSessoesVelhas();
    ok("e some quando envelhece", limpas >= 1, String(limpas));

    // Escolha forjada não derruba nada: volta para o menu.
    const forjada = await processarMensagem({ de: "5541970007005", escolha: "svc:999999" });
    ok("serviço inexistente volta para a lista",
      forjada[0]?.mensagem.tipo === "lista" || forjada[0]?.mensagem.tipo === "texto",
      JSON.stringify(forjada[0]?.mensagem)?.slice(0, 80));
    const lixo = await processarMensagem({ de: "5541970007005", escolha: "xxx:yyy" });
    ok("opção desconhecida cai no menu", lixo[0]?.mensagem.tipo === "lista",
      JSON.stringify(lixo[0]?.mensagem)?.slice(0, 80));
  }

  await limpar();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
