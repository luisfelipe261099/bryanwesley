"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";
import { salvarMeuEmail } from "./actions";
import { toast } from "@/lib/toast";

/** E-mail da conta: é por ele que chega o link quando a senha é esquecida. */
export function MeuEmail({ atual }: { atual: string | null }) {
  const [email, setEmail] = useState(atual ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="mt-5 border-t border-white/8 pt-5">
      <label className="block">
        <span className="label mb-2 flex items-center gap-1.5 text-steel-400">
          <Mail className="h-3.5 w-3.5" /> E-mail (para recuperar a senha)
        </span>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            autoComplete="email"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none placeholder:text-steel-400/60 focus:border-electric/60"
          />
          <button
            type="button"
            disabled={pending || email.trim() === (atual ?? "")}
            onClick={() =>
              start(async () => {
                const r = await salvarMeuEmail(email);
                toast(r.ok ? "E-mail salvo." : r.error, r.ok ? "ok" : "erro");
              })
            }
            className="btn-royal label inline-flex flex-none items-center gap-1.5 rounded-xl px-4 text-white disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </label>
      {!atual && (
        <p className="mt-2 text-xs text-amber-200">
          Cadastre seu e-mail: se esquecer a senha, o link para criar outra chega nele na hora.
        </p>
      )}
    </div>
  );
}
