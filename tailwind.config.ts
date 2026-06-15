import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Fundo base (quase-preto, estilo Apple dark)
        ink: {
          DEFAULT: "#0A0A0B",
          800: "#0E0E10",
          700: "#161618",
          600: "#1C1C1E",
        },
        // Superfícies SÓLIDAS elevadas (cinzas Apple)
        surface: {
          DEFAULT: "#1C1C1E", // cards
          2: "#2C2C2E", // elevado / hover
          3: "#3A3A3C", // bordas sólidas / inputs
        },
        // Texto
        steel: {
          200: "#EBEBF0",
          300: "#C7C7CC", // secundário
          400: "#98989F", // terciário
        },
        // Azul de sistema (systemBlue)
        royal: {
          DEFAULT: "#0A84FF",
          400: "#409CFF",
          500: "#0A84FF",
          600: "#0071E3",
          700: "#0058B9",
        },
        electric: "#5EAEFF", // accent claro p/ ícones e labels (bom contraste no escuro)
        gold: "#E9B872",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Sombras neutras (sem brilho colorido)
        glow: "0 12px 40px -16px rgba(0,0,0,0.8)",
        "glow-sm": "0 6px 18px -8px rgba(0,0,0,0.6)",
        card: "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px -18px rgba(0,0,0,0.8)",
        blue: "0 8px 24px -10px rgba(10,132,255,0.55)",
      },
      backgroundImage: {
        // Azul quase-sólido com leve profundidade (não um gradiente chamativo)
        "royal-grad": "linear-gradient(180deg, #2B9BFF 0%, #0A84FF 100%)",
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
