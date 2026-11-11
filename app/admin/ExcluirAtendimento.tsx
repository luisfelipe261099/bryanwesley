"use client";

// Lixeira do painel: apaga de vez um atendimento de teste ou lançado por
// engano, para o faturamento ficar certo. Só o dono vê (telas do painel).

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { excluirAtendimento } from "./actions";

export function ExcluirAtendimento({ id, resumo }: { id: number; resumo: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  if (confirmando) {
    return (
      <div data-ocupado className="flex flex-col items-end gap-2 rounded-xl border border-red-500/50 bg-red-500/10 p-2.5">
        <p className="max-w-[240px] text-right text-xs text-red-100">
          Excluir de vez <b>{resumo}</b>? Sai da agenda, da comissão e do faturamento. Não dá para desfazer.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setConfirmando(false);
              setErro(null);
            }}
            className="label rounded-full border border-white/15 px-3 py-2 text-steel-300"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await excluirAtendimento(id);
                if (r.ok) {
                  toast(r.message ?? "Excluído.", "ok");
                  setConfirmando(false);
                } else setErro(r.error);
              })
            }
            className="label inline-flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-2 text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Excluir
          </button>
        </div>
        {erro && <p className="max-w-[240px] text-right text-xs text-amber-200">{erro}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label="Excluir atendimento"
      title="Excluir (teste ou lançado por engano)"
      onClick={() => setConfirmando(true)}
      className="grid h-9 w-9 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-red-400/50 hover:text-red-300"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
