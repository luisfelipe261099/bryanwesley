"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Scissors,
  Gem,
  UserRound,
  BarChart3,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth/session";

type Item = { href: string; label: string; icon: LucideIcon; key: string };

// Cada papel vê só o que pode abrir — nada de aba que leva a "sem permissão".
function itemsFor(role: Role | null): Item[] {
  if (role === "ADMIN") {
    return [
      { href: "/agendar", label: "Agendar", icon: Scissors, key: "inicio" },
      { href: "/barbeiro", label: "Barbeiro", icon: UserRound, key: "barbeiro" },
      { href: "/admin", label: "Admin", icon: BarChart3, key: "admin" },
      // Admin cai na gestão, não na vitrine: é de lá que ele muda preço e
      // cuida dos membros (a vitrine fica a um clique, dentro da tela).
      { href: "/admin/clube", label: "Clube VIP", icon: Gem, key: "clube" },
    ];
  }
  if (role === "BARBER") {
    return [
      { href: "/barbeiro", label: "Agenda", icon: CalendarDays, key: "barbeiro" },
      { href: "/agendar", label: "Encaixe", icon: Scissors, key: "inicio" },
      { href: "/conta", label: "Conta", icon: UserRound, key: "conta" },
    ];
  }
  if (role === "CLIENT") {
    return [
      { href: "/agendar", label: "Agendar", icon: Scissors, key: "inicio" },
      { href: "/cliente", label: "Meus horários", icon: CalendarDays, key: "cliente" },
      { href: "/planos", label: "Clube VIP", icon: Gem, key: "planos" },
      { href: "/conta", label: "Conta", icon: UserRound, key: "conta" },
    ];
  }
  return [
    { href: "/agendar", label: "Agendar", icon: Scissors, key: "inicio" },
    { href: "/planos", label: "Clube VIP", icon: Gem, key: "clube" },
    { href: "/entrar", label: "Entrar", icon: UserRound, key: "entrar" },
  ];
}

export function BottomNav({
  active,
  role,
}: {
  active: string;
  role: Role | null;
}) {
  const items = itemsFor(role);
  const navRef = useRef<HTMLElement>(null);
  useBarraNoRodape(navRef);
  // O destaque segue o endereço aberto: o painel inteiro passa "admin",
  // mas dentro dele /admin/clube é a aba do Clube.
  const path = usePathname();
  const atual =
    [...items]
      // Do mais específico para o mais genérico: /admin/clube antes de
      // /admin, senão a aba do painel roubaria o destaque.
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => i.href !== "/" && path.startsWith(i.href))?.key ?? active;
  return (
    <nav
      ref={navRef}
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-800"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {items.map((item) => {
          const on = item.key === atual;
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1.5 rounded-xl py-2 transition-colors ${
                  on ? "text-electric" : "text-steel-400 hover:text-steel-200"
                }`}
              >
                <item.icon className="h-5 w-5" strokeWidth={on ? 2.2 : 1.7} />
                <span className="label text-[9px]">{item.label}</span>
                <span
                  className={`h-0.5 w-6 rounded-full transition-colors ${
                    on ? "bg-electric" : "bg-transparent"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const CAMPO = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * Mantém a barra colada no rodapé no iPhone. O Safari do iOS às vezes
 * deixa os elementos "fixed" no meio da tela depois que o teclado fecha
 * (a área de layout fica do tamanho de quando o teclado estava aberto) e
 * a barra passa a flutuar ao rolar. Aqui: com o teclado aberto a barra
 * some (não cobre o campo); ao fechar, empurramos a página 0 px para o
 * Safari refazer o layout e, se ainda sobrar diferença entre a área
 * visível e a de layout, compensamos com um translate.
 */
function useBarraNoRodape(ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const nav = ref.current;
    if (!vv || !nav) return;
    let raf = 0;
    let espera = 0;

    const ajustar = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.activeElement as HTMLElement | null;
        const tecladoAberto =
          !!el && (CAMPO.test(el.tagName) || el.isContentEditable) && vv.height < window.innerHeight - 120;
        nav.style.visibility = tecladoAberto ? "hidden" : "";
        // Diferença entre o fim da área visível e o fim da área de layout
        // (onde o bottom: 0 ancora). Normalmente é 0. Com zoom de pinça
        // não mexe: aí a barra acompanhar o layout é o esperado.
        const desvio = vv.offsetTop + vv.height - window.innerHeight;
        const corrigir =
          !tecladoAberto && vv.scale <= 1.01 && Math.abs(desvio) > 2 && Math.abs(desvio) < window.innerHeight * 0.6;
        nav.style.transform = corrigir ? `translateY(${Math.round(desvio)}px)` : "";
      });
    };

    const aoSairDoCampo = () => {
      window.clearTimeout(espera);
      espera = window.setTimeout(() => {
        // Empurrão de 0 px: faz o iOS recalcular a área de layout.
        window.scrollTo(window.scrollX, window.scrollY);
        ajustar();
      }, 120);
    };

    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    window.addEventListener("scroll", ajustar, { passive: true });
    window.addEventListener("orientationchange", ajustar);
    document.addEventListener("focusin", ajustar);
    document.addEventListener("focusout", aoSairDoCampo);
    ajustar();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(espera);
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
      window.removeEventListener("scroll", ajustar);
      window.removeEventListener("orientationchange", ajustar);
      document.removeEventListener("focusin", ajustar);
      document.removeEventListener("focusout", aoSairDoCampo);
    };
  }, [ref]);
}
