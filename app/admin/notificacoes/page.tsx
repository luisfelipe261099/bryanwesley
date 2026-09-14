import { notificationStats, recentNotifications } from "@/lib/notifications";
import { isWhatsappConfigured } from "@/lib/providers/whatsapp";
import { utcToShopParts, formatShopTime, labelDayMonth, labelAgo } from "@/lib/time";
import { lastDispatchAt } from "@/lib/dispatch";
import { NotificacoesPanel } from "./NotificacoesPanel";

export const dynamic = "force-dynamic";

export default async function AdminNotificacoes() {
  const [stats, rows, ultima] = await Promise.all([
    notificationStats(),
    recentNotifications(40),
    lastDispatchAt(),
  ]);

  return (
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
          utcToShopParts(n.scheduledFor).dateKey
        )} ${formatShopTime(n.scheduledFor)}`,
      }))}
    />
  );
}
