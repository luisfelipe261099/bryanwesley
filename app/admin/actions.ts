"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, like, sql as rawSql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  appointments,
  barbers,
  commissionTiers,
  planRequests,
  planServices,
  plans,
  recurringSlots,
  scheduleBlocks,
  services,
  settings as settingsTable,
  subscriptions,
  users,
} from "@/db/schema";
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth";
import {
  SESSION_COOKIE,
  signSession,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { cancelFutureOccurrences } from "@/lib/recurring";
import { isNextControlFlow, dbErrorMessage } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import {
  createBooking,
  transitionAppointment,
  rescheduleBooking,
  updateAppointmentServices,
  BookingError,
} from "@/lib/appointments";
import {
  retryNotification,
  pendingNotifications,
  markSent,
  markFailed,
  discardNotification as discardNotificationRow,
} from "@/lib/notifications";
import { sendWhatsapp, isWhatsappConfigured } from "@/lib/providers/whatsapp";
import { claimDispatchSlot, runDispatch } from "@/lib/dispatch";
import { chargeSubscription } from "@/lib/payments";
import { shopTimeToUtc, parseDateKey } from "@/lib/time";
import { normalizePhone, isValidPhone, nextPlaceholderPhone, isPlaceholderPhone } from "@/lib/phone";
import { planClientImport, chaveNome } from "@/lib/import";
import { nextRenewal } from "@/lib/subscriptions";
import { formatBRL } from "@/lib/money";
import { publicBaseUrl } from "@/lib/qr";
import { wahaConfigurado, wahaConectar, wahaCodigoDePareamento } from "@/lib/providers/waha";
import { retomarAtendente } from "@/lib/whatsapp-bot";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function admin() {
  return requireRole(["ADMIN"]);
}

function done(message?: string): Result {
  for (const p of [
    "/admin",
    "/admin/agenda",
    "/admin/ajustes",
    "/admin/equipe",
    "/admin/catalogo",
    "/admin/clientes",
    "/admin/notificacoes",
    "/admin/relatorios",
    "/barbeiro",
    "/cliente",
    "/agendar",
    "/",
    "/planos",
  ]) {
    revalidatePath(p);
  }
  return { ok: true, message };
}

function fail(e: unknown): Result {
  // redirect()/notFound() do Next viajam como exceção. Engolir aqui faria a
  // sessão expirada virar "não foi possível concluir" em vez de ir ao login.
  if (isNextControlFlow(e)) throw e;
  if (e instanceof BookingError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
  console.error(e);
  return { ok: false, error: "Não foi possível concluir a ação." };
}

// ───────────────────────── Configurações da agenda ─────────────────────────

const settingsSchema = z.object({
  acceptingBookings: z.boolean(),
  minAdvanceHours: z.number().int().min(0).max(72),
  slotMinutes: z.number().int().min(10).max(120),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
  closedWeekdays: z.array(z.number().int().min(0).max(6)),
  maxAdvanceDays: z.number().int().min(1).max(365),
  defaultBarberPct: z.number().int().min(0).max(100),
});

export async function saveSettings(
  input: z.input<typeof settingsSchema>
): Promise<Result> {
  try {
    await admin();
    const data = settingsSchema.parse(input);
    if (data.closeMinute <= data.openMinute) {
      return { ok: false, error: "O fechamento precisa ser depois da abertura." };
    }
    await db
      .update(settingsTable)
      .set(data)
      .where(eq(settingsTable.id, 1));
    return done("Configurações salvas.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Bloqueios de agenda ─────────────────────────

export async function addBlock(input: {
  dateKey: string;
  startMinute: number;
  endMinute: number;
  barberId: number | null;
  reason?: string;
}): Promise<Result> {
  try {
    await admin();
    if (input.endMinute <= input.startMinute) {
      return { ok: false, error: "O fim precisa ser depois do início." };
    }
    const { year, month, day } = parseDateKey(input.dateKey);
    await db.insert(scheduleBlocks).values({
      barberId: input.barberId,
      startsAt: shopTimeToUtc(year, month, day, input.startMinute),
      endsAt: shopTimeToUtc(year, month, day, input.endMinute),
      reason: input.reason?.trim() || null,
    });
    return done("Bloqueio criado.");
  } catch (e) {
    return fail(e);
  }
}

export async function removeBlock(id: number): Promise<Result> {
  try {
    await admin();
    await db.delete(scheduleBlocks).where(eq(scheduleBlocks.id, id));
    return done("Bloqueio removido.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Agendamentos ─────────────────────────

export async function adminTransition(
  id: number,
  next: "CONFIRMADO" | "CANCELADO" | "CONCLUIDO" | "NO_SHOW" | "EM_ANDAMENTO"
): Promise<Result> {
  try {
    await admin();
    await transitionAppointment(id, next);
    return done("Agendamento atualizado.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Equipe ─────────────────────────

const barberSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome."),
  shortName: z.string().trim().min(2, "Informe o nome curto."),
  title: z.string().trim().min(2, "Informe o cargo."),
  phone: z.string().refine(isValidPhone, "Telefone inválido."),
  email: z.string().email("E-mail inválido."),
  commissionPct: z.number().int().min(0).max(100),
  isAdmin: z.boolean().default(false),
});

export async function createBarber(
  input: z.input<typeof barberSchema> & { password?: string }
): Promise<Result> {
  try {
    await admin();
    const data = barberSchema.parse(input);
    const phone = normalizePhone(data.phone);
    const password = input.password?.trim();
    if (!password || password.length < 6) {
      return { ok: false, error: "Defina uma senha de ao menos 6 caracteres." };
    }

    const slug = data.shortName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const role = data.isAdmin ? "ADMIN" : "BARBER";
    const passwordHash = await hashPassword(password);
    const userData = {
      name: data.name,
      email: data.email.toLowerCase(),
      role,
      // Telefone já existia (ex.: era cliente): a senha informada passa a
      // valer, senão o barbeiro não consegue entrar.
      passwordHash,
      active: true,
    } as const;

    let userId: number;
    const existing = await db.query.users.findFirst({ where: eq(users.phone, phone) });
    // Só uma conta "leve" (cliente sem senha, criado por um agendamento)
    // vira barbeiro por aqui. Conta com senha é de alguém: sobrescrever
    // papel e senha dela seria tomar a conta.
    if (existing?.passwordHash) {
      return {
        ok: false,
        error:
          "Já existe uma conta com esse WhatsApp. Use outro número ou peça para a pessoa entrar em contato.",
      };
    }
    const emailDono = await db.query.users.findFirst({
      where: eq(users.email, userData.email),
    });
    if (emailDono && emailDono.id !== existing?.id) {
      return { ok: false, error: "Esse e-mail já está em outra conta." };
    }
    if (existing) {
      await db.update(users).set(userData).where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      const [{ id }] = await db
        .insert(users)
        .values({ phone, ...userData })
        .$returningId();
      userId = id;
    }

    const already = await db.query.barbers.findFirst({ where: eq(barbers.userId, userId) });
    if (!already) {
      await db.insert(barbers).values({
        userId,
        slug: `${slug}-${userId}`,
        shortName: data.shortName,
        title: data.title,
        commissionPct: data.commissionPct,
      });
    }

    return done("Barbeiro cadastrado.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateBarber(input: {
  id: number;
  shortName: string;
  title: string;
  commissionPct: number;
  monthlyGoalCents: number;
  active: boolean;
}): Promise<Result> {
  try {
    const session = await admin();

    // Desativar um barbeiro desativa a conta dele. Sem esta guarda o admin
    // desativa o próprio cartão e fica trancado para fora do sistema — não
    // existe outra porta para voltar. Aconteceu num teste aqui.
    if (!input.active) {
      const alvoAtual = await db.query.barbers.findFirst({
        where: eq(barbers.id, input.id),
      });
      if (alvoAtual?.userId === session.id) {
        return {
          ok: false,
          error:
            "Você não pode desativar a própria conta — ficaria sem acesso ao painel. Peça a outro administrador.",
        };
      }
      if (alvoAtual) {
        const dono = await db.query.users.findFirst({
          where: eq(users.id, alvoAtual.userId),
        });
        if (dono?.role === "ADMIN") {
          const [{ n }] = await db
            .select({ n: rawSql<number>`count(*)` })
            .from(users)
            .where(and(eq(users.role, "ADMIN"), eq(users.active, true)));
          if (Number(n) <= 1) {
            return {
              ok: false,
              error:
                "Esse é o último administrador ativo. Promova outra pessoa antes de desativá-lo.",
            };
          }
        }
      }
    }

    await db
      .update(barbers)
      .set({
        shortName: input.shortName.trim(),
        title: input.title.trim(),
        commissionPct: Math.max(0, Math.min(100, input.commissionPct)),
        monthlyGoalCents: Math.max(0, Math.round(input.monthlyGoalCents)),
        active: input.active,
      })
      .where(eq(barbers.id, input.id));
    // Sair da agenda é sair do sistema: a conta acompanha, e a sessão que
    // ainda estiver aberta no celular dele cai na próxima requisição.
    const alvo = await db.query.barbers.findFirst({ where: eq(barbers.id, input.id) });
    if (alvo) {
      await db
        .update(users)
        .set({ active: input.active })
        .where(eq(users.id, alvo.userId));
    }
    if (input.active) return done("Barbeiro atualizado.");

    // Os avulsos futuros dele não podem ficar de pé: ninguém vai atender,
    // o cliente aparece na porta e o horário nem consta mais na agenda de
    // quem ficou. São cancelados um a um (não em lote) porque cada
    // cancelamento avisa o cliente pelo WhatsApp.
    const futuros = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.barberId, input.id),
          gt(appointments.startsAt, new Date()),
          inArray(appointments.status, ["PENDENTE", "CONFIRMADO"])
        )
      );
    let cancelados = 0;
    for (const a of futuros) {
      try {
        await transitionAppointment(a.id, "CANCELADO");
        cancelados++;
      } catch (e) {
        console.error("Falha ao cancelar agendamento do barbeiro desativado:", e);
      }
    }

    // Quem tinha fixo com ele fica sem: o fixo é desligado e as semanas
    // futuras saem da agenda. Sem isso o membro veria um fixo "ativo" que
    // nunca mais materializa, e o barbeiro sairia com a agenda ocupada.
    const fixos = await db
      .select({ id: recurringSlots.id })
      .from(recurringSlots)
      .where(
        and(eq(recurringSlots.barberId, input.id), eq(recurringSlots.active, true))
      );
    const aviso = cancelados
      ? ` ${cancelados} agendamento(s) futuro(s) cancelado(s) — os clientes foram avisados.`
      : "";
    if (fixos.length === 0) {
      return done(`Barbeiro desativado e acesso encerrado.${aviso}`);
    }
    const ids = fixos.map((f) => f.id);
    await db
      .update(recurringSlots)
      .set({ active: false })
      .where(inArray(recurringSlots.id, ids));
    const liberados = await cancelFutureOccurrences(ids);
    return done(
      `Barbeiro desativado e acesso encerrado.${aviso} ${ids.length} horário(s) fixo(s) desligado(s) e ${liberados} agendamento(s) liberado(s) — avise os membros.`
    );
  } catch (e) {
    return fail(e);
  }
}

export async function setBarberHours(input: {
  barberId: number;
  weekday: number;
  openMinute: number | null;
  closeMinute: number | null;
}): Promise<Result> {
  try {
    await admin();
    const { barberHours } = await import("@/db/schema");
    if (input.openMinute === null || input.closeMinute === null) {
      await db
        .delete(barberHours)
        .where(
          and(
            eq(barberHours.barberId, input.barberId),
            eq(barberHours.weekday, input.weekday)
          )
        );
      // Com jornada própria em QUALQUER dia, o dia sem linha é folga
      // (lib/schedule: workingWindows). A mensagem prometia o contrário —
      // "volta a valer o horário da loja" — e o dono tirava o profissional
      // da agenda sem perceber. Só quando não sobra nenhuma linha é que a
      // loja volta a mandar.
      const [{ n: restantes }] = await db
        .select({ n: rawSql<number>`count(*)` })
        .from(barberHours)
        .where(eq(barberHours.barberId, input.barberId));
      return done(
        Number(restantes) > 0
          ? "Dia em branco: folga desse profissional."
          : "Jornada limpa — ele volta a seguir o horário da loja."
      );
    }
    if (input.closeMinute <= input.openMinute) {
      return { ok: false, error: "O fim precisa ser depois do início." };
    }
    await db
      .insert(barberHours)
      .values({
        barberId: input.barberId,
        weekday: input.weekday,
        openMinute: input.openMinute,
        closeMinute: input.closeMinute,
      })
      .onDuplicateKeyUpdate({
        set: { openMinute: input.openMinute, closeMinute: input.closeMinute },
      });
    return done("Jornada salva.");
  } catch (e) {
    return fail(e);
  }
}

export async function upsertCommissionTier(input: {
  id?: number;
  barberId: number | null;
  minRevenueCents: number;
  barberPct: number;
  label?: string;
}): Promise<Result> {
  try {
    await admin();
    if (input.id) {
      await db
        .update(commissionTiers)
        .set({
          barberId: input.barberId,
          minRevenueCents: input.minRevenueCents,
          barberPct: input.barberPct,
          label: input.label?.trim() || null,
        })
        .where(eq(commissionTiers.id, input.id));
    } else {
      await db.insert(commissionTiers).values({
        barberId: input.barberId,
        minRevenueCents: input.minRevenueCents,
        barberPct: input.barberPct,
        label: input.label?.trim() || null,
      });
    }
    return done("Faixa de comissão salva.");
  } catch (e) {
    return fail(e);
  }
}

export async function removeCommissionTier(id: number): Promise<Result> {
  try {
    await admin();
    await db.delete(commissionTiers).where(eq(commissionTiers.id, id));
    return done("Faixa removida.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Catálogo ─────────────────────────

const money = z
  .number({ message: "Valor inválido." })
  .int("Valor inválido.")
  .min(0, "Valor não pode ser negativo.");

const serviceSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(2, "Informe o nome do serviço."),
  description: z.string().trim().max(200).default(""),
  priceCents: money,
  durationMin: z.number().int().min(5).max(480),
  tag: z.string().trim().max(30).nullable().default(null),
  active: z.boolean().default(true),
});

export async function saveService(
  input: z.input<typeof serviceSchema>
): Promise<Result> {
  try {
    await admin();
    const data = serviceSchema.parse(input);
    if (data.id) {
      await db
        .update(services)
        .set({
          name: data.name,
          description: data.description,
          priceCents: data.priceCents,
          durationMin: data.durationMin,
          tag: data.tag,
          active: data.active,
        })
        .where(eq(services.id, data.id));
    } else {
      const slug =
        data.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || `servico-${Date.now()}`;
      await db.insert(services).values({
        slug,
        name: data.name,
        description: data.description,
        priceCents: data.priceCents,
        durationMin: data.durationMin,
        tag: data.tag,
        active: data.active,
        sortOrder: 99,
      });
    }
    return done("Serviço salvo.");
  } catch (e) {
    return fail(e);
  }
}

export async function toggleService(id: number, active: boolean): Promise<Result> {
  try {
    await admin();
    await db.update(services).set({ active }).where(eq(services.id, id));
    if (active) return done("Serviço ativado.");

    // Horário fixo guarda a lista de serviços. Tirando um do catálogo, o
    // fixo de quem o escolheu encolhe — e, se era o único, para de
    // materializar sem avisar ninguém. O dono precisa saber agora, não
    // pela reclamação do membro daqui a duas semanas.
    const fixos = await db
      .select({ id: recurringSlots.id, serviceIds: recurringSlots.serviceIds })
      .from(recurringSlots)
      .where(eq(recurringSlots.active, true));
    const afetados = fixos.filter((f) => (f.serviceIds ?? []).includes(id));
    const orfaos = afetados.filter(
      (f) => (f.serviceIds ?? []).filter((x) => x !== id).length === 0
    );
    if (afetados.length === 0) return done("Serviço desativado.");
    return done(
      `Serviço desativado. ${afetados.length} horário(s) fixo(s) usavam ele` +
        (orfaos.length
          ? ` — ${orfaos.length} ficaram sem nenhum serviço e vão parar de reservar. Avise os membros.`
          : " e passam a reservar só o resto.")
    );
  } catch (e) {
    return fail(e);
  }
}

const planSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(2, "Informe o nome do plano."),
  kicker: z.string().trim().max(40).default(""),
  tagline: z.string().trim().max(120).default(""),
  priceCents: money,
  annualPriceCents: money,
  features: z.array(z.string().trim().min(1)).max(10),
  highlight: z.boolean().default(false),
  badge: z.string().trim().max(30).nullable().default(null),
  active: z.boolean().default(true),
  serviceIds: z.array(z.number().int()).default([]),
});

export async function savePlan(
  input: z.input<typeof planSchema>
): Promise<Result> {
  try {
    await admin();
    const data = planSchema.parse(input);
    let planId = data.id;

    if (planId) {
      await db
        .update(plans)
        .set({
          name: data.name,
          kicker: data.kicker,
          tagline: data.tagline,
          priceCents: data.priceCents,
          annualPriceCents: data.annualPriceCents,
          features: data.features,
          highlight: data.highlight,
          badge: data.badge,
          active: data.active,
        })
        .where(eq(plans.id, planId));
    } else {
      const slug =
        data.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || `plano-${Date.now()}`;
      const [{ id }] = await db
        .insert(plans)
        .values({
          slug,
          name: data.name,
          kicker: data.kicker,
          tagline: data.tagline,
          priceCents: data.priceCents,
          annualPriceCents: data.annualPriceCents,
          features: data.features,
          highlight: data.highlight,
          badge: data.badge,
          active: data.active,
          sortOrder: 99,
        })
        .$returningId();
      planId = id;
    }

    // Só um plano pode ser o destaque da vitrine.
    if (data.highlight && planId) {
      await db
        .update(plans)
        .set({ highlight: false })
        .where(and(eq(plans.highlight, true)));
      await db.update(plans).set({ highlight: true }).where(eq(plans.id, planId));
    }

    await db.delete(planServices).where(eq(planServices.planId, planId!));
    if (data.serviceIds.length > 0) {
      await db
        .insert(planServices)
        .values(data.serviceIds.map((sid) => ({ planId: planId!, serviceId: sid })))
        .onDuplicateKeyUpdate({ set: { planId: rawSql`${planServices.planId}` } });
    }

    return done("Plano salvo.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Clientes ─────────────────────────

/** Assina um cliente num plano (uso interno até o gateway entrar). */
/**
 * Corrige o cadastro de um cliente.
 *
 * Existe principalmente para completar quem veio do sistema antigo sem
 * telefone: o número é a chave, então trocá-lo exige conferir se já não é
 * de outra pessoa. Conta com senha própria não tem o nome mexido por aqui.
 */
export async function updateClient(input: {
  userId: number;
  name: string;
  phone: string;
}): Promise<Result> {
  try {
    await admin();
    const name = input.name.trim();
    if (name.length < 2) return { ok: false, error: "Informe o nome do cliente." };

    const atual = await db.query.users.findFirst({ where: eq(users.id, input.userId) });
    if (!atual) return { ok: false, error: "Cliente não encontrado." };
    if (atual.role !== "CLIENT") {
      return { ok: false, error: "Use a tela de Equipe para editar quem trabalha aqui." };
    }

    const bruto = input.phone.trim();
    let phone = atual.phone;
    if (bruto) {
      if (!isValidPhone(bruto)) {
        return { ok: false, error: "Telefone inválido. Use DDD + número." };
      }
      phone = normalizePhone(bruto);
      if (phone !== atual.phone) {
        const dono = await db.query.users.findFirst({ where: eq(users.phone, phone) });
        if (dono && dono.id !== atual.id) {
          return {
            ok: false,
            error: `Esse telefone já é de ${dono.name}. Um número, um cadastro.`,
          };
        }
      }
    }

    await db.update(users).set({ name, phone }).where(eq(users.id, input.userId));
    return done(
      phone !== atual.phone ? "Cadastro atualizado." : "Nome atualizado."
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Cadastra um cliente pelo balcão, sem marcar horário.
 *
 * Antes só entrava gente no sistema de duas formas: agendando ou pela
 * importação do CSV. Quem chegava na loja e pedia "me cadastra aí" ficava
 * de fora até marcar alguma coisa.
 */
export async function createClientManually(input: {
  name: string;
  phone: string;
}): Promise<Result> {
  try {
    await admin();
    const name = input.name.trim();
    if (name.length < 2) return { ok: false, error: "Informe o nome do cliente." };
    if (!isValidPhone(input.phone)) {
      return { ok: false, error: "Telefone inválido. Use DDD + número." };
    }
    const phone = normalizePhone(input.phone);
    const existente = await db.query.users.findFirst({
      where: eq(users.phone, phone),
    });
    if (existente) {
      // O telefone é a chave do cadastro: em vez de criar um segundo
      // registro para a mesma pessoa, manda para a ficha que já existe.
      return {
        ok: false,
        error: `Esse telefone já é de ${existente.name}. Abra a ficha dele para editar.`,
      };
    }
    await db.insert(users).values({ name, phone, role: "CLIENT" });
    return done("Cliente cadastrado.");
  } catch (e) {
    return fail(e);
  }
}

/** Tira o horário fixo de um membro e devolve as semanas para a agenda. */
export async function liberarFixoDoCliente(userId: number): Promise<Result> {
  try {
    await admin();
    const liberados = await liberarFixosDe([userId]);
    return done(
      liberados > 0
        ? `Horário fixo encerrado — ${liberados} semana(s) liberada(s) na agenda.`
        : "Horário fixo encerrado."
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Marca um horário em nome do cliente, pelo balcão.
 *
 * O nome e o telefone saem do cadastro — digitar de novo criaria um
 * segundo registro para a mesma pessoa, já que o telefone é a chave. Quem
 * entrou sem telefone precisa ser completado antes: sem número não há como
 * mandar lembrete nem confirmar.
 */
export async function bookForClient(input: {
  userId: number;
  serviceIds: number[];
  dateKey: string;
  time: string;
  barberId: number | null;
  notes?: string;
}): Promise<Result> {
  try {
    await admin();
    const cliente = await db.query.users.findFirst({
      where: eq(users.id, input.userId),
    });
    if (!cliente || cliente.role !== "CLIENT") {
      return { ok: false, error: "Cliente não encontrado." };
    }
    if (isPlaceholderPhone(cliente.phone)) {
      return {
        ok: false,
        error: "Complete o WhatsApp deste cliente antes de marcar um horário.",
      };
    }
    if (input.serviceIds.length === 0) {
      return { ok: false, error: "Escolha ao menos um serviço." };
    }

    const appt = await createBooking({
      serviceIds: input.serviceIds,
      dateKey: input.dateKey,
      time: input.time,
      barberId: input.barberId,
      clientName: cliente.name,
      clientPhone: cliente.phone,
      notes: input.notes,
      userId: cliente.id,
      // Encaixe do balcão: não é pedido público, então não esbarra na
      // pausa da agenda nem na antecedência mínima.
    });
    return done(`Horário marcado. Código ${appt.code}.`);
  } catch (e) {
    return fail(e);
  }
}

export async function subscribeClient(input: {
  userId: number;
  planId: number;
  cycle: "MENSAL" | "ANUAL";
}): Promise<Result> {
  try {
    await admin();
    const renewsAt = nextRenewal(new Date(), input.cycle);

    // Encerra o que estiver em aberto — ativa OU vencida. Só a ativa era
    // encerrada, então trocar o plano de quem estava devendo deixava duas
    // assinaturas de pé: a nova valendo e a velha inflando "planos
    // vencidos" e a receita do mês.
    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, input.userId),
          inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"])
        )
      );

    await db.insert(subscriptions).values({
      userId: input.userId,
      planId: input.planId,
      cycle: input.cycle,
      renewsAt,
    });
    return done("Assinatura ativada.");
  } catch (e) {
    return fail(e);
  }
}

/** Registra o pagamento do ciclo e estende a assinatura. */
export async function renewSubscription(userId: number): Promise<Result> {
  try {
    await admin();
    const current = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"])
      ),
      orderBy: (s, { desc }) => [desc(s.startedAt)],
    });
    if (!current) return { ok: false, error: "Esse cliente não tem assinatura." };
    await db
      .update(subscriptions)
      .set({
        status: "ATIVA",
        renewsAt: nextRenewal(current.renewsAt, current.cycle),
        canceledAt: null,
      })
      .where(eq(subscriptions.id, current.id));
    return done("Renovação registrada.");
  } catch (e) {
    return fail(e);
  }
}

/** Admin define uma nova senha para qualquer conta (cliente ou equipe). */
export async function resetUserPassword(input: {
  userId: number;
  password: string;
}): Promise<Result> {
  try {
    const session = await admin();
    if (input.password.trim().length < 6) {
      return { ok: false, error: "A senha precisa ter ao menos 6 caracteres." };
    }
    // Senha redefinida pelo balcão: toda sessão antiga da conta cai.
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password.trim()),
        tokenVersion: rawSql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, input.userId));

    // Redefinindo a própria senha pelo painel: sem renovar o cookie, o admin
    // se deslogaria no mesmo clique (a versão do token acabou de subir).
    if (input.userId === session.id) {
      const eu = await db.query.users.findFirst({ where: eq(users.id, session.id) });
      cookies().set(
        SESSION_COOKIE,
        await signSession({ ...session, v: eu?.tokenVersion ?? 0 }),
        sessionCookieOptions
      );
      return done("Sua senha foi trocada. As outras sessões suas foram encerradas.");
    }
    return done("Senha redefinida. A pessoa precisa entrar de novo.");
  } catch (e) {
    return fail(e);
  }
}

export async function cancelSubscription(userId: number): Promise<Result> {
  try {
    await admin();
    // Vencida também é cancelável: antes o botão não fazia nada para quem
    // estava devendo, e a assinatura ficava pendurada para sempre.
    const alvos = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, ["ATIVA", "INADIMPLENTE"])
        )
      );
    if (alvos.length === 0) {
      return { ok: false, error: "Esse cliente não tem plano em aberto." };
    }
    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(
        inArray(
          subscriptions.id,
          alvos.map((a) => a.id)
        )
      );

    // O horário fixo é benefício de membro: sem plano, a cadeira volta para
    // a agenda. Sem isto o ex-membro seguia ocupando o mesmo horário toda
    // semana e o barbeiro não conseguia vender aquele espaço.
    const liberados = await liberarFixosDe([userId]);
    return done(
      liberados > 0
        ? `Assinatura cancelada. O horário fixo foi liberado (${liberados} horário(s) futuro(s)).`
        : "Assinatura cancelada."
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Desliga os horários fixos de quem deixou de ser membro e devolve as
 * semanas já reservadas para a agenda. Devolve quantos horários futuros
 * foram liberados.
 */
export async function liberarFixosDe(userIds: number[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const ativos = await db
    .select({ id: recurringSlots.id })
    .from(recurringSlots)
    .where(
      and(inArray(recurringSlots.userId, userIds), eq(recurringSlots.active, true))
    );
  if (ativos.length === 0) return 0;
  const ids = ativos.map((a) => a.id);
  await db.update(recurringSlots).set({ active: false }).where(inArray(recurringSlots.id, ids));
  return cancelFutureOccurrences(ids);
}

/**
 * Importa clientes do sistema antigo.
 * Aceita CSV com cabeçalho: nome,telefone[,email]. Linhas inválidas são
 * relatadas em vez de derrubar a importação inteira.
 */
export type ImportResult = Result & {
  criados?: number;
  atualizados?: number;
  skipped?: string[];
};

/** Quantos registros por INSERT/SELECT. Segura o tamanho do pacote SQL. */
const LOTE = 200;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Importa a base do sistema antigo.
 *
 * A leitura e as decisões ficam em lib/import.ts (testável); aqui é só o
 * banco — e em lote: uma base de mil clientes daria uns três mil
 * round-trips ao TiDB linha a linha e estouraria o tempo da função.
 */
export async function importClients(csv: string): Promise<ImportResult> {
  try {
    await admin();
    const plano = planClientImport(csv);
    if (!plano.ok) return { ok: false, error: plano.error };
    const { candidatos } = plano;
    const skipped = [...plano.skipped];

    // Quem já está na base, buscado de uma vez.
    const existentes = new Map<string, typeof users.$inferSelect>();
    for (const lote of chunk(candidatos.map((c) => c.phone), LOTE)) {
      const achados = await db.select().from(users).where(inArray(users.phone, lote));
      for (const u of achados) existentes.set(u.phone, u);
    }

    // E-mail tem índice único: um que já seja de outra conta não pode
    // entrar, senão o INSERT do lote inteiro falha.
    const emails = candidatos.map((c) => c.email).filter((e): e is string => !!e);
    const donoDoEmail = new Map<string, number>();
    for (const lote of chunk(emails, LOTE)) {
      const achados = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, lote));
      for (const u of achados) if (u.email) donoDoEmail.set(u.email, u.id);
    }

    // Quem já está na base com número reservado: serve para continuar a
    // numeração e, pelo nome, para reimportar a mesma planilha não criar
    // um segundo cadastro vazio da mesma pessoa (sem telefone, o nome é a
    // única chave que existe).
    const jaPendentes = await db
      .select({ name: users.name, phone: users.phone })
      .from(users)
      .where(like(users.phone, "00%"));
    const reservados = jaPendentes.map((u) => u.phone);
    const nomesPendentes = new Set(jaPendentes.map((u) => chaveNome(u.name)));

    const novos: { name: string; phone: string; email: string | null }[] = [];
    let naoEntraram = 0;
    const atualizar: { id: number; name: string; email: string | null }[] = [];

    for (const c of candidatos) {
      if (c.pendente) {
        // Já entrou numa importação anterior e continua esperando telefone:
        // criar de novo só daria trabalho de apagar depois.
        if (nomesPendentes.has(chaveNome(c.name))) {
          skipped.push(`${c.name} — já está na base esperando telefone`);
          continue;
        }
        const phone = nextPlaceholderPhone(reservados);
        reservados.push(phone);
        nomesPendentes.add(chaveNome(c.name));
        novos.push({ name: c.name, phone, email: null });
        continue;
      }
      const atual = existentes.get(c.phone);
      const dono = c.email ? donoDoEmail.get(c.email) : undefined;
      const emailLivre = !dono || dono === atual?.id;
      if (c.email && !emailLivre) {
        skipped.push(`${c.name} — e-mail ${c.email} já é de outra conta; importado sem e-mail`);
      }
      const email = emailLivre ? c.email : null;

      if (!atual) {
        novos.push({ name: c.name, phone: c.phone, email });
        continue;
      }
      // Conta com senha é de alguém que já usa o sistema: não se mexe.
      if (atual.passwordHash) continue;
      const precisaNome = atual.name !== c.name;
      const precisaEmail = !!email && !atual.email;
      if (precisaNome || precisaEmail) {
        atualizar.push({ id: atual.id, name: c.name, email: precisaEmail ? email : null });
      }
    }

    // Um lote que quebra não pode derrubar a importação inteira: o que já
    // entrou fica, e o que caiu vira aviso com nome e motivo. Em cima de
    // novecentas linhas, uma linha estranha não pode custar a base toda.
    for (const lote of chunk(novos, LOTE)) {
      try {
        await db.insert(users).values(
          lote.map((n) => ({
            name: n.name,
            phone: n.phone,
            email: n.email,
            role: "CLIENT" as const,
          }))
        );
      } catch {
        // Cai para linha a linha só neste lote, para isolar a que falhou.
        for (const n of lote) {
          try {
            await db.insert(users).values({
              name: n.name,
              phone: n.phone,
              email: n.email,
              role: "CLIENT" as const,
            });
          } catch (e) {
            skipped.push(
              `${n.name} — não entrou (${dbErrorMessage(e) ?? "erro no banco"})`
            );
            naoEntraram++;
          }
        }
      }
    }
    for (const u of atualizar) {
      await db
        .update(users)
        .set({ name: u.name, ...(u.email ? { email: u.email } : {}) })
        .where(eq(users.id, u.id));
    }

    const criados = novos.length - naoEntraram;
    const pendentes = novos.filter((n) => isPlaceholderPhone(n.phone)).length;
    const partes = [`${criados} cliente(s) novo(s)`];
    if (atualizar.length) partes.push(`${atualizar.length} atualizado(s)`);
    if (pendentes) partes.push(`${pendentes} sem telefone, para completar`);
    if (skipped.length) partes.push(`${skipped.length} aviso(s)`);
    return {
      ...done(partes.join(", ") + "."),
      criados,
      atualizados: atualizar.length,
      skipped,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function saveShopInfo(input: {
  shopName: string;
  shopUnit: string;
  shopPhone: string;
  shopAddress: string;
  shopInstagram: string;
  shopHoursLabel: string;
}): Promise<Result> {
  try {
    await admin();
    await db
      .update(settingsTable)
      .set({
        shopName: input.shopName.trim() || "Bryan Wesley Barbearia",
        shopUnit: input.shopUnit.trim(),
        shopPhone: input.shopPhone.trim(),
        shopAddress: input.shopAddress.trim(),
        shopInstagram: input.shopInstagram.trim(),
        shopHoursLabel: input.shopHoursLabel.trim(),
      })
      .where(eq(settingsTable.id, 1));
    return done("Dados da barbearia salvos.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Notificações ─────────────────────────

export async function resendNotification(id: number): Promise<Result> {
  try {
    await admin();
    await retryNotification(id);
    return done("Mensagem recolocada na fila.");
  } catch (e) {
    return fail(e);
  }
}

/** Tira uma mensagem da fila (não sai nunca). */
export async function discardNotification(id: number): Promise<Result> {
  try {
    await admin();
    await discardNotificationRow(id);
    return done("Mensagem descartada.");
  } catch (e) {
    return fail(e);
  }
}

/** Dispara a fila na hora, sem esperar o cron. */
/**
 * "Enviar agora" da tela de mensagens.
 *
 * Passa pela mesma trava da varredura automática: o laço próprio daqui
 * mandava a mesma mensagem duas vezes quando o heartbeat de outra aba
 * entregava ao mesmo tempo. A janela é curta (5s) só para excluir a
 * corrida — com os 10 minutos da varredura, o botão viraria um nada.
 */
export async function flushNotifications(): Promise<Result> {
  try {
    await admin();
    if (!isWhatsappConfigured()) {
      const fila = await pendingNotifications(50);
      return {
        ok: false,
        error: `WhatsApp não configurado. ${fila.length} mensagem(ns) aguardando na fila.`,
      };
    }
    const vez = await claimDispatchSlot(5_000);
    if (!vez) {
      return {
        ok: false,
        error: "Uma varredura já está rodando agora. Tente de novo em alguns segundos.",
      };
    }
    const r = await runDispatch(50);
    if (r.desconectado) {
      return {
        ok: false,
        error: `O WhatsApp não está conectado — conecte em "WhatsApp da barbearia", aqui em cima. ${r.pendentes} mensagem(ns) aguardando.`,
      };
    }
    const partes = [`${r.enviadas} mensagem(ns) enviada(s)`];
    if (r.falhas) partes.push(`${r.falhas} falha(s)`);
    if (r.descartadas) partes.push(`${r.descartadas} vencida(s) descartada(s)`);
    if (r.interrompida) partes.push("o resto da fila sai na próxima varredura");
    if (r.enviadas === 0 && r.falhas === 0 && r.pendentes === 0) {
      // Fila só com lembrete do futuro: "0 enviada(s)" parecia erro.
      partes.push("nada com hora marcada para agora");
    }
    return done(partes.join(" · ") + ".");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Cobrança ─────────────────────────

export type ChargeActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Gera o link de pagamento do próximo ciclo da assinatura. */
export async function createSubscriptionCharge(
  userId: number
): Promise<ChargeActionResult> {
  try {
    await admin();
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
      orderBy: (s, { desc }) => [desc(s.startedAt)],
    });
    if (!sub) return { ok: false, error: "Cliente sem assinatura." };
    const res = await chargeSubscription(userId, sub.cycle);
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath("/admin/clientes");
    return { ok: true, url: res.url };
  } catch (e) {
    const r = fail(e);
    return { ok: false, error: r.ok ? "Erro" : r.error };
  }
}

// ───────────────────────── Solicitações de plano ─────────────────────────

/** Aceita o pedido feito pelo cliente no site e ativa a assinatura. */
export async function acceptPlanRequest(requestId: number): Promise<Result> {
  try {
    await admin();
    const req = await db.query.planRequests.findFirst({
      where: eq(planRequests.id, requestId),
    });
    if (!req) return { ok: false, error: "Solicitação não encontrada." };

    const r = await subscribeClient({
      userId: req.userId,
      planId: req.planId,
      cycle: req.cycle,
    });
    if (!r.ok) return r;

    await db
      .update(planRequests)
      .set({ status: "ATENDIDA" })
      .where(eq(planRequests.id, requestId));
    return done("Assinatura ativada.");
  } catch (e) {
    return fail(e);
  }
}

export async function rejectPlanRequest(requestId: number): Promise<Result> {
  try {
    await admin();
    await db
      .update(planRequests)
      .set({ status: "RECUSADA" })
      .where(eq(planRequests.id, requestId));
    return done("Solicitação arquivada.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Troca os serviços de um atendimento em aberto (o cliente pediu barba
 * junto com o corte). O horário de início não muda.
 */
export async function editarServicos(input: {
  appointmentId: number;
  serviceIds: number[];
}): Promise<Result> {
  try {
    await admin();
    const appt = await updateAppointmentServices(input);
    return done(
      appt.kind === "ASSINANTE"
        ? "Serviços atualizados — incluso no plano."
        : `Serviços atualizados — ${formatBRL(appt.totalCents)}.`
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    return fail(e);
  }
}

// ───────────────────────── Remarcar pelo admin ─────────────────────────

export async function adminReschedule(input: {
  appointmentId: number;
  dateKey: string;
  time: string;
  barberId: number | null;
}): Promise<Result> {
  try {
    await admin();
    await rescheduleBooking(input);
    return done("Horário remarcado.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────── WhatsApp (WAHA) ─────────────────────

/**
 * "Conectar" do painel: cria (ou acerta) a sessão no WAHA já apontando o
 * webhook para este site e liga. Pode apertar de novo sem medo — é o
 * mesmo botão que conserta um webhook apontado para o lugar errado.
 */
export async function conectarWhatsapp(): Promise<Result> {
  try {
    await admin();
    if (!wahaConfigurado()) {
      return { ok: false, error: "Configure WAHA_URL e WAHA_API_KEY na Vercel primeiro." };
    }
    if (!process.env.WAHA_HMAC_KEY) {
      return { ok: false, error: "Falta WAHA_HMAC_KEY na Vercel — sem ela o site recusa as mensagens." };
    }
    const r = await wahaConectar(`${publicBaseUrl()}/api/whatsapp/waha`);
    if (!r.ok) return { ok: false, error: `O WAHA não aceitou: ${r.erro}` };
    return done("Pronto. Se aparecer o QR code, é só escanear com o WhatsApp da barbearia.");
  } catch (e) {
    return fail(e);
  }
}

/** Código de 8 letras para conectar sem escanear (painel aberto no próprio celular). */
export async function codigoDoWhatsapp(
  fone: string
): Promise<{ ok: true; codigo: string } | { ok: false; error: string }> {
  try {
    await admin();
    if (!isValidPhone(fone)) return { ok: false, error: "Digite o número do WhatsApp da barbearia, com DDD." };
    const r = await wahaCodigoDePareamento(normalizePhone(fone));
    if (r.codigo === null) {
      return { ok: false, error: `Não deu para gerar o código (${r.erro}). Use o QR code.` };
    }
    return { ok: true, codigo: r.codigo };
  } catch (e) {
    const r = fail(e);
    return r.ok ? { ok: false, error: "Não foi possível concluir." } : r;
  }
}

/** Devolve a conversa ao atendente antes de a pausa acabar. */
export async function retomarConversaWhatsapp(fone: string): Promise<Result> {
  try {
    await admin();
    await retomarAtendente(fone);
    return done("O atendente voltou a responder essa conversa.");
  } catch (e) {
    return fail(e);
  }
}
