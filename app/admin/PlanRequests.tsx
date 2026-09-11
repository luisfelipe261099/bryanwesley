"use client";

import { useState, useTransition } from "react";
import { Check, Gem, Loader2, X } from "lucide-react";
import { Card, Feedback, notify, type Msg } from "@/components/admin/Feedback";
import { formatBRL } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { acceptPlanRequest, rejectPlanRequest } from "./actions";

export type RequestRow = {
  id: number;
  cycle: string;
  clientName: string;
  clientPhone: string;
  planName: string;
  priceCents: number;
};

export function PlanRequests({ requests }: { requests: RequestRow[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function run(fn: (id: number) => Promise<{ ok: boolean; error?: string; message?: string }>, id: number) {
    setMsg(null);
    start(async () => {
      const r = await fn(id);
      setMsg(notify(r, "Feito."));
    });
  }

  return (
    <Card
      title="Pedidos de assinatura"
      desc="Clientes que escolheram um plano pelo site e aguardam confirmação."
      icon={<Gem className="h-5 w-5" />}
    >
      <ul className="space-y-2">
        {requests.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-electric/25 bg-electric/[0.05] p-3.5"
          >
            <div className="min-w-0">
              <p className="font-medium text-white">{r.clientName}</p>
              <p className="text-xs text-steel-400">
                {formatPhone(r.clientPhone)} · {r.planName} ·{" "}
                {r.cycle.toLowerCase()} · {formatBRL(r.priceCents)}/mês
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(acceptPlanRequest, r.id)}
                className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-white disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" strokeWidth={3} />
                )}
                Ativar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(rejectPlanRequest, r.id)}
                aria-label="Arquivar"
                title="Arquivar"
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 text-steel-400 hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Feedback msg={msg} />
    </Card>
  );
}
