"use client";

import Link from "next/link";
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
      { href: "/planos", label: "Clube VIP", icon: Gem, key: "clube" },
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
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-800/95 backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {items.map((item) => {
          const on = item.key === active;
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
