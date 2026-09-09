"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X, Play } from "lucide-react";
import { adminTransition } from "./actions";

export function ApptControls({ id, status }: { id: number; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(next: Parameters<typeof adminTransition>[1]) {
    setError(null);
    start(async () => {
      const res = await adminTransition(id, next);
      if (!res.ok) setError(res.error);
    });
  }

  const spinner = pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null;
  const terminal = ["CONCLUIDO", "CANCELADO", "NO_SHOW"].includes(status);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {!terminal && (
        <div className="flex items-center gap-1.5">
          {status === "EM_ANDAMENTO" ? (
            <IconBtn
              onClick={() => go("CONCLUIDO")}
              disabled={pending}
              title="Concluir"
              tone="ok"
            >
              {spinner ?? <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </IconBtn>
          ) : (
            <IconBtn
              onClick={() => go("EM_ANDAMENTO")}
              disabled={pending}
              title="Iniciar"
              tone="ok"
            >
              {spinner ?? <Play className="h-3.5 w-3.5" />}
            </IconBtn>
          )}
          <IconBtn
            onClick={() => go("CANCELADO")}
            disabled={pending}
            title="Cancelar"
            tone="danger"
          >
            <X className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      )}
      {error && (
        <p className="max-w-[200px] text-right text-xs text-amber-200">{error}</p>
      )}
    </div>
  );
}

function IconBtn({
  children,
  tone,
  ...props
}: {
  children: React.ReactNode;
  tone: "ok" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      aria-label={props.title}
      className={`grid h-8 w-8 place-items-center rounded-full border transition-colors disabled:opacity-40 ${
        tone === "ok"
          ? "border-electric/40 text-electric hover:bg-electric/10"
          : "border-white/12 text-steel-400 hover:border-red-400/50 hover:text-red-200"
      }`}
    >
      {children}
    </button>
  );
}
