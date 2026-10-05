// Valores de partida. A identidade real fica em `settings` e é editada
// no painel (Admin → Ajustes → Dados da barbearia).
//
// Telefone, endereço e Instagram NÃO têm valor de exemplo: um número
// inventado no rodapé do site em produção mandava o cliente ligar (ou
// chamar no WhatsApp) para ninguém. Enquanto o dono não preencher, a
// linha simplesmente não aparece.
export const shop = {
  name: "Bryan Wesley",
  legalName: "Bryan Wesley Barbearia",
  unit: "Unidade Cajuru",
  instagram: "",
  phone: "",
  address: "",
  hoursLabel: "Ter — Sáb · 09h às 20h",
  closedLabel: "Seg e Dom · Fechado",
};

/** Endereço do perfil no Instagram a partir do que o dono digitou ("@perfil", "perfil" ou a URL). */
export function instagramUrl(handle: string) {
  const h = handle.trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) return h;
  const user = h.replace(/^@/, "").replace(/^(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
  return user && /^[A-Za-z0-9._]+$/.test(user) ? `https://instagram.com/${user}` : null;
}

/** Link de WhatsApp para o telefone da barbearia, quando há um telefone válido. */
export function whatsappDaLoja(phone: string) {
  const digitos = phone.replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.startsWith("55") ? digitos : `55${digitos}`}`;
}

/** Mescla os padrões com o que o admin salvou. */
export function shopFrom(settings?: {
  shopName?: string | null;
  shopUnit?: string | null;
  shopPhone?: string | null;
  shopAddress?: string | null;
  shopInstagram?: string | null;
  shopHoursLabel?: string | null;
}) {
  return {
    ...shop,
    legalName: settings?.shopName || shop.legalName,
    unit: settings?.shopUnit || shop.unit,
    phone: settings?.shopPhone || shop.phone,
    address: settings?.shopAddress || shop.address,
    instagram: settings?.shopInstagram || shop.instagram,
    hoursLabel: settings?.shopHoursLabel || shop.hoursLabel,
  };
}
