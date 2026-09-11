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
    ],
  };
}
