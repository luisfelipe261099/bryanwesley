// Helpers de servidor: leem a sessão do cookie e barram acesso indevido.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  verifySession,
  type Role,
  type SessionUser,
} from "./session";

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** Exige sessão com um dos papéis; caso contrário manda para o login. */
export async function requireRole(
  roles: Role[],
  redirectTo = "/entrar"
): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect(`${redirectTo}?proximo=${encodeURIComponent("/")}`);
  if (!roles.includes(session.role)) redirect("/entrar?erro=sem-permissao");
  return session;
}

export type { SessionUser, Role };
