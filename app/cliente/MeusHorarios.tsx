"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Loader2, Scissors, X } from "lucide-react";
import { cancelMyAppointment, changeMyPassword } from "./actions";

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


export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await changeMyPassword({ current, next });
      setMsg(
        res.ok
          ? { ok: true, text: "Senha alterada." }
          : { ok: false, text: res.error }
      );
      if (res.ok) {
        setCurrent("");
        setNext("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Senha atual"
        autoComplete="current-password"
        aria-label="Senha atual"
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="Nova senha (mínimo 6)"
        autoComplete="new-password"
        aria-label="Nova senha"
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
      />
      <button
        type="submit"
        disabled={pending || !current || next.length < 6}
        className="btn-outline label inline-flex items-center gap-2 rounded-full px-5 py-3 text-electric disabled:opacity-40"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Alterar senha
      </button>
      {msg && (
        <p
          role="status"
          className={`text-sm ${msg.ok ? "text-neon" : "text-amber-200"}`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
