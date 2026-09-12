/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    // CSP restrita ao que o Next tolera sem nonce.
    // Sem 'default-src'/'script-src': o App Router injeta script inline
    // (self.__next_f.push) e style inline em cada página — barrar isso
    // quebraria a hidratação inteira. As diretivas abaixo são as que
    // valem sozinhas e não dependem de nonce.
    key: "Content-Security-Policy",
    value: [
      // Ninguém embute o site em iframe (reforça o X-Frame-Options).
      "frame-ancestors 'none'",
      // <base> injetado não consegue reescrever o destino dos links.
      "base-uri 'self'",
      // Formulário não posta para fora: corta a exfiltração clássica.
      "form-action 'self'",
      // Sem <object>/<embed>: um dos vetores antigos de XSS.
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "Permissions-Policy",
    // Câmera liberada para o próprio site: o barbeiro lê o QR pelo navegador.
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
