import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/qr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/planos", "/agendar", "/entrar", "/privacidade"] },
      { userAgent: "*", disallow: ["/admin", "/barbeiro", "/cliente", "/conta", "/api"] },
    ],
    sitemap: `${publicBaseUrl()}/sitemap.xml`,
  };
}
