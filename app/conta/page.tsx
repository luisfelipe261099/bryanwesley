import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, Bell, KeyRound, Sparkles, UserRound } from "lucide-react";
import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { ChangePassword } from "@/app/cliente/MeusHorarios";
import { AvisosPush } from "@/components/AvisosPush";
import { MeusAparelhos } from "@/components/MeusAparelhos";
import { chavePublicaPush, meusAparelhos } from "@/lib/push";
import { labelAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { ADMIN: "Administrador", BARBER: "Barbeiro", CLIENT: "Cliente" };
const HOME = { ADMIN: "/admin", BARBER: "/barbeiro", CLIENT: "/cliente" };

export default async function Conta() {
  const session = await requireRole(["ADMIN", "BARBER", "CLIENT"]);
  // O dono que também corta tem os dois tutoriais: o do painel e o da
  // agenda de barbeiro.
  const tutoriais =
    session.role === "ADMIN"
      ? [
          { href: "/admin?tutorial=1", label: "Tutorial do painel" },
          { href: "/admin?novidade=preco-turno", label: "Tutorial do preço por turno" },
          ...(session.barberId ? [{ href: "/barbeiro?tutorial=1", label: "Tutorial da agenda de barbeiro" }] : []),
        ]
      : [{ href: `${HOME[session.role]}?tutorial=1`, label: "Ver o tutorial de novo" }];
  const [user, chavePush, aparelhos] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.id) }).then((u) => u!),
    chavePublicaPush(),
    meusAparelhos(session.id),
  ]);

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
            <Bell className="h-5 w-5 text-electric" />
            <h2 className="font-display text-lg text-white">Avisos no celular</h2>
          </div>
          <div className="mt-5">
            <AvisosPush chavePublica={chavePush} usuarioId={session.id} papel={session.role} />
            <MeusAparelhos
              aparelhos={aparelhos.map((a) => ({
                id: a.id,
                nome: a.aparelho ?? "Aparelho",
                endpointHash: a.endpointHash,
                quando: `ativo ${labelAgo(a.usadoEm ?? a.createdAt)}`,
              }))}
            />
          </div>
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

        <div className="glass mt-5 rounded-3xl p-7">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-electric" />
            <h2 className="font-display text-lg text-white">Tutorial</h2>
          </div>
          <p className="mt-2 text-sm text-steel-400">
            O passo a passo do primeiro acesso, com o essencial de cada tela.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {tutoriais.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="label inline-flex items-center gap-2 rounded-full border border-electric/30 px-4 py-3 text-electric transition-colors hover:bg-electric/10"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </main>
      <BottomNav active="conta" role={session.role} />
    </>
  );
}
