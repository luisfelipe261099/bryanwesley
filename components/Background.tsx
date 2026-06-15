// Fundo sólido e limpo (estilo Apple): quase-preto com um realce
// radial bem sutil no topo. Sem grade, sem brilhos coloridos.
export function Background() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 bg-ink"
    >
      <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(10,132,255,0.10),transparent_70%)]" />
    </div>
  );
}
