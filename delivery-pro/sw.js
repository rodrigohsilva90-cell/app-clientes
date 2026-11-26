const CACHE_NAME = 'delivery-pro-v33';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/router.js',
  '/js/vitrine.js',
  '/js/balcao.js',
  '/js/geo.js',
  '/js/motoboy.js',
  '/js/cardapio.js',
  '/js/acompanhar.js',
  '/js/gestao-cardapio.js',
  '/js/frete.js',
  '/js/config-entrega.js',
  '/js/turno.js',
  '/js/kds.js',
  '/js/cadastro.js',
  '/js/equipe.js',
  '/js/horario.js',
  '/js/config-horarios.js',
  '/js/config-aparencia.js',
  '/js/plano.js',
  '/js/assinatura.js',
  '/js/master.js',
  '/js/avaliacoes.js',
  '/js/fotos.js',
  '/js/notificar.js',
  '/js/carrinhos.js',
  '/js/push-cliente.js',
  '/js/config-pix.js',
  '/js/termos.js',
  '/js/demo.js',
  '/js/importar-cardapio.js',
  '/js/relatorios.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia Network-First para código e HTML; Cache-First apenas se offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Nunca interceptar chamadas de API, Firestore ou mapas dinâmicos
  if (url.pathname.startsWith('/api/') || url.hostname.includes('googleapis.com') || url.hostname.includes('tile.openstreetmap.org')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notificações do pedido (Web Push): mostra o aviso e abre o acompanhamento ao tocar
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { title: 'Seu pedido', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Seu pedido', {
    body: d.body || '',
    icon: d.icon || '/icone.svg',
    badge: d.icon || '/icone.svg',
    tag: d.tag || 'pedido',
    renotify: true,
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const alvo = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertas) {
      if (c.url === alvo && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(alvo);
  })());
});
