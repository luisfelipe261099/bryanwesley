"use client";

// Ações do membro sobre o próprio plano. O site promete "cancele quando
// quiser" desde a vitrine, e o cliente vencido não tinha nem como ver que
// estava devendo — só descobria quando o benefício sumia.

import { useTransition } from "react";
import { Loader2, CreditCard, X, Undo2 } from "lucide-react";
import { cancelMyPlan, resumeMyPlan, payMyPlan } from "./actions";
import { toast } from "@/lib/toast";

function Acao({
  children,
  onRun,
  className,
}: {
  children: React.ReactNode;
  onRun: () => Promise<void>;
  className: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(onRun)}
      className={`label inline-flex items-center gap-2 rounded-full px-5 py-3 disabled:opacity-50 ${className}`}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}

export function PagarPlano({ rotulo = "Pagar agora" }: { rotulo?: string }) {
  return (
    <Acao
      className="btn-royal text-white"
      onRun={async () => {
        const r = await payMyPlan();
        if (r.ok && r.mode === "pagamento") window.location.href = r.url;
        else if (!r.ok) toast(r.error, "erro");
      }}
    >
      <CreditCard className="h-3.5 w-3.5" />
      {rotulo}
    </Acao>
  );
}

export function CancelarPlano() {
  return (
    <Acao
      className="border border-white/12 text-steel-300 hover:border-red-400/50 hover:text-red-200"
      onRun={async () => {
        const r = await cancelMyPlan();
        toast(r.ok ? (r.warning ?? "Plano cancelado.") : r.error, r.ok ? "ok" : "erro");
      }}
    >
      <X className="h-3.5 w-3.5" />
      Cancelar plano
    </Acao>
  );
}

export function ManterPlano() {
  return (
    <Acao
      className="btn-outline text-electric"
      onRun={async () => {
        const r = await resumeMyPlan();
        toast(r.ok ? (r.warning ?? "Assinatura mantida.") : r.error, r.ok ? "ok" : "erro");
      }}
    >
      <Undo2 className="h-3.5 w-3.5" />
      Voltar atrás
    </Acao>
  );
}
