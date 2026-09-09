"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Loader2, Scissors, X } from "lucide-react";
import { cancelMyAppointment } from "./actions";

export function CancelButton({ appointmentId }: { appointmentId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setError(null);
    start(async () => {
      const res = await cancelMyAppointment(appointmentId);
      if (!res.ok) setError(res.error);
      setConfirming(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className="label rounded-full border border-red-400/40 bg-red-400/10 px-3 py-2 text-red-200 transition-colors hover:border-red-400/70"
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Confirmar"
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="label rounded-full border border-white/12 px-3 py-2 text-steel-300"
          >
            Voltar
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 transition-colors hover:border-red-400/50 hover:text-red-200"
        >
          <X className="h-3 w-3" />
          Cancelar
        </button>
      )}
      {error && (
        <p className="flex max-w-[240px] items-start gap-1.5 text-right text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-none" />
          {error}
        </p>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
      <Scissors className="h-6 w-6 text-steel-400" />
      <p className="text-sm text-steel-400">{children}</p>
    </div>
  );
}
