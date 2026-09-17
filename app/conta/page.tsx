import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, KeyRound, UserRound } from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { ChangePassword } from "@/app/cliente/MeusHorarios";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { ADMIN: "Administrador", BARBER: "Barbeiro", CLIENT: "Cliente" };
const HOME = { ADMIN: "/admin", BARBER: "/barbeiro", CLIENT: "/cliente" };

export default async function Conta() {
  const session = await requireRole(["ADMIN", "BARBER", "CLIENT"]);
  const user = (await db.query.users.findFirst({ where: eq(users.id, session.id) }))!;

  return (
    <>
      <Background />
      <AppHeader
        badge={ROLE_LABEL[session.role]}
        user={{ name: session.name, initial: session.name.charAt(0) }}
      />
      <main className="mx-auto max-w-2xl px-5 pb-28 pt-24 lg:px-8">
        <Link
          href={HOME[session.role]}
          className="-ml-2 inline-flex items-center gap-2 rounded-full px-2 py-2.5 text-sm text-steel-400 hover:text-electric"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao painel
        </Link>

        <div className="glass mt-6 rounded-3xl p-7">
          <div className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-electric" />
            <h1 className="font-display text-xl text-white">Minha conta</h1>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="label text-steel-400">Nome</dt>
              <dd className="mt-1 text-white">{user.name}</dd>
            </div>
            <div>
              <dt className="label text-steel-400">WhatsApp</dt>
              <dd className="mt-1 text-white">{formatPhone(user.phone)}</dd>
            </div>
            <div>
              <dt className="label text-steel-400">E-mail</dt>
              <dd className="mt-1 text-white">{user.email ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="glass mt-5 rounded-3xl p-7">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-electric" />
            <h2 className="font-display text-lg text-white">Trocar senha</h2>
          </div>
          <div className="mt-5 max-w-sm">
            <ChangePassword />
          </div>
        </div>
      </main>
      <BottomNav active="conta" role={session.role} />
    </>
  );
}
