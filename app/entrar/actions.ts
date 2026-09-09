"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, barbers } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  signSession,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { normalizePhone, isValidPhone } from "@/lib/phone";

export type AuthState = { error?: string } | undefined;

const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Informe seu e-mail ou telefone."),
  password: z.string().min(1, "Informe sua senha."),
});

/** Para onde cada papel vai depois de entrar. */
function homeFor(role: "ADMIN" | "BARBER" | "CLIENT") {
  if (role === "ADMIN") return "/admin";
  if (role === "BARBER") return "/barbeiro";
  return "/cliente";
}

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { identifier, password } = parsed.data;
  const asPhone = normalizePhone(identifier);
  const asEmail = identifier.toLowerCase();

  const user = await db.query.users.findFirst({
    where: or(
      eq(users.email, asEmail),
      // Só procura por telefone quando o que veio parece um telefone.
      asPhone.length >= 10 ? eq(users.phone, asPhone) : undefined
    ),
  });

  // Mensagem genérica: não revela se o usuário existe.
  const genericError = { error: "E-mail/telefone ou senha inválidos." };
  if (!user || !user.passwordHash || !user.active) return genericError;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return genericError;

  const barber =
    user.role === "BARBER" || user.role === "ADMIN"
      ? await db.query.barbers.findFirst({ where: eq(barbers.userId, user.id) })
      : undefined;

  const token = await signSession({
    id: user.id,
    name: user.name,
    role: user.role,
    barberId: barber?.id,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);

  const next = String(formData.get("proximo") || "");
  redirect(next && next.startsWith("/") ? next : homeFor(user.role));
}

const signupSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo."),
  phone: z.string().refine(isValidPhone, "Informe um WhatsApp válido com DDD."),
  password: z.string().min(6, "A senha precisa ter ao menos 6 caracteres."),
});

export async function signup(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, password } = parsed.data;
  const phone = normalizePhone(parsed.data.phone);

  const existing = await db.query.users.findFirst({
    where: eq(users.phone, phone),
  });

  let userId: number;

  if (existing) {
    // Cliente que já agendou sem cadastro: aqui ele "assume" a conta,
    // definindo uma senha pela primeira vez.
    if (existing.passwordHash) {
      return { error: "Já existe uma conta com esse WhatsApp. Faça login." };
    }
    const [updated] = await db
      .update(users)
      .set({ name, passwordHash: await hashPassword(password) })
      .where(eq(users.id, existing.id))
      .returning();
    userId = updated.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        name,
        phone,
        passwordHash: await hashPassword(password),
        role: "CLIENT",
      })
      .returning();
    userId = created.id;
  }

  const token = await signSession({ id: userId, name, role: "CLIENT" });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect("/cliente");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  redirect("/entrar");
}
