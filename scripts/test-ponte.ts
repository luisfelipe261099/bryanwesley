// A ponte do WhatsApp de ponta a ponta: o programa de verdade
// (public/whatsapp/ponte.mjs) rodando como processo separado, falando com
// um WAHA de mentira e com as rotas reais do site (e o banco real).
// Pareamento por código, QR code no painel, código por número, fila de
// lembretes, mensagem que chega, barbearia assumindo, @lid, segredo
// revogado e a ponte se atualizando sozinha.
import "../db/load-env";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, pool } from "../db/client";
import { notifications, rateLimits, whatsappPonte, whatsappSessions, users } from "../db/schema";
import { eq, like, or } from "drizzle-orm";
import { POST as parearPOST } from "../app/api/whatsapp/ponte/parear/route";
import { POST as sinalPOST } from "../app/api/whatsapp/ponte/sinal/route";
import { POST as eventoPOST } from "../app/api/whatsapp/ponte/evento/route";
import {
  novoCodigoDeInstalacao, enviarComando, painelAberto, estadoDaPonte, desligarPonte, proximoSinal,
} from "../lib/ponte";
import { queueFreeText } from "../lib/notifications";
import { runDispatch } from "../lib/dispatch";
import { conversasPausadas } from "../lib/whatsapp-bot";

let p = 0, f = 0;
const ok = (l: string, c: boolean, e = "") =>
  c ? (p++, console.log("  ✓ " + l)) : (f++, console.log("  ✗ " + l + " " + e));
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate(cond: () => Promise<boolean> | boolean, ms = 20_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await espera(250);
  }
  return false;
}

const CHAVE_WAHA = "chave-local-do-waha";
const HMAC_LOCAL = "hmac-local-da-ponte";

// ───────────── WAHA de mentira ─────────────
type Chamada = { metodo: string; caminho: string; corpo: Record<string, unknown> | null };
const chamadas: Chamada[] = [];
const waha = {
  existe: false,
  status: "STOPPED",
  config: null as { webhooks?: { url: string; hmac?: { key: string } }[] } | null,
  semWhatsapp: new Set(["5541970009099"]),
};
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function wahaFalso() {
  return http.createServer((req, res) => {
    let cru = "";
    req.on("data", (c) => (cru += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const corpo = cru ? JSON.parse(cru) : null;
      chamadas.push({ metodo: req.method ?? "", caminho: url.pathname + url.search, corpo });
      const json = (s: number, o: unknown) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.headers["x-api-key"] !== CHAVE_WAHA) return json(401, {});
      const P = url.pathname;
      if (P === "/api/sessions" && req.method === "GET") return json(200, waha.existe ? [{ name: "default" }] : []);
      if (P === "/api/sessions" && req.method === "POST") { waha.existe = true; waha.config = corpo?.config; waha.status = "SCAN_QR_CODE"; return json(201, {}); }
      if (P === "/api/sessions/default" && req.method === "GET") {
        if (!waha.existe) return json(404, {});
        return json(200, { name: "default", status: waha.status, config: waha.config,
          me: waha.status === "WORKING" ? { id: "554199990000@c.us", pushName: "Bryan Wesley" } : null });
      }
      if (P === "/api/sessions/default" && req.method === "PUT") { waha.config = corpo?.config; return json(200, {}); }
      if (P === "/api/sessions/default/start") { waha.status = "SCAN_QR_CODE"; return json(201, {}); }
      if (P === "/api/sessions/default/logout") { waha.status = "SCAN_QR_CODE"; return json(201, {}); }
      if (P === "/api/default/auth/qr") {
        if ((req.headers.accept ?? "").includes("application/json")) return json(200, { mimetype: "image/png", data: PNG.toString("base64") });
        res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG);
      }
      if (P === "/api/default/auth/request-code") return json(201, { code: "ABCD-EFGH" });
      if (P === "/api/contacts/check-exists") {
        const fone = url.searchParams.get("phone") ?? "";
        if (waha.semWhatsapp.has(fone)) return json(200, { numberExists: false });
        const semNove = fone.length === 13 ? fone.slice(0, 4) + fone.slice(5) : fone;
        return json(200, { numberExists: true, chatId: `${semNove}@c.us` });
      }
      if (P === "/api/sendText") return json(201, { id: `true_${corpo?.chatId}_${chamadas.length}` });
      if (["/api/sendSeen", "/api/startTyping", "/api/stopTyping"].includes(P)) return json(200, {});
      const lid = P.match(/^\/api\/default\/lids\/(.+)$/);
      if (lid) return decodeURIComponent(lid[1]) === "777666555@lid" ? json(200, { lid: "777666555@lid", pn: "5541970009005@c.us" }) : json(404, {});
      json(404, {});
    });
  });
}

// ───────────── O site (rotas reais, servidas por HTTP) ─────────────
const ROTAS: Record<string, (r: Request) => Promise<Response>> = {
  "/api/whatsapp/ponte/parear": parearPOST,
  "/api/whatsapp/ponte/sinal": sinalPOST,
  "/api/whatsapp/ponte/evento": eventoPOST,
};
function siteFalso() {
  return http.createServer((req, res) => {
    let cru = "";
    req.on("data", (c) => (cru += c));
    req.on("end", async () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname.startsWith("/whatsapp/")) {
        try {
          const arq = readFileSync(join(process.cwd(), "public", url.pathname));
          res.writeHead(200); return res.end(arq);
        } catch { res.writeHead(404); return res.end(); }
      }
      const rota = ROTAS[url.pathname];
      if (!rota || req.method !== "POST") { res.writeHead(404); return res.end(); }
      const cabecalhos: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") cabecalhos[k] = v;
      try {
        const r = await rota(new Request(`http://site${url.pathname}`, { method: "POST", headers: cabecalhos, body: cru }));
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(await r.text());
      } catch (e) {
        console.error("rota quebrou:", e);
        res.writeHead(500); res.end();
      }
    });
  });
}

async function limpar() {
  await db.delete(whatsappPonte);
  await db.delete(rateLimits).where(or(like(rateLimits.chave, "wa%"), like(rateLimits.chave, "ponte%")));
  await db.delete(whatsappSessions).where(like(whatsappSessions.phone, "41970009%"));
  await db.delete(notifications).where(like(notifications.phone, "41970009%"));
  await db.delete(users).where(like(users.phone, "41970009%"));
}

async function main() {
  await limpar();
  for (const k of ["WHATSAPP_PROVIDER", "WAHA_URL", "WAHA_API_KEY", "WAHA_HMAC_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "GEMINI_API_KEY"]) delete process.env[k];

  const sWaha = wahaFalso(); await new Promise<void>((r) => sWaha.listen(0, "127.0.0.1", r));
  const sSite = siteFalso(); await new Promise<void>((r) => sSite.listen(0, "127.0.0.1", r));
  const WAHA = `http://127.0.0.1:${(sWaha.address() as AddressInfo).port}`;
  const SITE = `http://127.0.0.1:${(sSite.address() as AddressInfo).port}`;
  const portaPonte = 48000 + Math.floor(Math.random() * 1000);
  const PONTE = `http://127.0.0.1:${portaPonte}`;

  const parear = (codigo: string) => fetch(`${SITE}/api/whatsapp/ponte/parear`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ codigo }),
  });

  console.log("\n1. O código de instalação");
  let segredo = "";
  {
    const { codigo, expira } = await novoCodigoDeInstalacao();
    ok("tem 10 letras, sem 0/O nem 1/I/L", /^[A-HJKMNP-Z2-9]{10}$/.test(codigo), codigo);
    ok("vale 30 minutos", Math.abs(expira.getTime() - Date.now() - 30 * 60_000) < 5_000);
    const errado = await parear("ERRADO1234");
    ok("código errado: 401", errado.status === 401, String(errado.status));
    const certo = await parear(codigo.toLowerCase().replace(/(.{5})/, "$1-"));
    const j = (await certo.json()) as { segredo?: string };
    ok("código certo (com traço e minúsculas) devolve o segredo", certo.ok && (j.segredo?.length ?? 0) >= 40, JSON.stringify(j));
    segredo = j.segredo ?? "";
    const deNovo = await parear(codigo);
    ok("o mesmo código não vale duas vezes", deNovo.status === 401);
    const linha = await estadoDaPonte();
    ok("o site guarda só o hash do segredo", Boolean(linha?.segredoHash) && linha!.segredoHash !== segredo && !JSON.stringify(linha).includes(segredo));

    const { codigo: velho } = await novoCodigoDeInstalacao(new Date(Date.now() - 31 * 60_000));
    ok("código vencido: 401", (await parear(velho)).status === 401);
    const semSegredo = await fetch(`${SITE}/api/whatsapp/ponte/sinal`, { method: "POST", body: "{}" });
    ok("sinal sem segredo: 401", semSegredo.status === 401);
    const outro = await fetch(`${SITE}/api/whatsapp/ponte/sinal`, { method: "POST", headers: { authorization: "Bearer " + "x".repeat(43) }, body: "{}" });
    ok("sinal com segredo errado: 401", outro.status === 401);
    const muitas = await Promise.all(Array.from({ length: 10 }, () => parear("CHUTE00000")));
    ok("chute em série é freado (429)", muitas.some((r) => r.status === 429), muitas.map((r) => r.status).join(","));
    await db.delete(rateLimits).where(like(rateLimits.chave, "ponte%"));
  }

  console.log("\n2. A ponte sobe e o QR code aparece no painel");
  const arquivoLog = join(mkdtempSync(join(tmpdir(), "ponte-")), "ponte.log");
  const log = openSync(arquivoLog, "w");
  const ambiente = { ...process.env, SITE, SEGREDO: segredo, WAHA_LOCAL: WAHA, WAHA_API_KEY: CHAVE_WAHA, HMAC_LOCAL, PORTA: String(portaPonte), WEBHOOK_LOCAL: `${PONTE}/evento` };
  const ponte: ChildProcess = spawn(process.execPath, ["public/whatsapp/ponte.mjs"], { env: ambiente, stdio: ["ignore", log, log] });
  try {
    await painelAberto();
    ok("a ponte cria a sessão no WAHA", await ate(() => waha.existe));
    ok("com o webhook apontando para ela mesma, assinado", waha.config?.webhooks?.[0]?.url === `${PONTE}/evento` && waha.config.webhooks[0].hmac?.key === HMAC_LOCAL, JSON.stringify(waha.config));
    ok("o painel recebe a situação e o QR code", await ate(async () => {
      const e = await estadoDaPonte();
      return e?.status === "SCAN_QR_CODE" && (e.qr ?? "").startsWith("data:image/png;base64,");
    }));

    await enviarComando({ tipo: "codigo", fone: "41999990000" });
    ok("o pedido de código pelo painel volta com o código", await ate(async () => (await estadoDaPonte())?.codigoWhatsapp === "ABCD-EFGH"));
    ok("pedido com 55 na frente", chamadas.some((c) => c.caminho === "/api/default/auth/request-code" && c.corpo?.phoneNumber === "5541999990000"));

    console.log("\n3. Conectado");
    waha.status = "WORKING";
    ok("o painel mostra conectado, com o número (e o 9)", await ate(async () => {
      const e = await estadoDaPonte();
      return e?.status === "WORKING" && e.numero === "41999990000" && e.nome === "Bryan Wesley";
    }), JSON.stringify(await estadoDaPonte()));
    const e3 = await estadoDaPonte();
    ok("QR e código somem depois de conectar", !e3?.qr && !e3?.codigoWhatsapp);

    console.log("\n4. A fila de lembretes sai pela ponte");
    await db.delete(notifications).where(eq(notifications.status, "PENDENTE"));
    const n1 = await queueFreeText({ phone: "41970009001", body: "Lembrete pela ponte", kind: "LEMBRETE_24H" });
    const n2 = await queueFreeText({ phone: "41970009099", body: "Sem WhatsApp", kind: "LEMBRETE_24H" });
    const rel = await runDispatch(10);
    ok("a varredura do site não manda nada (quem manda é a ponte)", rel.ponte === true && rel.enviadas === 0, JSON.stringify(rel));
    ok("a ponte manda e o site marca como enviada", await ate(async () =>
      (await db.query.notifications.findFirst({ where: eq(notifications.id, n1!.id) }))?.status === "ENVIADA", 30_000));
    const envio = chamadas.find((c) => c.caminho === "/api/sendText" && c.corpo?.text === "Lembrete pela ponte");
    ok("para o id que o WhatsApp usa (sem o 9)", envio?.corpo?.chatId === "554170009001@c.us", String(envio?.corpo?.chatId));
    ok("número sem WhatsApp vira erro de vez", await ate(async () =>
      (await db.query.notifications.findFirst({ where: eq(notifications.id, n2!.id) }))?.status === "ERRO", 30_000));

    console.log("\n5. Mensagem que chega");
    const evento = async (payload: Record<string, unknown>, chave = HMAC_LOCAL) => {
      const corpo = JSON.stringify({ event: "message.any", session: "default", payload });
      return fetch(`${PONTE}/evento`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-hmac": createHmac("sha512", chave).update(corpo).digest("hex") }, body: corpo });
    };
    const falsa = await evento({ id: "x", from: "5541970009002@c.us", fromMe: false, body: "oi" }, "outra-chave");
    ok("a ponte recusa evento sem a assinatura do WAHA", falsa.status === 401);
    const antes = chamadas.length;
    const r = await evento({ id: "false_5541970009002@c.us_A1", from: "5541970009002@c.us", fromMe: false, body: "oi", _data: { notifyName: "Zé" } });
    ok("a ponte responde ao WAHA na hora", r.ok);
    ok("e o atendente responde pela ponte", await ate(() => chamadas.slice(antes).some((c) => c.caminho === "/api/sendText" && String(c.corpo?.text).includes("*1.* Marcar horário"))));
    const novas = chamadas.slice(antes);
    ok("com visto e 'digitando…' antes", ["/api/sendSeen", "/api/startTyping", "/api/stopTyping"].every((x) => novas.some((c) => c.caminho === x)));
    ok("chama pelo nome do perfil", novas.some((c) => String(c.corpo?.text ?? "").startsWith("Oi, Zé!")));

    const antes2 = chamadas.length;
    await evento({ id: "false_5541970009002@c.us_A2", from: "5541970009002@c.us", fromMe: false, body: "1" });
    await evento({ id: "false_5541970009002@c.us_A3", from: "5541970009002@c.us", fromMe: false, body: "menu" });
    await ate(() => chamadas.slice(antes2).filter((c) => c.caminho === "/api/sendText").length >= 2);
    const ordem = chamadas.slice(antes2).filter((c) => c.caminho === "/api/sendText").map((c) => String(c.corpo?.text));
    ok("duas mensagens seguidas são respondidas em ordem", ordem[0]?.includes("Qual serviço") && ordem[1]?.includes("Marcar horário"), ordem.map((t) => t.slice(0, 25)).join(" | "));

    await evento({ id: "true_A4", from: "554199990000@c.us", to: "5541970009002@c.us", fromMe: true, source: "app", body: "Oi, é o Bryan" });
    ok("a barbearia respondendo pelo celular pausa o atendente", await ate(async () => (await conversasPausadas()).some((c) => c.phone === "41970009002")));
    const antes3 = chamadas.length;
    await evento({ id: "true_A5", from: "554199990000@c.us", to: "5541970009002@c.us", fromMe: true, source: "api", body: "eco" });
    await espera(1500);
    ok("o eco do próprio sistema nem sobe para o site", !chamadas.slice(antes3).some((c) => c.caminho === "/api/sendText"));

    const antes4 = chamadas.length;
    await evento({ id: "false_777666555@lid_B1", from: "777666555@lid", fromMe: false, body: "oi" });
    ok("@lid: a ponte pergunta o telefone ao WAHA e o atendente responde", await ate(() =>
      chamadas.slice(antes4).some((c) => c.caminho.startsWith("/api/default/lids/")) &&
      chamadas.slice(antes4).some((c) => c.caminho === "/api/sendText" && c.corpo?.chatId === "777666555@lid")));
    const ses = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.phone, "41970009005") });
    ok("e a conversa fica no telefone certo", Boolean(ses));

    const antes5 = chamadas.length;
    await evento({ id: "g1", from: "1203630@g.us", fromMe: false, body: "oi grupo" });
    await espera(1500);
    ok("grupo nem sobe para o site", !chamadas.slice(antes5).some((c) => c.caminho === "/api/sendText"));

    console.log("\n6. Os comandos do painel");
    await enviarComando({ tipo: "conectar" });
    waha.config = { webhooks: [{ url: "http://outro/lugar" }] };
    ok("'Conectar' regrava o webhook", await ate(() => waha.config?.webhooks?.[0]?.url === `${PONTE}/evento`));
    await enviarComando({ tipo: "sair" });
    ok("'Desconectar número' faz logout no WAHA", await ate(() => chamadas.some((c) => c.caminho === "/api/sessions/default/logout")));
    waha.status = "WORKING";

    console.log("\n7. Ritmo do sinal");
    ok("com o painel aberto ou trabalho: 3s", proximoSinal({ conectado: true, painelAberto: true, trabalho: false, sobrou: false }) === 3_000);
    ok("conectado e parado: 20s", proximoSinal({ conectado: true, painelAberto: false, trabalho: false, sobrou: false }) === 20_000);
    ok("desconectado e ninguém olhando: 60s", proximoSinal({ conectado: false, painelAberto: false, trabalho: false, sobrou: false }) === 60_000);
    ok("fila grande: 1s", proximoSinal({ conectado: true, painelAberto: false, trabalho: true, sobrou: true }) === 1_000);

    console.log("\n8. Desligada no painel");
    await desligarPonte();
    const recusado = await ate(() => readFileSync(arquivoLog, "utf8").includes("recusou esta ponte"), 15_000);
    ok("a ponte percebe que foi desligada", recusado);
    ok("e o site não entrega mais nada para ela", (await sinalPOST(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${segredo}` }, body: "{}" }))).status === 401);
  } finally {
    ponte.kill();
    if (f) console.log("\n--- log da ponte ---\n" + readFileSync(arquivoLog, "utf8").slice(-3000));
  }

  console.log("\n9. A ponte se atualiza sozinha");
  {
    const pasta = mkdtempSync(join(tmpdir(), "ponte-velha-"));
    const arquivo = join(pasta, "ponte.mjs");
    writeFileSync(arquivo, readFileSync("public/whatsapp/ponte.mjs", "utf8").replace('const VERSAO = "1";', 'const VERSAO = "0";'));
    const { codigo } = await novoCodigoDeInstalacao();
    const s2 = ((await (await parear(codigo)).json()) as { segredo: string }).segredo;
    await painelAberto();
    const velha = spawn(process.execPath, [arquivo], { env: { ...ambiente, SEGREDO: s2 }, stdio: "ignore" });
    const saiu = await new Promise<number | null>((r) => { velha.on("exit", (c) => r(c)); setTimeout(() => { velha.kill(); r(null); }, 30_000); });
    ok("versão velha baixa a nova do site e reinicia", saiu === 0, `saída ${saiu}`);
    ok("o arquivo agora é a versão do site", readFileSync(arquivo, "utf8") === readFileSync("public/whatsapp/ponte.mjs", "utf8"));
  }

  await limpar();
  sWaha.close(); sSite.close();
  console.log(`\n${p} passaram · ${f} falharam`);
  await pool.end();
  process.exit(f === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
