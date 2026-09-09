"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Loader2, QrCode } from "lucide-react";
import { checkIn } from "./actions";

/**
 * Validação de chegada. O barbeiro aponta a câmera (o QR abre a rota
 * /barbeiro/checkin/<token>) ou digita o código curto aqui.
 */
export function CheckinBox() {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setMsg(null);
    start(async () => {
      const res = await checkIn({ code });
      setMsg(
        res.ok
          ? { ok: true, text: res.message ?? "Check-in confirmado." }
          : { ok: false, text: res.error }
      );
      if (res.ok) setCode("");
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
      <form onSubmit={submit} className="mt-3 flex gap-2">
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
          className="btn-royal label inline-flex flex-none items-center gap-1.5 rounded-xl px-4 text-white disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
        </button>
      </form>
      {msg && (
        <p
          role="status"
          className={`mt-3 flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm ${
            msg.ok
              ? "border border-neon/30 bg-neon/10 text-neon"
              : "border border-amber-400/30 bg-amber-400/10 text-amber-200"
          }`}
        >
          {msg.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          )}
          {msg.text}
        </p>
      )}
    </div>
  );
}
