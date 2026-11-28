// Simulador de rota ao vivo (/demo) — SÓ PARA A CONTA MASTER (vendas presenciais).
// Mostra ao lojista, na frente dele, a tela que o cliente vê, com uma moto virtual andando
// pelas ruas reais até onde o vendedor está. Não cria pedido nenhum.
// ?loja=slug usa o endereço e o nome dessa loja como ponto de saída.
import { db, auth, esc } from './config.js';
import { criarMapaRastreamento, criarMarcadorMoto, calcularDistanciaMetros, buscarRota, criarLinhaRota, trechoPorDistancia, comprimentoCaminho } from './geo.js';
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
  return (await buscarRota(a, b)) || Array.from({ length: 30 }, (_, i) => ({ lat: a.lat + ((b.lat - a.lat) * i) / 29, lng: a.lng + ((b.lng - a.lng) * i) / 29 }));
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
    <div class="card demo-frota-topo">
      <h3>👀 Visão do dono: vários motoboys ao mesmo tempo</h3>
      <p class="gc-dica">Mostra no mapa os motoboys saindo da loja, cada um com as suas entregas, e o painel do dono acompanhando tudo. Também é só demonstração.</p>
      <div class="demo-frota-campos">
        <label>Motoboys<select id="frota-qtd">${[2, 3, 4, 5, 6, 8].map(n => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Entregas por motoboy<select id="frota-entregas">${[1, 2, 3].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <button class="btn-primary" type="button" id="frota-iniciar">▶ Simular vários motoboys</button>
    </div>
    <div class="card hidden" id="frota-card">
      <div class="frota-resumo" id="frota-resumo"></div>
      <div id="frota-mapa" style="height:380px; border-radius:8px; margin:10px 0; z-index:1;"></div>
      <div id="frota-lista"></div>
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
  root.querySelector('#frota-iniciar').onclick = async (e) => {
    if (rodando) return;
    rodando = true;
    const b = e.currentTarget;
    b.disabled = true; btn.disabled = true;
    try { await simularFrota(root, loja, nomeLoja, Number(root.querySelector('#frota-qtd').value), Number(root.querySelector('#frota-entregas').value), b); }
    catch (err) { console.error(err); }
    b.disabled = false; btn.disabled = false; b.textContent = '🔁 Simular de novo';
    rodando = false;
  };
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
    const totalMetros = comprimentoCaminho(rota);
    const PASSOS = 45; // ~45 s de viagem: a cada segundo a moto anda 1/45 do caminho, POR CIMA da linha azul
    etapa('entrega');
    mapaCard.style.display = '';
    const divMapa = root.querySelector('#demo-mapa');
    divMapa.innerHTML = '';
    if (divMapa._leaflet_id) divMapa._leaflet_id = null;
    const mapa = criarMapaRastreamento('demo-mapa', rota[0], 15);
    L.marker([destino.lat, destino.lng]).addTo(mapa).bindPopup('Seu endereço');
    L.circleMarker([origem.lat, origem.lng], { radius: 7, color: '#ea1d2c' }).addTo(mapa).bindTooltip(`🏪 ${nomeLoja}`);
    mapa.fitBounds(L.latLngBounds([origem, destino].map(p => [p.lat, p.lng])).pad(0.25));
    const linha = criarLinhaRota(mapa); // linha azul do caminho que falta até o cliente
    linha.definir(rota);
    linha.atualizar(rota[0], destino);
    const moto = criarMarcadorMoto(mapa, rota[0]);
    mapaCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const eta = root.querySelector('#demo-eta');

    for (let k = 1; k <= PASSOS; k++) {
      const trecho = trechoPorDistancia(rota, (totalMetros * (k - 1)) / PASSOS, (totalMetros * k) / PASSOS);
      const chegada = trecho[trecho.length - 1];
      if (calcularDistanciaMetros(chegada.lat, chegada.lng, destino.lat, destino.lng) <= 50) break; // a 50 m o mapa some, igual ao app real
      moto.moverPeloCaminho(trecho.slice(1), 1000); // segue as curvas da rua
      linha.atualizar(chegada, destino);
      const minutos = Math.max(1, Math.round(((PASSOS - k) / PASSOS) * (totalMetros / 1000) * 3));
      eta.textContent = `· chega em ~${minutos} min`;
      if (k % 5 === 0) mapa.panTo([chegada.lat, chegada.lng]);
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

// ===================== Frota: vários motoboys entregando ao mesmo tempo =====================
const NOMES_FROTA = ['João', 'Maria', 'Pedro', 'Ana', 'Lucas', 'Bia', 'Rafa', 'Duda'];
const CORES_FROTA = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
const METROS_POR_SEGUNDO = 90; // velocidade acelerada da demonstração (~10x a moto real)
const km = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;

async function simularFrota(root, loja, nomeLoja, qtd, entregasCada, botao) {
  botao.textContent = '📍 Montando as rotas...';
  const aqui = await minhaPosicao();
  const lojaPos = loja && loja.localizacao && Number.isFinite(loja.localizacao.lat) ? loja.localizacao : (aqui || PADRAO);
  const card = root.querySelector('#frota-card');
  card.classList.remove('hidden');
  const divMapa = root.querySelector('#frota-mapa');
  divMapa.innerHTML = '';
  if (divMapa._leaflet_id) divMapa._leaflet_id = null;
  const mapa = criarMapaRastreamento('frota-mapa', lojaPos, 14);
  L.circleMarker([lojaPos.lat, lojaPos.lng], { radius: 10, color: '#111827', fillColor: '#facc15', fillOpacity: 1, weight: 3 }).addTo(mapa).bindTooltip('🏪 Loja', { permanent: true, direction: 'bottom', offset: [0, 8] });

  // Cada motoboy vai para um lado da cidade, com 1 a 3 entregas
  const motos = [];
  for (let i = 0; i < qtd; i++) {
    const base = (360 / qtd) * i + Math.random() * 30;
    const paradas = Array.from({ length: entregasCada }, (_, k) => deslocar(lojaPos, 900 + k * 700 + Math.random() * 900, base + (Math.random() * 50 - 25)));
    motos.push({ nome: NOMES_FROTA[i % NOMES_FROTA.length], cor: CORES_FROTA[i % CORES_FROTA.length], paradas, entregues: 0, status: '🏪 Na loja, esperando o pedido', pernas: [], metros: 0 });
  }
  // Rotas pelas ruas: loja → entrega 1 → entrega 2 → ... → volta à loja (poucas de cada vez, para o serviço de rotas não recusar)
  const pedacos = [];
  motos.forEach((m, i) => { const pts = [lojaPos, ...m.paradas, lojaPos]; for (let k = 0; k < pts.length - 1; k++) pedacos.push({ i, k, a: pts[k], b: pts[k + 1] }); });
  for (let x = 0; x < pedacos.length; x += 3) {
    await Promise.all(pedacos.slice(x, x + 3).map(async (pc) => { motos[pc.i].pernas[pc.k] = await rotaPelasRuas(pc.a, pc.b); }));
  }
  const todos = [lojaPos];
  motos.forEach((m) => {
    m.metros = m.pernas.reduce((a, r) => a + comprimentoCaminho(r), 0);
    L.polyline(m.pernas.flat().map(p => [p.lat, p.lng]), { color: m.cor, weight: 4, opacity: 0.35, interactive: false }).addTo(mapa);
    m.pinos = m.paradas.map((p, k) => {
      todos.push(p);
      return L.circleMarker([p.lat, p.lng], { radius: 9, color: m.cor, fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(mapa).bindTooltip(`${k + 1}`, { permanent: true, direction: 'center', className: 'frota-num' });
    });
  });
  mapa.fitBounds(L.latLngBounds(todos.map(p => [p.lat, p.lng])).pad(0.15));
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  botao.textContent = '🔁 Simulação em andamento...';

  const inicio = Date.now();
  const relogio = () => { const d = new Date(Date.now() + (Date.now() - inicio) * 9); return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  const total = qtd * entregasCada;
  const desenhar = () => {
    const feitas = motos.reduce((a, m) => a + m.entregues, 0);
    const naRua = motos.filter(m => m.naRua).length;
    root.querySelector('#frota-resumo').innerHTML = `
      <div><strong>${feitas}/${total}</strong><span>entregas feitas</span></div>
      <div><strong>${naRua}</strong><span>motoboys na rua</span></div>
      <div><strong>${relogio()}</strong><span>relógio simulado</span></div>`;
    root.querySelector('#frota-lista').innerHTML = motos.map(m => `
      <div class="frota-linha">
        <span class="frota-cor" style="background:${m.cor}"></span>
        <div><strong>🛵 ${esc(m.nome)}</strong> <small>${m.entregues}/${m.paradas.length} entregas · ${km(m.metros)} no total</small><span>${m.status}</span></div>
      </div>`).join('');
  };
  desenhar();
  const relogioTimer = setInterval(desenhar, 1000);

  // Cada motoboy sai alguns segundos depois do outro (como a cozinha liberando os pedidos)
  await Promise.all(motos.map(async (m, i) => {
    await espera(i * 3000);
    m.naRua = true;
    const moto = criarMarcadorMoto(mapa, lojaPos);
    moto.marker.bindTooltip(m.nome, { permanent: true, direction: 'top', offset: [0, -16], className: 'frota-rotulo' });
    const el = moto.marker.getElement();
    const circulo = el && el.querySelector('.moto-icone');
    if (circulo) { circulo.style.borderColor = m.cor; circulo.style.boxShadow = `0 0 0 3px ${m.cor}55`; }
    for (let k = 0; k < m.pernas.length; k++) {
      const voltando = k === m.paradas.length;
      const rota = m.pernas[k];
      const metros = comprimentoCaminho(rota);
      const passos = Math.max(3, Math.round(metros / METROS_POR_SEGUNDO));
      for (let t = 1; t <= passos; t++) {
        const trecho = trechoPorDistancia(rota, (metros * (t - 1)) / passos, (metros * t) / passos);
        moto.moverPeloCaminho(trecho.slice(1), 1000);
        const falta = metros - (metros * t) / passos;
        m.status = voltando ? `↩ Voltando para a loja · ${km(falta)}` : `➡ Indo para a ${k + 1}ª entrega · faltam ${km(falta)}`;
        await espera(1000);
      }
      if (!voltando) {
        m.status = `📦 Entregando a ${k + 1}ª encomenda...`;
        await espera(2500);
        m.entregues++;
        m.pinos[k].setStyle({ fillColor: m.cor });
        m.pinos[k].setTooltipContent('✔');
      }
    }
    m.naRua = false;
    m.status = '✅ De volta na loja, pronto para a próxima';
  }));
  clearInterval(relogioTimer);
  desenhar();
  root.querySelector('#frota-resumo').insertAdjacentHTML('beforeend', '<div class="frota-fim"><strong>🏁 Todas as entregas concluídas!</strong><span>No app de verdade, cada cliente acompanha a sua moto e o dono vê tudo no painel.</span></div>');
}
