import type { ReactNode } from "react";

// Entrada suave via CSS puro (keyframe `fade-up` no tailwind.config).
// Vantagem: NÃO depende de JS nem de IntersectionObserver — o conteúdo
// sempre termina visível, e respeita prefers-reduced-motion (globals.css).
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-fade-up ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}
