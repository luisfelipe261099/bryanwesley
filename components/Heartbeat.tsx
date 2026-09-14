"use client";

import { useEffect } from "react";

// A cada quantos minutos a aba aberta bate no servidor. O servidor só
// varre a fila de fato a cada 10 min (HEARTBEAT_INTERVAL_MS); as outras
// batidas custam uma consulta e voltam na hora.
const INTERVALO_MS = 5 * 60_000;

/**
 * Mantém os lembretes saindo enquanto alguém da equipe está com o
 * painel aberto — que, numa barbearia, é o dia inteiro. Não renderiza
 * nada e nunca derruba a tela: erro de rede é ignorado, a próxima
 * batida tenta de novo.
 */
export function Heartbeat() {
  useEffect(() => {
    const bater = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/notificacoes/heartbeat", {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    bater();
    const timer = setInterval(bater, INTERVALO_MS);
    // Aba que volta do segundo plano bate na hora, sem esperar o intervalo.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") bater();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);
  return null;
}
