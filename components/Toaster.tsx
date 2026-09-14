"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  subscribe,
  getToasts,
  getServerToasts,
  dismiss,
} from "@/lib/toast";

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getServerToasts);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A região aria-live precisa existir ANTES do primeiro aviso, senão o
  // leitor de tela não anuncia o que aparecer nela depois.
  if (!mounted) return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border px-4 py-3.5 text-sm shadow-card backdrop-blur-xl ${
            t.tone === "ok"
              ? "border-neon/30 bg-neon/10 text-neon"
              : "border-amber-400/30 bg-amber-400/10 text-amber-200"
          }`}
        >
          {t.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          )}
          <span className="flex-1">{t.text}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Fechar aviso"
            className="flex-none opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
