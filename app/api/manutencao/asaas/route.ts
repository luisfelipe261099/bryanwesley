import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { payments, subscriptions, users } from "@/db/schema";
import {
  apagarCobranca,
  desligarAvisosDoCliente,
  listarClientes,
  listarCobrancas,
  listarNegativacoes,
} from "@/lib/providers/asaas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Conferência do Asaas contra o sistema, para manutenção (não é tela).
 * Só responde com o MANUTENCAO_TOKEN no cabeçalho; sem a variável, a rota
 * não existe.
 */
function autorizado(req: Request) {
  const esperado = process.env.MANUTENCAO_TOKEN;
  const recebido = req.headers.get("x-manutencao-token");
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const naoExiste = () => NextResponse.json({ error: "não encontrado" }, { status: 404 });

/** O que está em aberto no Asaas, com o que o sistema sabe de cada cobrança. */
export async function GET(req: Request) {
  if (!autorizado(req)) return naoExiste();
  const [vencidas, pendentes, clientes, negativacoes] = await Promise.all([
    listarCobrancas("OVERDUE"),
    listarCobrancas("PENDING"),
    listarClientes(),
    listarNegativacoes(),
  ]);
  if (!vencidas.ok) return NextResponse.json({ error: vencidas.error }, { status: 502 });
  if (!pendentes.ok) return NextResponse.json({ error: pendentes.error }, { status: 502 });
  const nomes = new Map((clientes.ok ? clientes.data : []).map((c) => [c.id, c]));

  const abertas = [...vencidas.data, ...pendentes.data].filter((c) => !c.deleted);
  const refs = abertas.map((c) => c.externalReference).filter((r): r is string => !!r);
  const linhas = refs.length ? await db.select().from(payments).where(inArray(payments.orderNsu, refs)) : [];
  const porRef = new Map(linhas.map((l) => [l.orderNsu, l]));
  const userIds = [...new Set(linhas.map((l) => l.userId).filter((v): v is number => v != null))];
  const [subs, pagos, gente] = userIds.length
    ? await Promise.all([
        db.select().from(subscriptions).where(inArray(subscriptions.userId, userIds)).orderBy(desc(subscriptions.startedAt)),
        db
          .select()
          .from(payments)
          .where(and(inArray(payments.userId, userIds), eq(payments.status, "PAGO")))
          .orderBy(desc(payments.paidAt)),
        db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)),
      ])
    : [[], [], []];

  const cobrancas = abertas.map((c) => {
    const linha = c.externalReference ? porRef.get(c.externalReference) : undefined;
    const sub = linha?.userId ? subs.find((s) => s.userId === linha.userId) : undefined;
    const pagosDele = linha?.userId ? pagos.filter((p) => p.userId === linha.userId).slice(0, 4) : [];
    return {
      asaasId: c.id,
      situacaoAsaas: c.status,
      valor: c.value,
      vencimento: c.dueDate,
      criada: c.dateCreated,
      forma: c.billingType,
      descricao: c.description,
      clienteAsaas: nomes.get(c.customer)?.name ?? c.customer,
      avisosDesligados: nomes.get(c.customer)?.notificationDisabled ?? null,
      daAssinaturaAsaas: c.subscription ?? null,
      sistema: linha
        ? {
            pagamentoId: linha.id,
            situacao: linha.status,
            tipo: linha.kind,
            idAsaasGravado: linha.transactionNsu,
            cliente: gente.find((g) => g.id === linha.userId)?.name ?? null,
            userId: linha.userId,
            plano: sub ? { situacao: sub.status, venceEm: sub.renewsAt, saindo: !!sub.canceledAt } : null,
            ultimosPagos: pagosDele.map((p) => ({
              tipo: p.kind,
              valorCents: p.amountCents,
              por: p.provider,
              forma: p.slug,
              pagoEm: p.paidAt,
              descricao: p.description,
            })),
          }
        : null,
    };
  });

  return NextResponse.json({
    cobrancas,
    clientes: clientes.ok
      ? { total: clientes.data.length, comAvisosLigados: clientes.data.filter((c) => !c.notificationDisabled).length }
      : { erro: clientes.error },
    negativacoes: negativacoes.ok ? negativacoes.data.data ?? [] : { erro: negativacoes.error },
  });
}

/**
 * { acao: "desligar-avisos" }: desliga e-mail/SMS do Asaas de todo cliente
 * já cadastrado. { acao: "apagar", ids: [...] }: apaga no Asaas cobranças
 * em aberto e marca como canceladas aqui.
 */
export async function POST(req: Request) {
  if (!autorizado(req)) return naoExiste();
  const body = (await req.json().catch(() => ({}))) as { acao?: string; ids?: string[] };

  if (body.acao === "desligar-avisos") {
    const clientes = await listarClientes();
    if (!clientes.ok) return NextResponse.json({ error: clientes.error }, { status: 502 });
    const ligados = clientes.data.filter((c) => !c.notificationDisabled);
    let feitos = 0;
    const falhas: string[] = [];
    for (let i = 0; i < ligados.length; i += 8) {
      const lote = await Promise.all(ligados.slice(i, i + 8).map((c) => desligarAvisosDoCliente(c.id).then((r) => ({ c, r }))));
      for (const { c, r } of lote) {
        if (r.ok) feitos++;
        else falhas.push(`${c.name}: ${r.error}`);
      }
    }
    return NextResponse.json({ total: clientes.data.length, estavamLigados: ligados.length, desligados: feitos, falhas });
  }

  if (body.acao === "apagar" && Array.isArray(body.ids)) {
    const resultado: { id: string; ok: boolean; erro?: string }[] = [];
    for (const id of body.ids.slice(0, 100).map(String)) {
      const r = await apagarCobranca(id);
      if (!r.ok && r.status !== 404) {
        resultado.push({ id, ok: false, erro: r.error });
        continue;
      }
      await db
        .update(payments)
        .set({ status: "CANCELADO" })
        .where(and(eq(payments.transactionNsu, id), eq(payments.status, "PENDENTE")));
      resultado.push({ id, ok: true });
    }
    return NextResponse.json({ resultado });
  }

  return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
}
