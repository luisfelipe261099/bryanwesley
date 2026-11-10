"use client";

// "Cobrar" na agenda da equipe: o cliente não pagou pelo app (ou deixou o
// Pix em aberto). Duas saídas:
//  · Mostrar o Pix — abre a tela do agendamento, que gera o QR do Asaas e
//    vira "Pago" sozinha quando cai;
//  · Recebi no balcão — dinheiro, Pix na maquininha/chave ou cartão: marca
//    pago e tira a fatura online em aberto.

import { useState, useTransition } from "react";
import { Banknote, CreditCard, Loader2, QrCode, Wallet, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatBRL } from "@/lib/money";
import { receberNoBalcao } from "./actions";
import type { FormaBalcao } from "@/lib/payments";

export function CobrarAtendimento({
  id,
  token,
  totalCents,
  mensalista = false,
}: {
  id: number;
  token: string | null;
  totalCents: number;
  mensalista?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function receber(forma: FormaBalcao) {
    setErro(null);
    start(async () => {
      const r = await receberNoBalcao(id, forma);
      if (r.ok) {
        toast(r.message ?? "Pagamento registrado.", "ok");
        setAberto(false);
      } else setErro(r.error);
    });
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="label inline-flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-2 text-white transition-colors hover:bg-emerald-500"
      >
        <Wallet className="h-3 w-3" />
        Cobrar
      </button>
    );
  }

  const botao =
    "label inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-steel-100 transition-colors hover:border-electric/50 disabled:opacity-50";

  return (
    <div className="flex w-full max-w-[280px] flex-col gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-2.5 text-left">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-emerald-100">Cobrar {formatBRL(totalCents)}</p>
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => {
            setAberto(false);
            setErro(null);
          }}
          className="text-steel-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {token && (
        <a
          href={`/agendar/confirmado/${token}`}
          className="label inline-flex items-center justify-center gap-1.5 rounded-full bg-electric px-3 py-2 text-white"
        >
          <QrCode className="h-3.5 w-3.5" />
          Mostrar Pix para o cliente
        </a>
      )}
      <p className="text-[11px] text-steel-300">Ou já recebeu? Marque como:</p>
      <div className="grid grid-cols-1 gap-1.5">
        {!mensalista && (
          <button type="button" disabled={pending} onClick={() => receber("DINHEIRO")} className={botao}>
            <Banknote className="h-3.5 w-3.5" /> Dinheiro
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => receber("PIX_BALCAO")} className={botao}>
          <QrCode className="h-3.5 w-3.5" /> Pix na maquininha / chave
        </button>
        <button type="button" disabled={pending} onClick={() => receber("CARTAO_BALCAO")} className={botao}>
          <CreditCard className="h-3.5 w-3.5" /> Cartão na maquininha
        </button>
      </div>
      {pending && (
        <p className="flex items-center gap-1.5 text-[11px] text-steel-300">
          <Loader2 className="h-3 w-3 animate-spin" /> Registrando…
        </p>
      )}
      {mensalista && <p className="text-[11px] text-steel-300">Mensalista: só Pix ou cartão.</p>}
      {erro && <p className="text-[11px] text-red-300">{erro}</p>}
    </div>
  );
}
