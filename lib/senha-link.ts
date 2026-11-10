// ───────────────────────────────────────────────────────────
// Nova senha pela barbearia (sem WhatsApp automático).
//
// O cliente pede em "Esqueci minha senha"; o admin vê o pedido, gera um
// link e manda pelo WhatsApp da própria barbearia. O link abre a tela de
// nova senha, vale 24 h e uma vez só. Só o hash do token fica guardado.
//
// Mora fora de um arquivo "use server": exportado de lá, cada função
// virava uma ação pública chamável sem login.
// ───────────────────────────────────────────────────────────
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, like } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResets, users } from "@/db/schema";
import { publicBaseUrl } from "./qr";

const HORAS_LINK = 24;
const HORAS_PEDIDO = 72;
const PEDIDO = "pedido";

const hashToken = (t: string) => `link:${createHash("sha256").update(t).digest("hex")}`;

/** Registra o pedido do cliente (um aberto por vez). */
export async function registrarPedidoDeSenha(userId: number) {
  const aberto = await db.query.passwordResets.findFirst({
    where: and(
      eq(passwordResets.userId, userId),
      eq(passwordResets.codeHash, PEDIDO),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date())
    ),
  });
  if (aberto) return false;
  await db.insert(passwordResets).values({
    userId,
    codeHash: PEDIDO,
    expiresAt: new Date(Date.now() + HORAS_PEDIDO * 3600_000),
  });
  return true;
}

/** Pedidos em aberto, para o painel. */
export async function pedidosDeSenhaAbertos() {
  const rows = await db
    .select({ id: passwordResets.id, userId: users.id, name: users.name, phone: users.phone, createdAt: passwordResets.createdAt })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(
      and(
        eq(passwordResets.codeHash, PEDIDO),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date())
      )
    )
    .orderBy(desc(passwordResets.id))
    .limit(20);
  return rows;
}

/** O cliente tem pedido em aberto? (para a ficha avisar) */
export async function temPedidoDeSenha(userId: number) {
  const r = await db.query.passwordResets.findFirst({
    where: and(
      eq(passwordResets.userId, userId),
      eq(passwordResets.codeHash, PEDIDO),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date())
    ),
    columns: { createdAt: true },
  });
  return r?.createdAt ?? null;
}

/**
 * Gera o link de nova senha (o anterior deixa de valer) e fecha o pedido.
 * Devolve o link e o texto pronto para o WhatsApp.
 */
export async function gerarLinkDeSenha(userId: number) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u || !u.active) return null;
  // Link anterior e pedido em aberto: saem.
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt), like(passwordResets.codeHash, "link:%")));
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt), eq(passwordResets.codeHash, PEDIDO)));

  const token = randomBytes(24).toString("base64url");
  await db.insert(passwordResets).values({
    userId,
    codeHash: hashToken(token),
    expiresAt: new Date(Date.now() + HORAS_LINK * 3600_000),
  });
  const url = `${publicBaseUrl()}/entrar/nova-senha/${token}`;
  const primeiro = u.name.split(" ")[0];
  const texto = `Oi ${primeiro}! Aqui é da Bryan Wesley Barbearia. Para criar sua nova senha, abra este link (vale por ${HORAS_LINK} horas e uma vez só): ${url}`;
  return { url, texto, phone: u.phone };
}

/** Confere o link sem gastar (para a página abrir o formulário). */
export async function linkDeSenhaValido(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await db.query.passwordResets.findFirst({
    where: and(
      eq(passwordResets.codeHash, hashToken(token)),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date())
    ),
  });
  if (!r) return null;
  const u = await db.query.users.findFirst({ where: eq(users.id, r.userId), columns: { id: true, name: true, active: true } });
  return u?.active ? { resetId: r.id, userId: u.id, name: u.name } : null;
}

/** Gasta o link (uma vez só, mesmo com dois envios ao mesmo tempo). */
export async function gastarLinkDeSenha(resetId: number) {
  const [r] = await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.id, resetId), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  return r.affectedRows === 1;
}
