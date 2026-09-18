import type { MetadataRoute } from "next";

// Instalável no celular do barbeiro e do cliente (tela cheia, ícone na home).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bryan Wesley Barbearia",
    short_name: "Bryan Wesley",
    description: "Agendamento, Clube VIP e painel da barbearia.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0E14",
    theme_color: "#0B0E14",
    lang: "pt-BR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      // iOS ignora SVG no atalho da tela inicial; Android quer PNG.
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable": o Android recorta o ícone no formato do aparelho
      // (círculo, squircle, gota). Sem uma versão com margem de sobra, o
      // emblema chegava encostado na borda e saía cortado — ou o sistema
      // encolhia o ícone dentro de um quadrado branco.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
