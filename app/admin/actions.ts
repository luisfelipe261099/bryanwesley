"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  barbers,
  commissionTiers,
  planServices,
  plans,
  scheduleBlocks,
  services,
  settings as settingsTable,
  subscriptions,
  users,
} from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { transitionAppointment, BookingError } from "@/lib/appointments";
import { shopTimeToUtc, parseDateKey } from "@/lib/time";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { nextRenewal } from "@/lib/subscriptions";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function admin() {
  return requireRole(["ADMIN"]);
}

function done(message?: string): Result {
  for (const p of ["/admin", "/admin/agenda", "/admin/equipe", "/admin/catalogo", "/admin/clientes", "/barbeiro", "/cliente", "/agendar", "/", "/planos"]) {
    revalidatePath(p);
  }
  return { ok: true, message };
}

function fail(e: unknown): Result {
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

    const [user] = await db
      .insert(users)
      .values({
        name: data.name,
        phone,
        email: data.email.toLowerCase(),
        passwordHash: await hashPassword(password),
        role: data.isAdmin ? "ADMIN" : "BARBER",
      })
      .onConflictDoUpdate({
        target: users.phone,
        set: {
          name: data.name,
          email: data.email.toLowerCase(),
          role: data.isAdmin ? "ADMIN" : "BARBER",
          // Telefone já existia (ex.: era cliente): a senha informada
          // passa a valer, senão o barbeiro não consegue entrar.
          passwordHash: await hashPassword(password),
          active: true,
        },
      })
      .returning();

    await db
      .insert(barbers)
      .values({
        userId: user.id,
        slug: `${slug}-${user.id}`,
        shortName: data.shortName,
        title: data.title,
        commissionPct: data.commissionPct,
      })
      .onConflictDoNothing();

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
    await admin();
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
    return done("Barbeiro atualizado.");
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
      return done("Jornada removida (volta a valer o horário da loja).");
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
      .onConflictDoUpdate({
        target: [barberHours.barberId, barberHours.weekday],
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
    return done(active ? "Serviço ativado." : "Serviço desativado.");
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
      const [created] = await db
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
        .returning();
      planId = created.id;
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
        .onConflictDoNothing();
    }

    return done("Plano salvo.");
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────── Clientes ─────────────────────────

/** Assina um cliente num plano (uso interno até o gateway entrar). */
export async function subscribeClient(input: {
  userId: number;
  planId: number;
  cycle: "MENSAL" | "ANUAL";
}): Promise<Result> {
  try {
    await admin();
    const renewsAt = nextRenewal(new Date(), input.cycle);

    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(
        and(
          eq(subscriptions.userId, input.userId),
          eq(subscriptions.status, "ATIVA")
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
    await admin();
    if (input.password.trim().length < 6) {
      return { ok: false, error: "A senha precisa ter ao menos 6 caracteres." };
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password.trim()) })
      .where(eq(users.id, input.userId));
    return done("Senha redefinida.");
  } catch (e) {
    return fail(e);
  }
}

export async function cancelSubscription(userId: number): Promise<Result> {
  try {
    await admin();
    await db
      .update(subscriptions)
      .set({ status: "CANCELADA", canceledAt: new Date() })
      .where(
        and(eq(subscriptions.userId, userId), eq(subscriptions.status, "ATIVA"))
      );
    return done("Assinatura cancelada.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Importa clientes do sistema antigo.
 * Aceita CSV com cabeçalho: nome,telefone[,email]. Linhas inválidas são
 * relatadas em vez de derrubar a importação inteira.
 */
export async function importClients(csv: string): Promise<
  Result & { imported?: number; skipped?: string[] }
> {
  try {
    await admin();
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return { ok: false, error: "Arquivo vazio." };

    // Descarta o cabeçalho quando presente.
    const first = lines[0].toLowerCase();
    const rows =
      first.includes("nome") || first.includes("telefone")
        ? lines.slice(1)
        : lines;

    let imported = 0;
    const skipped: string[] = [];

    for (const line of rows) {
      const cols = line.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      const [name, rawPhone, email] = cols;
      if (!name || !rawPhone) {
        skipped.push(`${line} — nome ou telefone ausente`);
        continue;
      }
      if (!isValidPhone(rawPhone)) {
        skipped.push(`${name} — telefone inválido (${rawPhone})`);
        continue;
      }
      await db
        .insert(users)
        .values({
          name,
          phone: normalizePhone(rawPhone),
          email: email && email.includes("@") ? email.toLowerCase() : null,
          role: "CLIENT",
        })
        .onConflictDoUpdate({
          target: users.phone,
          set: { name },
        });
      imported++;
    }

    return { ...done(`${imported} cliente(s) importado(s).`), imported, skipped };
  } catch (e) {
    return fail(e);
  }
}
