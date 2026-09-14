// Sessão em cookie httpOnly assinado (JWT via jose).
// Compatível com o Edge Runtime, então o middleware consegue validar
// sem tocar no banco.
import { SignJWT, jwtVerify } from "jose";

export type Role = "ADMIN" | "BARBER" | "CLIENT";

export type SessionUser = {
  id: number;
  name: string;
  role: Role;
  barberId?: number;
  /** users.token_version no momento do login. */
  v: number;
};

/** Situação atual da conta no banco, para confrontar com o cookie. */
export type AccountState = {
  active: boolean;
  role: Role;
  tokenVersion: number;
};

/**
 * O cookie vale 30 dias, mas nesse meio-tempo a conta pode ter sido
 * desativada, mudado de papel ou trocado a senha. Só a sessão que ainda
 * bate com o banco continua valendo.
 */
export function sessionMatchesAccount(
  session: SessionUser,
  account: AccountState | null
): boolean {
  if (!account || !account.active) return false;
  if (account.role !== session.role) return false;
  return account.tokenVersion === session.v;
}

const ROLES: Role[] = ["ADMIN", "BARBER", "CLIENT"];

export const SESSION_COOKIE = "bw_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error(
      "AUTH_SECRET ausente ou muito curta (mínimo 24 caracteres)."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser) {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    // Confere o papel contra a lista conhecida: um token antigo, de outra
    // versão do sistema, não vira papel inexistente que escapa dos guards.
    if (
      typeof payload.id !== "number" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string" ||
      !ROLES.includes(payload.role as Role)
    ) {
      return null;
    }
    return {
      id: payload.id,
      name: payload.name,
      role: payload.role as Role,
      barberId:
        typeof payload.barberId === "number" ? payload.barberId : undefined,
      // Token de antes da versão existir vale como versão 0.
      v: typeof payload.v === "number" ? payload.v : 0,
    };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
