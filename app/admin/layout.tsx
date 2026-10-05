import { Background } from "@/components/Background";
import { AppHeader } from "@/components/AppHeader";
import { BottomNav } from "@/components/BottomNav";
import { Heartbeat } from "@/components/Heartbeat";
import { requireRole } from "@/lib/auth";
import { AdminNav } from "./AdminNav";
import { ProvedorAvisoWhatsapp } from "./AgendaHoje";
import { whatsappEnviando } from "@/lib/whatsapp-status";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole(["ADMIN"]);
  const avisa = await whatsappEnviando().catch(() => false);
  return (
    <>
      <Background />
      <AppHeader
        badge="Gestão executiva"
        user={{ name: session.name, initial: session.name.charAt(0) }}
      />
      <main className="mx-auto max-w-7xl overflow-x-clip px-5 pb-28 pt-24 lg:px-8">
        <AdminNav />
        <ProvedorAvisoWhatsapp ligado={avisa}>{children}</ProvedorAvisoWhatsapp>
      </main>
      <BottomNav active="admin" role={session.role} />
      <Heartbeat />
    </>
  );
}
