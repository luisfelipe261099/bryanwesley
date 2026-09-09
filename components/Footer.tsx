import Link from "next/link";
import { MapPin, Phone, Clock, Instagram } from "lucide-react";
import { Logo } from "./Logo";
import { barbershop } from "@/lib/data";

export function Footer() {
  return (
    <footer
      id="contato"
      className="relative border-t border-white/8 bg-ink-800/70"
    >
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-steel-400">
              Precisão, estilo e cuidado em cada corte. Agende online, entre no
              Clube VIP e nunca mais perca o ponto da sua barba e cabelo.
            </p>
            <Link
              href="https://instagram.com"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-medium text-steel-300 transition-colors hover:border-electric/45 hover:text-white"
            >
              <Instagram className="h-4 w-4 text-electric" />
              {barbershop.instagram}
            </Link>
          </div>

          <div>
            <h4 className="label text-steel-200">Contato</h4>
            <ul className="mt-4 space-y-3 text-sm text-steel-400">
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 flex-none text-electric" />
                {barbershop.address}
              </li>
              <li className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 flex-none text-electric" />
                {barbershop.phone}
              </li>
            </ul>
          </div>

          <div>
            <h4 className="label text-steel-200">Horários</h4>
            <ul className="mt-4 space-y-3 text-sm text-steel-400">
              <li className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 flex-none text-electric" />
                Ter — Sáb · 09h às 20h
              </li>
              <li className="pl-[26px] text-steel-400/70">Seg e Dom · Fechado</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-6 text-xs text-steel-400 sm:flex-row">
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
