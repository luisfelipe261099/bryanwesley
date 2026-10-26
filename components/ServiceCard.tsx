import { Clock } from "lucide-react";
import type { Service } from "@/db/schema";
import { formatBRL, formatDuration } from "@/lib/money";
import { rotuloDias, rotuloFaixa, type RegraPreco } from "@/lib/precos";
import { serviceIcons } from "./serviceIcons";

export function ServiceCard({ service, regras = [] }: { service: Service; regras?: RegraPreco[] }) {
  const Icon = serviceIcons[service.slug] ?? serviceIcons.corte;
  return (
    <div className="glass glass-hover group relative flex flex-col rounded-2xl p-5">
      {service.tag && (
        <span className="label absolute right-4 top-4 rounded-full border border-electric/25 bg-electric/10 px-2.5 py-1.5 text-electric">
          {service.tag}
        </span>
      )}
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-electric/25 bg-electric/10 text-electric transition-colors duration-300 group-hover:border-electric/50">
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <h3 className="font-display text-lg text-white">{service.name}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-steel-400">
        {service.description}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-4">
        <span className="font-display text-xl tabular-nums text-white">
          {formatBRL(service.priceCents)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-steel-400">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(service.durationMin)}
        </span>
      </div>
      {regras.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-steel-400">
          {regras.map((r) => (
            <li key={r.id}>
              <span className="text-amber-200/90">{r.label || "Turno"}:</span>{" "}
              <span className="tabular-nums text-steel-200">{formatBRL(r.priceCents)}</span>{" "}
              · {rotuloDias(r.weekdays)}, {rotuloFaixa(r)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
