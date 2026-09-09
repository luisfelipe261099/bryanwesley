"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarCog, Users, Tags, UserRound } from "lucide-react";

const links = [
  { href: "/admin", label: "Visão geral", icon: BarChart3 },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarCog },
  { href: "/admin/equipe", label: "Equipe", icon: UserRound },
  { href: "/admin/catalogo", label: "Catálogo", icon: Tags },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-2 overflow-x-auto pb-1">
      {links.map((l) => {
        const on = path === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? "page" : undefined}
            className={`label inline-flex flex-none items-center gap-2 rounded-full px-4 py-2.5 transition-all ${
              on
                ? "btn-royal text-white"
                : "border border-white/10 bg-surface/70 text-steel-300 hover:border-electric/40 hover:text-white"
            }`}
          >
            <l.icon className="h-3.5 w-3.5" />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
