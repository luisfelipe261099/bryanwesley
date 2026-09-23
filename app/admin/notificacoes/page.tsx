import { notificationStats, recentNotifications } from "@/lib/notifications";
import { isWhatsappConfigured, provedorAtivo } from "@/lib/providers/whatsapp";
import { wahaConfigurado, wahaStatus } from "@/lib/providers/waha";
import { iaConfigurada, MODELO_PADRAO } from "@/lib/whatsapp-ia";
import { conversasPausadas } from "@/lib/whatsapp-bot";
import { formatPhone } from "@/lib/phone";
import { estadoDaPonte, painelAberto, PONTE_SILENCIO_MS } from "@/lib/ponte";
import {
  utcToShopParts,
  formatShopTime,
  labelDayMonth,
  labelAgo,
} from "@/lib/time";
import { lastDispatchAt } from "@/lib/dispatch";
import { NotificacoesPanel } from "./NotificacoesPanel";
import { LinkDoWhatsapp } from "./LinkDoWhatsapp";
import { ConexaoWhatsapp } from "./ConexaoWhatsapp";
import { listServices } from "@/lib/queries";
import { getSettings } from "@/lib/schedule";
import { publicBaseUrl } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default async function AdminNotificacoes() {
  const webhookWaha = `${publicBaseUrl()}/api/whatsapp/waha`;
  const [stats, rows, ultima, servicos, settings, pausadas, statusWaha, ponte] = await Promise.all([
    notificationStats(),
    recentNotifications(40),
    lastDispatchAt(),
    listServices(),
    getSettings(),
    conversasPausadas(),
    // Só pergunta ao WAHA quando ele está configurado: sem isso, a tela
    // esperaria um servidor que não existe.
    wahaConfigurado() ? wahaStatus(webhookWaha) : Promise.resolve(null),
    estadoDaPonte(),
  ]);

  // Instalado pela ponte: com o painel aberto, o servidor dá sinal a cada
  // 3 segundos (QR code fresco, "Conectado" na hora).
  const pelaPonte = !process.env.WHATSAPP_PROVIDER && Boolean(ponte?.segredoHash);
  if (pelaPonte) await painelAberto();
  const foraDoAr =
    pelaPonte &&
    Boolean(ponte?.pareadaEm) &&
    Date.now() - (ponte?.vistoEm ?? ponte!.pareadaEm!).getTime() > PONTE_SILENCIO_MS;

  // Cada jeito de ligar o WhatsApp precisa das suas variáveis; sem elas a
  // rota correspondente recusa tudo, de propósito.
  const faltaWaha = [
    process.env.WAHA_URL ? null : "WAHA_URL",
    process.env.WAHA_API_KEY ? null : "WAHA_API_KEY",
    process.env.WAHA_HMAC_KEY ? null : "WAHA_HMAC_KEY",
  ].filter((x): x is string => x !== null);
  const faltaMeta = [
    process.env.WHATSAPP_TOKEN ? null : "WHATSAPP_TOKEN",
    process.env.WHATSAPP_PHONE_NUMBER_ID ? null : "WHATSAPP_PHONE_NUMBER_ID",
    process.env.WHATSAPP_VERIFY_TOKEN ? null : "WHATSAPP_VERIFY_TOKEN",
    process.env.WHATSAPP_APP_SECRET ? null : "WHATSAPP_APP_SECRET",
  ].filter((x): x is string => x !== null);

  return (
    <div className="space-y-5">
      <ConexaoWhatsapp
        provedor={pelaPonte ? "ponte" : provedorAtivo()}
        ponte={{
          status: ponte?.status ?? null,
          numero: ponte?.numero ?? null,
          nome: ponte?.nome ?? null,
          qr: ponte?.qr ?? null,
          codigoWhatsapp: ponte?.codigoWhatsapp ?? null,
          vistoHa: ponte?.vistoEm ? labelAgo(ponte.vistoEm) : null,
          foraDoAr,
        }}
        waha={{
          falta: faltaWaha,
          status: statusWaha?.status ?? null,
          numero: statusWaha?.numero ?? null,
          nome: statusWaha?.nome ?? null,
          webhookCerto: statusWaha?.webhookCerto ?? null,
          erro: statusWaha?.erro ?? null,
        }}
        meta={{ falta: faltaMeta }}
        ia={{ ligada: iaConfigurada(), modelo: process.env.GEMINI_MODEL || MODELO_PADRAO }}
        pausadas={pausadas.map((c) => ({
          phone: c.phone,
          rotulo: formatPhone(c.phone),
          ate: c.ate ? formatShopTime(c.ate) : "—",
        }))}
      />
      <LinkDoWhatsapp
        base={publicBaseUrl()}
        shopName={settings.shopName}
        servicos={servicos.map((s) => ({ slug: s.slug, name: s.name }))}
      />
      <NotificacoesPanel
        configured={isWhatsappConfigured() || pelaPonte}
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
