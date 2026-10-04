import { Bell, Smartphone } from "lucide-react";
import { Card } from "@/components/admin/Feedback";
import { AvisosPush } from "@/components/AvisosPush";
import { labelAgo } from "@/lib/time";

const PAPEL = { ADMIN: "Admin", BARBER: "Barbeiro", CLIENT: "Cliente" } as const;

export type PessoaDaEquipe = {
  userId: number;
  nome: string;
  role: "ADMIN" | "BARBER" | "CLIENT";
  aparelhos: number;
  ultimo: Date | null;
};

/**
 * Avisos no celular da equipe: o botão do próprio admin e, embaixo, quem
 * da equipe já ligou — cada um liga no próprio aparelho, não dá para
 * ligar pelo outro.
 */
export function AvisosEquipe({
  chavePublica,
  usuarioId,
  equipe,
}: {
  chavePublica: string;
  usuarioId: number;
  equipe: PessoaDaEquipe[];
}) {
  const semAviso = equipe.filter((p) => p.aparelhos === 0);
  return (
    <Card
      title="Avisos no celular"
      desc="Agendamento novo, cancelamento e pedido de plano chegam como notificação — sem precisar do WhatsApp e com o site fechado."
      icon={<Bell className="h-5 w-5" />}
    >
      <AvisosPush chavePublica={chavePublica} usuarioId={usuarioId} papel="ADMIN" />

      <div className="mt-6 border-t border-white/8 pt-5">
        <p className="label text-steel-400">Equipe</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {equipe.map((p) => (
            <li
              key={p.userId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/[0.02] px-4 py-3 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate text-white">{p.nome}</span>
                <span className="text-xs text-steel-400">{PAPEL[p.role]}</span>
              </span>
              <span
                className={`label inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1.5 ${
                  p.aparelhos > 0 ? "bg-neon/10 text-neon" : "bg-white/5 text-steel-400"
                }`}
                title={p.ultimo ? `Ativo ${labelAgo(p.ultimo)}` : undefined}
              >
                <Smartphone className="h-3.5 w-3.5" />
                {p.aparelhos > 0 ? `${p.aparelhos} aparelho${p.aparelhos === 1 ? "" : "s"}` : "sem avisos"}
              </span>
            </li>
          ))}
        </ul>
        {semAviso.length > 0 && (
          <p className="mt-3 text-xs text-steel-400">
            Quem está &ldquo;sem avisos&rdquo; liga no próprio celular: ao abrir a agenda aparece o convite no
            topo, e em <strong className="text-steel-200">Conta → Avisos no celular</strong> dá para ligar,
            testar e desligar.
          </p>
        )}
      </div>
    </Card>
  );
}
