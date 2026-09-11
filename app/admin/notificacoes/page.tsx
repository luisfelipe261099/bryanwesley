import { notificationStats, recentNotifications } from "@/lib/notifications";
import { isWhatsappConfigured } from "@/lib/providers/whatsapp";
import { utcToShopParts, formatShopTime, labelDayMonth } from "@/lib/time";
import { NotificacoesPanel } from "./NotificacoesPanel";

export const dynamic = "force-dynamic";

export default async function AdminNotificacoes() {
  const [stats, rows] = await Promise.all([
    notificationStats(),
    recentNotifications(40),
  ]);

  return (
    <NotificacoesPanel
      configured={isWhatsappConfigured()}
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
          utcToShopParts(n.scheduledFor).dateKey
        )} ${formatShopTime(n.scheduledFor)}`,
      }))}
    />
  );
}
