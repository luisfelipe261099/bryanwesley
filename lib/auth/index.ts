// Helpers de servidor: leem a sessão do cookie e barram acesso indevido.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  SESSION_COOKIE,
  verifySession,
  sessionMatchesAccount,
  type Role,
  type SessionUser,
} from "./session";

// Uma leitura por requisição, mesmo que layout, página e header peçam a
// sessão separadamente.
const loadAccount = cache(async (id: number) => {
  const [row] = await db
    .select({
      active: users.active,
      role: users.role,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
});

/**
 * Sessão válida: cookie assinado E conta ainda de pé no banco. O middleware
 * só confere a assinatura (roda no Edge, sem banco); aqui é onde um
 * barbeiro desativado ou uma senha trocada derrubam a sessão antiga.
 */
export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const account = await loadAccount(session.id);
  return sessionMatchesAccount(session, account) ? session : null;
}

/** Caminho da página atual, encaminhado pelo middleware nas rotas protegidas. */
function currentPath(): string {
  const path = headers().get("x-pathname");
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Exige sessão com um dos papéis; caso contrário manda para o login. */
export async function requireRole(
  roles: Role[],
  redirectTo = "/entrar"
): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect(`${redirectTo}?proximo=${encodeURIComponent(currentPath())}`);
  }
  if (!roles.includes(session.role)) redirect("/entrar?erro=sem-permissao");
  return session;
}

export type { SessionUser, Role };
