"use client";

// "Cobrar" na agenda da equipe (com desconto e venda extra): o cliente não pagou pelo app (ou deixou o
// Pix em aberto). Duas saídas:
//  · Mostrar o Pix — abre a tela do agendamento, que gera o QR do Asaas e
//    vira "Pago" sozinha quando cai;
//  · Recebi no balcão — dinheiro, Pix na maquininha/chave ou cartão: marca
//    pago e tira a fatura online em aberto.

import { useState, useTransition } from "react";
import { Banknote, CreditCard, Loader2, Minus, Plus, QrCode, Wallet, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatBRL } from "@/lib/money";
import { ajustarValor, receberNoBalcao, removerAjuste } from "./actions";
import type { FormaBalcao } from "@/lib/payments";

export function CobrarAtendimento({
  id,
  token,
  totalCents,
  mensalista = false,
  ajustes = [],
}: {
  /** Descontos e vendas extras já lançados (linhas sem serviço). */
  ajustes?: { id: number; name: string; priceCents: number }[];
  id: number;
  token: string | null;
  totalCents: number;
  mensalista?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState<"DESCONTO" | "EXTRA" | null>(null);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");

  function aplicarAjuste() {
    if (!ajuste) return;
    // "7,50" e "1.234,50" (vírgula decimal) ou "7.50" (ponto decimal).
    const limpo = valor.includes(",") ? valor.replace(/\./g, "").replace(",", ".") : valor;
    const cents = Math.round(Number(limpo) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setErro("Digite o valor em reais (ex.: 5 ou 7,50).");
      return;
    }
    setErro(null);
    start(async () => {
      const r = await ajustarValor(id, ajuste, cents, descricao);
      if (r.ok) {
        toast(r.message ?? "Valor ajustado.", "ok");
        setAjuste(null);
        setValor("");
        setDescricao("");
      } else setErro(r.error);
    });
  }

  function tirar(itemId: number) {
    setErro(null);
    start(async () => {
      const r = await removerAjuste(id, itemId);
      if (r.ok) toast(r.message ?? "Ajuste removido.", "ok");
      else setErro(r.error);
    });
  }

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
      {ajustes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-black/20 p-2 text-[11px]">
          {ajustes.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className={a.priceCents < 0 ? "text-amber-200" : "text-steel-100"}>
                {a.priceCents < 0 ? "−" : "+"} {formatBRL(Math.abs(a.priceCents))} · {a.name}
              </span>
              <button
                type="button"
                aria-label="Remover"
                disabled={pending}
                onClick={() => tirar(a.id)}
                className="text-steel-400 hover:text-red-300 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {ajuste ? (
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
          <p className="text-[11px] font-semibold text-steel-100">
            {ajuste === "DESCONTO" ? "Desconto" : "Venda extra"}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-steel-300">R$</span>
            <input
              inputMode="decimal"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0,00"
              className="w-full rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-electric/60"
            />
          </div>
          <input
            value={descricao}
            maxLength={80}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={ajuste === "DESCONTO" ? "Motivo (opcional)" : "O que foi vendido (ex.: pomada)"}
            className="w-full rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-electric/60"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setAjuste(null);
                setErro(null);
              }}
              className="label rounded-full border border-white/15 px-3 py-1.5 text-steel-300"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={aplicarAjuste}
              className="label rounded-full bg-electric px-3 py-1.5 text-white disabled:opacity-50"
            >
              Aplicar
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" disabled={pending} onClick={() => setAjuste("DESCONTO")} className={botao}>
            <Minus className="h-3.5 w-3.5" /> Desconto
          </button>
          <button type="button" disabled={pending} onClick={() => setAjuste("EXTRA")} className={botao}>
            <Plus className="h-3.5 w-3.5" /> Venda extra
          </button>
        </div>
      )}
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
