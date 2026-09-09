"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Check, Loader2, Play, UserX } from "lucide-react";
import {
  startAppointment,
  finishAppointment,
  markNoShow,
  type ActionResult,
} from "./actions";

export function AppointmentActions({
  id,
  status,
}: {
  id: number;
  status: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (id: number) => Promise<ActionResult>) {
    setError(null);
    start(async () => {
      const res = await fn(id);
      if (!res.ok) setError(res.error);
    });
  }

  const busy = pending ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {status === "CONFIRMADO" || status === "PENDENTE" ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(startAppointment)}
            className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white disabled:opacity-50"
          >
            {busy ?? <Play className="h-3 w-3" />}
            Iniciar
          </button>
          <button
            type="button"
            disabled={pending}
            aria-label="Marcar falta"
            title="Marcar falta"
            onClick={() => run(markNoShow)}
            className="label grid h-8 w-8 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-50"
          >
            <UserX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : status === "EM_ANDAMENTO" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(finishAppointment)}
          className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white disabled:opacity-50"
        >
          {busy ?? <Check className="h-3 w-3" strokeWidth={3} />}
          Finalizar
        </button>
      ) : null}

      {error && (
        <p className="flex max-w-[220px] items-start gap-1.5 text-right text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-none" />
          {error}
        </p>
      )}
    </div>
  );
}
