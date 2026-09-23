// O WhatsApp pelo WAHA, de ponta a ponta — com um WAHA (e um Gemini) de
// mentira no lugar dos de verdade. A rota do webhook, o atendente, o
// banco e o despacho são os reais: a conversa em texto numerado marca o
// horário na agenda, a barbearia assume pelo celular e o atendente se
// cala, o lembrete sai pelo WAHA para o número certo.
import "../db/load-env";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { db, pool } from "../db/client";
import {
  appointments, appointmentServices, appointmentCommissions, notifications,
  rateLimits, users, whatsappSessions, services as sv,
} from "../db/schema";
import { eq, inArray, like, or } from "drizzle-orm";
import { POST as webhookWaha } from "../app/api/whatsapp/waha/route";
import { queueFreeText } from "../lib/notifications";
import { runDispatch } from "../lib/dispatch";
import { getAvailability, getSettings, listOpenDays } from "../lib/schedule";
import { wahaConectar, wahaStatus, wahaCodigoDePareamento, wahaQr } from "../lib/providers/waha";
import { provedorAtivo } from "../lib/providers/whatsapp";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));

const MARCA = "ZZWaha";
const CHAVE_API = "chave-do-waha";
const CHAVE_HMAC = "segredo-do-webhook";

// ───────────── O WAHA (e o Gemini) de mentira ─────────────
type Chamada = { metodo: string; caminho: string; corpo: Record<string, unknown> | null; chave: string | null };
const chamadas: Chamada[] = [];
const falso = {
  sessao: { existe: true, status: "WORKING", config: null as unknown },
  semWhatsapp: new Set<string>(["5541970008099"]),
  lids: { "999888777@lid": "5541970008005@c.us" } as Record<string, string>,
  gemini: { status: 200, resposta: null as unknown },
};

function servidorFalso() {
  return http.createServer((req, res) => {
    let cru = "";
    req.on("data", (c) => (cru += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const corpo = cru ? JSON.parse(cru) : null;
      chamadas.push({ metodo: req.method ?? "", caminho: url.pathname + url.search, corpo, chave: (req.headers["x-api-key"] as string) ?? null });
      const json = (s: number, o: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };

      if (url.pathname.startsWith("/v1beta/models/")) {
        if (falso.gemini.status !== 200) return json(falso.gemini.status, { error: {} });
        return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(falso.gemini.resposta) }] } }] });
      }
      if (req.headers["x-api-key"] !== CHAVE_API) return json(401, { error: "chave" });

      if (url.pathname === "/api/contacts/check-exists") {
        const fone = url.searchParams.get("phone") ?? "";
        if (falso.semWhatsapp.has(fone)) return json(200, { numberExists: false });
        // Celular antigo: o WhatsApp registrou sem o nono dígito.
        const semNove = fone.length === 13 ? fone.slice(0, 4) + fone.slice(5) : fone;
        return json(200, { numberExists: true, chatId: `${semNove}@c.us` });
      }
      if (url.pathname === "/api/sendText") return json(201, { id: { _serialized: `true_${corpo?.chatId}_${chamadas.length}` } });
      if (["/api/sendSeen", "/api/startTyping", "/api/stopTyping"].includes(url.pathname)) return json(200, {});
      const lid = url.pathname.match(/^\/api\/default\/lids\/(.+)$/);
      if (lid) {
        const pn = falso.lids[decodeURIComponent(lid[1])];
        return pn ? json(200, { lid: decodeURIComponent(lid[1]), pn }) : json(404, {});
      }
      if (url.pathname === "/api/sessions/default" && req.method === "GET") {
        if (!falso.sessao.existe) return json(404, {});
        return json(200, { name: "default", status: falso.sessao.status, me: { id: "5541999990000@c.us", pushName: "Bryan Wesley" }, config: falso.sessao.config });
      }
      if (url.pathname === "/api/sessions" && req.method === "POST") {
        falso.sessao = { existe: true, status: "SCAN_QR_CODE", config: corpo?.config };
        return json(201, { name: "default" });
      }
      if (url.pathname === "/api/sessions/default" && req.method === "PUT") {
        falso.sessao.config = corpo?.config;
        return json(200, {});
      }
      if (url.pathname === "/api/sessions/default/start") { falso.sessao.status = "STARTING"; return json(201, {}); }
      if (url.pathname === "/api/default/auth/qr") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); }
      if (url.pathname === "/api/default/auth/request-code") return json(201, { code: "ABCD-EFGH" });
      json(404, { error: "rota do WAHA falso" });
    });
  });
}

// ───────────── Conversando pelo webhook ─────────────
let seq = 0;
async function evento(payload: Record<string, unknown>, opts: { assinar?: boolean; chave?: string; sessao?: string } = {}) {
  const corpo = JSON.stringify({ id: `evt_${++seq}`, event: "message.any", session: opts.sessao ?? "default", payload });
  const assinatura = createHmac("sha512", opts.chave ?? CHAVE_HMAC).update(corpo).digest("hex");
  const antes = chamadas.length;
  const res = await webhookWaha(new Request("http://localhost/api/whatsapp/waha", {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.assinar === false ? {} : { "x-webhook-hmac": assinatura }) },
    body: corpo,
  }));
  const novas = chamadas.slice(antes);
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
    textos: novas.filter((c) => c.caminho === "/api/sendText").map((c) => String(c.corpo?.text ?? "")),
    para: novas.filter((c) => c.caminho === "/api/sendText").map((c) => String(c.corpo?.chatId ?? "")),
    chamadas: novas,
  };
}
let ultimoPayload: Record<string, unknown> = {};
const cliente = (chatId: string, texto: string, extra: Record<string, unknown> = {}) => {
  ultimoPayload = { id: `false_${chatId}_${++seq}`, from: chatId, to: "5541999990000@c.us", fromMe: false, body: texto, hasMedia: false, ...extra };
  return evento(ultimoPayload);
};

/** O número da opção cujo texto contém `trecho`, lido do menu numerado. */
function numeroDe(texto: string, trecho: string | RegExp) {
  for (const linha of texto.split("\n")) {
    const m = linha.match(/^\*(\d+)\.\* (.*)$/);
    if (m && (typeof trecho === "string" ? m[2].includes(trecho) : trecho.test(m[2]))) return m[1];
  }
  return null;
}

async function limpar() {
  const gente = await db.select({ id: users.id }).from(users).where(like(users.name, `${MARCA}%`));
  const ids = gente.map((u) => u.id);
  await db.delete(rateLimits).where(or(like(rateLimits.chave, "wa%"), like(rateLimits.chave, "ia:%")));
  await db.delete(whatsappSessions).where(like(whatsappSessions.phone, "41970008%"));
  await db.delete(notifications).where(like(notifications.phone, "41970008%"));
  if (!ids.length) return;
  const appts = await db.select({ id: appointments.id }).from(appointments).where(inArray(appointments.clientUserId, ids));
  const apptIds = appts.map((a) => a.id);
  if (apptIds.length) {
    await db.delete(appointmentCommissions).where(inArray(appointmentCommissions.appointmentId, apptIds));
    await db.delete(appointmentServices).where(inArray(appointmentServices.appointmentId, apptIds));
    await db.delete(notifications).where(inArray(notifications.appointmentId, apptIds));
    await db.delete(appointments).where(inArray(appointments.id, apptIds));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

async function main() {
  const srv = servidorFalso();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const porta = (srv.address() as AddressInfo).port;
  // Só o WAHA: a Cloud API fica de fora para o teste não depender do .env.
  for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "GEMINI_API_KEY", "WHATSAPP_PROVIDER"]) delete process.env[k];
  process.env.WAHA_URL = `http://127.0.0.1:${porta}`;
  process.env.WAHA_API_KEY = CHAVE_API;
  process.env.WAHA_HMAC_KEY = CHAVE_HMAC;
  process.env.GEMINI_API_BASE = `http://127.0.0.1:${porta}`;
  await limpar();

  console.log("\n1. A porta do webhook");
  {
    ok("com o WAHA configurado, ele é o provedor", provedorAtivo() === "waha", String(provedorAtivo()));
    const r1 = await evento({ id: "x1", from: "5541970008001@c.us", fromMe: false, body: "oi" }, { assinar: false });
    ok("sem assinatura: 401", r1.status === 401, String(r1.status));
    const r2 = await evento({ id: "x2", from: "5541970008001@c.us", fromMe: false, body: "oi" }, { chave: "outra" });
    ok("assinatura com outra chave: 401", r2.status === 401, String(r2.status));
    delete process.env.WAHA_HMAC_KEY;
    const r3 = await evento({ id: "x3", from: "5541970008001@c.us", fromMe: false, body: "oi" });
    ok("sem WAHA_HMAC_KEY no site: 503", r3.status === 503, String(r3.status));
    process.env.WAHA_HMAC_KEY = CHAVE_HMAC;
    const grupo = await evento({ id: "g1", from: "120363@g.us", fromMe: false, body: "oi" });
    ok("grupo é ignorado", grupo.json.ignorada !== undefined && grupo.textos.length === 0, JSON.stringify(grupo.json));
    const outra = await evento({ id: "o1", from: "5541970008001@c.us", fromMe: false, body: "oi" }, { sessao: "outra" });
    ok("outra sessão é ignorada", outra.json.ignorada !== undefined && outra.textos.length === 0);
    await limpar();
  }

  console.log("\n2. Marcando do zero, só respondendo números");
  const corte = (await db.query.services.findFirst({ where: eq(sv.slug, "corte") }))!;
  let codigo = "";
  {
    const ZAP = "5541970008001@c.us";
    const r = await cliente(ZAP, "oi", { _data: { notifyName: "Zé" } });
    ok("responde", r.textos.length === 1, JSON.stringify(r.json));
    ok("para a mesma conversa", r.para[0] === ZAP, r.para[0]);
    ok("com visto e 'digitando…' antes", ["/api/sendSeen", "/api/startTyping", "/api/stopTyping"].every((c) => r.chamadas.some((x) => x.caminho === c)));
    ok("com a chave do WAHA", r.chamadas.every((c) => c.chave === CHAVE_API));
    ok("menu numerado", /\*1\.\* Marcar horário/.test(r.textos[0]) && r.textos[0].includes("Responda com o número"), r.textos[0]);
    ok("chama pelo nome do perfil", r.textos[0].startsWith("Oi, Zé!"), r.textos[0].slice(0, 30));

    const repetida = await evento(ultimoPayload);
    ok("a mesma mensagem reenviada não vira outra resposta", repetida.json.repetida === true && repetida.textos.length === 0, JSON.stringify(repetida.json));

    const r2 = await cliente(ZAP, numeroDe(r.textos[0], "Marcar horário")!);
    const nCorte = numeroDe(r2.textos[0], `${corte.name} —`);
    ok("mostra os serviços numerados", Boolean(nCorte), r2.textos[0]);

    const r3 = await cliente(ZAP, nCorte!);
    ok("mostra os dias numerados", /\*1\.\* (Hoje|Amanhã|[A-ZÁ][a-zçá]+), \d{2}\/\d{2}/.test(r3.textos[0]), r3.textos[0]);

    // Procura um dia com horário: o primeiro pode já ter lotado (aí a
    // lista de dias volta, com a mesma numeração).
    let horarios = "";
    for (let i = 1; i <= 9 && !horarios; i++) {
      const rDia = await cliente(ZAP, String(i));
      const ultimo = rDia.textos[rDia.textos.length - 1] ?? "";
      if (ultimo.includes("estes horários estão livres")) horarios = ultimo;
      else if (!ultimo.includes("Para que dia")) break;
    }
    ok("mostra os horários livres numerados", /\*1\.\* \d{2}:\d{2}/.test(horarios), horarios.slice(0, 120));
    const primeiraHora = horarios.match(/\*1\.\* (\d{2}:\d{2})/)?.[1] ?? "";

    const r5 = await cliente(ZAP, "1");
    ok("pede o nome de quem é novo", /nome completo/i.test(r5.textos[0] ?? ""), r5.textos[0]);

    const r6 = await cliente(ZAP, `meu nome é ${MARCA} Numeros`);
    ok("fecha e confirma na conversa", (r6.textos[0] ?? "").includes("Tá marcado"), r6.textos[0]);
    codigo = r6.textos[0]?.match(/código: ([A-Z0-9]{6})/i)?.[1] ?? "";

    const cli = await db.query.users.findFirst({ where: eq(users.phone, "41970008001") });
    ok("o cliente entrou no cadastro com o nome certo", cli?.name === `${MARCA} Numeros`, cli?.name);
    const appt = cli ? (await db.select().from(appointments).where(eq(appointments.clientUserId, cli.id)))[0] : undefined;
    ok("o horário está na agenda", Boolean(appt) && appt!.code === codigo, `${appt?.code} vs ${codigo}`);
    ok("no horário escolhido", Boolean(appt) && r6.textos[0].includes(primeiraHora), `${primeiraHora} · ${r6.textos[0]}`);
    ok("marcado como vindo do WhatsApp", (appt?.notes ?? "").includes("WhatsApp"));
  }

  console.log("\n3. Escrevendo em vez de escolher");
  {
    const ZAP = "5541970008003@c.us";
    await cliente(ZAP, "oi");
    const r0 = await cliente(ZAP, "quero marcar um corte");
    const ambos = await db.select().from(sv).where(like(sv.name, "Corte%"));
    ok("'corte' com dois cortes no catálogo: pergunta qual, só com eles",
      (r0.textos.at(-1) ?? "").startsWith("Qual deles?") && ambos.every((a) => r0.textos.at(-1)!.includes(a.name)) &&
      (r0.textos.at(-1) ?? "").includes("Ver todos os serviços"), r0.textos.at(-1));
    const r1 = await cliente(ZAP, corte.name.toLowerCase());
    ok("o nome do serviço digitado pula para o dia", (r1.textos.at(-1) ?? "").includes("Para que dia"), r1.textos.at(-1));

    const settings = await getSettings();
    const dias = listOpenDays(settings, 14);
    let dia = "", hora = "";
    for (const d of dias) {
      const { slots } = await getAvailability({ dateKey: d.dateKey, durationMin: corte.durationMin, barberId: null });
      const livres = slots.filter((s) => s.available);
      if (livres.length >= 2) { dia = d.dateKey; hora = livres[1].time; break; }
    }
    const [, mm, dd] = dia.split("-");
    const r2 = await cliente(ZAP, `${dd}/${mm}`);
    ok("a data digitada abre os horários daquele dia", (r2.textos.at(-1) ?? "").includes("estes horários estão livres"), r2.textos.at(-1));

    const r3 = await cliente(ZAP, `${Number(hora.slice(0, 2))}h${hora.slice(3) === "00" ? "" : hora.slice(3)}`);
    ok("a hora digitada vale como escolha", /nome completo/i.test(r3.textos[0] ?? ""), `${hora} → ${r3.textos[0]}`);

    const r4 = await cliente(ZAP, "ok");
    ok("'ok' não vira nome", /nome completo/i.test(r4.textos[0] ?? ""), r4.textos[0]);
    const r5 = await cliente(ZAP, `${MARCA} Digitado`);
    ok("e o horário fecha", (r5.textos[0] ?? "").includes("Tá marcado") && r5.textos[0].includes(hora), r5.textos[0]);
  }

  console.log("\n4. O cliente antigo, com o número sem o nono dígito");
  {
    await db.insert(users).values({ name: `${MARCA} Antigo`, phone: "41970008002", role: "CLIENT" });
    const r = await cliente("554170008002@c.us", "oi");
    ok("é reconhecido pelo cadastro", (r.textos[0] ?? "").startsWith(`Oi, ${MARCA}!`), r.textos[0]?.slice(0, 40));
    ok("e a resposta volta para o id que ele usa", r.para[0] === "554170008002@c.us", r.para[0]);
  }

  console.log("\n5. A barbearia assume pelo celular");
  {
    const ZAP = "5541970008001@c.us";
    const humano = await evento({ id: `true_${ZAP}_h${++seq}`, from: "5541999990000@c.us", to: ZAP, fromMe: true, source: "app", body: "Oi! Aqui é o Bryan" });
    ok("o que sai do celular pausa o atendente", humano.json.pausado === true, JSON.stringify(humano.json));
    const quieto = await cliente(ZAP, "tem horário hoje?");
    ok("e ele fica quieto nessa conversa", quieto.textos.length === 0 && !quieto.chamadas.some((c) => c.caminho === "/api/sendSeen"), JSON.stringify(quieto.json));
    const doSistema = await evento({ id: `true_${ZAP}_s${++seq}`, from: "5541999990000@c.us", to: ZAP, fromMe: true, source: "api", body: "menu" });
    ok("o que o próprio sistema manda não conta como gente", doSistema.json.ignorada !== undefined);
    const volta = await cliente(ZAP, "menu");
    ok("'menu' traz o atendente de volta", (volta.textos[0] ?? "").includes("*1.* Marcar horário"), volta.textos[0]);
  }

  console.log("\n6. Número escondido (@lid)");
  {
    const r = await cliente("999888777@lid", "oi");
    ok("o WAHA diz o telefone e o atendente responde", r.textos.length === 1 && r.chamadas.some((c) => c.caminho.startsWith("/api/default/lids/")), JSON.stringify(r.json));
    ok("para o mesmo @lid", r.para[0] === "999888777@lid", r.para[0]);
    const sem = await cliente("111222333@lid", "oi");
    ok("sem telefone, manda o link do site", (sem.textos[0] ?? "").includes("/agendar"), sem.textos[0]);
    const sem2 = await cliente("111222333@lid", "oi de novo");
    ok("e não repete o link em seguida", sem2.textos.length === 0);
  }

  console.log("\n7. Áudio");
  {
    const r = await cliente("5541970008006@c.us", "", { hasMedia: true });
    ok("áudio no começo abre o menu", (r.textos[0] ?? "").includes("*1.* Marcar horário"), r.textos[0]);
    await cliente("5541970008006@c.us", "1");
    const r2 = await cliente("5541970008006@c.us", "", { hasMedia: true });
    ok("no meio da conversa, pede para escrever", (r2.textos[0] ?? "").includes("não consigo ouvir"), r2.textos[0]);
  }

  console.log("\n8. Lembrete e confirmação saem pelo WAHA");
  {
    await db.delete(notifications).where(eq(notifications.status, "PENDENTE"));
    await queueFreeText({ phone: "41970008001", body: "Lembrete de teste", kind: "LEMBRETE_24H" });
    await queueFreeText({ phone: "41970008099", body: "Para quem não tem WhatsApp", kind: "LEMBRETE_24H" });
    const antes = chamadas.length;
    const rel = await runDispatch(10);
    const novas = chamadas.slice(antes);
    const envio = novas.find((c) => c.caminho === "/api/sendText");
    ok("o despacho usa o WAHA", rel.configurado && rel.enviadas === 1, JSON.stringify(rel));
    ok("pergunta ao WAHA qual é a conversa do número", novas.some((c) => c.caminho.startsWith("/api/contacts/check-exists?phone=5541970008001")));
    ok("e manda para o id que o WhatsApp usa (sem o 9)", envio?.corpo?.chatId === "554170008001@c.us", String(envio?.corpo?.chatId));
    const semZap = await db.query.notifications.findFirst({ where: eq(notifications.phone, "41970008099") });
    ok("número sem WhatsApp vira erro de vez, sem insistir", semZap?.status === "ERRO" && (semZap.error ?? "").includes("não tem WhatsApp"), `${semZap?.status} ${semZap?.error}`);

    // Número desconectado (QR pendente): o WAHA não recusa, fica pendurado.
    // A varredura nem tenta — a fila espera sem gastar tentativa.
    falso.sessao.status = "SCAN_QR_CODE";
    await queueFreeText({ phone: "41970008001", body: "Outro lembrete", kind: "LEMBRETE_24H" });
    const antes2 = chamadas.length;
    const rel2 = await runDispatch(10);
    const espera = await db.query.notifications.findFirst({ where: eq(notifications.body, "Outro lembrete") });
    ok("WAHA desconectado: a fila espera", rel2.desconectado === true && rel2.enviadas === 0 &&
      !chamadas.slice(antes2).some((c) => c.caminho === "/api/sendText"), JSON.stringify(rel2));
    ok("sem gastar tentativa", espera?.status === "PENDENTE" && espera.attempts === 0, `${espera?.status} ${espera?.attempts}`);
    falso.sessao.status = "WORKING";
  }

  console.log("\n9. Frases inteiras com o Gemini");
  {
    process.env.GEMINI_API_KEY = "chave-falsa";
    const ZAP = "5541970008002@c.us"; // o cliente antigo, já cadastrado
    const settings = await getSettings();
    let dia = "", hora = "", ocupada = "";
    for (const d of listOpenDays(settings, 14)) {
      const { slots } = await getAvailability({ dateKey: d.dateKey, durationMin: corte.durationMin, barberId: null });
      const livre = slots.find((s) => s.available);
      const fora = slots.find((s) => !s.available && s.reason !== "antecedencia");
      if (livre) { dia = d.dateKey; hora = livre.time; ocupada = fora?.time ?? ""; break; }
    }
    falso.gemini = { status: 200, resposta: { intencao: "agendar", servicos: [corte.id, 99999], data: dia, hora, periodo: null } };
    const r = await cliente(ZAP, "fala! quero dar um tapa no cabelo, pode ser nesse dia?");
    ok("entende e pede confirmação antes de marcar", (r.textos[0] ?? "").includes("Fechado assim?") && r.textos[0].includes(hora) && r.textos[0].includes("*1.* Confirmar"), r.textos[0]);
    const pedido = chamadas.filter((c) => c.caminho.startsWith("/v1beta/models/")).at(-1);
    ok("sem mandar telefone ao Gemini", !/7000800/.test(JSON.stringify(pedido?.corpo ?? {})));
    const sim = await cliente(ZAP, "sim");
    ok("'sim' marca (cliente conhecido não repete o nome)", (sim.textos[0] ?? "").includes("Tá marcado"), sim.textos[0]);

    if (ocupada) {
      falso.gemini = { status: 200, resposta: { intencao: "agendar", servicos: [corte.id], data: dia, hora: ocupada, periodo: null } };
      const r2 = await cliente(ZAP, "e às outra hora?");
      ok("hora ocupada: avisa e mostra as mais perto", (r2.textos[0] ?? "").includes("não está livre"), r2.textos.join(" | ").slice(0, 160));
    }

    falso.gemini = { status: 429, resposta: null };
    await cliente(ZAP, "menu");
    const r3 = await cliente(ZAP, `quero agendar ${corte.name} por favor`);
    ok("Gemini no limite: segue sem ele", (r3.textos.at(-1) ?? "").includes("Para que dia"), r3.textos.at(-1));
    delete process.env.GEMINI_API_KEY;
  }

  console.log("\n10. O botão Conectar do painel");
  {
    falso.sessao = { existe: false, status: "STOPPED", config: null };
    const url = "https://bryanwesley.vercel.app/api/whatsapp/waha";
    const r = await wahaConectar(url);
    const criar = chamadas.filter((c) => c.caminho === "/api/sessions" && c.metodo === "POST").at(-1);
    const gancho = (criar?.corpo?.config as { webhooks?: { url: string; events: string[]; hmac: { key: string } }[] })?.webhooks?.[0];
    ok("cria a sessão já ligada", r.ok && criar?.corpo?.start === true, JSON.stringify(r));
    ok("com o webhook apontando para o site", gancho?.url === url && gancho.events.includes("message.any"), JSON.stringify(gancho));
    ok("assinado com a mesma chave", gancho?.hmac?.key === CHAVE_HMAC);
    const st = await wahaStatus(url);
    ok("a situação mostra o QR code e o webhook certo", st.status === "SCAN_QR_CODE" && st.webhookCerto === true, JSON.stringify(st));
    falso.sessao.config = { webhooks: [{ url: "https://outro-site/webhook" }] };
    ok("webhook apontando para outro lugar é percebido", (await wahaStatus(url)).webhookCerto === false);
    await wahaConectar(url);
    ok("e o Conectar acerta", (await wahaStatus(url)).webhookCerto === true);
    const cod = await wahaCodigoDePareamento("41999990000");
    ok("código de pareamento para quem está no celular", cod.codigo === "ABCD-EFGH", JSON.stringify(cod));
    const qr = await wahaQr();
    ok("o QR code vem como imagem", qr?.headers.get("content-type") === "image/png");
    process.env.WAHA_API_KEY = "errada";
    ok("chave errada aparece como tal", (await wahaStatus(url)).status === "SEM_ACESSO");
    process.env.WAHA_API_KEY = CHAVE_API;
  }

  await limpar();
  srv.close();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
