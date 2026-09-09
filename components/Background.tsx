// Fundo do sistema: neutro #0B0E14 com um halo elétrico bem sutil no topo
// e a malha pontilhada do design system em opacidade baixíssima.
export function Background() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 bg-ink"
    >
      <div className="absolute inset-0 bg-grid-faint bg-[size:28px_28px] opacity-[0.045]" />
      <div className="absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(30,184,255,0.13),transparent_70%)]" />
    </div>
  );
}
