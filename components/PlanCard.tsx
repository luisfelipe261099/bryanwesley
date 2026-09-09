import Link from "next/link";
import { Check, Sparkles, Shield, Crown, Gem } from "lucide-react";
import { type Plan, formatBRL } from "@/lib/data";

const planIcons: Record<string, typeof Shield> = {
  silver: Shield,
  gold: Crown,
  diamond: Gem,
};

export function PlanCard({
  plan,
  cycle = "mensal",
}: {
  plan: Plan;
  cycle?: "mensal" | "anual";
}) {
  const Icon = planIcons[plan.id] ?? Shield;
  const price = cycle === "anual" ? plan.annualPrice : plan.price;

  return (
    <div
      className={`relative flex flex-col rounded-3xl p-7 transition-transform duration-300 hover:-translate-y-1 ${
        plan.highlight
          ? "border border-electric/45 bg-surface shadow-glow"
          : "glass glass-hover"
      }`}
    >
      {plan.highlight && (
        // Halo elétrico só no plano-âncora
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-40 rounded-t-3xl bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(30,184,255,0.16),transparent_70%)]"
        />
      )}

      {plan.badge && (
        <span
          className={`label absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-2 ${
            plan.highlight
              ? "bg-royal-grad text-white shadow-glow-sm"
              : "border border-white/12 bg-surface-2 text-steel-300"
          }`}
        >
          <Sparkles className="h-3 w-3" />
          {plan.badge}
        </span>
      )}

      <div className="relative flex items-center justify-between">
        <span className="label text-electric">{plan.kicker}</span>
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${
            plan.highlight
              ? "bg-royal-grad text-white"
              : "border border-white/10 bg-white/5 text-steel-300"
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
      </div>

      <h3 className="relative mt-3 font-display text-3xl text-white">
        {plan.name}
      </h3>
      <p className="relative mt-1.5 text-sm text-steel-400">{plan.tagline}</p>

      <div className="relative mt-6 flex items-end gap-1.5">
        <span className="mb-2 text-sm font-medium text-steel-400">R$</span>
        <span
          className={`font-display text-5xl leading-none tabular-nums ${
            plan.highlight ? "text-electric" : "text-white"
          }`}
        >
          {price}
        </span>
        <span className="mb-1.5 text-sm text-steel-400">/mês</span>
      </div>
      {cycle === "anual" && (
        <p className="relative mt-1.5 text-xs text-neon">
          No plano anual · equivale a {formatBRL(price * 12)} por ano
        </p>
      )}

      <ul className="relative mt-6 flex flex-1 flex-col gap-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full ${
                plan.highlight ? "bg-electric/20" : "bg-white/8"
              }`}
            >
              <Check
                className={plan.highlight ? "h-3 w-3 text-electric" : "h-3 w-3 text-steel-300"}
                strokeWidth={3}
              />
            </span>
            <span className="text-steel-300">{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/agendar?plano=${plan.id}`}
        className={`label relative mt-7 inline-flex items-center justify-center rounded-full py-4 transition-transform active:scale-[0.98] ${
          plan.highlight
            ? "btn-royal text-white"
            : "border border-white/12 text-steel-200 hover:border-electric/45 hover:text-white"
        }`}
      >
        Assinar {plan.name.replace("Plano ", "")}
      </Link>
    </div>
  );
}
