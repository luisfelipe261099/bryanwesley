// O que a pessoa digita no WhatsApp, sem banco nem rede: números,
// "sábado", "15h", "meu nome é", o texto numerado do WAHA, o nono
// dígito, os eventos do WAHA e a conferência do que o Gemini devolve.
import {
  casarOpcao, dataDigitada, horaDigitada, limparNome, tituloDoDia,
  intencaoPorPalavras, servicosCitados, ehAtalhoDeMenu,
} from "../lib/whatsapp-texto";
import { paraTexto, opcoesDe, type MensagemSaida } from "../lib/providers/whatsapp";
import { telefoneDoWhatsapp } from "../lib/phone";
import { lerEventoWaha, extrairMensagens, chaveDaMensagem } from "../lib/whatsapp-inbox";
import { interpretar, validar, type ContextoIa } from "../lib/whatsapp-ia";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));
const igual = (l: string, veio: unknown, esperado: unknown) =>
  ok(l, JSON.stringify(veio) === JSON.stringify(esperado), `veio ${JSON.stringify(veio)}, esperado ${JSON.stringify(esperado)}`);

const HOJE = "2026-09-23"; // quarta-feira

async function main() {
  console.log("\n1. Horário digitado");
  igual("15h", horaDigitada("15h"), "15:00");
  igual("15:30", horaDigitada("15:30"), "15:30");
  igual("15h30", horaDigitada("15h30"), "15:30");
  igual("15.30", horaDigitada("15.30"), "15:30");
  igual("às 3 da tarde", horaDigitada("às 3 da tarde"), "15:00");
  igual("8 da noite", horaDigitada("8 da noite"), "20:00");
  igual("9 da manhã", horaDigitada("9 da manhã"), "09:00");
  igual("15 e meia", horaDigitada("15 e meia"), "15:30");
  igual("meio-dia", horaDigitada("meio-dia"), "12:00");
  igual("hora no meio da frase", horaDigitada("tem às 16h amanhã?"), "16:00");
  igual("18 sozinho é hora", horaDigitada("18"), "18:00");
  igual("9 sozinho é opção, não hora", horaDigitada("9"), null);
  igual("25h não existe", horaDigitada("25h"), null);
  igual("frase sem hora", horaDigitada("quero cortar"), null);

  console.log("\n2. Dia digitado (hoje é quarta, 23/09)");
  igual("hoje", dataDigitada("hoje", HOJE), "2026-09-23");
  igual("amanhã", dataDigitada("amanhã", HOJE), "2026-09-24");
  igual("depois de amanhã", dataDigitada("depois de amanhã", HOJE), "2026-09-25");
  igual("sábado", dataDigitada("sábado", HOJE), "2026-09-26");
  igual("quarta é hoje", dataDigitada("quarta", HOJE), "2026-09-23");
  igual("quarta que vem pula uma semana", dataDigitada("quarta que vem", HOJE), "2026-09-30");
  igual("26/09", dataDigitada("26/09", HOJE), "2026-09-26");
  igual("1/10", dataDigitada("1/10", HOJE), "2026-10-01");
  igual("dia 5 cai no mês que vem", dataDigitada("dia 5", HOJE), "2026-10-05");
  igual("31/09 não existe", dataDigitada("31/09", HOJE), null);
  igual("26 solto só quando o dia é a pergunta", dataDigitada("26", HOJE), null);
  igual("26 solto na pergunta do dia", dataDigitada("26", HOJE, { numeroSolto: true }), "2026-09-26");
  igual("dia no meio da frase", dataDigitada("quero sábado às 15h", HOJE), "2026-09-26");

  console.log("\n3. Resposta a uma opção");
  const servicos = [
    { id: "svc:1", titulo: "Corte" },
    { id: "svc:2", titulo: "Barba" },
    { id: "svc:3", titulo: "Corte + Barba" },
    { id: "svc:4", titulo: "Sobrancelha" },
  ];
  igual("pelo número", casarOpcao("2", servicos), "svc:2");
  igual("número com ponto", casarOpcao("1.", servicos), "svc:1");
  igual("'opção 3'", casarOpcao("opção 3", servicos), "svc:3");
  igual("número fora da lista", casarOpcao("7", servicos), null);
  igual("pelo nome exato", casarOpcao("corte", servicos), "svc:1");
  igual("maiúscula e acento não importam", casarOpcao("CORTE", servicos), "svc:1");
  igual("'corte e barba' é o combo", casarOpcao("corte e barba", servicos), "svc:3");
  igual("pedaço que só uma opção tem", casarOpcao("sobran", servicos), "svc:4");
  const dias = [
    { id: "day:2026-09-23", titulo: "Hoje, 23/09" },
    { id: "day:2026-09-24", titulo: "Amanhã, 24/09" },
    { id: "day:2026-09-26", titulo: "Sábado, 26/09" },
  ];
  igual("'amanhã' na lista de dias", casarOpcao("amanhã", dias), "day:2026-09-24");
  igual("'sabado' sem acento", casarOpcao("sabado", dias), "day:2026-09-26");
  igual("'26/09'", casarOpcao("26/09", dias), "day:2026-09-26");
  const horas = [
    { id: "time:09:00", titulo: "09:00" },
    { id: "time:15:00", titulo: "15:00" },
    { id: "mais:9", titulo: "Ver mais horários" },
  ];
  igual("'15h' na lista de horários", casarOpcao("15h", horas), "time:15:00");
  igual("'ver mais'", casarOpcao("ver mais", horas), "mais:9");
  const confirmar = [
    { id: "confirmar:sim", titulo: "Confirmar" },
    { id: "confirmar:outro", titulo: "Outro horário" },
  ];
  igual("'sim' confirma", casarOpcao("Sim!", confirmar), "confirmar:sim");
  igual("'pode marcar' confirma", casarOpcao("pode marcar", confirmar), "confirmar:sim");
  igual("👍 confirma", casarOpcao("👍", confirmar), "confirmar:sim");
  igual("'não' pede outro horário", casarOpcao("não", confirmar), "confirmar:outro");
  const cancelar = [
    { id: "cancelarsim:9", titulo: "Sim, cancelar" },
    { id: "menu:voltar", titulo: "Não, manter" },
  ];
  igual("'sim' cancela", casarOpcao("sim", cancelar), "cancelarsim:9");
  igual("'não' mantém", casarOpcao("nao", cancelar), "menu:voltar");

  console.log("\n4. Nome, atalhos e assunto");
  igual("tira 'meu nome é'", limparNome("Meu nome é Maria Souza"), "Maria Souza");
  igual("arruma maiúsculas", limparNome("joão da silva"), "João da Silva");
  igual("tira emoji", limparNome("🙂 Ana"), "Ana");
  igual("TUDO MAIÚSCULO vira nome", limparNome("JOÃO DA SILVA"), "João da Silva");
  igual("maiúscula de propósito fica", limparNome("Ronald McDonald"), "Ronald McDonald");
  igual("'ok' não é nome", limparNome("ok"), null);
  igual("número não é nome", limparNome("1"), null);
  ok("'oi' e 'menu' recomeçam", ehAtalhoDeMenu("Oi!") && ehAtalhoDeMenu("MENU") && ehAtalhoDeMenu("bom dia"));
  ok("frase comum não recomeça", !ehAtalhoDeMenu("oi, quero cortar"));
  igual("quero marcar", intencaoPorPalavras("quero marcar"), "agendar");
  igual("cancelar", intencaoPorPalavras("preciso cancelar meu horário"), "meus");
  igual("onde fica", intencaoPorPalavras("onde fica a barbearia?"), "endereco");
  const catalogo = [
    { id: 1, name: "Corte" }, { id: 2, name: "Barba" },
    { id: 3, name: "Corte + Barba" }, { id: 4, name: "Sobrancelha" },
  ];
  igual("serviço citado", servicosCitados("quero corte sábado", catalogo), [1]);
  igual("combo citado leva o combo", servicosCitados("corte e barba amanhã", catalogo), [3]);
  igual("'cortei' não é 'corte'", servicosCitados("cortei ontem", catalogo), []);
  igual("título do dia", [tituloDoDia("2026-09-23", HOJE), tituloDoDia("2026-09-24", HOJE), tituloDoDia("2026-09-26", HOJE)],
    ["Hoje, 23/09", "Amanhã, 24/09", "Sábado, 26/09"]);

  console.log("\n5. O menu em texto numerado (WAHA)");
  const lista: MensagemSaida = {
    tipo: "lista",
    corpo: "Qual serviço?",
    rodape: "Depois o dia",
    botao: "Ver",
    secoes: [{ linhas: [{ id: "svc:1", titulo: "Corte", descricao: "R$ 45" }, { id: "svc:2", titulo: "Barba" }] }],
  };
  const txt = paraTexto(lista);
  ok("numera as opções", txt.includes("*1.* Corte — R$ 45") && txt.includes("*2.* Barba"), txt);
  ok("traz o rodapé e a instrução", txt.includes("_Depois o dia_") && txt.includes("Responda com o número"), txt);
  igual("a ordem guardada é a mesma da numeração", opcoesDe(lista).map((o) => o.id), ["svc:1", "svc:2"]);
  const botoes: MensagemSaida = { tipo: "botoes", corpo: "Confirma?", botoes: [{ id: "a", titulo: "Sim" }, { id: "b", titulo: "Não" }] };
  ok("botões também viram números", paraTexto(botoes).includes("*1.* Sim") && paraTexto(botoes).includes("*2.* Não"));
  igual("texto passa igual", paraTexto({ tipo: "texto", texto: "oi" }), "oi");

  console.log("\n6. O nono dígito");
  igual("celular de Curitiba sem o 9 ganha o 9", telefoneDoWhatsapp("554188887777@c.us"), "41988887777");
  igual("com o 9 fica igual", telefoneDoWhatsapp("5541988887777@s.whatsapp.net"), "41988887777");
  igual("fixo não ganha 9", telefoneDoWhatsapp("554133334444@c.us"), "4133334444");
  const meta = extrairMensagens({ entry: [{ changes: [{ value: { messages: [
    { id: "wamid.X", from: "554188887777", type: "text", text: { body: "oi" } },
  ] } }] }] });
  igual("a Cloud API também passa pelo ajuste", meta[0]?.de, "41988887777");
  igual("e traz o id da mensagem", meta[0]?.id, "wamid.X");
  ok("a chave de repetição é curta e estável",
    chaveDaMensagem("x".repeat(300)).length <= 80 && chaveDaMensagem("a") === chaveDaMensagem("a") &&
    chaveDaMensagem("a") !== chaveDaMensagem("b"));

  console.log("\n7. Eventos do WAHA");
  const base = { event: "message.any", session: "default" };
  const entrada = lerEventoWaha({ ...base, payload: {
    id: "false_554188887777@c.us_AAA", from: "554188887777@c.us", fromMe: false, body: " oi ",
    hasMedia: false, _data: { notifyName: "João" },
  } }, "default");
  ok("mensagem de cliente", entrada.tipo === "mensagem", entrada.tipo);
  if (entrada.tipo === "mensagem") {
    igual("com o telefone já com o 9", entrada.de, "41988887777");
    igual("responde para a mesma conversa", entrada.chatId, "554188887777@c.us");
    igual("texto limpo", entrada.texto, "oi");
    igual("nome do perfil", entrada.nomeDoPerfil, "João");
  }
  const doSistema = lerEventoWaha({ ...base, payload: { id: "true_x_1", from: "me", to: "5541988887777@c.us", fromMe: true, source: "api", body: "menu" } });
  igual("o que o sistema mandou é ignorado", doSistema.tipo, "ignorar");
  const doCelular = lerEventoWaha({ ...base, payload: { id: "true_x_2", from: "me", to: "5541988887777@c.us", fromMe: true, source: "app", body: "Oi, é o Bryan" } });
  ok("o que a barbearia mandou pelo celular pausa o atendente", doCelular.tipo === "humano" && doCelular.de === "41988887777", JSON.stringify(doCelular));
  igual("grupo é ignorado", lerEventoWaha({ ...base, payload: { id: "g1", from: "1203@g.us", fromMe: false, body: "oi" } }).tipo, "ignorar");
  igual("status é ignorado", lerEventoWaha({ ...base, payload: { id: "s1", from: "status@broadcast", fromMe: false, body: "oi" } }).tipo, "ignorar");
  igual("outra sessão é ignorada", lerEventoWaha({ ...base, session: "outra", payload: { id: "o1", from: "5541988887777@c.us", body: "oi" } }, "default").tipo, "ignorar");
  igual("outro evento é ignorado", lerEventoWaha({ event: "session.status", session: "default", payload: {} }).tipo, "ignorar");
  const lidComAlt = lerEventoWaha({ ...base, payload: { id: "l1", from: "123456@lid", fromMe: false, body: "oi",
    _data: { key: { remoteJidAlt: "554188887777@s.whatsapp.net" } } } });
  ok("@lid com o número alternativo", lidComAlt.tipo === "mensagem" && lidComAlt.de === "41988887777" && lidComAlt.chatId === "123456@lid", JSON.stringify(lidComAlt));
  const lidSem = lerEventoWaha({ ...base, payload: { id: "l2", from: "123456@lid", fromMe: false, body: "oi" } });
  ok("@lid sem número fica para a rota perguntar ao WAHA", lidSem.tipo === "mensagem" && lidSem.de === null);
  const audio = lerEventoWaha({ ...base, payload: { id: "a1", from: "5541988887777@c.us", fromMe: false, body: "", hasMedia: true } });
  ok("áudio chega marcado como mídia", audio.tipo === "mensagem" && audio.midia && audio.texto === "");

  console.log("\n8. O Gemini não decide sozinho");
  const ctx: ContextoIa = {
    hoje: HOJE,
    calendario: [{ dateKey: "2026-09-23", semana: "quarta-feira" }, { dateKey: "2026-09-26", semana: "sábado" }],
    servicos: [{ id: 1, nome: "Corte" }, { id: 2, nome: "Barba" }],
    etapa: "menu",
  };
  igual("resposta boa passa", validar({ intencao: "agendar", servicos: [1], data: "2026-09-26", hora: "15:00", periodo: null }, ctx),
    { intencao: "agendar", servicoIds: [1], dateKey: "2026-09-26", hora: "15:00", periodo: null });
  igual("serviço inventado cai", validar({ intencao: "agendar", servicos: [1, 999], data: null, hora: null, periodo: null }, ctx)?.servicoIds, [1]);
  igual("data fora do calendário cai", validar({ intencao: "agendar", servicos: [], data: "2026-12-25", hora: null, periodo: null }, ctx)?.dateKey, null);
  igual("hora torta cai", validar({ intencao: "agendar", servicos: [], data: null, hora: "3pm", periodo: null }, ctx)?.hora, null);
  igual("intenção desconhecida não vale", validar({ intencao: "comprar", servicos: [] }, ctx), null);

  process.env.GEMINI_API_KEY = "chave-de-teste";
  const pedidos: { url: string; corpo: Record<string, unknown> }[] = [];
  const falso = (respostas: { status: number; corpo: unknown }[]) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? "{}")) });
      const r = respostas.shift()!;
      return new Response(JSON.stringify(r.corpo), { status: r.status });
    }) as typeof fetch;
  const resposta = (obj: unknown, cercado = false) => ({
    candidates: [{ content: { parts: [{ text: cercado ? "```json\n" + JSON.stringify(obj) + "\n```" : JSON.stringify(obj) }] } }],
  });

  const r1 = await interpretar("corte sábado 15h", ctx, {
    fetch: falso([{ status: 200, corpo: resposta({ intencao: "agendar", servicos: [1], data: "2026-09-26", hora: "15:00", periodo: null }) }]),
  });
  igual("interpreta a frase", r1, { intencao: "agendar", servicoIds: [1], dateKey: "2026-09-26", hora: "15:00", periodo: null });
  ok("manda o calendário e os serviços, sem telefone",
    JSON.stringify(pedidos[0].corpo).includes("2026-09-26: sábado") && JSON.stringify(pedidos[0].corpo).includes("1: Corte") &&
    !/\d{10,}/.test(JSON.stringify(pedidos[0].corpo)), JSON.stringify(pedidos[0].corpo).slice(0, 200));
  ok("pede JSON com esquema", JSON.stringify(pedidos[0].corpo).includes("responseSchema"));

  const r2 = await interpretar("oi", ctx, {
    fetch: falso([{ status: 200, corpo: resposta({ intencao: "saudacao", servicos: [], data: null, hora: null, periodo: null }, true) }]),
  });
  igual("JSON cercado por ``` também serve", r2?.intencao, "saudacao");

  pedidos.length = 0;
  const r3 = await interpretar("oi", ctx, {
    fetch: falso([
      { status: 400, corpo: { error: { message: "schema" } } },
      { status: 200, corpo: resposta({ intencao: "saudacao", servicos: [], data: null, hora: null, periodo: null }) },
    ]),
  });
  ok("esquema recusado: tenta de novo sem ele", r3?.intencao === "saudacao" && pedidos.length === 2 &&
    !JSON.stringify(pedidos[1].corpo).includes("responseSchema"));

  igual("limite do plano grátis (429): volta para o menu",
    await interpretar("oi", ctx, { fetch: falso([{ status: 429, corpo: {} }]) }), null);
  igual("resposta que não é JSON: volta para o menu",
    await interpretar("oi", ctx, { fetch: falso([{ status: 200, corpo: { candidates: [{ content: { parts: [{ text: "não sei" }] } }] } }]) }), null);
  igual("rede caída: volta para o menu",
    await interpretar("oi", ctx, { fetch: (async () => { throw new Error("offline"); }) as typeof fetch }), null);
  delete process.env.GEMINI_API_KEY;
  igual("sem chave nem tenta", await interpretar("oi", ctx, { fetch: falso([]) }), null);

  console.log(`\n${p} passaram · ${f} falharam`);
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
