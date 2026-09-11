// Valores de partida. A identidade real fica em `settings` e é editada
// no painel (Admin → Agenda → Dados da barbearia); estes só preenchem
// enquanto o campo estiver vazio.
export const shop = {
  name: "Bryan Wesley",
  legalName: "Bryan Wesley Barbearia",
  unit: "Unidade Cajuru",
  instagram: "@bryanwesley.barbearia",
  phone: "(41) 9 9999-0000",
  address: "Av. Prefeito Maurício Fruet, 1200 — Cajuru, Curitiba",
  hoursLabel: "Ter — Sáb · 09h às 20h",
  closedLabel: "Seg e Dom · Fechado",
};

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
