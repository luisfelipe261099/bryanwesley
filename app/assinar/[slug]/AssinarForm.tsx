"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { requestPlan } from "@/app/cliente/actions";
import { cpfValido, formatarCpf } from "@/lib/cpf";

export function AssinarForm({
  planId,
  planName,
  priceCents,
  annualCents,
  features,
  cobrancaOnline = false,
  cpfAtual = "",
}: {
  /** Pagamento online (Asaas) ligado: pede o CPF, que o Asaas exige. */
  cobrancaOnline?: boolean;
  cpfAtual?: string;
  planId: number;
  planName: string;
  priceCents: number;
  annualCents: number;
  features: string[];
}) {
  const [cycle, setCycle] = useState<"MENSAL" | "ANUAL">("MENSAL");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState(formatarCpf(cpfAtual));
  const router = useRouter();

  const unit = cycle === "ANUAL" ? annualCents : priceCents;
  const total = cycle === "ANUAL" ? annualCents * 12 : priceCents;

  function submit() {
    setError(null);
    if (cobrancaOnline && !cpfValido(cpf)) {
      setError("Informe um CPF válido para pagar online.");
      return;
    }
    start(async () => {
      try {
        const res = await requestPlan({ planId, cycle, cpf: cobrancaOnline ? cpf : undefined });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.mode === "pagamento") {
          // Cobrança online ativa: leva direto para o checkout.
          window.location.href = res.url;
          return;
        }
        // Vai para a conta com o aviso: o estado local não sobrevive à
        // revalidação disparada pela própria ação.
        router.push("/cliente?assinatura=pedida");
      } catch (e) {
        console.error(e);
        setError(
          "Não conseguimos falar com o servidor agora. Tente de novo em instantes."
        );
      }
    });
  }

  return (
    <div className="glass rounded-3xl p-7">
      <span className="label text-electric">Escolha o ciclo</span>
      <div className="mt-3 flex gap-2">
        {(["MENSAL", "ANUAL"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCycle(c)}
            aria-pressed={cycle === c}
            className={`label flex-1 rounded-full py-3.5 transition-all ${
              cycle === c ? "btn-royal text-white" : "border border-white/12 text-steel-300"
            }`}
          >
            {c === "MENSAL" ? "Mensal" : "Anual"}
            {c === "ANUAL" && (
              <span className="ml-2 rounded-full bg-neon/15 px-2 py-1 text-[9px] text-neon">
                2 meses off
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-end justify-between border-t border-white/8 pt-5">
        <div>
          <p className="label text-steel-400">Você paga</p>
          <p className="mt-1 font-display text-3xl text-white">
            {formatBRL(unit)}
            <span className="ml-1 text-sm font-normal text-steel-400">/mês</span>
          </p>
        </div>
        {cycle === "ANUAL" && (
          <p className="text-right text-xs text-steel-400">
            {formatBRL(total)} por ano
          </p>
        )}
      </div>

      <ul className="mt-6 space-y-2.5 border-t border-white/8 pt-5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-electric/15">
              <Check className="h-3 w-3 text-electric" strokeWidth={3} />
            </span>
            <span className="text-steel-300">{f}</span>
          </li>
        ))}
      </ul>

      {cobrancaOnline && (
        <label className="mt-6 block border-t border-white/8 pt-5">
          <span className="label mb-2 block text-steel-400">CPF de quem vai usar o plano</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
          <span className="mt-1.5 block text-xs text-steel-400">
            O pagamento é feito pelo Asaas, com Pix, boleto ou cartão. O CPF é pedido por ele para emitir a cobrança.
          </span>
        </label>
      )}

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-royal label mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        Quero o {planName.replace("Plano ", "")}
      </button>
      <p className="mt-3 text-center text-xs text-steel-400">
        Sem fidelidade. Você cancela quando quiser.
      </p>
    </div>
  );
}
