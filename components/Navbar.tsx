"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, CalendarPlus } from "lucide-react";
import { Logo } from "./Logo";

const links = [
  { href: "/#servicos", label: "Serviços" },
  { href: "/planos", label: "Clube VIP" },
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#contato", label: "Contato" },
];

export function Navbar({
  logged = false,
  unit,
}: {
  logged?: boolean;
  unit?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Com o menu aberto a página atrás não rola — e, principalmente, não
  // aparece por baixo: antes o painel só cobria a própria altura e os
  // botões da capa ficavam logo abaixo dos do menu, parecendo repetidos.
  useEffect(() => {
    if (!open) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open
          ? "border-b border-white/8 bg-ink-800/95 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" aria-label="Bryan Wesley Barbearia — início">
          <Logo subtitle={unit} />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-steel-300 transition-colors hover:text-electric"
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
            {logged ? "Minha conta" : "Entrar"}
          </Link>
          <Link
            href="/agendar"
            className="btn-royal label inline-flex items-center gap-2 rounded-full px-5 py-3 text-white"
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
          aria-controls="menu-celular"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

    </header>
    {open && (
      <div
        id="menu-celular"
        className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto overscroll-contain border-t border-white/8 bg-ink-800 px-5 pb-10 pt-2 md:hidden"
      >
        <div className="flex flex-col">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="border-b border-white/6 py-3.5 text-base font-medium text-steel-300"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Link
            href="/entrar"
            onClick={() => setOpen(false)}
            className="rounded-full border border-white/12 py-3.5 text-center text-sm font-semibold text-white"
          >
            {logged ? "Minha conta" : "Entrar"}
          </Link>
          <Link
            href="/agendar"
            onClick={() => setOpen(false)}
            className="btn-royal label inline-flex items-center justify-center gap-2 rounded-full py-4 text-white"
          >
            <CalendarPlus className="h-4 w-4" />
            Agendar horário
          </Link>
        </div>
      </div>
    )}
    </>
  );
}
