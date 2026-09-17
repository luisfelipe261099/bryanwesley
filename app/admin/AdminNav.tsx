"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarCog,
  Users,
  Tags,
  UserRound,
  MessageCircle,
  FileBarChart,
} from "lucide-react";

const links = [
  { href: "/admin", label: "Visão geral", icon: BarChart3 },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarCog },
  { href: "/admin/equipe", label: "Equipe", icon: UserRound },
  { href: "/admin/catalogo", label: "Catálogo", icon: Tags },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/relatorios", label: "Relatórios", icon: FileBarChart },
  { href: "/admin/notificacoes", label: "Mensagens", icon: MessageCircle },
];

export function AdminNav() {
  const path = usePathname();
  return (
    // Vaza até a borda da tela no celular: o chip cortado na lateral é o
    // que mostra que a lista continua para o lado.
    <nav className="rail mb-6 -mx-5 px-5 lg:mx-0 lg:px-0">
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
