"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, or, sql as rawSql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, barbers, appointments, subscriptions } from "@/db/schema";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  signSession,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { safeNext } from "@/lib/url";

export type AuthState = { error?: string } | undefined;

// Hash de uma senha aleatória: usado quando o usuário não existe, para o
// bcrypt gastar o mesmo tempo e não denunciar quem tem conta.
const DUMMY_HASH =
  "$2b$10$H/6ulv31oIqfcLrAFOFz.erhql8DPlDXj6fZbts7cHhu5XnCfe.vK";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

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

  // Mensagem genérica e tempo parecido: não revela se o usuário existe.
  const genericError = { error: "E-mail/telefone ou senha inválidos." };

  // A trava não barra mais quem sabe a senha.
  //
  // Duas coisas estavam erradas aqui. A trava era conferida ANTES da
  // senha, e respondia "muitas tentativas" — o que denuncia que a conta
  // existe, bastando errar cinco vezes para descobrir quem é cliente.
  // E, como travava por conta, cinco tentativas erradas no e-mail do dono
  // deixavam o painel inacessível por 15 minutos, todas as vezes, de
  // qualquer lugar do mundo. Quem apresenta a senha certa não está
  // adivinhando: entra e a trava cai. Quem erra continua barrado —
  // acertar por tentativa é o que a trava impede.
  // Enquanto a trava vale, cada tentativa custa um segundo e meio. Isso
  // mantém o freio contra quem fica adivinhando (bcrypt + espera deixam a
  // taxa baixíssima) sem transformar a trava numa porta fechada na cara
  // do dono da conta.
  const travada =
    !!user?.lockedUntil && user.lockedUntil.getTime() > Date.now();
  if (travada) await new Promise((r) => setTimeout(r, 1500));

  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hash);
  if (!user || !user.passwordHash || !user.active || !ok) {
    if (user) {
      // Trava que já expirou não conta mais: senão o primeiro erro depois
      // dos 15 minutos travaria de novo na hora (5 + 1 ≥ 5).
      const travaVencida =
        !!user.lockedUntil && user.lockedUntil.getTime() <= Date.now();
      const failed = (travaVencida ? 0 : user.failedLogins) + 1;
      // Mensagem sempre a mesma, travado ou não: o texto do bloqueio
      // servia de "esse cadastro existe".
      await db
        .update(users)
        .set({
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : null,
        })
        .where(eq(users.id, user.id));
    }
    return genericError;
  }

  // Senha certa numa conta travada: o dono voltou. Zera tudo e segue.
  if (user.failedLogins > 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
  }

  const barber =
    user.role === "BARBER" || user.role === "ADMIN"
      ? await db.query.barbers.findFirst({ where: eq(barbers.userId, user.id) })
      : undefined;

  const token = await signSession({
    id: user.id,
    name: user.name,
    role: user.role,
    barberId: barber?.id,
    v: user.tokenVersion,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);

  redirect(safeNext(formData.get("proximo")) ?? homeFor(user.role));
}

const signupSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo."),
  phone: z.string().refine(isValidPhone, "Informe um WhatsApp válido com DDD."),
  password: z.string().min(6, "A senha precisa ter ao menos 6 caracteres."),
  // Código de um agendamento feito com esse telefone — prova de posse
  // enquanto não há confirmação por WhatsApp.
  code: z.string().trim().toUpperCase().optional(),
});

export type SignupState =
  | { error?: string; needsCode?: boolean }
  | undefined;

export async function signup(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    code: formData.get("code") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, password, code } = parsed.data;
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

    // Só conta de cliente se assume por aqui. Um registro de barbeiro ou
    // de admin sem senha (o seed cria a equipe, e uma conta pode ficar
    // sem senha até o primeiro acesso) viraria acesso ao painel para quem
    // soubesse o telefone da pessoa.
    if (existing.role !== "CLIENT") {
      return {
        error:
          "Esse WhatsApp é de uma conta da equipe. Fale com a barbearia para liberar o seu acesso.",
      };
    }

    // Se esse telefone já tem agendamento, quem assume a conta precisa
    // provar que é o dono: informar o código de um deles. Sem isso,
    // qualquer pessoa com o número veria os horários de outra.
    // Tem algum agendamento neste telefone? (Só a existência: listar os 50
    // primeiros deixava o cliente antigo, com mais de 50 visitas, sem
    // conseguir provar nada — o código dele nunca estava na fatia.)
    const [{ n: quantos }] = await db
      .select({ n: rawSql<number>`count(*)` })
      .from(appointments)
      .where(eq(appointments.clientPhone, phone));
    const temHistorico = Number(quantos) > 0;
    // Conta de assinante não se reivindica sozinha. O código prova pouco:
    // quem souber o WhatsApp da pessoa consegue agendar em nome dela e
    // ficar com o código daquele agendamento. Como assinatura vale dinheiro
    // (atendimento incluso no plano), esse caso passa pelo balcão.
    const assinaturaAtiva = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, existing.id),
        eq(subscriptions.status, "ATIVA")
      ),
    });
    if (assinaturaAtiva) {
      return {
        error:
          "Esse WhatsApp já tem plano ativo. Fale com a barbearia para liberar o seu acesso.",
      };
    }

    if (temHistorico) {
      if (!code) return { needsCode: true };
      const confere = await db.query.appointments.findFirst({
        where: and(
          eq(appointments.clientPhone, phone),
          eq(appointments.code, code.trim().toUpperCase())
        ),
        columns: { id: true },
      });
      if (!confere) {
        // Mantém o campo visível junto do erro, senão ele some da tela.
        return {
          needsCode: true,
          error:
            "Código não confere. Ele está na confirmação do seu agendamento.",
        };
      }
    } else {
      // Cadastro que veio do sistema antigo: tem nome e telefone reais, mas
      // nenhum agendamento aqui para servir de prova. Deixar qualquer um
      // criar senha nele entregaria o cadastro de 890 clientes a quem
      // souber o número — e trancaria o dono de fora, porque o segundo a
      // tentar ouve "já existe uma conta com esse WhatsApp".
      return {
        error:
          "Esse WhatsApp já está cadastrado na barbearia. Peça no balcão para liberarem o seu acesso, ou marque um horário e use o código da confirmação para criar a senha.",
      };
    }
    await db
      .update(users)
      .set({ name, passwordHash: await hashPassword(password) })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [{ id }] = await db
      .insert(users)
      .values({
        name,
        phone,
        passwordHash: await hashPassword(password),
        role: "CLIENT",
      })
      .$returningId();
    userId = id;
  }

  const conta = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const token = await signSession({
    id: userId,
    name,
    role: "CLIENT",
    v: conta?.tokenVersion ?? 0,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect("/cliente");
}

export async function logout() {
  cookies().delete(SESSION_COOKIE);
  redirect("/entrar");
}
