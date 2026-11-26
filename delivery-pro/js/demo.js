// Simulador de rota ao vivo (/demo) — SÓ PARA A CONTA MASTER (vendas presenciais).
// Mostra ao lojista, na frente dele, a tela que o cliente vê, com uma moto virtual andando
// pelas ruas reais até onde o vendedor está. Não cria pedido nenhum.
// ?loja=slug usa o endereço e o nome dessa loja como ponto de saída.
import { db, auth, esc } from './config.js';
import { criarMapaRastreamento, criarMarcadorMoto, calcularDistanciaMetros } from './geo.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const PADRAO = { lat: -23.5505, lng: -46.6333 }; // centro de São Paulo, se não houver GPS
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function lojaDaUrl() {
  const slug = new URLSearchParams(window.location.search).get('loja');
  if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  try {
    const s = await getDoc(doc(db, 'slugs', slug));
    if (!s.exists()) return null;
    const l = await getDoc(doc(db, 'lojas', s.data().lojaId));
    return l.exists() ? { slug, ...l.data() } : null;
  } catch (_) { return null; }
}

function minhaPosicao() {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// Ponto a ~1,5 km na direção indicada (para a "loja" quando não há loja real)
function deslocar(p, metros, graus) {
  const r = (graus * Math.PI) / 180;
  return { lat: p.lat + (metros * Math.cos(r)) / 111320, lng: p.lng + (metros * Math.sin(r)) / (111320 * Math.cos((p.lat * Math.PI) / 180)) };
}

// Rota pelas ruas (OSRM / OpenStreetMap, gratuito). Se falhar, segue em linha reta.
async function rotaPelasRuas(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const d = await r.json();
    const pts = d.routes && d.routes[0] && d.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    if (pts && pts.length > 1) return pts;
  } catch (_) {}
  return Array.from({ length: 30 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / 29, lng: a.lng + ((b.lng - a.lng) * i) / 29 }));
}

// Divide a rota em ~N pontos com distâncias iguais (a moto anda num ritmo constante)
function pontosNoCaminho(rota, n) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < rota.length; i++) {
    const d = calcularDistanciaMetros(rota[i - 1].lat, rota[i - 1].lng, rota[i].lat, rota[i].lng);
    seg.push(d); total += d;
  }
  const saida = [rota[0]];
  for (let k = 1; k <= n; k++) {
    let alvo = (total * k) / n;
    let i = 0;
    while (i < seg.length && alvo > seg[i]) { alvo -= seg[i]; i++; }
    if (i >= seg.length) { saida.push(rota[rota.length - 1]); continue; }
    const f = seg[i] ? alvo / seg[i] : 0;
    saida.push({ lat: rota[i].lat + (rota[i + 1].lat - rota[i].lat) * f, lng: rota[i].lng + (rota[i + 1].lng - rota[i].lng) * f });
  }
  return { pontos: saida, totalMetros: total };
}

const ETAPAS = [
  { id: 'novo', icone: '📝', titulo: 'Pedido recebido', texto: 'Aguardando a loja confirmar.' },
  { id: 'preparo', icone: '🔥', titulo: 'Em preparo', texto: 'A loja está preparando seu pedido.' },
  { id: 'entrega', icone: '🛵', titulo: 'Saiu para entrega', texto: 'O entregador está a caminho.' },
  { id: 'concluido', icone: '✅', titulo: 'Entregue', texto: 'Bom apetite!' }
];

function desenharEtapas(atual) {
  const i = ETAPAS.findIndex(e => e.id === atual);
  return ETAPAS.map((e, k) => {
    const feita = k < i, agora = k === i, cor = feita || agora ? 'var(--primary)' : 'var(--border)';
    return `<div style="display:flex; gap:12px; align-items:flex-start; padding:8px 0; opacity:${feita || agora ? 1 : 0.5};">
      <div style="width:36px; height:36px; border-radius:50%; border:3px solid ${cor}; display:flex; align-items:center; justify-content:center; flex-shrink:0; ${agora ? 'background:var(--primary);' : ''}">${feita ? '✔' : e.icone}</div>
      <div><strong style="${agora ? 'color:var(--primary);' : ''}">${e.titulo}</strong>${agora ? `<div style="font-size:14px; color:var(--text-muted);">${e.texto}</div>` : ''}</div></div>`;
  }).join('');
}

// Confere no servidor se quem está logado é o Master
async function ehMaster() {
  try {
    if (auth.authStateReady) await auth.authStateReady();
    const u = auth.currentUser;
    if (!u) return false;
    const r = await fetch('/api/master', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ acao: 'eu' }) });
    return r.ok;
  } catch (_) { return false; }
}

export async function iniciarDemo(root) {
  root.innerHTML = '<div class="card"><p>Carregando...</p></div>';
  if (!(await ehMaster())) {
    root.innerHTML = '<div class="card"><h3>🔒 Acesso restrito</h3><p>O simulador de rota é exclusivo da conta Master. Entre pelo botão "Entrar" no topo.</p></div>';
    return;
  }
  const loja = await lojaDaUrl();
  const nomeLoja = loja ? loja.nome : 'Pizzaria Demonstração';
  root.innerHTML = `
    <div class="card demo-topo">
      <span class="badge">🎬 DEMONSTRAÇÃO</span>
      <h2>Rastreamento ao vivo</h2>
      <p class="gc-dica">Isto é exatamente o que o cliente vê no celular depois de pedir. A moto é virtual e anda pelas ruas reais até <strong>onde você está agora</strong>. Nenhum pedido de verdade é criado.</p>
      <button class="btn-primary" type="button" id="demo-iniciar">▶ Iniciar simulação</button>
    </div>
    <div class="card" id="demo-status" style="display:none;"></div>
    <div class="card hidden acomp-chegando" id="demo-chegando">🏁 <strong>O entregador está chegando ao seu endereço!</strong><span>Fique de olho no portão ou no interfone.</span></div>
    <div class="card" id="demo-mapa-card" style="display:none;">
      <strong>🛵 Entregador a caminho</strong> <span class="demo-eta" id="demo-eta"></span>
      <div id="demo-mapa" style="height:300px; border-radius:8px; margin-top:10px; z-index:1;"></div>
    </div>
    <div class="card hidden" id="demo-final"></div>`;

  const btn = root.querySelector('#demo-iniciar');
  let rodando = false;
  btn.onclick = async () => {
    if (rodando) return;
    rodando = true;
    btn.disabled = true;
    btn.textContent = '📍 Pegando sua localização...';
    const destino = (await minhaPosicao()) || PADRAO;
    const origem = loja && loja.localizacao && Number.isFinite(loja.localizacao.lat)
      ? loja.localizacao
      : deslocar(destino, 1500, Math.floor(Math.random() * 360));
    btn.textContent = '🔁 Simulação em andamento...';

    const status = root.querySelector('#demo-status');
    const mapaCard = root.querySelector('#demo-mapa-card');
    const chegando = root.querySelector('#demo-chegando');
    const final = root.querySelector('#demo-final');
    chegando.classList.add('hidden'); final.classList.add('hidden'); mapaCard.style.display = 'none';
    status.style.display = '';
    const etapa = (id) => { status.innerHTML = `<h2>Pedido #${Math.floor(100 + Math.random() * 900)} · ${esc(nomeLoja)}</h2><p style="color:var(--text-muted); font-size:14px; margin:4px 0 14px;">Esta tela atualiza sozinha. Pode deixar aberta.</p>${desenharEtapas(id)}`; };

    etapa('novo'); await espera(2500);
    etapa('preparo'); await espera(3500);

    const rota = await rotaPelasRuas(origem, destino);
    const { pontos, totalMetros } = pontosNoCaminho(rota, 45); // ~45 passos de 1 s
    etapa('entrega');
    mapaCard.style.display = '';
    const divMapa = root.querySelector('#demo-mapa');
    divMapa.innerHTML = '';
    if (divMapa._leaflet_id) divMapa._leaflet_id = null;
    const mapa = criarMapaRastreamento('demo-mapa', pontos[0], 15);
    L.marker([destino.lat, destino.lng]).addTo(mapa).bindPopup('Seu endereço');
    L.circleMarker([origem.lat, origem.lng], { radius: 7, color: '#ea1d2c' }).addTo(mapa).bindTooltip(`🏪 ${nomeLoja}`);
    mapa.fitBounds(L.latLngBounds([origem, destino].map(p => [p.lat, p.lng])).pad(0.25));
    const moto = criarMarcadorMoto(mapa, pontos[0]);
    mapaCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const eta = root.querySelector('#demo-eta');

    for (let k = 1; k < pontos.length; k++) {
      const resta = calcularDistanciaMetros(pontos[k].lat, pontos[k].lng, destino.lat, destino.lng);
      if (resta <= 50) break; // privacidade: a 50 m o mapa some, igual ao app real
      moto.moverSuavemente(pontos[k], 1000);
      const minutos = Math.max(1, Math.round(((pontos.length - k) / pontos.length) * (totalMetros / 1000) * 3));
      eta.textContent = `· chega em ~${minutos} min`;
      if (k % 5 === 0) mapa.panTo([pontos[k].lat, pontos[k].lng]);
      await espera(1000);
    }
    mapaCard.style.display = 'none';
    chegando.classList.remove('hidden');
    await espera(4000);
    chegando.classList.add('hidden');
    etapa('concluido');
    final.classList.remove('hidden');
    final.innerHTML = `
      <strong>Como foi o seu pedido?</strong>
      <p class="gc-dica">Toque nas estrelas — leva 1 segundo.</p>
      <div class="av-estrelas grande">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}">☆</button>`).join('')}</div>
      <p class="selo-organico">Tecnologia <strong>Delivery Pro</strong> · Tem um comércio? <a href="/?ref=selo">Crie seu cardápio grátis</a></p>`;
    final.querySelectorAll('[data-n]').forEach(b => {
      b.onclick = () => final.querySelectorAll('[data-n]').forEach(x => { x.textContent = Number(x.dataset.n) <= Number(b.dataset.n) ? '★' : '☆'; });
    });
    btn.disabled = false;
    btn.textContent = '🔁 Repetir simulação';
    rodando = false;
  };
}
