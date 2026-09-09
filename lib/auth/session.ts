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
};

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
    if (
      typeof payload.id !== "number" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      id: payload.id,
      name: payload.name,
      role: payload.role as Role,
      barberId:
        typeof payload.barberId === "number" ? payload.barberId : undefined,
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
