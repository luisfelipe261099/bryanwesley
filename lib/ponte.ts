// ───────────────────────────────────────────────────────────
// A ponte do WhatsApp — o lado do site.
//
// O WAHA precisa de uma máquina ligada 24h, e a Vercel não é isso. Para
// não exigir domínio, certificado nem porta aberta nessa máquina, quem
// abre as conexões é ela: um programa pequeno ao lado do WAHA (a
// "ponte", public/whatsapp/ponte.mjs) repassa ao site cada mensagem que
// chega e, de tempos em tempos, dá um sinal — conta como está o número,
// manda o QR code, busca as ordens do painel e as mensagens da fila.
//
// Instalar é colar um comando no servidor. O comando leva um código de
// uso único que o painel gera; a ponte troca esse código por um segredo
// que só ela guarda (aqui fica só o hash).
// ───────────────────────────────────────────────────────────
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, whatsappPonte, type ComandoPonte } from "@/db/schema";
import { markFailed, markSent, queueFreeText } from "./notifications";
import { discardStaleNotifications } from "./dispatch";
import { isValidPhone, normalizePhone, telefoneDoWhatsapp } from "./phone";

/** Versão do programa da ponte. Mudou aqui, a ponte se atualiza sozinha. */
export const PONTE_VERSAO = "1";

const PRAZO_DO_CODIGO_MS = 30 * 60_000;
/** Mensagem entregue à ponte fica reservada por isto antes de voltar à fila. */
const ARRENDAMENTO_MS = 5 * 60_000;
/** Sem sinal há mais disto, o painel mostra o servidor como fora do ar. */
export const PONTE_SILENCIO_MS = 3 * 60_000;
const LOTE = 10;

// Sem 0/O e 1/I/L: o código é lido na tela e digitado (ou colado).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function estadoDaPonte() {
  return (await db.query.whatsappPonte.findFirst({ where: eq(whatsappPonte.id, 1) })) ?? null;
}

/** Há um servidor instalado (pareado) — as mensagens saem por ele. */
export async function pontePareada() {
  return Boolean((await estadoDaPonte())?.segredoHash);
}

/**
 * Código de instalação para o comando do painel. Vale 30 minutos e uma
 * vez só; gerar outro invalida o anterior.
 */
export async function novoCodigoDeInstalacao(agora = new Date()) {
  const codigo = Array.from(randomBytes(10), (b) => ALFABETO[b % ALFABETO.length]).join("");
  const expira = new Date(agora.getTime() + PRAZO_DO_CODIGO_MS);
  await db
    .insert(whatsappPonte)
    .values({ id: 1, codigoHash: sha256(codigo), codigoExpira: expira })
    .onDuplicateKeyUpdate({ set: { codigoHash: sha256(codigo), codigoExpira: expira } });
  return { codigo, expira };
}

/**
 * A ponte troca o código pelo segredo. Um servidor novo toma o lugar do
 * antigo: o segredo anterior deixa de valer na hora.
 */
export async function parear(codigo: string, agora = new Date()): Promise<string | null> {
  const limpo = (codigo ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const linha = await estadoDaPonte();
  if (!linha?.codigoHash || !linha.codigoExpira || linha.codigoExpira < agora) return null;
  if (!iguais(sha256(limpo), linha.codigoHash)) return null;

  const segredo = randomBytes(32).toString("base64url");
  // "where codigo_hash = o lido": dois servidores com o mesmo código ao
  // mesmo tempo — só um leva.
  const [res] = await db
    .update(whatsappPonte)
    .set({
      segredoHash: sha256(segredo),
      codigoHash: null,
      codigoExpira: null,
      pareadaEm: agora,
      vistoEm: null,
      status: "INSTALANDO",
      numero: null,
      nome: null,
      qr: null,
      codigoWhatsapp: null,
      comandos: [],
    })
    .where(and(eq(whatsappPonte.id, 1), eq(whatsappPonte.codigoHash, linha.codigoHash)));
  return res.affectedRows === 1 ? segredo : null;
}

/** Confere o "Authorization: Bearer <segredo>" de uma chamada da ponte. */
export async function autenticarPonte(req: Request) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  if (!m) return false;
  const linha = await estadoDaPonte();
  return Boolean(linha?.segredoHash && iguais(sha256(m[1]), linha.segredoHash));
}

/** "Desligar" do painel: o servidor para de valer até instalar de novo. */
export async function desligarPonte() {
  await db
    .update(whatsappPonte)
    .set({ segredoHash: null, status: null, numero: null, nome: null, qr: null, codigoWhatsapp: null, comandos: [] })
    .where(eq(whatsappPonte.id, 1));
}

/** O painel deixa uma ordem para o servidor buscar no próximo sinal. */
export async function enviarComando(c: ComandoPonte) {
  const linha = await estadoDaPonte();
  if (!linha?.segredoHash) return false;
  // Ordem repetida não se acumula (dois cliques em "Conectar").
  const fila = (linha.comandos ?? []).filter((x) => x.tipo !== c.tipo);
  await db
    .update(whatsappPonte)
    .set({ comandos: [...fila, c], ...(c.tipo === "codigo" ? { codigoWhatsapp: null } : {}) })
    .where(eq(whatsappPonte.id, 1));
  return true;
}

/** O painel está aberto: o servidor pergunta a cada 3s por 2 minutos. */
export async function painelAberto(agora = new Date()) {
  await db
    .update(whatsappPonte)
    .set({ painelAte: new Date(agora.getTime() + 2 * 60_000) })
    .where(eq(whatsappPonte.id, 1));
}

export type Sinal = {
  status?: string | null;
  numero?: string | null;
  nome?: string | null;
  /** data:image/png;base64,… — só enquanto espera o QR. */
  qr?: string | null;
  /** Resposta ao comando "codigo". */
  codigoWhatsapp?: string | null;
  /** Como foram os envios da rodada anterior. */
  resultados?: { id: number; ok: boolean; erro?: string; definitivo?: boolean }[];
  /** Respostas do atendente que não saíram: vão para a fila. */
  falhas?: { fone: string; texto: string }[];
  versao?: string | null;
};

export type RespostaDoSinal = {
  comandos: ComandoPonte[];
  mensagens: { id: number; fone: string; texto: string }[];
  /** Quando dar o próximo sinal. */
  proximoEmMs: number;
  ponteVersao: string;
};

/** Lembrete vencido sai da fila — a cada 5 minutos, não a cada sinal. */
let ultimaFaxina = 0;

const texto = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** O sinal da ponte: registra como ela está e devolve o que ela tem de fazer. */
export async function receberSinal(s: Sinal, agora = new Date()): Promise<RespostaDoSinal> {
  // 1. Como foram os envios anteriores.
  const resultados = (Array.isArray(s.resultados) ? s.resultados : []).filter((r) =>
    Number.isInteger(r?.id)
  );
  if (resultados.length) {
    const linhas = await db
      .select()
      .from(notifications)
      .where(inArray(notifications.id, resultados.map((r) => r.id)));
    for (const r of resultados) {
      const n = linhas.find((l) => l.id === r.id);
      if (!n || n.status !== "PENDENTE") continue;
      if (r.ok) await markSent(n.id);
      else await markFailed(n.id, texto(r.erro, 300) ?? "Falha no envio", n.attempts, Boolean(r.definitivo));
    }
  }

  // 2. Resposta que não saiu (a confirmação com o código): para a fila.
  for (const f of (Array.isArray(s.falhas) ? s.falhas : []).slice(0, 20)) {
    const fone = normalizePhone(String(f?.fone ?? ""));
    const corpo = texto(f?.texto, 4000);
    if (isValidPhone(fone) && corpo) await queueFreeText({ phone: fone, body: corpo });
  }

  // 3. Como está o número — e 4. as ordens do painel, entregues uma vez
  // só. Uma leitura e uma escrita por sinal: o banco é de plano grátis.
  const linha = await estadoDaPonte();
  const comandos = linha?.comandos ?? [];
  const status = texto(s.status, 40);
  const qr =
    status === "SCAN_QR_CODE" && typeof s.qr === "string" && /^data:image\/(png|jpeg);base64,/.test(s.qr) && s.qr.length < 300_000
      ? s.qr
      : null;
  const codigoWhatsapp = texto(s.codigoWhatsapp, 40);
  await db
    .update(whatsappPonte)
    .set({
      vistoEm: agora,
      status,
      numero: status === "WORKING" && texto(s.numero, 20) ? telefoneDoWhatsapp(texto(s.numero, 20)!) : null,
      nome: status === "WORKING" ? texto(s.nome, 120) : null,
      qr,
      versao: texto(s.versao, 40),
      ...(comandos.length ? { comandos: [] } : {}),
      // Conectou: o código de pareamento já não serve.
      ...(status === "WORKING" ? { codigoWhatsapp: null } : codigoWhatsapp ? { codigoWhatsapp } : {}),
    })
    .where(eq(whatsappPonte.id, 1));

  // 5. A fila de mensagens — só com o número conectado. Cada mensagem
  // entregue fica reservada por 5 minutos: se a ponte cair no meio, ela
  // volta sozinha para a fila.
  let mensagens: RespostaDoSinal["mensagens"] = [];
  let sobrou = false;
  if (status === "WORKING") {
    if (agora.getTime() - ultimaFaxina > 5 * 60_000) {
      ultimaFaxina = agora.getTime();
      await discardStaleNotifications(agora);
    }
    const fila = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, "PENDENTE"), lte(notifications.scheduledFor, agora)))
      .orderBy(asc(notifications.scheduledFor))
      .limit(LOTE + 1);
    sobrou = fila.length > LOTE;
    const lote = fila.slice(0, LOTE);
    if (lote.length) {
      await db
        .update(notifications)
        .set({ scheduledFor: new Date(agora.getTime() + ARRENDAMENTO_MS) })
        .where(inArray(notifications.id, lote.map((n) => n.id)));
      mensagens = lote.map((n) => ({ id: n.id, fone: n.phone, texto: n.body }));
    }
  }

  return {
    comandos,
    mensagens,
    proximoEmMs: proximoSinal({
      conectado: status === "WORKING",
      painelAberto: Boolean(linha?.painelAte && linha.painelAte > agora),
      trabalho: comandos.length > 0 || mensagens.length > 0,
      sobrou,
    }),
    ponteVersao: PONTE_VERSAO,
  };
}

/**
 * Quando perguntar de novo. Cada sinal é uma chamada na Vercel e algumas
 * consultas no banco — os dois de plano grátis. Então: rápido só com
 * alguém olhando o painel (o QR code troca a cada ~20s) ou com fila; no
 * resto do tempo, devagar. Número desconectado e ninguém olhando não tem
 * pressa nenhuma.
 */
export function proximoSinal(o: {
  conectado: boolean;
  painelAberto: boolean;
  trabalho: boolean;
  sobrou: boolean;
}) {
  if (o.sobrou) return 1_000;
  if (o.painelAberto || o.trabalho) return 3_000;
  return o.conectado ? 20_000 : 60_000;
}
