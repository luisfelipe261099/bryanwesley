"use client";

// Trocar os serviços de um atendimento já marcado.
//
// É a situação mais comum do balcão: o cliente sentou para cortar e pede
// barba também. A única saída era cancelar e marcar de novo — o que
// dispara um "seu horário foi cancelado" no WhatsApp da pessoa que está
// sentada na cadeira.

import { useState, useTransition } from "react";
import { Loader2, Scissors } from "lucide-react";
import { Modal } from "@/components/Modal";
import { toast } from "@/lib/toast";
import { formatBRL, formatDuration } from "@/lib/money";
import { editarServicos } from "../actions";
import { ItemMenu } from "../AgendaHoje";

export type ServicoDoCatalogo = {
  id: number;
  name: string;
  priceCents: number;
  durationMin: number;
};

export function EditarServicos({
  appointmentId,
  servicos,
  atuais,
  resumo,
  variante = "icone",
}: {
  appointmentId: number;
  /** O catálogo ativo, para escolher. */
  servicos: ServicoDoCatalogo[];
  /** Ids do que já está marcado neste atendimento. */
  atuais: number[];
  resumo: string;
  /** "menu" desenha o gatilho como linha do menu de ações. */
  variante?: "icone" | "menu";
}) {
  const [open, setOpen] = useState(false);
  const [escolhidos, setEscolhidos] = useState<number[]>(atuais);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, start] = useTransition();

  const selecionados = servicos.filter((s) => escolhidos.includes(s.id));
  const total = selecionados.reduce((a, s) => a + s.priceCents, 0);
  const duracao = selecionados.reduce((a, s) => a + s.durationMin, 0);

  function abrir() {
    setEscolhidos(atuais);
    setErro(null);
    setOpen(true);
  }

  function salvar() {
    setErro(null);
    start(async () => {
      const r = await editarServicos({ appointmentId, serviceIds: escolhidos });
      if (r.ok) {
        setOpen(false);
        toast(r.message ?? "Serviços atualizados.", "ok");
      } else setErro(r.error);
    });
  }

  return (
    <>
      {variante === "menu" ? (
        <ItemMenu onClick={abrir}>
          <Scissors className="h-3.5 w-3.5" />
          Mudar serviços
        </ItemMenu>
      ) : (
        <button
          type="button"
          onClick={abrir}
          title="Mudar serviços"
          aria-label={`Mudar serviços de ${resumo}`}
          className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-steel-400 transition-colors hover:border-electric/45 hover:text-white sm:h-9 sm:w-9"
        >
          <Scissors className="h-3.5 w-3.5" />
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        label={`Serviços — ${resumo}`}
      >
        <p className="text-sm text-steel-400">
          O horário de início não muda. Se a nova duração passar por cima do
          próximo horário da cadeira, a troca é recusada.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {servicos.map((s) => {
            const on = escolhidos.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setEscolhidos(
                    on
                      ? escolhidos.filter((x) => x !== s.id)
                      : [...escolhidos, s.id]
                  )
                }
                className={`label rounded-full px-3.5 py-2.5 transition-all ${
                  on
                    ? "border border-electric/50 bg-electric/10 text-electric"
                    : "border border-white/12 text-steel-400 hover:text-white"
                }`}
              >
                {s.name}
                <span className="ml-1.5 opacity-70">{formatBRL(s.priceCents)}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 text-sm text-steel-300">
          {selecionados.length === 0
            ? "Escolha ao menos um serviço."
            : `${selecionados.map((s) => s.name).join(" + ")} · ${formatDuration(
                duracao
              )} · ${formatBRL(total)}`}
          <span className="mt-1 block text-xs text-steel-400">
            Quem tem plano não paga o que o plano cobre — a conta é refeita ao
            salvar.
          </span>
        </p>

        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200"
          >
            {erro}
          </p>
        )}

        <button
          type="button"
          onClick={salvar}
          disabled={escolhidos.length === 0 || salvando}
          className="btn-royal label mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-40"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar serviços
        </button>
      </Modal>
    </>
  );
}
