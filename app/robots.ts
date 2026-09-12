import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/qr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/planos", "/agendar", "/entrar", "/privacidade"] },
      {
        userAgent: "*",
        // "/agendar/confirmado" carrega o token do check-in na URL: se o
        // cliente compartilhar o link, ele não pode acabar num índice de busca.
        disallow: [
          "/admin",
          "/barbeiro",
          "/cliente",
          "/conta",
          "/api",
          "/agendar/confirmado",
        ],
      },
    ],
    sitemap: `${publicBaseUrl()}/sitemap.xml`,
  };
}
