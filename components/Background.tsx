// Fundo do sistema: neutro #0B0E14 (o fundo do body) com um halo elétrico
// bem sutil no topo.
//
// Era uma camada FIXA da tela inteira com a malha pontilhada (gradiente
// repetido a cada 28px, em 4,5% de opacidade) e o halo por cima. No tablet
// Android do salão, essa camada fixa e transparente atrás de uma página
// longa (a aba Salão, que ainda se atualiza sozinha a cada minuto) fazia a
// tela "chuviscar" em faixas. Agora o halo rola com a página e a malha saiu:
// quase não muda o visual e não sobra camada fixa para a placa de vídeo.
export function Background() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(30,184,255,0.13),transparent_70%)]"
    />
  );
}
