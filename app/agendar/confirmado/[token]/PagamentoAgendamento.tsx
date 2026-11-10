"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Banknote, CheckCircle2, Copy, CreditCard, ExternalLink, Loader2, QrCode } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { formatarCpf } from "@/lib/cpf";
import { pagarAgendamento, pagarNaBarbearia, statusDoPagamento } from "./actions";

type Metodo = "PIX" | "CARTAO" | "BALCAO";

/**
 * Pagamento do horário na tela da confirmação. Pix: o QR e o "copia e
 * cola" aparecem aqui mesmo; cartão: abre a página segura do Asaas. A
 * tela pergunta sozinha se já caiu e vira "Pago" sem recarregar.
 */
export function PagamentoAgendamento({
  token,
  totalCents,
  metodo,
  status,
  pix,
  faturaUrl,
  reciboUrl,
  online,
  pedirCpf,
  daCasa,
  mensalista = false,
  formaPaga = null,
}: {
  /** Como foi pago (DINHEIRO, PIX_BALCAO, CARTAO_BALCAO, PIX…). */
  formaPaga?: string | null;
  /** Cliente com plano: no salão é só Pix ou cartão à vista, sem dinheiro. */
  mensalista?: boolean;
  token: string;
  totalCents: number;
  metodo: Metodo | null;
  status: "PAGO" | "PENDENTE" | null;
  pix: { imagem: string; copiaECola: string } | null;
  faturaUrl: string | null;
  reciboUrl: string | null;
  online: boolean;
  /** Sem CPF salvo que possa ser usado: o campo aparece. */
  pedirCpf: boolean;
  daCasa: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [mostrarCpf, setMostrarCpf] = useState(pedirCpf);
  const [copiado, setCopiado] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);

  const aguardando = status === "PENDENTE" && (metodo === "PIX" || metodo === "CARTAO");
  // Confere sozinha por 15 minutos; depois, só quando o cliente pedir.
  const [conferindo, setConferindo] = useState(true);
  const [verificando, startVerificar] = useTransition();

  // Enquanto a fatura está aberta, confere a cada 4 s (e ao voltar da aba
  // do cartão). Para quando cair.
  useEffect(() => {
    if (!aguardando || !conferindo) return;
    let parar = false;
    const fim = window.setTimeout(() => setConferindo(false), 15 * 60_000);
    const conferir = async () => {
      try {
        const r = await statusDoPagamento(token);
        if (!parar && r.pago) router.refresh();
      } catch {
        /* rede oscilou: tenta no próximo ciclo */
      }
    };
    const t = window.setInterval(conferir, 4000);
    const aoVoltar = () => document.visibilityState === "visible" && conferir();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      parar = true;
      window.clearTimeout(fim);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [aguardando, conferindo, token, router]);

  if (totalCents <= 0) return null;

  if (status === "PAGO") {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-left">
        <p className="flex items-center gap-2 font-semibold text-emerald-200">
          <CheckCircle2 className="h-5 w-5" />
          {formaPaga === "DINHEIRO"
            ? "Pago em dinheiro"
            : formaPaga === "PIX_BALCAO"
              ? "Pago no Pix (balcão)"
              : formaPaga === "CARTAO_BALCAO"
                ? "Pago no cartão (balcão)"
                : `Pago ${formaPaga?.startsWith("CREDIT_CARD") || (!formaPaga && metodo === "CARTAO") ? "no cartão" : "no Pix"}`}{" "}
          · {formatBRL(totalCents)}
        </p>
        <p className="mt-1 text-sm text-emerald-100/80">
          {formaPaga && ["DINHEIRO", "PIX_BALCAO", "CARTAO_BALCAO"].includes(formaPaga)
            ? "Recebido na barbearia."
            : daCasa ? "O cliente já pagou pelo app. Nada a cobrar no balcão." : "Tudo certo! É só chegar no horário."}
        </p>
        {reciboUrl && (
          <a
            href={reciboUrl}
            target="_blank"
            rel="noreferrer"
            className="label mt-3 inline-flex items-center gap-1.5 text-emerald-200 underline-offset-4 hover:underline"
          >
            Ver comprovante <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  if (!online) {
    return (
      <p className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-surface-2 p-4 text-left text-sm text-steel-300">
        <Banknote className="h-5 w-5 flex-none text-electric" />
        Pagamento na barbearia, na hora do atendimento.
      </p>
    );
  }

  function pagar(m: "PIX" | "CARTAO") {
    setErro(null);
    // O cartão abre numa aba nova: aberta já no toque, senão o celular
    // bloqueia como pop-up quando a resposta do servidor chega.
    const aba = m === "CARTAO" ? window.open("about:blank", "_blank") : null;
    start(async () => {
      const r = await pagarAgendamento(token, m, cpf || undefined);
      if (!r.ok) {
        aba?.close();
        setErro(r.error);
        if (r.precisaCpf) setMostrarCpf(true);
        return;
      }
      setEscolhendo(false);
      if (aba) aba.location.href = r.url;
      router.refresh();
    });
  }

  function naBarbearia() {
    setErro(null);
    start(async () => {
      const r = await pagarNaBarbearia(token);
      if (!r.ok) setErro(r.error ?? "Não deu certo. Tente de novo.");
      setEscolhendo(false);
      router.refresh();
    });
  }

  const opcoes = (
    <div className="mt-4 space-y-3">
      {mostrarCpf && (
        <label className="block">
          <span className="label mb-2 block text-steel-400">
            CPF {daCasa ? "do cliente" : ""} (o Asaas pede para Pix e cartão)
          </span>
          <input
            value={cpf}
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            inputMode="numeric"
            placeholder="000.000.000-00"
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => pagar("PIX")}
          disabled={pending}
          className="btn-royal label inline-flex items-center justify-center gap-2 rounded-xl px-3 py-3.5 text-white disabled:opacity-50"
        >
          <QrCode className="h-4 w-4" /> Pagar com Pix
        </button>
        <button
          type="button"
          onClick={() => pagar("CARTAO")}
          disabled={pending}
          className="label inline-flex items-center justify-center gap-2 rounded-xl border border-electric/40 bg-electric/10 px-3 py-3.5 text-electric disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" /> Cartão
        </button>
      </div>
      {metodo !== "BALCAO" && (
        <button
          type="button"
          onClick={naBarbearia}
          disabled={pending}
          className="label inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 px-3 py-3 text-steel-300 disabled:opacity-50"
        >
          <Banknote className="h-4 w-4" /> {mensalista ? "Pagar na barbearia (Pix ou cartão)" : "Pagar na barbearia (dinheiro)"}
        </button>
      )}
    </div>
  );

  const erroBox = erro && (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
      {erro}
    </p>
  );

  // Fatura aberta: Pix na tela ou o botão do cartão.
  if (aguardando && !escolhendo) {
    return (
      <div className="mt-5 rounded-2xl border border-electric/30 bg-electric/[0.06] p-4 text-left">
        <p className="label flex items-center justify-between text-electric">
          <span>{metodo === "PIX" ? "Pague com Pix" : "Pague com cartão"}</span>
          <span className="font-display text-base normal-case tracking-normal text-white">{formatBRL(totalCents)}</span>
        </p>
        {metodo === "PIX" && pix ? (
          <>
            <p className="mt-2 text-sm text-steel-300">
              {daCasa
                ? "Peça para o cliente ler este QR no app do banco."
                : "Abra o app do seu banco, escolha Pix e leia o QR, ou copie o código."}
            </p>
            <div className="mx-auto mt-4 w-56 rounded-2xl bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pix.imagem}`} alt="QR do Pix" className="block h-auto w-full" />
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pix.copiaECola);
                  setCopiado(true);
                  window.setTimeout(() => setCopiado(false), 2500);
                } catch {
                  window.prompt("Copie o código do Pix:", pix.copiaECola);
                }
              }}
              className="btn-royal label mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-white"
            >
              <Copy className="h-4 w-4" />
              {copiado ? "Código copiado!" : "Copiar código Pix"}
            </button>
          </>
        ) : (
          faturaUrl && (
            <a
              href={faturaUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-royal label mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-white"
            >
              {metodo === "PIX" ? <QrCode className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
              {metodo === "PIX" ? "Abrir o Pix" : "Pagar com cartão"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )
        )}
        {conferindo ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-steel-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Aguardando o pagamento… esta tela atualiza sozinha.
          </p>
        ) : (
          <button
            type="button"
            disabled={verificando}
            onClick={() =>
              startVerificar(async () => {
                const r = await statusDoPagamento(token).catch(() => ({ pago: false }));
                if (r.pago) router.refresh();
                else setConferindo(true);
              })
            }
            className="label mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 px-4 py-3 text-steel-200 disabled:opacity-50"
          >
            {verificando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Já paguei, verificar
          </button>
        )}
        <button
          type="button"
          onClick={() => setEscolhendo(true)}
          className="mt-2 w-full text-center text-xs text-steel-400 underline-offset-4 hover:text-white hover:underline"
        >
          Trocar a forma de pagamento
        </button>
        {erroBox}
      </div>
    );
  }

  // Na barbearia (ou a cobrança online não saiu): dá para pagar pelo app.
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-surface-2/60 p-4 text-left">
      {metodo === "BALCAO" && !escolhendo ? (
        <>
          <p className="flex items-center gap-2 font-semibold text-white">
            <Banknote className="h-5 w-5 text-electric" />
            Pagamento na barbearia · {formatBRL(totalCents)}
          </p>
          <p className="mt-1 text-sm text-steel-400">
            {mensalista
              ? daCasa
                ? "Mensalista: cobre na hora só Pix ou cartão à vista (sem dinheiro)."
                : "Na hora, com Pix ou cartão à vista. Mensalista não paga em dinheiro."
              : daCasa
                ? "O cliente paga na hora, em dinheiro ou na maquininha."
                : "Paga na hora, em dinheiro ou na maquininha."}
          </p>
          <button
            type="button"
            onClick={() => setEscolhendo(true)}
            className="label mt-3 text-electric underline-offset-4 hover:underline"
          >
            {daCasa ? "Cobrar agora com Pix ou cartão" : "Prefiro pagar agora (Pix ou cartão)"}
          </button>
        </>
      ) : (
        <>
          <p className="font-semibold text-white">Como {daCasa ? "o cliente vai" : "você quer"} pagar?</p>
          <p className="mt-1 text-sm text-steel-400">Total {formatBRL(totalCents)}</p>
          {opcoes}
        </>
      )}
      {erroBox}
    </div>
  );
}
