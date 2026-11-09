"use client";

// Ações do membro sobre o próprio plano. O site promete "cancele quando
// quiser" desde a vitrine, e o cliente vencido não tinha nem como ver que
// estava devendo — só descobria quando o benefício sumia.

import { useTransition } from "react";
import { Loader2, CreditCard, QrCode, X, Undo2 } from "lucide-react";
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

/** Mensalidade: Pix ou cartão de crédito à vista (sem boleto, sem parcelar). */
export function PagarPlano({ rotulo = "Pagar com Pix" }: { rotulo?: string }) {
  const pagar = (metodo: "PIX" | "CARTAO") => async () => {
    let r = await payMyPlan({ metodo });
    // Sem CPF na conta, o Asaas não gera a cobrança: pergunta e tenta de novo.
    if (!r.ok && r.precisaCpf) {
      const cpf = window.prompt(`${r.error}\nDigite o CPF (só os números):`);
      if (!cpf) return;
      r = await payMyPlan({ cpf, metodo });
    }
    if (r.ok && r.mode === "pagamento") window.location.href = r.url;
    else if (!r.ok) toast(r.error, "erro");
  };
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Acao className="btn-royal text-white" onRun={pagar("PIX")}>
        <QrCode className="h-3.5 w-3.5" />
        {rotulo}
      </Acao>
      <Acao className="border border-electric/40 bg-electric/10 text-electric" onRun={pagar("CARTAO")}>
        <CreditCard className="h-3.5 w-3.5" />
        Cartão à vista
      </Acao>
    </span>
  );
}

export function CancelarPlano({ vencido = false }: { vencido?: boolean }) {
  return (
    <Acao
      className="border border-white/12 text-steel-300 hover:border-red-400/50 hover:text-red-200"
      onRun={async () => {
        // Um toque sem querer não pode encerrar o plano. Vencido, o
        // encerramento é imediato — o texto não pode prometer o contrário.
        const pergunta = vencido
          ? "Encerrar seu plano agora? Seu horário fixo, se houver, é liberado."
          : "Cancelar seu plano do Clube? Os benefícios valem até o fim do ciclo já pago.";
        if (!confirm(pergunta)) return;
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
