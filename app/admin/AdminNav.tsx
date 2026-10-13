"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Gem,
  CalendarDays,
  SlidersHorizontal,
  Users,
  Tags,
  UserRound,
  MessageCircle,
  FileBarChart,
} from "lucide-react";

const links = [
  { href: "/admin", label: "Visão geral", icon: BarChart3 },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/admin/equipe", label: "Equipe", icon: UserRound },
  { href: "/admin/catalogo", label: "Catálogo", icon: Tags },
  { href: "/admin/clientes", label: "Clientes", icon: Users },
  { href: "/admin/clube", label: "Clube VIP", icon: Gem },
  { href: "/admin/relatorios", label: "Relatórios", icon: FileBarChart },
  { href: "/admin/notificacoes", label: "Mensagens", icon: MessageCircle },
  { href: "/admin/ajustes", label: "Ajustes", icon: SlidersHorizontal },
];

export function AdminNav() {
  const path = usePathname();
  const trilho = useRef<HTMLElement>(null);

  // No celular só cabem três chips: em Relatórios ou Ajustes, o chip da
  // tela aberta ficava fora da vista. Centraliza o ativo — só na
  // horizontal, sem mexer na rolagem da página.
  useEffect(() => {
    const nav = trilho.current;
    const ativo = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !ativo) return;
    const dx = ativo.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft = Math.max(0, nav.scrollLeft + dx - (nav.clientWidth - ativo.offsetWidth) / 2);
  }, [path]);

  return (
    // Vaza até a borda da tela no celular: o chip cortado na lateral é o
    // que mostra que a lista continua para o lado.
    <nav ref={trilho} className="rail mb-6 -mx-5 px-5 lg:mx-0 lg:px-0">
      {links.map((l) => {
        // A ficha de um cliente (/admin/clientes/12) fica sob "Clientes".
        const on = path === l.href || (l.href !== "/admin" && path.startsWith(l.href + "/"));
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
