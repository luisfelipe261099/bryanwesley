import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "./Logo";

export function AppHeader({
  badge,
  user,
}: {
  badge: string;
  user?: { name: string; initial: string };
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Logo />
          </Link>
          <span className="hidden rounded-full border border-electric/30 bg-royal/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-electric sm:inline">
            {badge}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden items-center gap-2.5 sm:flex">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-royal-grad font-display text-base text-white">
                {user.initial}
              </div>
              <span className="text-sm font-medium text-white">
                {user.name}
              </span>
            </div>
          )}
          <Link
            href="/entrar"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-steel-300 transition-colors hover:border-white/30 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Trocar perfil</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
