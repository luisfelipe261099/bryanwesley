import { Clock } from "lucide-react";
import { type Service, formatBRL, formatDuration } from "@/lib/data";
import { serviceIcons } from "./serviceIcons";

export function ServiceCard({ service }: { service: Service }) {
  const Icon = serviceIcons[service.id] ?? serviceIcons.corte;
  return (
    <div className="glass glass-hover group relative flex flex-col rounded-2xl p-5">
      {service.tag && (
        <span className="absolute right-4 top-4 rounded-full bg-royal/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-electric">
          {service.tag}
        </span>
      )}
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-royal-grad text-white shadow-glow-sm transition-transform duration-300 group-hover:scale-105">
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <h3 className="text-lg font-semibold text-white">{service.name}</h3>
      <p className="mt-1 text-sm leading-relaxed text-steel-400">
        {service.description}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
        <span className="text-xl font-bold tabular-nums text-white">
          {formatBRL(service.price)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-steel-400">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(service.durationMin)}
        </span>
      </div>
    </div>
  );
}
