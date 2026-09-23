import { notificationStats, recentNotifications } from "@/lib/notifications";
import { isWhatsappConfigured } from "@/lib/providers/whatsapp";
import {
  utcToShopParts,
  formatShopTime,
  labelDayMonth,
  labelAgo,
} from "@/lib/time";
import { lastDispatchAt } from "@/lib/dispatch";
import { NotificacoesPanel } from "./NotificacoesPanel";
import { LinkDoWhatsapp } from "./LinkDoWhatsapp";
import { listServices } from "@/lib/queries";
import { getSettings } from "@/lib/schedule";
import { publicBaseUrl } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function AdminNotificacoes() {
  const [stats, rows, ultima, servicos, settings] = await Promise.all([
    notificationStats(),
    recentNotifications(40),
    lastDispatchAt(),
    listServices(),
    getSettings(),
  ]);

  // O auto-atendente precisa das três variáveis: sem elas a rota do
  // webhook recusa tudo, de propósito.
  const falta = [
    process.env.WHATSAPP_TOKEN ? null : "WHATSAPP_TOKEN",
    process.env.WHATSAPP_PHONE_NUMBER_ID ? null : "WHATSAPP_PHONE_NUMBER_ID",
    process.env.WHATSAPP_VERIFY_TOKEN ? null : "WHATSAPP_VERIFY_TOKEN",
    process.env.WHATSAPP_APP_SECRET ? null : "WHATSAPP_APP_SECRET",
  ].filter((x): x is string => x !== null);

  return (
    <div className="space-y-5">
      <LinkDoWhatsapp
        base={publicBaseUrl()}
        shopName={settings.shopName}
        servicos={servicos.map((s) => ({ slug: s.slug, name: s.name }))}
        autoAtendente={{ ligado: falta.length === 0, falta }}
      />
      <NotificacoesPanel
        configured={isWhatsappConfigured()}
        ultimaVerificacao={ultima ? labelAgo(ultima) : null}
        stats={stats}
        rows={rows.map((n) => ({
          id: n.id,
          phone: n.phone,
          kind: n.kind,
          status: n.status,
          body: n.body,
          error: n.error,
          attempts: n.attempts,
          quando: `${labelDayMonth(
            utcToShopParts(n.scheduledFor).dateKey,
          )} ${formatShopTime(n.scheduledFor)}`,
        }))}
      />
    </div>
  );
}
