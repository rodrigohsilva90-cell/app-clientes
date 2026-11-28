const CACHE_NAME = 'delivery-pro-v58';
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
  '/js/relatorios.js',
  '/js/clientes.js',
  '/js/tema.js',
  '/js/qr.js',
  '/js/repasse.js',
  '/js/backup.js',
  '/js/frota.js'
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

// Estratégia para abrir rápido mesmo com 4G fraco:
// - Código e estilo do app (/js, /css) e bibliotecas com versão fixa (Firebase, Leaflet): usa a cópia do aparelho na hora
//   e atualiza por trás. Cada publicação troca o CACHE_NAME, então a versão nova entra inteira de uma vez.
// - Páginas (HTML): tenta a internet por até 3 s; se demorar ou cair, abre a cópia guardada.
const ehBibliotecaVersionada = (url) =>
  (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) ||
  (url.hostname === 'unpkg.com' && /@\d+\.\d+\.\d+/.test(url.pathname)) ||
  (url.hostname === 'cdn.jsdelivr.net' && /@\d+\.\d+\.\d+/.test(url.pathname));

function guardar(request, response) {
  if (response && (response.status === 200 || response.type === 'opaque')) {
    const copia = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copia)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Nunca interceptar chamadas de API, Firestore, mapas, fotos de produtos e serviços de endereço
  if (url.pathname.startsWith('/api/') || url.hostname.includes('googleapis.com') || url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('nominatim') || url.hostname.includes('viacep')) {
    return;
  }

  const mesmoSite = url.origin === self.location.origin;

  // Bibliotecas com versão no endereço: nunca mudam, então a cópia do aparelho vale para sempre
  if (ehBibliotecaVersionada(url)) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => guardar(req, r))));
    return;
  }

  // Código e estilo do app: cópia do aparelho na hora + atualização por trás
  if (mesmoSite && (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/'))) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => cache.match(req).then((guardado) => {
        const daRede = fetch(req).then((r) => guardar(req, r)).catch(() => guardado);
        if (guardado) { event.waitUntil(daRede); return guardado; }
        return daRede;
      }))
    );
    return;
  }

  // Páginas: internet com limite de 3 s, senão a cópia guardada
  if (req.mode === 'navigate') {
    event.respondWith(new Promise((resolve) => {
      let respondeu = false;
      const usarCopia = () => caches.match(req).then((c) => c || caches.match('/index.html')).then((c) => { if (c && !respondeu) { respondeu = true; resolve(c); } });
      const t = setTimeout(usarCopia, 3000);
      fetch(req).then((r) => {
        clearTimeout(t);
        guardar(req, r);
        if (!respondeu) { respondeu = true; resolve(r); }
      }).catch(() => { clearTimeout(t); usarCopia().then(() => { if (!respondeu) { respondeu = true; resolve(Response.error()); } }); });
    }));
    return;
  }

  // Resto (ícones, manifest...): internet primeiro, cópia se estiver sem sinal
  event.respondWith(fetch(req).then((r) => (mesmoSite ? guardar(req, r) : r)).catch(() => caches.match(req)));
});
