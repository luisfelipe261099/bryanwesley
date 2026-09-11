import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "./Logo";
import { shopFrom } from "@/lib/shop";
import { getSettings } from "@/lib/schedule";
import { logout } from "@/app/entrar/actions";

export async function AppHeader({
  badge,
  user,
}: {
  badge: string;
  user?: { name: string; initial: string };
}) {
  // A unidade vem do banco: trocar o nome no painel reflete em todo header.
  const unit = shopFrom(await getSettings().catch(() => undefined)).unit;
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-ink-800/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Logo subtitle={unit} />
          </Link>
          <span className="label hidden rounded-full border border-electric/30 bg-electric/10 px-2.5 py-1.5 text-electric sm:inline-block">
            {badge}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <Link
              href="/conta"
              title="Minha conta"
              className="flex items-center gap-2.5 rounded-full transition-opacity hover:opacity-85"
            >
              <span className="hidden text-sm font-medium text-white sm:inline">
                {user.name}
              </span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-royal-grad font-display text-base text-white ring-2 ring-electric/30">
                {user.initial}
              </span>
            </Link>
          )}
          <form action={logout}>
            <button
              type="submit"
              aria-label="Sair"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-2 text-sm font-medium text-steel-300 transition-colors hover:border-electric/40 hover:text-white sm:px-4"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
