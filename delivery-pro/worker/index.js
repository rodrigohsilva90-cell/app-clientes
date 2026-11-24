export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // 1. CORS Preflight para chamadas da API
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // 2. Rota de Manifest PWA dinâmico por loja: /{slug}/manifest.webmanifest
    if (pathParts.length === 2 && pathParts[1] === 'manifest.webmanifest') {
      const slug = pathParts[0].toLowerCase();
      // Em produção, busca nome/cor/ícone da loja no KV ou Firestore REST
      const manifest = {
        name: `Delivery — ${slug.toUpperCase()}`,
        short_name: slug.toUpperCase(),
        start_url: `/${slug}`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ea1d2c',
        icons: [
          { src: 'https://via.placeholder.com/192', sizes: '192x192', type: 'image/png' },
          { src: 'https://via.placeholder.com/512', sizes: '512x512', type: 'image/png' }
        ]
      };
      return new Response(JSON.stringify(manifest), {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // 3. Endpoints de API Segura (Checkout, Pix, Webhooks)
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', region: 'edge', timestamp: Date.now() });
      }
      return jsonResponse({ error: 'Rota de API não encontrada' }, 404);
    }

    // 4. Fallback para os arquivos estáticos do Cloudflare Pages
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Worker ativo');
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
