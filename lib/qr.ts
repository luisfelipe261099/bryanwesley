import QRCode from "qrcode";

/** SVG do QR de check-in, gerado no servidor. */
export async function checkinQrSvg(baseUrl: string, token: string) {
  return QRCode.toString(`${baseUrl}/barbeiro/checkin/${token}`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0B0E14", light: "#FFFFFF" },
  });
}

/** URL pública do site, para montar o link dentro do QR. */
export function publicBaseUrl() {
  // Sem a barra do fim: "https://dominio/" + "/api/…" dava "//", e o Next
  // responde redirect — webhook não segue redirect em POST.
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
