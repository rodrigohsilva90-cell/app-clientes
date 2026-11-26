// ============================================================
// SERVICE WORKER - PWA, CACHE OFFLINE & SAME-ORIGIN SECURITY
// ============================================================

const CACHE_VERSION = 'v60';
const CACHE_NAME = `gestao-clientes-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './firebase-config.js',
  './utils.js',
  './smart-paste.js',
  './clients.js',
  './admin.js',
  './auth.js',
  './app.js',
  './ai-config.js',
  './ai-report.js',
  './whatsnew.js',
  './push.js',
  './support-report.js',
  './app-groups.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // SDK do Firebase (CDN): guarda uma cópia para o app abrir offline
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0 && req.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => { cache.put(req, res.clone()); return res; }))
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (req.method !== 'GET') {
    return;
  }

  // Portal do assinante tem token na URL: nunca guardar em cache
  if (url.pathname.endsWith('/portal.html') || url.pathname.endsWith('/portal-config.js')) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req, { ignoreSearch: true });
      })
  );
});

// ============================================================
// NOTIFICAÇÕES (resumo do dia e pedidos de ajuda do portal)
// ============================================================
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'GestãoPro', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const alvo = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          // App já aberto: avisa qual ação a notificação pede (ex.: abrir a fila de cobrança)
          c.postMessage({ tipo: 'notificacao', url: alvo });
          return c.focus();
        }
      }
      return self.clients.openWindow(alvo);
    })
  );
});
