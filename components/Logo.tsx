import { shop } from "@/lib/shop";

// Emblema da marca: hexágono cheio com o monograma BW vazado.
//
// É o mesmo desenho do ícone do app (app/icon.svg, public/icon-*.png), para
// a barbearia ter uma marca só na tela inicial do celular, na aba do
// navegador e no topo do site. As letras são o Space Grotesk Bold — a
// mesma fonte dos títulos — já convertido em contorno, então não depende
// de fonte instalada em lugar nenhum.
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient
          id="bw-el"
          x1="120"
          y1="104"
          x2="400"
          y2="416"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#9DF9FF" />
          <stop offset=".38" stopColor="#22D7FF" />
          <stop offset="1" stopColor="#2F62FF" />
        </linearGradient>
        {/* Luz de cima: dá volume ao emblema sem pesar no arquivo. */}
        <linearGradient
          id="bw-brilho"
          x1="256"
          y1="88"
          x2="256"
          y2="424"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" stopOpacity=".45" />
          <stop offset=".45" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M256 88 404 173 404 339 256 424 108 339 108 173Z"
        fill="url(#bw-el)"
        stroke="url(#bw-el)"
        strokeWidth="18"
        strokeLinejoin="round"
      />
      <path
        d="M256 88 404 173 404 339 256 424 108 339 108 173Z"
        fill="none"
        stroke="url(#bw-brilho)"
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <g transform="translate(134.27 313.00) scale(0.7714)">
        <path d="M82 0L9.200 0L9.200-23.200L27.600-23.200L27.600-116.800L9.200-116.800L9.200-140L81.200-140Q94-140 103.500-135.700Q113-131.400 118.300-123.500Q123.600-115.600 123.600-104.600L123.600-102.600Q123.600-93 120-86.900Q116.400-80.800 111.500-77.500Q106.600-74.200 102.200-72.800L102.200-69.200Q106.600-68 111.800-64.700Q117-61.400 120.700-55.200Q124.400-49 124.400-39L124.400-37Q124.400-25.400 119-17.100Q113.600-8.800 104.100-4.400Q94.600 0 82 0M54-58.400L54-24L78.800-24Q87.400-24 92.700-28.200Q98-32.400 98-40.200L98-42.200Q98-50 92.800-54.200Q87.600-58.400 78.800-58.400L54-58.400M54-116L54-82.400L78.400-82.400Q86.600-82.400 91.900-86.600Q97.200-90.800 97.200-98.200L97.200-100.200Q97.200-107.800 92-111.900Q86.800-116 78.400-116L54-116M202.800 0L157.200 0L138.800-140L165-140L178.600-18.400L182.200-18.400L199.800-140L245.400-140L263-18.400L266.600-18.400L280.200-140L306.400-140L288 0L242.400 0L224.400-124.400L220.800-124.400" fill="#0B0E14" />
      </g>
    </svg>
  );
}

export function Logo({
  className = "",
  compact = false,
  subtitle = shop.unit,
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
