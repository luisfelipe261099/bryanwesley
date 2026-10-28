"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from "lucide-react";
import { marcarTutorialVisto } from "@/app/tutorial/actions";
import type { Tour } from "@/lib/tutorial";

type Passo = {
  titulo: string;
  texto: string;
  /** Seletores do elemento a destacar, em ordem de preferência. Sem alvo
   * na tela (ou sem seletor), o cartão aparece no centro. */
  alvo?: string[];
  /** Botão final que leva a outra tela (ex.: "Abrir o Catálogo"). */
  acao?: { rotulo: string; href: string };
};

function passosDe(tour: Tour, nome: string): Passo[] {
  if (tour === "preco-turno") {
    return [
      {
        titulo: `Novidade, ${nome}: preço por turno`,
        texto:
          "Agora cada serviço pode ter outro valor em certos dias e horários. Exemplo: o corte custa R$ 50 de dia e R$ 60 à noite, ou mais caro no sábado.",
      },
      {
        titulo: "Fica no Catálogo",
        texto:
          "Toque na aba Catálogo. Embaixo de cada serviço aparece a parte Preço por turno, com o botão Adicionar turno.",
        alvo: ['nav.rail a[href="/admin/catalogo"]'],
      },
      {
        titulo: "Como criar um turno",
        texto:
          "Escreva o nome (ex.: Noite), os horários em Das e Até, o preço, e marque os dias da semana. Toque em Salvar turno. Fora dos turnos vale o preço normal do serviço.",
      },
      {
        titulo: "O que o cliente vê",
        texto:
          "O site mostra os turnos em cada serviço, e na hora de agendar o total já sai com o preço do horário escolhido. Quem já marcou continua com o valor combinado.",
        acao: { rotulo: "Abrir o Catálogo", href: "/admin/catalogo" },
      },
    ];
  }
  if (tour === "admin") {
    return [
      {
        titulo: `Bem-vindo ao painel, ${nome}!`,
        texto:
          "Em um minuto você conhece o essencial do dia a dia. Dá para rever este tutorial quando quiser, em Minha conta.",
      },
      {
        titulo: "Uma aba para cada área",
        texto:
          "Agenda, Equipe, Catálogo, Clientes, Clube VIP, Relatórios, Mensagens e Ajustes. No celular, arraste as abas para o lado para ver todas.",
        alvo: ["nav.rail"],
      },
      {
        titulo: "Os números do dia",
        texto:
          "Faturamento de hoje, Clube VIP por mês, ocupação e comissões do mês. A tela se atualiza sozinha a cada minuto.",
        alvo: ['[data-tour="kpis"]'],
      },
      {
        titulo: "A agenda de hoje",
        texto:
          "Todos os barbeiros juntos. Em cada horário: Iniciar e, no fim, Concluir — é o Concluir que lança a comissão. Nos três pontinhos ficam falta e cancelar; remarcar fica na aba Agenda.",
        alvo: ['[data-tour="agenda-hoje"]'],
      },
      {
        titulo: "Encaixe e pedido por telefone",
        texto:
          "Toque em Novo agendamento, escolha o serviço, o barbeiro e o horário, e digite o nome e o WhatsApp do cliente.",
        alvo: ['[data-tour="novo-agendamento"]'],
      },
      {
        titulo: "Antes de abrir as portas",
        texto:
          "Equipe: cadastre os barbeiros e as folgas. Catálogo: preços e durações. Clube VIP: os planos. Ajustes: dados da barbearia e horários. Mensagens: avisos no celular e o WhatsApp da barbearia.",
      },
      {
        titulo: "Tudo pronto",
        texto:
          "Ligue os avisos no celular para saber de cada horário novo, cancelado ou remarcado e de cada pedido de plano — mesmo com o site fechado.",
        alvo: ['[data-testid="avisos-push-banner"]'],
      },
    ];
  }
  if (tour === "barbeiro") {
    return [
      {
        titulo: `Bem-vindo, ${nome}!`,
        texto:
          "Seu dia no sistema cabe em poucos toques: validar a chegada, finalizar, marcar falta e encaixar. Dá para rever este tutorial em Minha conta.",
      },
      {
        titulo: "Cliente chegou",
        texto:
          "Aponte a câmera do seu celular para o QR do cliente e toque no link, ou digite o código de 6 letras e toque em Validar. Com a cadeira livre, o atendimento começa sozinho.",
        alvo: ['[data-tour="checkin"]'],
      },
      {
        titulo: "Sua agenda do dia",
        texto:
          "Terminou? Toque em Finalizar — só aí a comissão é lançada. Cliente não veio? Depois do horário marcado, toque no bonequinho com X e confirme.",
        alvo: ['[data-tour="agenda"]'],
      },
      {
        titulo: "Comissão do mês",
        texto: "Quanto você já ganhou no mês e quanto falta para a meta.",
        alvo: ['[data-tour="comissao"]'],
      },
      {
        titulo: "Cliente sem horário",
        texto:
          "Toque em Encaixe, deixe o seu nome marcado, escolha o horário e digite o nome e o WhatsApp do cliente.",
        alvo: ['nav[aria-label="Navegação principal"] a[href="/agendar"]', '[data-tour="encaixe"]'],
      },
      {
        titulo: "Ligue os avisos",
        texto:
          "Horário novo, cancelado ou remarcado na sua agenda chega no celular, mesmo com o site fechado.",
        alvo: ['[data-testid="avisos-push-banner"]'],
      },
    ];
  }
  return [
    {
      titulo: `Bem-vindo, ${nome}!`,
      texto:
        "Aqui você marca, remarca e acompanha os seus horários na Bryan Wesley. Dá para rever este tutorial em Minha conta.",
    },
    {
      titulo: "Agendar",
      texto:
        "Escolha o serviço, o barbeiro e o horário que preferir. A confirmação aparece na hora e chega no seu WhatsApp.",
      alvo: ['[data-tour="agendar"]'],
    },
    {
      titulo: "No dia do corte",
      texto:
        "Mostre o QR code ou o código de 6 letras na barbearia. Precisa mudar? Remarcar e cancelar ficam no seu próximo horário.",
      alvo: ['[data-tour="proximo"]', '[data-tour="horarios"]'],
    },
    {
      titulo: "Clube VIP",
      texto:
        "Com um plano, os serviços inclusos saem sem cobrança. Escolha o seu e a barbearia confirma com você pelo WhatsApp.",
      alvo: ['[data-tour="clube"]'],
    },
    {
      titulo: "Ligue os avisos",
      texto:
        "Receba a confirmação e os lembretes do seu horário no celular, mesmo com o site fechado.",
      alvo: ['[data-testid="avisos-push-banner"]'],
    },
  ];
}

const CHAVE = (tour: Tour, usuarioId: number) => `tutorial:${tour}:${usuarioId}`;

function lerLocal(chave: string) {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarLocal(chave: string) {
  try {
    localStorage.setItem(chave, "1");
  } catch {}
}

/** Primeiro elemento visível entre os seletores do passo. */
function acharAlvo(alvo?: string[]): HTMLElement | null {
  for (const sel of alvo ?? []) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

type Caixa = { top: number; left: number; width: number; height: number };

/**
 * Tutorial de primeiro acesso: um passo a passo sobre a tela de verdade,
 * com o elemento de cada passo em destaque. Aparece uma vez por conta
 * (gravado no servidor); "Pular" também conta como visto.
 */
export function TutorialPrimeiroAcesso({
  tour,
  nome,
  usuarioId,
  mostrar,
  forcar = false,
}: {
  tour: Tour;
  /** Primeiro nome, para a saudação. */
  nome: string;
  usuarioId: number;
  /** O servidor diz que a conta ainda não viu este tutorial. */
  mostrar: boolean;
  /** Aberto pelo "Ver o tutorial de novo" (?tutorial=1). */
  forcar?: boolean;
}) {
  // Lista estável entre renderizações: um passo novo a cada render refazia
  // a medição, que renderizava de novo, sem fim.
  const passos = useMemo(() => passosDe(tour, nome), [tour, nome]);
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [vh, setVh] = useState(800);
  const principal = useRef<HTMLButtonElement>(null);

  // Abre depois que a página assentou (as animações de entrada mexem no
  // layout). O localStorage só evita reabrir se o servidor falhou em gravar.
  useEffect(() => {
    if (!forcar && (!mostrar || lerLocal(CHAVE(tour, usuarioId)))) return;
    const t = setTimeout(() => setAberto(true), 900);
    if (forcar) {
      // Tira o ?tutorial=1 da barra: recarregar não reabre.
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("tutorial");
        u.searchParams.delete("novidade");
        window.history.replaceState(null, "", u.toString());
      } catch {}
    }
    return () => clearTimeout(t);
  }, [forcar, mostrar, tour, usuarioId]);

  const passo = passos[i];

  const medir = useCallback(() => {
    setVh(window.innerHeight);
    const el = acharAlvo(passo?.alvo);
    if (!el) {
      setCaixa(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nova = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    // Só troca se mexeu: a rolagem chama isto a cada quadro.
    setCaixa((c) =>
      c && c.top === nova.top && c.left === nova.left && c.width === nova.width && c.height === nova.height ? c : nova
    );
  }, [passo]);

  // A cada passo: leva o alvo para a vista e mede de novo quando assenta.
  useLayoutEffect(() => {
    if (!aberto) return;
    const el = acharAlvo(passo?.alvo);
    if (el) {
      const r = el.getBoundingClientRect();
      const fora = r.top < 80 || r.bottom > window.innerHeight - 100;
      // Aba escondida no fim da fileira (celular): traz para o meio.
      const deLado = r.left < 0 || r.right > window.innerWidth;
      if (fora || deLado)
        el.scrollIntoView({
          block: fora ? (r.height > window.innerHeight * 0.5 ? "start" : "center") : "nearest",
          inline: deLado ? "center" : "nearest",
          behavior: "smooth",
        });
    }
    medir();
    const t1 = setTimeout(medir, 350);
    const t2 = setTimeout(medir, 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [aberto, i, passo, medir]);

  useEffect(() => {
    if (!aberto) return;
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, { passive: true });
    principal.current?.focus();
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir);
    };
  }, [aberto, i, medir]);

  const fechar = useCallback(() => {
    setAberto(false);
    gravarLocal(CHAVE(tour, usuarioId));
    marcarTutorialVisto(tour).catch(() => {});
  }, [tour, usuarioId]);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowRight") setI((v) => Math.min(passos.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, fechar, passos.length]);

  if (!aberto || !passo) return null;
  const ultimo = i === passos.length - 1;

  // Cartão embaixo do destaque quando cabe, senão em cima; sem destaque,
  // no centro.
  // Destaque grande demais para caber o cartão em volta: cartão no pé da
  // tela, por cima da parte de baixo do destaque.
  const CARTAO = 250;
  let posCartao: React.CSSProperties;
  if (caixa) {
    const abaixo = vh - (caixa.top + caixa.height);
    if (abaixo >= CARTAO) posCartao = { top: caixa.top + caixa.height + 12 };
    else if (caixa.top >= CARTAO) posCartao = { bottom: vh - caixa.top + 12 };
    else posCartao = { bottom: 16 };
  } else {
    posCartao = { top: "50%", transform: "translateY(-50%)" };
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Tutorial" className="fixed inset-0 z-[300]">
      {caixa ? (
        // O recorte: uma caixa transparente com sombra enorme escurece o resto.
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl ring-2 ring-electric transition-all duration-300"
          style={{
            top: caixa.top,
            left: caixa.left,
            width: caixa.width,
            height: caixa.height,
            boxShadow: "0 0 0 9999px rgba(4,6,10,0.72), 0 0 24px rgba(30,184,255,0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgba(4,6,10,0.72)]" />
      )}
      {/* Toque fora não faz nada: só os botões avançam ou fecham. */}
      <div className="absolute inset-0" />

      <div
        className="absolute inset-x-4 mx-auto max-w-md rounded-3xl border border-electric/30 bg-ink-800 p-5 shadow-card"
        style={posCartao}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="label inline-flex items-center gap-1.5 text-electric">
            <Sparkles className="h-3.5 w-3.5" />
            {i + 1} de {passos.length}
          </span>
          <button
            type="button"
            onClick={fechar}
            aria-label="Pular tutorial"
            className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-full text-steel-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="mt-2 font-display text-xl text-white">{passo.titulo}</h2>
        <p className="mt-2 text-sm leading-relaxed text-steel-300">{passo.texto}</p>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {passos.map((_, k) => (
            <span
              key={k}
              className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-electric" : "w-1.5 bg-white/20"}`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {i === 0 ? (
            <button type="button" onClick={fechar} className="label rounded-full px-3 py-2.5 text-steel-400 hover:text-white">
              Pular
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setI((v) => Math.max(0, v - 1))}
              className="label inline-flex items-center gap-1.5 rounded-full border border-white/12 px-4 py-2.5 text-steel-300 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar
            </button>
          )}
          <button
            ref={principal}
            type="button"
            onClick={() => {
              if (!ultimo) return setI((v) => v + 1);
              fechar();
              if (passo.acao) window.location.href = passo.acao.href;
            }}
            className="btn-royal label inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-white"
          >
            {ultimo ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                {passo.acao?.rotulo ?? "Começar"}
              </>
            ) : (
              <>
                Próximo
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
