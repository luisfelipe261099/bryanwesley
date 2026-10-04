"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/entrar/actions";
import { CHAVE_DONO } from "./AvisosPush";

/**
 * Sair também tira este aparelho dos avisos da conta: num celular
 * emprestado ou no tablet do balcão, quem saiu não pode continuar
 * recebendo "Novo agendamento". A inscrição do navegador fica — quem
 * entrar depois liga de novo com um toque, e aí o aparelho é dele.
 */
export function BotaoSair() {
  const limparAvisos = () => {
    try {
      localStorage.removeItem(CHAVE_DONO);
      sessionStorage.removeItem("avisos-push:sincronizado");
    } catch {}
    if (!("serviceWorker" in navigator)) return;
    // Não espera: o pedido segue (keepalive) enquanto a página troca.
    navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        return fetch("/api/push/inscricao", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          keepalive: true,
        });
      })
      .catch(() => {});
  };
  return (
    <form action={logout} onSubmit={limparAvisos}>
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
