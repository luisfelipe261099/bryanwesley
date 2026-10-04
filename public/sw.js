/* ───────────────────────────────────────────────────────────
 * Service worker dos avisos no celular.
 *
 * Só faz uma coisa: recebe o aviso do serviço de push e mostra a
 * notificação — e, ao toque, abre a tela certa do site. Não guarda
 * página nenhuma em cache de propósito: o site é dinâmico, e um cache
 * aqui mostraria agenda velha.
 * ─────────────────────────────────────────────────────────── */

self.addEventListener("install", () => {
  // Versão nova assume na hora, sem esperar as abas fecharem.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { corpo: event.data ? event.data.text() : "" };
  }
  const titulo = dados.titulo || "Bryan Wesley Barbearia";
  const opcoes = {
    body: dados.corpo || "",
    icon: "/icon-192.png",
    data: { url: dados.url || "/" },
    // Avisos do mesmo horário substituem o anterior em vez de empilhar.
    tag: dados.tag || undefined,
    renotify: Boolean(dados.tag),
    timestamp: typeof dados.quando === "number" ? dados.quando : Date.now(),
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin
  );
  // Só o próprio site: um aviso nunca leva para fora.
  if (destino.origin !== self.location.origin) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((abas) => {
        // Aba do site já aberta: leva para a tela e traz para a frente.
        for (const aba of abas) {
          if (new URL(aba.url).origin === self.location.origin && "focus" in aba) {
            // navigate() recusa aba que este worker não controla: cai
            // para abrir uma nova em vez de não fazer nada.
            if ("navigate" in aba) {
              return aba
                .navigate(destino.href)
                .then((a) => (a || aba).focus())
                .catch(() => self.clients.openWindow(destino.href));
            }
            return aba.focus();
          }
        }
        return self.clients.openWindow(destino.href);
      })
  );
});

// O navegador trocou a inscrição por conta própria (acontece de tempos
// em tempos): refaz e avisa o site, senão os avisos param em silêncio.
self.addEventListener("pushsubscriptionchange", (event) => {
  const antiga = event.oldSubscription;
  const opcoes = (antiga && antiga.options) || null;
  if (!opcoes || !opcoes.applicationServerKey) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: opcoes.applicationServerKey })
      .then((nova) =>
        fetch("/api/push/inscricao", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inscricao: nova.toJSON() }),
        })
      )
      .catch(() => {})
  );
});
