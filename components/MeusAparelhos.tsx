"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { esquecerAparelho } from "@/app/conta/actions";

export type AparelhoRow = { id: number; nome: string; quando: string; endpointHash: string };

/** sha256 em hex do endereço do aparelho — a mesma conta que o servidor faz. */
async function hashDoEndpoint(endpoint: string) {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Os aparelhos em que a pessoa ligou os avisos, com o botão de tirar. O
 * aparelho em uso aparece marcado; removê-lo também desfaz a inscrição
 * no navegador, para o cartão acima não seguir dizendo "ligados".
 */
export function MeusAparelhos({ aparelhos }: { aparelhos: AparelhoRow[] }) {
  const [atual, setAtual] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !crypto?.subtle) return;
    let vivo = true;
    navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => (sub ? hashDoEndpoint(sub.endpoint) : null))
      .then((h) => {
        if (vivo) setAtual(h);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (aparelhos.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-white/6 rounded-2xl border border-white/8">
      {aparelhos.map((a) => (
        <Aparelho key={a.id} {...a} esteAparelho={a.endpointHash === atual} />
      ))}
    </ul>
  );
}

async function desinscreverEsteNavegador() {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {}
  window.dispatchEvent(new Event("avisos-push:removido"));
}

function Aparelho({ id, nome, quando, esteAparelho }: AparelhoRow & { esteAparelho: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 items-center gap-2.5 text-steel-200">
        <Smartphone className="h-4 w-4 flex-none text-electric" />
        <span className="truncate">{nome}</span>
        {esteAparelho && (
          <span className="label flex-none rounded-full bg-electric/10 px-2 py-1 text-electric">este aparelho</span>
        )}
        <span className="hidden text-xs text-steel-400 sm:inline">· {quando}</span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await esquecerAparelho(id);
            if (!r.ok) {
              toast(r.error, "erro");
              return;
            }
            if (esteAparelho) await desinscreverEsteNavegador();
            toast(esteAparelho ? "Avisos desligados neste aparelho." : "Aparelho removido.");
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
