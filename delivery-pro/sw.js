const CACHE_NAME = 'delivery-pro-v20';
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
  '/js/fotos.js'
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
