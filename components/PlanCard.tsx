import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { type Plan, formatBRL } from "@/lib/data";

export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`relative flex flex-col rounded-3xl p-7 transition-transform duration-300 hover:-translate-y-1 ${
        plan.highlight
          ? "bg-royal-grad text-white shadow-glow"
          : "glass glass-hover text-white"
      }`}
    >
      {plan.badge && (
        <span
          className={`absolute -top-3 left-7 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
            plan.highlight
              ? "bg-white text-royal-600"
              : "bg-royal/20 text-electric"
          }`}
        >
          <Sparkles className="h-3 w-3" />
          {plan.badge}
        </span>
      )}

      <h3 className="font-display text-3xl tracking-wide">{plan.name}</h3>
      <p
        className={`mt-1 text-sm ${
          plan.highlight ? "text-white/80" : "text-steel-400"
        }`}
      >
        {plan.tagline}
      </p>

      <div className="mt-5 flex items-end gap-1">
        <span className="text-4xl font-bold tabular-nums">
          {formatBRL(plan.price)}
        </span>
        <span
          className={`mb-1 text-sm ${
            plan.highlight ? "text-white/75" : "text-steel-400"
          }`}
        >
          /mês
        </span>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full ${
                plan.highlight ? "bg-white/20" : "bg-royal/20"
              }`}
            >
              <Check
                className={`h-3 w-3 ${
                  plan.highlight ? "text-white" : "text-electric"
                }`}
                strokeWidth={3}
              />
            </span>
            <span className={plan.highlight ? "text-white/95" : "text-steel-300"}>
              {f}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/entrar"
        className={`mt-7 inline-flex items-center justify-center rounded-full py-3 text-sm font-semibold transition-transform active:scale-[0.98] ${
          plan.highlight
            ? "bg-white text-royal-600 hover:bg-white/90"
            : "btn-royal text-white"
        }`}
      >
        Assinar {plan.name}
      </Link>
    </div>
  );
}
