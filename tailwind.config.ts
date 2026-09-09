import type { Config } from "tailwindcss";

// ───────────────────────────────────────────────────────────
// Design system: "Modern Electric Precision"
// Primary  #1EB8FF · Secondary #2979FF · Tertiary #00E5FF
// Neutral  #0B0E14
// Headline/Label: Space Grotesk · Body: Plus Jakarta Sans
// ───────────────────────────────────────────────────────────
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutro base — azul-petróleo quase preto
        ink: {
          DEFAULT: "#0B0E14",
          800: "#0E121A",
          700: "#141922",
          600: "#1A202B",
        },
        // Superfícies elevadas (cards, inputs, bordas sólidas)
        surface: {
          DEFAULT: "#131823",
          2: "#1A2130",
          3: "#252E3F",
        },
        // Texto
        steel: {
          200: "#E6EAF2",
          300: "#A9B4C7", // secundário
          400: "#6F7C93", // terciário
        },
        // Secondary — azul profundo (ações sólidas, gradiente)
        royal: {
          DEFAULT: "#2979FF",
          400: "#5B96FF",
          500: "#2979FF",
          600: "#1E63E0",
          700: "#1749A8",
        },
        // Primary — azul elétrico (destaques, ícones, links)
        electric: {
          DEFAULT: "#1EB8FF",
          soft: "#7BD3FF",
          deep: "#0E93D6",
        },
        // Tertiary — ciano (acento pontual: VIP, métricas positivas)
        neon: {
          DEFAULT: "#00E5FF",
          soft: "#6FF1FF",
        },
        gold: "#E9B872",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 16px 48px -20px rgba(30,184,255,0.45)",
        "glow-sm": "0 8px 22px -10px rgba(30,184,255,0.4)",
        card: "0 1px 2px rgba(0,0,0,0.5), 0 12px 34px -20px rgba(0,0,0,0.9)",
        blue: "0 10px 28px -12px rgba(41,121,255,0.6)",
      },
      backgroundImage: {
        // Primary → Secondary, o gradiente-assinatura do sistema
        "royal-grad": "linear-gradient(135deg, #1EB8FF 0%, #2979FF 100%)",
        // Tertiary → Primary, para o acento VIP
        "neon-grad": "linear-gradient(135deg, #00E5FF 0%, #1EB8FF 100%)",
        // Malha pontilhada discreta (fundo de seções em destaque)
        "grid-faint":
          "radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)",
      },
      borderRadius: {
        "2xl": "1.1rem",
        "3xl": "1.5rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
