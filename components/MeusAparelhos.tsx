"use client";

import { useTransition } from "react";
import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { esquecerAparelho } from "@/app/conta/actions";

export type AparelhoRow = { id: number; nome: string; quando: string };

/** Os aparelhos em que a pessoa ligou os avisos, com o botão de tirar. */
export function MeusAparelhos({ aparelhos }: { aparelhos: AparelhoRow[] }) {
  if (aparelhos.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8">
      {aparelhos.map((a) => (
        <Aparelho key={a.id} {...a} />
      ))}
    </ul>
  );
}

function Aparelho({ id, nome, quando }: AparelhoRow) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-2.5 text-steel-200">
        <Smartphone className="h-4 w-4 flex-none text-electric" />
        <span className="truncate">{nome}</span>
        <span className="hidden text-xs text-steel-400 sm:inline">· {quando}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await esquecerAparelho(id);
            if (r.ok) toast("Aparelho removido.");
            else toast(r.error, "erro");
          })
        }
        aria-label={`Remover ${nome}`}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-steel-400 transition-colors hover:text-red-200 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Remover
      </button>
    </li>
  );
}
