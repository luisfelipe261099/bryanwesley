"use client";

import { useState } from "react";
import type { Plan } from "@/db/schema";
import { PlanCard } from "@/components/PlanCard";

export function PlanosGrid({ plans }: { plans: Plan[] }) {
  const [cycle, setCycle] = useState<"mensal" | "anual">("mensal");

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-surface p-1.5">
          <CycleButton
            active={cycle === "mensal"}
            onClick={() => setCycle("mensal")}
          >
            Mensal
          </CycleButton>
          <CycleButton
            active={cycle === "anual"}
            onClick={() => setCycle("anual")}
          >
            Anual
            <span
              className={`ml-2 rounded-full px-2 py-1 text-[9px] ${
                cycle === "anual"
                  ? "bg-white/20 text-white"
                  : "bg-neon/15 text-neon"
              }`}
            >
              2 meses off
            </span>
          </CycleButton>
        </div>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} cycle={cycle} />
        ))}
      </div>
    </>
  );
}

function CycleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`label inline-flex items-center rounded-full px-6 py-3 transition-all ${
        active ? "btn-royal text-white" : "text-steel-300 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
