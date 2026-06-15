import Link from "next/link";
import { MapPin, Phone, Clock, Instagram } from "lucide-react";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer
      id="contato"
      className="relative border-t border-white/5 bg-ink-800/60"
    >
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-steel-400">
              Estilo, precisão e atenção em cada corte. Agende online, assine um
              plano e nunca mais perca o ponto da sua barba e cabelo.
            </p>
            <Link
              href="https://instagram.com"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-steel-300 transition-colors hover:border-electric/40 hover:text-white"
            >
              <Instagram className="h-4 w-4" />
              @bryanwesley.barbearia
            </Link>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">
              Contato
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-steel-400">
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 flex-none text-electric" />
                Rua das Tesouras, 120 — Centro
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 flex-none text-electric" />
                (11) 9 9999-0000
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-white">
              Horários
            </h4>
            <ul className="mt-4 space-y-3 text-sm text-steel-400">
              <li className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 flex-none text-electric" />
                Ter — Sáb · 09h às 20h
              </li>
              <li className="pl-[26px] text-steel-400/70">Seg e Dom · Fechado</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-steel-400 sm:flex-row">
          <span>
            © {new Date().getFullYear()} Bryan Wesley Barbearia. Todos os
            direitos reservados.
          </span>
          <span className="text-steel-400/70">
            Protótipo de demonstração · feito com cuidado
          </span>
        </div>
      </div>
    </footer>
  );
}
