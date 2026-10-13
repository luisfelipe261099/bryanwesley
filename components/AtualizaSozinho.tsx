"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// De quanto em quanto tempo a tela busca a agenda de novo.
const INTERVALO_MS = 60_000;
// Toque ou tecla há menos que isso: a pessoa está no meio de uma ação.
const MEXENDO_MS = 4_000;
// Campo com digitação recente segura a atualização por este tempo.
const DIGITANDO_MS = 15_000;

/**
 * Recarrega os dados da página (sem recarregar a página) enquanto ela
 * está à vista: o horário que o cliente marcou pelo site aparece sozinho
 * no painel do balcão. O "Em tempo real" do painel prometia isso e a
 * lista só mudava ao recarregar.
 *
 * Não atualiza no meio de uma ação: com o menu "⋯" ou uma confirmação
 * aberta (marcados com data-ocupado), com uma janela aberta, logo depois
 * de um toque ou enquanto alguém digita. Trocar a lista debaixo do dedo
 * fazia o toque cair na linha de baixo.
 */
export function AtualizaSozinho() {
  const router = useRouter();
  useEffect(() => {
    let ultimoToque = 0;
    let ultimaDigitacao = 0;
    const tocou = () => {
      ultimoToque = Date.now();
    };
    const digitou = () => {
      ultimaDigitacao = Date.now();
    };
    document.addEventListener("pointerdown", tocou, { capture: true, passive: true });
    document.addEventListener("keydown", tocou, { capture: true, passive: true });
    document.addEventListener("input", digitou, { capture: true, passive: true });

    const ocupado = () => {
      const agora = Date.now();
      if (agora - ultimoToque < MEXENDO_MS) return true;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && agora - ultimaDigitacao < DIGITANDO_MS) return true;
      return Boolean(document.querySelector('[role="dialog"], [data-ocupado]'));
    };
    const atualizar = () => {
      if (document.visibilityState === "hidden" || ocupado()) return;
      router.refresh();
    };
    const timer = setInterval(atualizar, INTERVALO_MS);
    // Aba que volta do segundo plano já mostra o que mudou.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
      document.removeEventListener("pointerdown", tocou, { capture: true });
      document.removeEventListener("keydown", tocou, { capture: true });
      document.removeEventListener("input", digitou, { capture: true });
    };
  }, [router]);
  return null;
}
