"use client";

// Os botões de cada atendimento no painel, usados na agenda, no dashboard
// e na ficha do cliente.
//
// Só a ação do momento fica à vista (iniciar, ou concluir quando já
// começou). O resto — concluir sem ter iniciado, mudar serviços,
// remarcar, marcar falta e cancelar — vive no menu "⋯", com o nome
// escrito. Seis círculos iguais na mesma linha viravam um teste de
// memória, e o cancelar ficava a um toque errado de distância.

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, X, Play, UserX, MoreHorizontal, RotateCcw } from "lucide-react";
import { toast } from "@/lib/toast";
import { adminTransition } from "./actions";

/**
 * O WhatsApp da barbearia está mandando mensagens? Vem do layout do
 * painel. Com ele desligado, prometer "o cliente recebe um aviso" fazia o
 * dono confiar num recado que nunca saiu.
 */
export const AvisoPorWhatsapp = createContext(false);

export function ProvedorAvisoWhatsapp({ ligado, children }: { ligado: boolean; children: React.ReactNode }) {
  return <AvisoPorWhatsapp.Provider value={ligado}>{children}</AvisoPorWhatsapp.Provider>;
}

/** "AAAA-MM-DD" de hoje no fuso da loja. */
function hojeNaLoja() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** O que cada ação destrutiva pede para confirmar antes de acontecer. */
function confirmacao(acao: string, avisaWhatsapp: boolean) {
  if (acao === "CANCELADO") {
    return {
      pergunta: avisaWhatsapp
        ? "Cancelar este horário? O cliente recebe um aviso de cancelamento no WhatsApp."
        : "Cancelar este horário? O WhatsApp ainda não está conectado: avise o cliente você mesmo.",
      botao: "Cancelar horário",
    };
  }
  return {
    pergunta: "Marcar que o cliente não apareceu? O horário é encerrado sem cobrança.",
    botao: "Marcar falta",
  };
}

export function ApptControls({
  id,
  status,
  dia,
  inicio,
  children,
}: {
  id: number;
  status: string;
  /** Dia do atendimento ("AAAA-MM-DD"): iniciar, concluir e falta só no dia. */
  dia?: string;
  /** Início do atendimento (ISO): falta só depois do horário. */
  inicio?: string;
  /** Ações extras da tela (mudar serviços, remarcar), dentro do menu. */
  children?: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [paraCima, setParaCima] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const avisaWhatsapp = useContext(AvisoPorWhatsapp);
  const futuro = dia ? dia > hojeNaLoja() : false;
  const antesDoHorario = inicio ? new Date(inicio).getTime() > Date.now() : false;

  // Clicar fora fecha o menu: aberto, ele cobre a linha de baixo.
  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => {
      // O modal de Remarcar/Mudar serviços é um portal no <body>: para o
      // DOM ele está "fora" do menu. Sem esta exceção, o primeiro toque
      // dentro do modal fechava o menu — e o modal ia junto.
      const alvo = e.target as Element | null;
      if (alvo?.closest?.('[role="dialog"]')) return;
      if (caixa.current && !caixa.current.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  function go(next: Parameters<typeof adminTransition>[1]) {
    setError(null);
    setConfirmando(null);
    setMenu(false);
    start(async () => {
      const res = await adminTransition(id, next);
      if (res.ok) toast(res.message ?? "Atualizado.", "ok");
      else setError(res.error);
    });
  }

  const spinner = pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null;
  const terminal = ["CONCLUIDO", "CANCELADO", "NO_SHOW"].includes(status);
  const emAndamento = status === "EM_ANDAMENTO";

  if (terminal) {
    // Falta marcada por engano tem volta: o cliente apareceu.
    if (status === "NO_SHOW") {
      return (
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => go("CONFIRMADO")}
            className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-steel-300 hover:text-white disabled:opacity-50"
          >
            {spinner ?? <RotateCcw className="h-3.5 w-3.5" />}
            Desfazer falta
          </button>
          {error && <p className="max-w-[200px] text-right text-xs text-amber-200">{error}</p>}
        </div>
      );
    }
    return error ? (
      <p className="max-w-[200px] text-right text-xs text-amber-200">{error}</p>
    ) : null;
  }

  if (confirmando) {
    const c = confirmacao(confirmando, avisaWhatsapp);
    return (
      <div className="flex flex-col items-end gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-2.5">
        <p className="max-w-[230px] text-right text-xs text-amber-100">{c.pergunta}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setConfirmando(null)}
            className="label rounded-full border border-white/15 px-3 py-2 text-steel-300"
          >
            Voltar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => go(confirmando as Parameters<typeof adminTransition>[1])}
            className="label rounded-full bg-red-500/90 px-3 py-2 text-white disabled:opacity-50"
          >
            {spinner ?? c.botao}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div ref={caixa} className="relative flex items-center gap-1.5">
        {/* A ação do momento — no dia. Em dia futuro, só o menu. */}
        {futuro ? null : emAndamento ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => go("CONCLUIDO")}
            className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-white disabled:opacity-50"
          >
            {spinner ?? <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            Concluir
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => go("EM_ANDAMENTO")}
            className="btn-outline label inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-electric disabled:opacity-50"
          >
            {spinner ?? <Play className="h-3.5 w-3.5" />}
            Iniciar
          </button>
        )}

        <button
          type="button"
          aria-label="Mais ações"
          aria-expanded={menu}
          onClick={() => {
            // Perto do fim da tela (o último horário do dia, com a barra
            // fixa embaixo), o menu abre para cima: aberto para baixo,
            // "Cancelar" ficava sob a barra e o toque ia para ela.
            const r = caixa.current?.getBoundingClientRect();
            setParaCima(Boolean(r && r.bottom + 260 > window.innerHeight - 90));
            setMenu((v) => !v);
          }}
          className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-steel-300 transition-colors hover:border-electric/45 hover:text-white sm:h-9 sm:w-9"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {/* Montado sempre (só escondido): as ações da tela abrem modais, e
            desmontar o menu ao fechá-lo levava o modal aberto junto. */}
        <div
          className={`absolute right-0 z-50 w-56 overflow-hidden rounded-2xl border border-white/12 bg-ink-800 p-1.5 shadow-card ${
            paraCima ? "bottom-full mb-2" : "top-full mt-2"
          } ${menu ? "" : "hidden"}`}
        >
          {children}
          {!emAndamento && !futuro && (
            <ItemMenu onClick={() => go("CONCLUIDO")}>
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              Concluir direto
            </ItemMenu>
          )}
          {!emAndamento && !futuro && !antesDoHorario && (
            <ItemMenu onClick={() => setConfirmando("NO_SHOW")}>
              <UserX className="h-3.5 w-3.5" />
              Marcar falta
            </ItemMenu>
          )}
          <ItemMenu tom="perigo" onClick={() => setConfirmando("CANCELADO")}>
            <X className="h-3.5 w-3.5" />
            Cancelar horário
          </ItemMenu>
        </div>
      </div>
      {error && (
        <p className="max-w-[200px] text-right text-xs text-amber-200">{error}</p>
      )}
    </div>
  );
}

/** Uma linha do menu "⋯" — também usada pelas ações que a tela injeta. */
export function ItemMenu({
  children,
  onClick,
  tom = "normal",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tom?: "normal" | "perigo";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
        tom === "perigo"
          ? "text-steel-300 hover:bg-red-500/10 hover:text-red-200"
          : "text-steel-200 hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
