import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hitRateLimit } from "@/lib/rate-limit";
import {
  lerInscricao,
  salvarInscricao,
  removerInscricao,
  nomeDoAparelho,
  contarAparelhos,
} from "@/lib/push";
import { garantirLembretesPush } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * A inscrição deste aparelho nos avisos no celular.
 *
 * POST guarda (ou renova) a inscrição que o navegador gerou; DELETE a
 * remove. Só com sessão: a inscrição é da pessoa logada, e é ela quem
 * passa a receber os avisos — o barbeiro os da agenda dele, o cliente
 * os do horário dele. O service worker também chama o POST sozinho
 * quando o navegador troca a inscrição.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  // Um aparelho se inscreve uma vez; dezenas por hora é script.
  const freio = await hitRateLimit(`push:inscrever:${session.id}`, 40, 3600_000);
  if (!freio.ok) return NextResponse.json({ error: "muitas tentativas" }, { status: 429 });

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }
  const inscricao = lerInscricao((corpo as { inscricao?: unknown } | null)?.inscricao);
  if (!inscricao) return NextResponse.json({ error: "inscrição inválida" }, { status: 400 });

  await salvarInscricao(session.id, inscricao, nomeDoAparelho(req.headers.get("user-agent")));
  // Horários já marcados ganham o lembrete pelo celular também.
  const lembretes = await garantirLembretesPush(session.id).catch((e) => {
    console.error("Lembretes push do cliente:", e);
    return 0;
  });
  return NextResponse.json({ ok: true, aparelhos: await contarAparelhos(session.id), lembretes });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  let corpo: { endpoint?: unknown } | null = null;
  try {
    corpo = await req.json();
  } catch {
    corpo = null;
  }
  const endpoint = typeof corpo?.endpoint === "string" ? corpo.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint ausente" }, { status: 400 });
  const removida = await removerInscricao(session.id, endpoint);
  return NextResponse.json({ ok: true, removida, aparelhos: await contarAparelhos(session.id) });
}
