// ───────────────────────────────────────────────────────────
// A ponte do WhatsApp — roda no servidor da barbearia, ao lado do WAHA.
//
// Só faz conexões DE SAÍDA: repassa ao site cada mensagem que chega no
// WAHA e, de tempos em tempos, dá um sinal — como está o número, o QR
// code, as ordens do painel, as mensagens da fila. Por isso o servidor
// não precisa de domínio, certificado nem porta aberta: funciona numa
// máquina grátis na nuvem ou atrás do roteador de casa.
//
// Node 22 puro, sem dependências. Instalado por /whatsapp/instalar.sh.
// ───────────────────────────────────────────────────────────
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const VERSAO = "1";
const SITE = (process.env.SITE ?? "").replace(/\/+$/, "");
const SEGREDO = process.env.SEGREDO ?? "";
const WAHA = (process.env.WAHA_LOCAL ?? "http://waha:3000").replace(/\/+$/, "");
const WAHA_KEY = process.env.WAHA_API_KEY ?? "";
const HMAC_LOCAL = process.env.HMAC_LOCAL ?? "";
const PORTA = Number(process.env.PORTA ?? 8080);
/** Onde o WAHA entrega os eventos — dentro da rede do Docker. */
const WEBHOOK_LOCAL = process.env.WEBHOOK_LOCAL ?? `http://ponte:${PORTA}/evento`;
const SESSAO = "default";

if (!SITE || !SEGREDO || !WAHA_KEY) {
  console.error("Faltam SITE, SEGREDO ou WAHA_API_KEY. Rode o instalador de novo pelo painel.");
  process.exit(1);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ───────────── WAHA ─────────────

async function waha(caminho, { method = "GET", body, accept = "application/json", timeout = 15_000 } = {}) {
  return fetch(WAHA + caminho, {
    method,
    headers: {
      "X-Api-Key": WAHA_KEY,
      accept,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
}

async function wahaJson(caminho, opts) {
  const r = await waha(caminho, opts);
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { ok: r.ok, status: r.status, json, texto };
}

function configDaSessao() {
  return {
    webhooks: [
      {
        url: WEBHOOK_LOCAL,
        // "message.any" traz também o que a barbearia manda pelo celular:
        // é assim que o atendente sabe que alguém assumiu a conversa.
        events: ["message.any"],
        hmac: { key: HMAC_LOCAL },
        retries: { policy: "exponential", delaySeconds: 2, attempts: 4 },
      },
    ],
  };
}

/**
 * Cria a sessão (ou acerta o webhook da que existe) e liga. `forcar`
 * regrava a configuração mesmo se já estiver certa — é o "Conectar" do
 * painel; na partida, só mexe se precisar, para não derrubar a conexão.
 */
async function garantirSessao(forcar = false) {
  const atual = await wahaJson(`/api/sessions/${SESSAO}`, { timeout: 10_000 });
  if (atual.status === 404) {
    const r = await wahaJson("/api/sessions", {
      method: "POST",
      body: { name: SESSAO, start: true, config: configDaSessao() },
      timeout: 30_000,
    });
    log("sessão criada:", r.status);
    return;
  }
  if (!atual.ok) throw new Error(`WAHA HTTP ${atual.status} ao ler a sessão`);

  const ganchos = atual.json?.config?.webhooks ?? [];
  const certo = ganchos.some((g) => g?.url === WEBHOOK_LOCAL);
  if (forcar || !certo) {
    const r = await wahaJson(`/api/sessions/${SESSAO}`, {
      method: "PUT",
      body: { config: configDaSessao() },
      timeout: 30_000,
    });
    log("configuração da sessão atualizada:", r.status);
  }
  const status = atual.json?.status;
  if (status === "STOPPED" || status === "FAILED") {
    const r = await wahaJson(`/api/sessions/${SESSAO}/start`, { method: "POST", timeout: 30_000 });
    log("sessão ligada:", r.status);
  }
}

async function estadoDaSessao() {
  try {
    const r = await wahaJson(`/api/sessions/${SESSAO}`, { timeout: 8_000 });
    if (r.status === 404) return { status: "NAO_EXISTE" };
    if (!r.ok) return { status: `WAHA_${r.status}` };
    const id = r.json?.me?.id ?? null;
    return {
      status: r.json?.status ?? "DESCONHECIDO",
      // "5541999990000@c.us" (ou com ":12" do aparelho) → só os dígitos.
      numero: id ? String(id).split("@")[0].split(":")[0] : null,
      nome: r.json?.me?.pushName ?? null,
    };
  } catch {
    return { status: "WAHA_FORA_DO_AR" };
  }
}

/** O QR code como data URL (o WAHA manda em JSON ou como imagem). */
async function qrDataUrl() {
  try {
    const r = await waha(`/api/${SESSAO}/auth/qr?format=image`, {
      accept: "application/json",
      timeout: 8_000,
    });
    if (!r.ok) return null;
    const tipo = r.headers.get("content-type") ?? "";
    if (tipo.includes("application/json")) {
      const j = await r.json();
      return j?.data ? `data:${j.mimetype ?? "image/png"};base64,${j.data}` : null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${tipo.split(";")[0] || "image/png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function enviarTexto(chatId, texto) {
  try {
    const r = await wahaJson("/api/sendText", {
      method: "POST",
      body: { session: SESSAO, chatId, text: texto, linkPreview: false },
      timeout: 20_000,
    });
    if (r.ok) return { ok: true };
    return { ok: false, erro: `WAHA HTTP ${r.status}: ${r.texto.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "WAHA não respondeu" };
  }
}

/**
 * Lembrete, confirmação do site: primeiro pergunta ao WhatsApp qual é a
 * conversa do número (celular antigo de Curitiba está lá sem o nono
 * dígito), depois manda.
 */
async function enviarParaTelefone(fone, texto) {
  const numero = fone.length > 11 && fone.startsWith("55") ? fone : `55${fone}`;
  try {
    const c = await wahaJson(`/api/contacts/check-exists?phone=${numero}&session=${SESSAO}`, {
      timeout: 15_000,
    });
    if (!c.ok) return { ok: false, erro: `WAHA HTTP ${c.status} ao conferir o número` };
    if (!c.json?.numberExists) {
      return { ok: false, erro: "Esse número não tem WhatsApp.", definitivo: true };
    }
    return enviarTexto(c.json.chatId || `${numero}@c.us`, texto);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "WAHA não respondeu" };
  }
}

// ───────────── Site ─────────────

class AcessoNegado extends Error {}

async function site(caminho, corpo, timeout = 25_000) {
  const res = await fetch(SITE + caminho, {
    method: "POST",
    headers: { authorization: `Bearer ${SEGREDO}`, "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 401) throw new AcessoNegado("o site recusou o segredo desta ponte");
  if (!res.ok) throw new Error(`site HTTP ${res.status}`);
  return res.json();
}

// ───────────── Mensagens que chegam ─────────────

/** Respostas do atendente que não saíram: vão para a fila no próximo sinal. */
let falhas = [];

async function tratarEvento(ev) {
  if (ev?.event !== "message" && ev?.event !== "message.any") return;
  const p = ev.payload ?? {};
  const chatId = String((p.fromMe ? p.to : p.from) ?? "");
  // Grupo, status, canal: nem sobe para o site.
  if (!chatId || /@(g\.us|newsletter|broadcast)$/.test(chatId) || chatId.startsWith("status@")) return;
  // O que o próprio sistema mandou volta como evento — ignora. O que a
  // barbearia mandou pelo celular ("app") sobe: pausa o atendente.
  if (p.fromMe && p.source !== "app") return;

  // Número escondido ("@lid"): o site não alcança o WAHA, então quem
  // pergunta o telefone é a ponte.
  if (chatId.endsWith("@lid")) {
    const r = await wahaJson(`/api/${SESSAO}/lids/${encodeURIComponent(chatId)}`, {
      timeout: 8_000,
    }).catch(() => null);
    if (r?.ok && r.json?.pn) p._ponte = { pn: r.json.pn };
  }

  const resposta = await site("/api/whatsapp/ponte/evento", { ...ev, payload: p });
  const acoes = Array.isArray(resposta?.acoes) ? resposta.acoes : [];
  if (!acoes.length) return;

  // Visto, "digitando…", uma pausa: o jeito de gente responder.
  const alvo = { session: SESSAO, chatId: acoes[0].chatId };
  await wahaJson("/api/sendSeen", { method: "POST", body: alvo, timeout: 5_000 }).catch(() => null);
  await wahaJson("/api/startTyping", { method: "POST", body: alvo, timeout: 5_000 }).catch(() => null);
  await espera(900 + Math.random() * 900);
  await wahaJson("/api/stopTyping", { method: "POST", body: alvo, timeout: 5_000 }).catch(() => null);

  for (const [i, a] of acoes.entries()) {
    if (i > 0) await espera(500 + Math.random() * 500);
    const r = await enviarTexto(a.chatId, a.texto);
    if (!r.ok) {
      log("resposta não saiu:", r.erro);
      if (a.guardarSeFalhar && a.fone) falhas.push({ fone: a.fone, texto: a.texto });
    }
  }
}

function assinaturaOk(corpo, cabecalho) {
  if (!HMAC_LOCAL) return true;
  if (typeof cabecalho !== "string" || !/^[0-9a-f]+$/i.test(cabecalho)) return false;
  const esperado = createHmac("sha512", HMAC_LOCAL).update(corpo).digest("hex");
  return (
    cabecalho.length === esperado.length &&
    timingSafeEqual(Buffer.from(cabecalho.toLowerCase()), Buffer.from(esperado))
  );
}

/** Uma fila por conversa: duas mensagens seguidas são respondidas em ordem. */
const filas = new Map();

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/saude") {
      res.writeHead(200).end("ok");
      return;
    }
    if (req.method !== "POST" || !req.url?.startsWith("/evento")) {
      res.writeHead(404).end();
      return;
    }
    let cru = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      cru += c;
      if (cru.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!assinaturaOk(cru, req.headers["x-webhook-hmac"])) {
        res.writeHead(401).end();
        return;
      }
      // Responde já: o WAHA não precisa esperar o site.
      res.writeHead(200).end("ok");
      let ev;
      try {
        ev = JSON.parse(cru);
      } catch {
        return;
      }
      const p = ev?.payload ?? {};
      const chave = String((p.fromMe ? p.to : p.from) ?? "?");
      const atual = (filas.get(chave) ?? Promise.resolve())
        .then(() => tratarEvento(ev))
        .catch((e) => log("erro ao tratar mensagem:", e instanceof Error ? e.message : e));
      filas.set(chave, atual);
      atual.finally(() => {
        if (filas.get(chave) === atual) filas.delete(chave);
      });
    });
  })
  .listen(PORTA, () => log(`ponte ${VERSAO} ouvindo na porta ${PORTA}`));

// ───────────── O sinal ─────────────

let resultados = [];
let codigoWhatsapp = null;

async function executar(c) {
  if (c?.tipo === "conectar") {
    await garantirSessao(true);
  } else if (c?.tipo === "codigo" && typeof c.fone === "string") {
    const fone = c.fone.startsWith("55") && c.fone.length > 11 ? c.fone : `55${c.fone}`;
    const r = await wahaJson(`/api/${SESSAO}/auth/request-code`, {
      method: "POST",
      body: { phoneNumber: fone },
      timeout: 20_000,
    }).catch(() => null);
    codigoWhatsapp = r?.ok && r.json?.code ? String(r.json.code) : `erro:${r?.status ?? "sem resposta"}`;
  } else if (c?.tipo === "sair") {
    await wahaJson(`/api/sessions/${SESSAO}/logout`, { method: "POST", timeout: 20_000 }).catch(() => null);
  }
}

/** O site tem uma ponte mais nova: baixa, grava por cima e reinicia. */
async function atualizar() {
  try {
    const res = await fetch(`${SITE}/whatsapp/ponte.mjs`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return;
    const codigo = await res.text();
    if (!codigo.includes("A ponte do WhatsApp")) return;
    await writeFile(fileURLToPath(import.meta.url), codigo);
    log("ponte atualizada — reiniciando");
    process.exit(0); // o Docker sobe de novo, já com a versão nova
  } catch (e) {
    log("não deu para atualizar:", e instanceof Error ? e.message : e);
  }
}

async function ciclo() {
  const st = await estadoDaSessao();
  const qr = st.status === "SCAN_QR_CODE" ? await qrDataUrl() : null;

  // O que vai neste sinal sai da memória; se o site não receber, volta.
  const contados = resultados;
  const falhados = falhas;
  const codigo = codigoWhatsapp;
  resultados = [];
  falhas = [];
  codigoWhatsapp = null;

  let r;
  try {
    r = await site("/api/whatsapp/ponte/sinal", {
      status: st.status,
      numero: st.numero ?? null,
      nome: st.nome ?? null,
      qr,
      codigoWhatsapp: codigo,
      resultados: contados,
      falhas: falhados,
      versao: VERSAO,
    });
  } catch (e) {
    resultados = contados.concat(resultados);
    falhas = falhados.concat(falhas);
    codigoWhatsapp = codigoWhatsapp ?? codigo;
    throw e;
  }

  if (r?.ponteVersao && r.ponteVersao !== VERSAO) await atualizar();

  for (const c of r?.comandos ?? []) {
    await executar(c).catch((e) => log("comando falhou:", c?.tipo, e instanceof Error ? e.message : e));
  }

  // Lembretes espaçados, como gente mandando — rajada é o que faz o
  // WhatsApp desconfiar de robô.
  for (const [i, m] of (r?.mensagens ?? []).entries()) {
    if (i > 0) await espera(1500 + Math.random() * 2500);
    const envio = await enviarParaTelefone(String(m.fone), String(m.texto));
    resultados.push({ id: m.id, ...envio });
  }

  return Math.min(Math.max(Number(r?.proximoEmMs) || 20_000, 1_000), 120_000);
}

async function principal() {
  // O WAHA demora um pouco para subir junto com a ponte.
  for (let i = 0; i < 90; i++) {
    try {
      if ((await waha("/api/sessions", { timeout: 5_000 })).ok) break;
    } catch {
      /* ainda subindo */
    }
    await espera(2_000);
  }
  await garantirSessao(false).catch((e) => log("não deu para preparar a sessão:", e.message));

  for (;;) {
    let proximo = 20_000;
    try {
      proximo = await ciclo();
    } catch (e) {
      if (e instanceof AcessoNegado) {
        log("O site recusou esta ponte (desligada no painel ou instalada em outro servidor).");
        proximo = 300_000;
      } else {
        log("sinal falhou:", e instanceof Error ? e.message : e);
        proximo = 30_000;
      }
    }
    await espera(proximo);
  }
}

principal();
