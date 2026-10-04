"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/app/entrar/actions";
import { CHAVE_DONO } from "./AvisosPush";

/**
 * Sair também tira este aparelho dos avisos da conta: num celular
 * emprestado ou no tablet do balcão, quem saiu não pode continuar
 * recebendo "Novo agendamento". O endereço do aparelho vai no próprio
 * formulário, e a ação de sair o remove antes de apagar a sessão — sem
 * corrida entre dois pedidos. A inscrição do navegador fica: quem entrar
 * depois liga de novo com um toque, e aí o aparelho é dele.
 */
export function BotaoSair() {
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let vivo = true;
    navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (vivo && sub) setEndpoint(sub.endpoint);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const limparAvisos = () => {
    try {
      localStorage.removeItem(CHAVE_DONO);
      sessionStorage.removeItem("avisos-push:sincronizado");
    } catch {}
  };

  return (
    <form action={logout} onSubmit={limparAvisos}>
      <input type="hidden" name="pushEndpoint" value={endpoint} />
      <button
        type="submit"
        aria-label="Sair"
        className="inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-2 text-sm font-medium text-steel-300 transition-colors hover:border-electric/40 hover:text-white sm:px-4"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Sair</span>
      </button>
    </form>
  );
}
