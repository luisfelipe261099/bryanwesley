import { barbershop } from "@/lib/data";

// Emblema hexagonal com poste de barbeiro — traço elétrico sobre o neutro.
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bw-stroke" x1="20" y1="3" x2="20" y2="37">
          <stop stopColor="#00E5FF" />
          <stop offset="1" stopColor="#2979FF" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#131823" />
      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="11"
        stroke="url(#bw-stroke)"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      {/* Hexágono */}
      <path
        d="M20 7.5 L30 13 V27 L20 32.5 L10 27 V13 Z"
        stroke="url(#bw-stroke)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Poste de barbeiro */}
      <rect
        x="17.4"
        y="13.6"
        width="5.2"
        height="12.8"
        rx="2.6"
        stroke="#1EB8FF"
        strokeWidth="1.3"
      />
      <path
        d="M17.8 24.2 22.2 19.4M17.8 20.6 22.2 15.8"
        stroke="#00E5FF"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  compact = false,
  subtitle = barbershop.unit,
}: {
  className?: string;
  compact?: boolean;
  subtitle?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col gap-1 leading-none">
          <span className="whitespace-nowrap font-display text-[15px] uppercase tracking-[0.2em] text-white">
            Bryan Wesley
          </span>
          <span className="label whitespace-nowrap text-[9px] tracking-[0.28em] text-steel-400">
            {subtitle}
          </span>
        </span>
      )}
    </span>
  );
}
