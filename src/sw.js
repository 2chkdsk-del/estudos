// sw.js — Service Worker do "Diário Oficial da Aprovação"
//
//  - precacheAndRoute: pré-cacheia TODOS os arquivos do build (JS, CSS, HTML, ícones), então o
//    app abre offline mesmo na primeira vez sem rede (depois de instalado).
//  - Libs do Anki (JSZip, sql.js, fzstd) vêm de CDN: ficam em cache depois do primeiro uso.
//  - Fontes do Google: ficam em cache depois da primeira visita (sem elas, o app usa fontes do sistema).
//  - notificationclick: tocar na notificação do Pomodoro traz o app para a frente.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Lista de arquivos injetada pelo vite-plugin-pwa no build
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const DAY = 60 * 60 * 24;

// Libs do Anki (carregadas só no importar/exportar)
registerRoute(
  ({ url }) => url.origin === "https://cdnjs.cloudflare.com" || url.origin === "https://cdn.jsdelivr.net",
  new CacheFirst({
    cacheName: "anki-libs",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 90 * DAY }),
    ],
  })
);

// Fontes do Google (CSS + arquivos)
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: "google-fonts-css",
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "google-fonts-files",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * DAY }),
    ],
  })
);

// Atualiza sem esperar o usuário fechar todas as abas
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    // apaga os caches da versão anterior do service worker (sem Workbox)
    Promise.all(["plano-estudos-v1", "plano-estudos-v2"].map((k) => caches.delete(k))).then(() => self.clients.claim())
  );
});

// Tocar na notificação do Pomodoro traz o app para a frente
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    })
  );
});
