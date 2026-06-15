"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, CalendarPlus } from "lucide-react";
import { Logo } from "./Logo";

const links = [
  { href: "/#servicos", label: "Serviços" },
  { href: "/planos", label: "Planos" },
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#contato", label: "Contato" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/5 bg-ink/80 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" aria-label="Bryan Wesley Barbearia — início">
          <Logo />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-steel-300 transition-colors hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/entrar"
            className="text-sm font-semibold text-steel-300 transition-colors hover:text-white"
          >
            Entrar
          </Link>
          <Link
            href="/agendar"
            className="btn-royal inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
          >
            <CalendarPlus className="h-4 w-4" />
            Agendar
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white md:hidden"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/5 bg-ink/95 px-5 pb-6 pt-2 backdrop-blur-xl md:hidden">
          <div className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-white/5 py-3.5 text-base font-medium text-steel-300"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/entrar"
              onClick={() => setOpen(false)}
              className="rounded-full border border-white/10 py-3 text-center text-sm font-semibold text-white"
            >
              Entrar
            </Link>
            <Link
              href="/agendar"
              onClick={() => setOpen(false)}
              className="btn-royal inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white"
            >
              <CalendarPlus className="h-4 w-4" />
              Agendar horário
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
