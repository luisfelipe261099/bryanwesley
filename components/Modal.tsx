"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Modal em portal no <body>.
 *
 * Sem isso, o diálogo herda o contexto de empilhamento do card que o
 * contém (as animações de entrada criam um), e conteúdo posterior da
 * página fica por cima — cliques chegam no elemento errado.
 */
export function Modal({
  open,
  onClose,
  label,
  children,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Esc fecha e a página atrás não rola enquanto o diálogo está aberto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-ink/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`glass my-auto w-full ${maxWidth} rounded-3xl p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-white">{label}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-steel-400 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
