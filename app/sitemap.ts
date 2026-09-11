import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/qr";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBaseUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/planos`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/agendar`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/entrar`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacidade`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
