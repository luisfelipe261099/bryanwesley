"use client";

import { useEffect, useRef, useState } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  // Esc fecha, a página atrás não rola, e o foco entra no diálogo, circula
  // dentro dele (Tab) e volta para onde estava ao fechar — senão teclado e
  // leitor de tela continuam navegando a página de trás.
  useEffect(() => {
    if (!open) return;
    const antes = document.activeElement as HTMLElement | null;
    const focaveis = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    (focaveis()[0] ?? panelRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const lista = focaveis();
      if (lista.length === 0) return;
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      antes?.focus?.();
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
        ref={panelRef}
        tabIndex={-1}
        className={`glass my-auto w-full ${maxWidth} rounded-3xl p-6 outline-none`}
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
