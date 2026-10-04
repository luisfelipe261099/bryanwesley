// ───────────────────────────────────────────────────────────
// Avisos no celular (Web Push).
//
// O barbeiro liga os avisos uma vez no painel; dali em diante o
// agendamento novo chega como notificação no aparelho, com o site
// fechado. Funciona pelo serviço de push de cada navegador (Google,
// Apple, Mozilla), que recebe o aviso cifrado e entrega ao aparelho.
//
// Aqui só se guarda a inscrição de cada aparelho e se manda o aviso.
// Quem recebe o quê é decisão de lib/avisos.
//
// Não exige variável nenhuma: as chaves VAPID (a identidade do site
// perante os serviços de push) nascem na primeira vez e ficam no banco.
// Quem preferir pode fixá-las em VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
// ───────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import webpush, { WebPushError, type RequestOptions, type PushSubscription } from "web-push";
import { and, desc, eq, inArray, sql, count as drizzleCount, max as drizzleMax } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions, pushVapid, users } from "@/db/schema";
import { publicBaseUrl } from "./qr";

/** O que aparece no aparelho. */
export type Aviso = {
  titulo: string;
  corpo: string;
  /** Caminho do site aberto ao tocar no aviso. */
  url?: string;
  /** Avisos com a mesma tag substituem o anterior em vez de empilhar. */
  tag?: string;
};

export type ResultadoPush = {
  /** Aparelhos que receberam. */
  enviadas: number;
  /** Aparelhos em que o envio falhou agora (ficam para a próxima). */
  falhas: number;
  /** Aparelhos que o serviço de push diz que não existem mais. */
  removidas: number;
  /** Quantos aparelhos as pessoas avisadas tinham inscritos. */
  aparelhos: number;
};

/** Aparelhos por pessoa: celular, tablet, computador… além disso é lixo antigo. */
export const MAX_APARELHOS_POR_PESSOA = 8;
/**
 * Tempo máximo por aparelho. O aviso sai dentro da ação de quem agendou,
 * e a função da Vercel tem poucos segundos: um serviço de push pendurado
 * não pode levar o agendamento junto. Na prática eles respondem em menos
 * de um segundo.
 */
const TIMEOUT_MS = 5_000;
/** Vale até um dia: aviso de agendamento entregue depois disso já não ajuda. */
const TTL_S = 24 * 3600;
/** Falhas seguidas que fazem o aparelho sair da lista. */
const FALHAS_PARA_DESCARTAR = 8;

export const ZERO: ResultadoPush = { enviadas: 0, falhas: 0, removidas: 0, aparelhos: 0 };

const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

// ───────────────────────── Chaves ─────────────────────────

type Chaves = { publicKey: string; privateKey: string };
let chavesCache: Chaves | null = null;

/** Bytes de um base64url (o formato das chaves VAPID e das inscrições). */
function bytesDeBase64url(s: string): Buffer | null {
  if (!BASE64URL.test(s)) return null;
  try {
    return Buffer.from(s.replace(/=+$/, ""), "base64url");
  } catch {
    return null;
  }
}

/**
 * Chave pública VAPID: ponto P-256 sem compressão, 65 bytes; privada: 32
 * bytes. Chave errada na variável faria TODO envio falhar com erro local
 * (e, pior, em silêncio) — então a variável inválida é ignorada, com
 * aviso no log, e valem as do banco.
 */
export function chavesValidas(publicKey: string, privateKey: string) {
  const pub = bytesDeBase64url(publicKey);
  const priv = bytesDeBase64url(privateKey);
  return pub !== null && pub.length === 65 && pub[0] === 4 && priv !== null && priv.length === 32;
}
let avisouEnv = false;

/**
 * As chaves VAPID: das variáveis de ambiente, se as duas existirem;
 * senão as do banco, geradas na primeira vez. Guardadas em memória
 * depois disso — a instância vive pouco, mas atende muitos pedidos.
 */
export async function chavesVapid(): Promise<Chaves> {
  if (chavesCache) return chavesCache;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) {
    if (chavesValidas(pub, priv)) return (chavesCache = { publicKey: pub, privateKey: priv });
    if (!avisouEnv) {
      avisouEnv = true;
      console.error("Push: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY inválidas — ignoradas; valem as chaves do banco.");
    }
  }

  let [linha] = await db.select().from(pushVapid).where(eq(pushVapid.id, 1)).limit(1);
  if (!linha) {
    const novas = webpush.generateVAPIDKeys();
    // Duas instâncias chegando juntas num banco vazio: a primeira grava,
    // a segunda esbarra na chave primária e relê o que a primeira gravou.
    await db
      .insert(pushVapid)
      .values({ id: 1, publicKey: novas.publicKey, privateKey: novas.privateKey })
      .onDuplicateKeyUpdate({ set: { id: 1 } });
    [linha] = await db.select().from(pushVapid).where(eq(pushVapid.id, 1)).limit(1);
  }
  chavesCache = { publicKey: linha.publicKey, privateKey: linha.privateKey };
  return chavesCache;
}

/** A chave que o navegador recebe ao se inscrever. */
export async function chavePublicaPush() {
  return (await chavesVapid()).publicKey;
}

/** Só para testes: esquece as chaves em memória. */
export function esquecerChaves() {
  chavesCache = null;
}

/**
 * Quem o site diz ser para o serviço de push: o próprio endereço, ou um
 * e-mail. Serve para o serviço avisar quem manda demais — nunca é
 * mostrado a quem recebe.
 */
function assunto() {
  const fixo = process.env.VAPID_SUBJECT?.trim();
  if (fixo) return fixo;
  const base = publicBaseUrl();
  return base.startsWith("https://") ? base : "mailto:barbearia@localhost";
}

// ───────────────────────── Inscrições ─────────────────────────

/** O que o navegador devolve em `PushSubscription.toJSON()`. */
export type InscricaoDoNavegador = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * Confere o que veio do navegador. O endereço precisa ser HTTPS num
 * servidor de verdade (um serviço de push: Google, Apple, Mozilla…);
 * localmente, nos testes, HTTP e IP passam. As chaves têm tamanho
 * fixo (p256dh: ponto P-256 de 65 bytes; auth: 16 bytes) — fora disso
 * o envio falharia em todo aviso, para sempre.
 */
export function lerInscricao(x: unknown): InscricaoDoNavegador | null {
  const o = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!o || typeof o !== "object") return null;
  const endpoint = typeof o.endpoint === "string" ? o.endpoint.trim() : "";
  const p256dh = typeof o.keys?.p256dh === "string" ? o.keys.p256dh.trim() : "";
  const auth = typeof o.keys?.auth === "string" ? o.keys.auth.trim() : "";
  if (!endpoint || endpoint.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  const producao = process.env.NODE_ENV === "production";
  if (url.protocol !== "https:" && (producao || url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  // Em produção, nada de IP, localhost ou nome sem domínio: o servidor
  // não pode ser levado a bater em endereço interno.
  const host = url.hostname.toLowerCase();
  if (producao && (host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[") || !host.includes("."))) {
    return null;
  }
  if (p256dh.length > 200 || auth.length > 100) return null;
  const chave = bytesDeBase64url(p256dh);
  const segredo = bytesDeBase64url(auth);
  if (!chave || chave.length !== 65 || chave[0] !== 4) return null;
  if (!segredo || segredo.length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export function hashDoEndpoint(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

/**
 * Nome curto do aparelho, para a pessoa reconhecer na lista: "iPhone ·
 * Safari", "Android · Chrome". Só o que dá para tirar do User-Agent.
 */
export function nomeDoAparelho(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  if (!ua) return null;
  const sistema = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Aparelho";
  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "navegador";
  return `${sistema} · ${navegador}`.slice(0, 200);
}

/**
 * Guarda (ou atualiza) a inscrição de um aparelho. O mesmo aparelho pode
 * trocar de dono — o barbeiro saiu e o cliente entrou no mesmo celular —
 * então o endereço passa a valer para quem está logado agora.
 */
export async function salvarInscricao(
  userId: number,
  i: InscricaoDoNavegador,
  aparelho?: string | null
) {
  const agora = new Date();
  const valores = {
    userId,
    p256dh: i.keys.p256dh,
    auth: i.keys.auth,
    aparelho: aparelho?.slice(0, 200) ?? null,
    falhas: 0,
    usadoEm: agora,
  };
  await db
    .insert(pushSubscriptions)
    .values({ ...valores, endpointHash: hashDoEndpoint(i.endpoint), endpoint: i.endpoint })
    .onDuplicateKeyUpdate({ set: valores });

  // Teto por pessoa: os aparelhos mais parados saem. Sem isto, cada
  // reinstalação do navegador deixava um endereço morto para trás.
  const todas = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.usadoEm), desc(pushSubscriptions.id));
  const sobra = todas.slice(MAX_APARELHOS_POR_PESSOA).map((t) => t.id);
  if (sobra.length) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, sobra));
  }
}

/** A pessoa desligou os avisos neste aparelho. */
export async function removerInscricao(userId: number, endpoint: string) {
  const [res] = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpointHash, hashDoEndpoint(endpoint)),
        eq(pushSubscriptions.userId, userId)
      )
    );
  return res.affectedRows > 0;
}

/** Quantos aparelhos a pessoa tem com avisos ligados. */
export async function contarAparelhos(userId: number) {
  const [row] = await db
    .select({ total: drizzleCount() })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return Number(row?.total ?? 0);
}

/** Aparelhos das pessoas dadas — só de contas ativas. */
export async function inscricoesDe(userIds: number[]) {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      falhas: pushSubscriptions.falhas,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(inArray(pushSubscriptions.userId, userIds), eq(users.active, true)));
}

/** Para o painel: quem da equipe já ligou os avisos, e em quantos aparelhos. */
export async function aparelhosDaEquipe() {
  const rows = await db
    .select({
      userId: users.id,
      nome: users.name,
      role: users.role,
      aparelhos: drizzleCount(pushSubscriptions.id),
      ultimo: drizzleMax(pushSubscriptions.usadoEm),
    })
    .from(users)
    .leftJoin(pushSubscriptions, eq(pushSubscriptions.userId, users.id))
    .where(and(inArray(users.role, ["ADMIN", "BARBER"]), eq(users.active, true)))
    .groupBy(users.id, users.name, users.role)
    .orderBy(users.role, users.name);
  return rows.map((r) => ({
    ...r,
    aparelhos: Number(r.aparelhos),
    ultimo: r.ultimo ? new Date(r.ultimo) : null,
  }));
}

/** Para a tela "Minha conta": os aparelhos da própria pessoa. */
export async function meusAparelhos(userId: number) {
  return db
    .select({
      id: pushSubscriptions.id,
      aparelho: pushSubscriptions.aparelho,
      usadoEm: pushSubscriptions.usadoEm,
      createdAt: pushSubscriptions.createdAt,
      endpointHash: pushSubscriptions.endpointHash,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.usadoEm));
}

// ───────────────────────── Envio ─────────────────────────

/** Quem fala com o serviço de push. Os testes trocam por um falso. */
export type Transporte = (
  inscricao: PushSubscription,
  payload: string,
  opcoes: RequestOptions
) => Promise<{ statusCode: number }>;

const transporteReal: Transporte = (i, payload, opcoes) =>
  webpush.sendNotification(i, payload, opcoes);
let transporte: Transporte = transporteReal;

/** Só para testes. `null` volta ao envio de verdade. */
export function usarTransporte(t: Transporte | null) {
  transporte = t ?? transporteReal;
}

/** Garante que nenhum envio segure a ação de quem agendou por mais que o teto. */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Serviço de push não respondeu em ${ms / 1000}s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

/** Código HTTP da resposta do serviço de push, quando o erro veio dele. */
function codigoDoErro(e: unknown): number | null {
  if (e instanceof WebPushError) return e.statusCode;
  const sc = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof sc === "number" ? sc : null;
}

/** O que o serviço de push respondeu, para o log — host e começo do corpo. */
function descreverErro(e: unknown, endpoint: string) {
  let host = endpoint;
  try {
    host = new URL(endpoint).host;
  } catch {}
  const corpo = e instanceof WebPushError && e.body ? ` · ${String(e.body).slice(0, 160)}` : "";
  const msg = e instanceof Error ? e.message : String(e);
  return `${host}: ${msg}${corpo}`;
}

/**
 * Manda o aviso a todos os aparelhos das pessoas dadas. Não lança: quem
 * agenda não pode ficar sem horário porque um serviço de push caiu. O
 * aparelho que o serviço diz não existir mais (404/410) sai da lista;
 * o que falha de outro jeito ganha uma falha e sai depois de várias.
 */
export async function enviarPush(
  userIds: number[],
  aviso: Aviso,
  opcoes: {
    excluir?: (number | null | undefined)[];
    urgencia?: "high" | "normal" | "low";
    /** Por quanto tempo o serviço guarda o aviso para um aparelho desligado (padrão: 1 dia). */
    ttlSegundos?: number;
  } = {}
): Promise<ResultadoPush> {
  const fora = new Set((opcoes.excluir ?? []).filter((x): x is number => typeof x === "number"));
  const alvo = Array.from(new Set(userIds)).filter((id) => !fora.has(id));
  if (alvo.length === 0) return { ...ZERO };

  let inscricoes: Awaited<ReturnType<typeof inscricoesDe>>;
  let chaves: Chaves;
  try {
    inscricoes = await inscricoesDe(alvo);
    if (inscricoes.length === 0) return { ...ZERO };
    chaves = await chavesVapid();
  } catch (e) {
    console.error("Push: não deu para ler as inscrições:", e);
    return { ...ZERO };
  }

  const payload = JSON.stringify({
    titulo: aviso.titulo.slice(0, 120),
    corpo: aviso.corpo.slice(0, 500),
    url: aviso.url ?? "/",
    tag: aviso.tag,
    quando: Date.now(),
  });
  const requisicao: RequestOptions = {
    vapidDetails: { subject: assunto(), publicKey: chaves.publicKey, privateKey: chaves.privateKey },
    TTL: Math.max(60, Math.min(TTL_S, Math.round(opcoes.ttlSegundos ?? TTL_S))),
    urgency: opcoes.urgencia ?? "high",
    timeout: TIMEOUT_MS,
    contentEncoding: "aes128gcm",
  };

  const resultados = await Promise.allSettled(
    inscricoes.map((i) =>
      comPrazo(
        transporte({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, payload, requisicao),
        TIMEOUT_MS + 1_000
      )
    )
  );

  const entregues: number[] = [];
  const mortas: number[] = [];
  const falharam: number[] = [];
  resultados.forEach((r, idx) => {
    const i = inscricoes[idx];
    if (r.status === "fulfilled") {
      entregues.push(i.id);
      return;
    }
    const codigo = codigoDoErro(r.reason);
    // 404/410: o navegador cancelou a inscrição (a pessoa desligou os
    // avisos, limpou o site ou trocou de aparelho).
    if (codigo === 404 || codigo === 410) {
      mortas.push(i.id);
      return;
    }
    // Só a recusa do próprio serviço conta contra o aparelho. Tempo
    // esgotado, rede fora, chave do site errada: o problema é daqui, e
    // descartar o aparelho por isso apagaria todo mundo numa noite ruim.
    if (codigo !== null) {
      if (i.falhas + 1 >= FALHAS_PARA_DESCARTAR) mortas.push(i.id);
      else falharam.push(i.id);
    }
    console.error(`Push: falha no aparelho ${i.id} (${codigo ?? "sem resposta"}) — ${descreverErro(r.reason, i.endpoint)}`);
  });

  try {
    const agora = new Date();
    if (entregues.length) {
      await db
        .update(pushSubscriptions)
        .set({ usadoEm: agora, falhas: 0 })
        .where(inArray(pushSubscriptions.id, entregues));
    }
    if (mortas.length) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, mortas));
    }
    if (falharam.length) {
      await db
        .update(pushSubscriptions)
        .set({ falhas: sql`${pushSubscriptions.falhas} + 1` })
        .where(inArray(pushSubscriptions.id, falharam));
    }
  } catch (e) {
    console.error("Push: não deu para anotar o resultado:", e);
  }

  return {
    enviadas: entregues.length,
    falhas: inscricoes.length - entregues.length - mortas.length,
    removidas: mortas.length,
    aparelhos: inscricoes.length,
  };
}
