import Link from "next/link";
import { Download, FileBarChart, Percent, Users } from "lucide-react";
import { Card } from "@/components/admin/Feedback";
import { listTeam } from "@/lib/queries";
import { commissionReport, summarize, byBarber } from "@/lib/reports";
import { formatBRL } from "@/lib/money";
import { utcToShopParts } from "@/lib/time";

export const dynamic = "force-dynamic";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export default async function AdminRelatorios({
  searchParams,
}: {
  searchParams: { ano?: string; mes?: string; barbeiro?: string };
}) {
  const hoje = utcToShopParts(new Date());
  const year = Number(searchParams.ano ?? hoje.year);
  const month = Number(searchParams.mes ?? hoje.month);
  const barberId = searchParams.barbeiro ? Number(searchParams.barbeiro) : null;

  const [team, lines] = await Promise.all([
    listTeam(),
    commissionReport(year, month, barberId),
  ]);
  const total = summarize(lines);
  const porBarbeiro = byBarber(lines);

  // Últimos 6 meses para o seletor.
  const meses: { ano: number; mes: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoje.year, hoje.month - 1 - i, 1);
    meses.push({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
  }

  const qs = (o: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== null) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <Card
        title="Fechamento do mês"
        desc="Sai da razão de comissões: cada atendimento concluído gera um lançamento."
        icon={<FileBarChart className="h-5 w-5" />}
      >
        <div className="flex flex-wrap gap-2">
          {meses.map((m) => {
            const on = m.ano === year && m.mes === month;
            return (
              <Link
                key={`${m.ano}-${m.mes}`}
                href={qs({ ano: m.ano, mes: m.mes, barbeiro: barberId })}
                className={`label rounded-full px-4 py-2.5 transition-all ${
                  on
                    ? "btn-royal text-white"
                    : "border border-white/10 bg-surface/70 text-steel-300 hover:border-electric/40"
                }`}
              >
                {MESES[m.mes - 1]}/{String(m.ano).slice(-2)}
              </Link>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={qs({ ano: year, mes: month, barbeiro: null })}
            className={`label rounded-full px-4 py-2.5 transition-all ${
              !barberId
                ? "border border-electric/50 bg-electric/10 text-electric"
                : "border border-white/10 text-steel-300"
            }`}
          >
            Equipe toda
          </Link>
          {team.map((b) => (
            <Link
              key={b.id}
              href={qs({ ano: year, mes: month, barbeiro: b.id })}
              className={`label rounded-full px-4 py-2.5 transition-all ${
                barberId === b.id
                  ? "border border-electric/50 bg-electric/10 text-electric"
                  : "border border-white/10 text-steel-300"
              }`}
            >
              {b.shortName}
            </Link>
          ))}
        </div>

        <div className="mt-5 grid gap-4 border-t border-white/8 pt-5 sm:grid-cols-4">
          <Total label="Atendimentos" value={String(total.atendimentos)} />
          <Total label="Serviços realizados" value={formatBRL(total.baseCents)} />
          <Total label="Comissões" value={formatBRL(total.barberCents)} accent />
          <Total label="Fica com a casa" value={formatBRL(total.shopCents)} />
        </div>

        <a
          href={`/api/relatorios/comissoes${qs({ ano: year, mes: month, barbeiro: barberId })}`}
          className="btn-royal label mt-5 inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-white"
        >
          <Download className="h-4 w-4" />
          Baixar CSV do fechamento
        </a>
      </Card>

      <Card title="Por barbeiro" icon={<Percent className="h-5 w-5" />}>
        {porBarbeiro.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Nenhum atendimento concluído nesse período.
          </p>
        ) : (
          <ul className="space-y-2">
            {porBarbeiro.map((b) => (
              <li
                key={b.barberId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/[0.02] p-3.5"
              >
                <div>
                  <p className="font-medium text-white">{b.nome}</p>
                  <p className="text-xs text-steel-400">
                    {b.atendimentos} atendimento(s) · gerou {formatBRL(b.baseCents)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg text-electric">
                    {formatBRL(b.barberCents)}
                  </p>
                  <p className="text-xs text-steel-400">
                    casa {formatBRL(b.shopCents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Lançamentos" desc={`${lines.length} no período`}>
        {lines.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-steel-400">
            Sem lançamentos.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="label border-b border-white/8 text-steel-400">
                  <th className="pb-3 font-semibold">Data</th>
                  <th className="pb-3 font-semibold">Cliente</th>
                  <th className="pb-3 font-semibold">Barbeiro</th>
                  <th className="pb-3 font-semibold">Origem</th>
                  <th className="pb-3 text-right font-semibold">Base</th>
                  <th className="pb-3 text-right font-semibold">%</th>
                  <th className="pb-3 text-right font-semibold">Barbeiro</th>
                  <th className="pb-3 text-right font-semibold">Casa</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-white/5">
                    <td className="py-3 text-steel-300">
                      {l.data} {l.hora}
                    </td>
                    <td className="py-3 text-white">{l.cliente}</td>
                    <td className="py-3 text-steel-300">{l.barbeiro}</td>
                    <td className="py-3">
                      <span
                        className={`label rounded-full px-2.5 py-1.5 ${
                          l.origem === "Plano"
                            ? "bg-electric/10 text-electric"
                            : "bg-white/5 text-steel-300"
                        }`}
                      >
                        {l.origem}
                      </span>
                    </td>
                    <td className="py-3 text-right tabular-nums text-steel-200">
                      {formatBRL(l.baseCents)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-steel-400">
                      {l.barberPct}%
                    </td>
                    <td className="py-3 text-right tabular-nums text-electric">
                      {formatBRL(l.barberCents)}
                    </td>
                    <td className="py-3 text-right tabular-nums text-steel-200">
                      {formatBRL(l.shopCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Base de clientes" desc="Backup ou campanha de WhatsApp." icon={<Users className="h-5 w-5" />}>
        <a
          href="/api/relatorios/clientes"
          className="btn-outline label inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-electric"
        >
          <Download className="h-4 w-4" />
          Baixar clientes em CSV
        </a>
      </Card>
    </div>
  );
}

function Total({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={`font-display text-xl ${accent ? "text-electric" : "text-white"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-steel-400">{label}</div>
    </div>
  );
}
