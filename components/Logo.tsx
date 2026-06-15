export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bw-top" x1="20" y1="0" x2="20" y2="40">
          <stop stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Ícone de app: quadrado arredondado sólido */}
      <rect x="1.5" y="1.5" width="37" height="37" rx="10.5" fill="#0A84FF" />
      <rect x="1.5" y="1.5" width="37" height="37" rx="10.5" fill="url(#bw-top)" />
      <rect
        x="1.5"
        y="1.5"
        width="37"
        height="37"
        rx="10.5"
        stroke="#ffffff"
        strokeOpacity="0.12"
      />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-sans), system-ui, sans-serif"
        fontSize="17"
        fontWeight="800"
        letterSpacing="-0.5"
        fill="#ffffff"
      >
        BW
      </text>
    </svg>
  );
}

export function Logo({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-xl tracking-wide text-white">
            BRYAN WESLEY
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.32em] text-steel-400">
            Barbearia
          </span>
        </span>
      )}
    </span>
  );
}
