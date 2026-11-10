"use client";

import { useFormState, useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { definirSenhaPeloLink, type NovaSenhaState } from "../../actions";

const campo =
  "w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3.5 text-white outline-none transition-colors placeholder:text-steel-400/60 focus:border-electric/60 focus:ring-2 focus:ring-electric/20";

function Salvar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-royal label inline-flex w-full items-center justify-center gap-2 rounded-full py-4 text-white disabled:opacity-60"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Salvar nova senha e entrar
    </button>
  );
}

export function NovaSenhaForm({ token }: { token: string }) {
  const [state, action] = useFormState<NovaSenhaState, FormData>(definirSenhaPeloLink, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="label mb-2 block text-steel-400">Nova senha</span>
        <input name="senha" type="password" required minLength={6} autoComplete="new-password" placeholder="Mínimo 6 caracteres" className={campo} />
      </label>
      <label className="block">
        <span className="label mb-2 block text-steel-400">Repita a nova senha</span>
        <input name="confirmar" type="password" required autoComplete="new-password" placeholder="••••••••" className={campo} />
      </label>
      {state?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          {state.error}
        </p>
      )}
      <Salvar />
    </form>
  );
}
