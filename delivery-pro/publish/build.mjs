import fs from 'fs'; import path from 'path';
const root = process.argv[2];
const files = ['index.html','sw.js','css/styles.css','js/config.js','js/router.js','js/vitrine.js','js/balcao.js','js/geo.js','js/motoboy.js','js/cardapio.js','js/acompanhar.js','js/gestao-cardapio.js','js/frete.js','js/config-entrega.js','js/turno.js','js/kds.js','js/cadastro.js','js/equipe.js','js/horario.js','js/config-horarios.js','js/config-aparencia.js','js/plano.js','js/assinatura.js','js/master.js','js/avaliacoes.js','js/fotos.js'];
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const map = {};
for (const f of files) map['/'+f] = [types[path.extname(f)], fs.readFileSync(path.join(root,f),'utf8')];
let worker = fs.readFileSync(path.join(root,'worker/index.js'),'utf8');
worker = worker.replace(
  "    // 4. Fallback para os arquivos estáticos do Cloudflare Pages\n    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Worker ativo');",
`    // 4. Arquivos estáticos do app (embutidos neste Worker pelo publish/build)
    if (url.pathname === '/manifest.webmanifest') {
      return new Response(JSON.stringify({
        name: 'Delivery Pro', short_name: 'Delivery Pro', start_url: '/', display: 'standalone',
        background_color: '#ffffff', theme_color: '#ea1d2c',
        icons: [{ src: '/icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } });
    }
    const arquivo = APP_FILES[url.pathname === '/' ? '/index.html' : url.pathname];
    if (arquivo) {
      return new Response(arquivo[1], { headers: { 'Content-Type': arquivo[0], 'Cache-Control': 'no-cache' } });
    }
    // Rotas do app (/{slug}, /{slug}/painel, /master...) abrem a casca index.html
    if (!/\\.[a-z0-9]+$/i.test(url.pathname)) {
      const casca = APP_FILES['/index.html'];
      // Página de loja: nome, descrição, foto e ícone da loja no cabeçalho (prévia do WhatsApp e app instalado)
      const slugPagina = (pathParts[0] || '').toLowerCase();
      const pub = slugPagina ? await dadosPublicosLoja(env, slugPagina, ctx) : null;
      const html = pub ? personalizarCasca(casca[1], pub, slugPagina, url) : casca[1];
      return new Response(html, { headers: { 'Content-Type': casca[0], 'Cache-Control': 'no-cache' } });
    }
    return new Response('Não encontrado', { status: 404 });`);
if (!worker.includes('APP_FILES')) throw new Error('replace falhou');
const out = `// Gerado a partir de delivery-pro/ (worker/index.js + arquivos do app). Cópia exata do Worker "delivery-pro" no ar.\nconst APP_FILES = ${JSON.stringify(map)};\n\n${worker}`;
fs.writeFileSync(path.join(root,'publish/worker.js'), out);
console.log(out.length);
