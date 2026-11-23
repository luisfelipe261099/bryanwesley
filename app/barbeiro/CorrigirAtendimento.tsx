"use client";

// "Corrigir" na agenda do barbeiro (pedido do Bryan): apertou o comando
// errado — finalizou antes da hora, marcou falta, registrou o pagamento
// errado ou o serviço está errado — e precisa arrumar sem chamar o dono.

import { useState, useTransition } from "react";
import { Loader2, Pencil, RotateCcw, Undo2, Users, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { EditarServicos, type ServicoDoCatalogo } from "@/app/admin/agenda/EditarServicos";
import {
  desfazerFalta,
  desfazerRecebimento,
  editarServicosDoAtendimento,
  reabrir,
  type ActionResult,
} from "./actions";

export function CorrigirAtendimento({
  id,
  status,
  pagoNoBalcao,
  servicos,
  atuais,
  resumo,
  dia,
  hora,
  barbeiroId,
  barbeiros,
  trocarBarbeiro,
}: {
  id: number;
  status: string;
  /** Há recebimento no balcão (dinheiro/maquininha) registrado. */
  pagoNoBalcao: boolean;
  servicos: ServicoDoCatalogo[];
  atuais: number[];
  resumo: string;
  dia: string;
  hora: string;
  /** Salão (dono): o cliente preferiu outro barbeiro. */
  barbeiroId?: number;
  barbeiros?: { id: number; nome: string }[];
  trocarBarbeiro?: (input: { appointmentId: number; barberId: number }) => Promise<ActionResult>;
}) {
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function run(fn: (id: number) => Promise<ActionResult>) {
    setErro(null);
    start(async () => {
      const r = await fn(id);
      if (r.ok) {
        toast(r.message ?? "Corrigido.", "ok");
        setAberto(false);
      } else setErro(r.error);
    });
  }

  const podeServicos = ["PENDENTE", "CONFIRMADO", "EM_ANDAMENTO"].includes(status);
  const outros = (barbeiros ?? []).filter((b) => b.id !== barbeiroId);
  const podeBarbeiro = podeServicos && !!trocarBarbeiro && outros.length > 0;
  const temAlgo = status === "CONCLUIDO" || status === "NO_SHOW" || pagoNoBalcao || podeServicos;
  if (!temAlgo) return null;

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-electric/45 hover:text-white"
      >
        <Pencil className="h-3 w-3" />
        Corrigir
      </button>
    );
  }

  const botao =
    "label inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-steel-100 transition-colors hover:border-electric/50 disabled:opacity-50";

  return (
    <div data-ocupado className="flex w-full max-w-[280px] flex-col gap-2 rounded-xl border border-white/15 bg-white/[0.04] p-2.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white">Corrigir {resumo}</p>
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => {
            setAberto(false);
            setErro(null);
          }}
          className="text-steel-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {status === "CONCLUIDO" && (
        <button type="button" disabled={pending} onClick={() => run(reabrir)} className={botao}>
          <RotateCcw className="h-3.5 w-3.5" /> Reabrir (finalizei sem querer)
        </button>
      )}
      {status === "NO_SHOW" && (
        <button type="button" disabled={pending} onClick={() => run(desfazerFalta)} className={botao}>
          <Undo2 className="h-3.5 w-3.5" /> Desfazer falta
        </button>
      )}
      {pagoNoBalcao && (
        <button type="button" disabled={pending} onClick={() => run(desfazerRecebimento)} className={botao}>
          <Undo2 className="h-3.5 w-3.5" /> Desfazer pagamento registrado
        </button>
      )}
      {podeServicos && (
        <EditarServicos
          variante="texto"
          appointmentId={id}
          servicos={servicos}
          atuais={atuais}
          resumo={resumo}
          dia={dia}
          hora={hora}
          acao={editarServicosDoAtendimento}
        />
      )}
      {podeBarbeiro && (
        <div className="border-t border-white/10 pt-2">
          <p className="flex items-center gap-1.5 text-[11px] text-steel-300">
            <Users className="h-3.5 w-3.5" /> Passar para outro barbeiro
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {outros.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={pending}
                onClick={() => run((apptId) => trocarBarbeiro!({ appointmentId: apptId, barberId: b.id }))}
                className={botao}
              >
                {b.nome}
              </button>
            ))}
          </div>
        </div>
      )}
      {status === "CONCLUIDO" && (
        <p className="text-[11px] text-steel-400">Para trocar o serviço de um finalizado: reabra, troque e finalize de novo.</p>
      )}
      {pending && (
        <p className="flex items-center gap-1.5 text-[11px] text-steel-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Corrigindo…
        </p>
      )}
      {erro && <p className="text-[11px] text-red-300">{erro}</p>}
    </div>
  );
}
