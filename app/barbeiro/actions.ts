"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, gte, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, appointmentServices, services, users } from "@/db/schema";
import { activeSubscription, dayBounds } from "@/lib/queries";
import { requireRole } from "@/lib/auth";
import { isNextControlFlow } from "@/lib/errors";
import { transitionAppointment, BookingError } from "@/lib/appointments";
import { shopToday, utcToShopParts, labelFullDate } from "@/lib/time";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** O barbeiro só mexe no próprio atendimento; o admin mexe em qualquer um. */
async function assertOwnership(appointmentId: number) {
  const session = await requireRole(["BARBER", "ADMIN"]);
  const appt = await db.query.appointments.findFirst({
    where: eq(appointments.id, appointmentId),
  });
  if (!appt) throw new BookingError("Agendamento não encontrado.");
  if (session.role === "BARBER" && appt.barberId !== session.barberId) {
    throw new BookingError("Esse atendimento é de outro barbeiro.");
  }
  return { session, appt };
}

export async function startAppointment(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "EM_ANDAMENTO");
    revalidateAll();
    return { ok: true, message: "Atendimento iniciado." };
  } catch (e) {
    return toResult(e);
  }
}

export async function finishAppointment(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "CONCLUIDO");
    revalidateAll();
    return { ok: true, message: "Atendimento concluído e comissão lançada." };
  } catch (e) {
    return toResult(e);
  }
}

export async function markNoShow(id: number): Promise<ActionResult> {
  try {
    await assertOwnership(id);
    await transitionAppointment(id, "NO_SHOW");
    revalidateAll();
    return { ok: true, message: "Marcado como falta." };
  } catch (e) {
    return toResult(e);
  }
}

/**
 * Check-in: valida a chegada do cliente.
 * Aceita o token do QR ou o código curto digitado à mão — o barbeiro
 * nunca fica travado se a câmera falhar.
 */
export async function checkIn(input: {
  token?: string;
  code?: string;
}): Promise<ActionResult & { appointmentId?: number; semPlano?: boolean }> {
  try {
    return await fazerCheckIn(input);
  } catch (e) {
    return toResult(e);
  }
}

async function fazerCheckIn(input: {
  token?: string;
  code?: string;
}): Promise<ActionResult & { appointmentId?: number; semPlano?: boolean }> {
  const session = await requireRole(["BARBER", "ADMIN"]);

  const where = input.token
    ? eq(appointments.checkinToken, input.token)
    : input.code
      ? eq(appointments.code, input.code.trim().toUpperCase())
      : null;
  if (!where) return { ok: false, error: "Informe o QR ou o código." };

  const appt = await db.query.appointments.findFirst({ where });
  if (!appt) return { ok: false, error: "Código não encontrado." };

  if (session.role === "BARBER" && appt.barberId !== session.barberId) {
    return { ok: false, error: "Esse atendimento é de outro barbeiro." };
  }
  const dia = utcToShopParts(appt.startsAt).dateKey;
  if (appt.status === "NO_SHOW" && dia !== shopToday()) {
    return {
      ok: false,
      error: `Esse horário era de ${labelFullDate(dia)} e ficou como falta. Marque um novo horário para o cliente.`,
    };
  }
  if (appt.status === "NO_SHOW") {
    // Falta marcada e o cliente apareceu: tem volta, mas pelo painel.
    return {
      ok: false,
      error:
        session.role === "ADMIN"
          ? "Esse horário está marcado como falta. Se o cliente chegou, use “Desfazer falta” na Agenda."
          : "Esse horário está marcado como falta. Se o cliente chegou, peça ao administrador para desfazer a falta.",
    };
  }
  if (appt.status === "CANCELADO") {
    return { ok: false, error: "Esse agendamento foi cancelado." };
  }
  if (appt.status === "CONCLUIDO") {
    return { ok: false, error: "Esse atendimento já foi concluído." };
  }
  // Check-in é de hoje. O código de um horário da semana que vem iniciava
  // aquele atendimento agora — e bagunçava a agenda dos dois dias.
  if (dia !== shopToday()) {
    return {
      ok: false,
      error: `Esse agendamento é de ${labelFullDate(dia)}, não de hoje.`,
    };
  }

  await db
    .update(appointments)
    .set({ checkedInAt: appt.checkedInAt ?? new Date() })
    .where(eq(appointments.id, appt.id));

  // Assinante: confere se o plano ainda vale — é o ponto anti-fraude.
  // Vale também para o horário coberto só em parte (corte no plano +
  // sobrancelha avulsa): ele fica como avulso, mas o item do plano sai
  // de graça do mesmo jeito.
  let planoInfo = "";
  let semPlano = false;
  // Item de graça só "é do plano" se no catálogo ele tem preço: uma
  // cortesia de R$ 0 não pode disparar o alerta.
  const [doPlano] =
    appt.kind === "ASSINANTE"
      ? [{ id: 0 }]
      : await db
          .select({ id: appointmentServices.id })
          .from(appointmentServices)
          .innerJoin(services, eq(services.id, appointmentServices.serviceId))
          .where(
            and(
              eq(appointmentServices.appointmentId, appt.id),
              eq(appointmentServices.priceCents, 0),
              gt(services.priceCents, 0)
            )
          )
          .limit(1);
  if (doPlano) {
    const sub = appt.clientUserId
      ? await activeSubscription(appt.clientUserId)
      : undefined;
    // Ciclo vencido é plano vencido, mesmo antes da rotina diária virar o
    // status (a mesma regra de quem agenda).
    const valido = !!sub && sub.renewsAt.getTime() > Date.now();
    semPlano = !valido;
    planoInfo = valido
      ? ` Plano ${sub!.plan.name.replace("Plano ", "")} ativo.`
      : " ATENÇÃO: sem plano ativo — cobrar avulso.";
    // O plano vem pelo WhatsApp digitado: marcado com outro nome, pode ser
    // outra pessoa usando o número de um membro. O barbeiro confere.
    if (valido && appt.clientUserId) {
      const dono = await db.query.users.findFirst({
        columns: { name: true },
        where: eq(users.id, appt.clientUserId),
      });
      const primeiro = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (dono && primeiro(dono.name) !== primeiro(appt.clientName)) {
        planoInfo += ` ATENÇÃO: marcado como ${appt.clientName} no plano de ${dono.name} — confira se é a mesma pessoa.`;
      }
    }
  }

  // Só inicia automaticamente se o barbeiro estiver livre; senão
  // registra a chegada e ele inicia quando terminar o atual.
  let started = false;
  if (appt.status === "CONFIRMADO" || appt.status === "PENDENTE") {
    // Só conta quem está na cadeira HOJE: um atendimento esquecido aberto
    // no sábado travava o início automático de todos os check-ins.
    const { start: inicioHoje, end: fimHoje } = dayBounds(shopToday());
    const busy = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.barberId, appt.barberId),
        eq(appointments.status, "EM_ANDAMENTO"),
        gte(appointments.startsAt, inicioHoje),
        lt(appointments.startsAt, fimHoje)
      ),
    });
    if (!busy) {
      await transitionAppointment(appt.id, "EM_ANDAMENTO");
      started = true;
    }
  }

  // Ler o QR de novo com o atendimento já rodando não é "chegada": antes
  // dizia "inicie quando liberar a cadeira" para quem já estava sentado.
  const situacao =
    appt.status === "EM_ANDAMENTO"
      ? " Atendimento já em andamento."
      : started
        ? ""
        : " Chegada registrada — inicie quando liberar a cadeira.";

  revalidateAll();
  return {
    ok: true,
    message: `Check-in de ${appt.clientName} confirmado.${planoInfo}${situacao}`,
    appointmentId: appt.id,
    semPlano,
  };
}

function revalidateAll() {
  revalidatePath("/barbeiro");
  revalidatePath("/admin");
  revalidatePath("/cliente");
}

function toResult(e: unknown): ActionResult {
  // Mesma regra do admin: redirect() de sessão expirada precisa propagar.
  if (isNextControlFlow(e)) throw e;
  if (e instanceof BookingError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Não foi possível concluir a ação." };
}
