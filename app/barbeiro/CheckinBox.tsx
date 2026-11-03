"use client";

import { useCallback, useState, useTransition } from "react";
import { AlertCircle, Camera, Loader2, QrCode } from "lucide-react";
import { toast } from "@/lib/toast";
import { checkIn } from "./actions";
import { LerQr, type LeituraQr } from "./LerQr";

/**
 * Validação de chegada. O barbeiro lê o QR do cliente com a câmera aqui
 * mesmo (botão "Ler QR com a câmera"), aponta a câmera do celular (o QR
 * abre a rota /barbeiro/checkin/<token>) ou digita o código curto.
 */
export function CheckinBox() {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const fecharCamera = useCallback(() => setCamera(false), []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    validar({ code });
  }

  function lido(l: LeituraQr) {
    setCamera(false);
    if ("code" in l) setCode(l.code);
    validar(l);
  }

  function validar(entrada: { code: string } | { token: string }) {
    setMsg(null);
    start(async () => {
      const res = await checkIn(entrada);
      if (res.ok) {
        // Aviso flutuante: a revalidação da agenda remontaria este card
        // e apagaria a confirmação bem na hora em que o barbeiro lê.
        // Assinante sem plano ativo é o aviso que mais importa (cobrar
        // avulso): fica em âmbar até o barbeiro fechar, em vez de sumir
        // em 4,5 s no meio do atendimento.
        if (res.semPlano) toast(res.message ?? "Check-in confirmado.", "erro", 0);
        else toast(res.message ?? "Check-in confirmado.", "ok");
        setCode("");
        setMsg(null);
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="label flex items-center gap-2 text-electric">
        <QrCode className="h-3.5 w-3.5" />
        Check-in do cliente
      </div>
      <p className="mt-2 text-xs leading-relaxed text-steel-400">
        Leia o QR do cliente com a câmera ou digite o código de 6 letras que
        aparece no app dele.
      </p>
      <button
        type="button"
        onClick={() => {
          setMsg(null);
          setCamera(true);
        }}
        disabled={pending}
        className="btn-royal label mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-white disabled:opacity-40"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        Ler QR com a câmera
      </button>
      <p className="mt-3 text-center text-[11px] uppercase tracking-[0.2em] text-steel-400/70">ou digite o código</p>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="Ex.: K7QM2P"
          aria-label="Código de check-in"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-display tracking-[0.2em] text-white outline-none transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-steel-400/60 focus:border-electric/60"
        />
        <button
          type="submit"
          disabled={pending || code.length < 4}
          className="label inline-flex flex-none items-center gap-1.5 rounded-xl border border-electric/40 bg-electric/10 px-4 text-electric disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
        </button>
      </form>
      {msg && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-sm text-amber-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          {msg.text}
        </p>
      )}
      {camera && <LerQr onLer={lido} onFechar={fecharCamera} />}
    </div>
  );
}
