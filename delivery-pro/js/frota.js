// Painel do dono: mapa ao vivo com todos os motoboys (dados reais).
// A posição vem do GPS do celular de cada motoboy, gravada no pedido que ele está levando agora
// (motoboyCoords da 1ª parada, a cada ~8 s em movimento). Os outros pedidos da bag viram paradas numeradas.
import { db, esc, formatarCentavos } from './config.js';
import { AppState } from './router.js';
import { coordsValidas } from './frete.js';
import { criarMarcadorMoto, calcularDistanciaMetros } from './geo.js';
import { collection, query, where, onSnapshot, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const CORES = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563', '#65a30d', '#c2410c'];
const RESERVA_VALIDA_MS = 90 * 60 * 1000;
const ms = (t) => (t && t.toMillis ? t.toMillis() : (t ? Date.parse(t) || 0 : 0));
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);
const haQuanto = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `há ${Math.max(1, s)} s` : `há ${Math.round(s / 60)} min`; };

// concluidosHoje: lista que o painel já mantém (para contar as entregas do dia de cada motoboy)
export async function abrirMapaFrota({ concluidosHoje = () => [] } = {}) {
  const loja = AppState.lojaDados || {};
  const lojaPos = coordsValidas(loja.localizacao) ? loja.localizacao : null;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay frota-real';
  overlay.innerHTML = `
    <div class="gc-janela frota-janela">
      <header class="gc-topo">
        <h3>🗺️ Motoboys ao vivo</h3>
        <div style="display:flex; gap:8px;">
          <button class="btn-outline-sm" type="button" data-centralizar>🎯 Ver todos</button>
          <button class="btn-outline-sm" type="button" data-fechar>✕</button>
        </div>
      </header>
      <div class="frota-corpo">
        ${lojaPos ? '' : '<div class="frota-aviso">⚠ A loja ainda não tem endereço no mapa. Coloque em ⚙ Configurações → 🛵 Entrega e frete para ver a loja aqui e para o mapa aparecer para os clientes.</div>'}
        <div class="frota-resumo" id="fr-resumo"></div>
        <div id="fr-mapa" class="frota-mapa-real"></div>
        <div id="fr-lista"></div>
        <p class="gc-dica">A posição vem do GPS do celular de cada motoboy enquanto ele tem entrega na mão (atualiza a cada ~8 s). Sem entrega, o GPS fica desligado para poupar bateria.</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);

  if (typeof L === 'undefined') { $('#fr-mapa').innerHTML = '<p style="padding:20px;">Mapa indisponível. Confira a internet e abra de novo.</p>'; }
  const mapa = typeof L !== 'undefined' ? L.map($('#fr-mapa')).setView(lojaPos ? [lojaPos.lat, lojaPos.lng] : [-23.55, -46.63], 14) : null;
  if (mapa) {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    if (lojaPos) L.circleMarker([lojaPos.lat, lojaPos.lng], { radius: 10, color: '#111827', fillColor: '#facc15', fillOpacity: 1, weight: 3 }).addTo(mapa).bindTooltip('🏪 Loja', { permanent: true, direction: 'bottom', offset: [0, 8] });
    setTimeout(() => mapa.invalidateSize(), 200);
  }

  // Nomes dos entregadores cadastrados (cada um ganha uma cor fixa)
  let entregadores = [];
  try {
    const snap = await getDocs(collection(db, 'lojas', AppState.lojaId, 'entregadores'));
    entregadores = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || 'Entregador', telefone: d.data().telefone || d.data().whatsapp || '' }));
  } catch (_) {}
  const corDe = (uid) => { const i = entregadores.findIndex(e => e.uid === uid); return CORES[(i >= 0 ? i : entregadores.length) % CORES.length]; };
  const nomeDe = (uid, pedido) => (entregadores.find(e => e.uid === uid) || {}).nome || (pedido && pedido.motoboyNome) || 'Entregador';

  const camadas = new Map();   // uid → { moto, linha, paradas: [] }
  const ultimaPos = new Map(); // uid → { lat, lng, em }
  let pedidos = [];
  let primeiraVez = true;

  function desenhar() {
    const emRota = pedidos.filter(p => p.status === 'entrega' && p.motoboyId);
    const porMotoboy = new Map();
    emRota.forEach(p => { if (!porMotoboy.has(p.motoboyId)) porMotoboy.set(p.motoboyId, []); porMotoboy.get(p.motoboyId).push(p); });
    const reservas = pedidos.filter(p => p.status === 'preparo' && p.reservadoPor && Date.now() - ms(p.reservadoEm) < RESERVA_VALIDA_MS);
    const semMotoboy = pedidos.filter(p => p.status === 'preparo' && p.tipoEntrega !== 'retirada' && !p.motoboyId && !(p.reservadoPor && Date.now() - ms(p.reservadoEm) < RESERVA_VALIDA_MS));
    const hoje = concluidosHoje().filter(p => p.status === 'concluido' && p.motoboyId);

    // Posição atual: vem do pedido que é a 1ª parada (motoboyCoords com lat/lng)
    porMotoboy.forEach((lista, uid) => {
      lista.sort((a, b) => (Number(a.motoboyCoords && a.motoboyCoords.antes) || 0) - (Number(b.motoboyCoords && b.motoboyCoords.antes) || 0));
      const comGps = lista.find(p => p.motoboyCoords && Number.isFinite(p.motoboyCoords.lat));
      if (comGps) ultimaPos.set(uid, { lat: comGps.motoboyCoords.lat, lng: comGps.motoboyCoords.lng, em: ms(comGps.gpsAtualizadoEm) || Date.now(), foraDoApp: comGps.motoboyCoords.foraDoApp === true });
    });

    // Mapa: tira quem não está mais em rota e atualiza os outros
    if (mapa) {
      camadas.forEach((c, uid) => {
        if (porMotoboy.has(uid)) return;
        c.moto && c.moto.marker.remove(); c.linha && c.linha.remove(); c.paradas.forEach(x => x.remove());
        camadas.delete(uid);
      });
      porMotoboy.forEach((lista, uid) => {
        const cor = corDe(uid);
        let c = camadas.get(uid);
        if (!c) { c = { moto: null, linha: null, paradas: [] }; camadas.set(uid, c); }
        const pos = ultimaPos.get(uid);
        if (pos) {
          if (!c.moto) {
            c.moto = criarMarcadorMoto(mapa, pos);
            c.moto.marker.bindTooltip(nomeDe(uid, lista[0]), { permanent: true, direction: 'top', offset: [0, -16], className: 'frota-rotulo' });
            const circulo = c.moto.marker.getElement() && c.moto.marker.getElement().querySelector('.moto-icone');
            if (circulo) { circulo.style.borderColor = cor; circulo.style.boxShadow = `0 0 0 3px ${cor}55`; }
          } else c.moto.moverSuavemente(pos, 1500);
        }
        c.paradas.forEach(x => x.remove());
        c.paradas = lista.filter(p => coordsValidas(p.destinoCoords)).map((p, i) => L.circleMarker([p.destinoCoords.lat, p.destinoCoords.lng], { radius: 9, color: cor, fillColor: '#fff', fillOpacity: 1, weight: 3 })
          .addTo(mapa).bindTooltip(`${i + 1}`, { permanent: true, direction: 'center', className: 'frota-num' })
          .bindPopup(`<strong>#${esc(p.numeroPedido || '')}</strong> · ${esc(String(p.clienteNome || '').split(/\s+/)[0])}<br/>${esc(p.enderecoPartes && p.enderecoPartes.bairro ? p.enderecoPartes.bairro : p.enderecoTexto || '')}`));
        const pontos = [pos, ...lista.map(p => p.destinoCoords)].filter(coordsValidas).map(p => [p.lat, p.lng]);
        if (c.linha) c.linha.setLatLngs(pontos);
        else c.linha = L.polyline(pontos, { color: cor, weight: 4, opacity: 0.45, dashArray: '8 8', interactive: false }).addTo(mapa);
      });
      if (primeiraVez && porMotoboy.size) { primeiraVez = false; centralizar(); }
    }

    // Resumo
    const naRua = porMotoboy.size;
    $('#fr-resumo').innerHTML = `
      <div><strong>${naRua}</strong><span>motoboys na rua</span></div>
      <div><strong>${emRota.length}</strong><span>entregas em andamento</span></div>
      <div><strong>${hoje.length}</strong><span>entregues hoje</span></div>
      <div class="${semMotoboy.length ? 'alerta' : ''}"><strong>${semMotoboy.length}</strong><span>esperando motoboy</span></div>`;

    // Lista: primeiro quem está na rua, depois os outros cadastrados
    const uids = [...new Set([...porMotoboy.keys(), ...reservas.map(p => p.reservadoPor), ...entregadores.map(e => e.uid)])];
    $('#fr-lista').innerHTML = uids.map(uid => {
      const lista = porMotoboy.get(uid) || [];
      const minhas = reservas.filter(p => p.reservadoPor === uid);
      const feitas = hoje.filter(p => p.motoboyId === uid).length;
      const pos = ultimaPos.get(uid);
      const prox = lista[0];
      const dist = pos && prox && coordsValidas(prox.destinoCoords) ? calcularDistanciaMetros(pos.lat, pos.lng, prox.destinoCoords.lat, prox.destinoCoords.lng) : null;
      const sinalVelho = pos && Date.now() - pos.em > 2 * 60000;
      const cobrar = lista.filter(p => p.pagamentoStatus !== 'aprovado' && p.formaPagamento === 'dinheiro').reduce((a, p) => a + (Number(p.totalCentavos) || 0), 0);
      let status;
      if (lista.length) {
        status = `🛵 ${lista.length} na bag · próxima: <strong>#${esc(prox.numeroPedido || '')}</strong> ${esc(prox.enderecoPartes && prox.enderecoPartes.bairro ? prox.enderecoPartes.bairro : '')}${dist != null ? ` · faltam ${km(dist)}` : ''}`;
        status += !pos ? '<small class="frota-velho">📡 Esperando o GPS do celular dele</small>'
          : pos.foraDoApp ? `<small class="frota-velho">📱 Saiu do Delivery Pro ${haQuanto(pos.em)} (Google Maps/Waze?): posição parada até ele voltar ao app</small>`
          : `<small class="${sinalVelho ? 'frota-velho' : ''}">📡 GPS ${haQuanto(pos.em)}${sinalVelho ? ' (sem sinal ou app fechado?)' : ''}</small>`;
      } else status = '🏪 Sem entrega na mão';
      return `<div class="frota-linha${lista.length ? '' : ' parado'}" data-uid="${esc(uid)}">
        <span class="frota-cor" style="background:${corDe(uid)}"></span>
        <div style="flex:1;">
          <strong>${esc(nomeDe(uid, lista[0] || minhas[0]))}</strong> <small>${feitas} entrega(s) hoje${cobrar ? ` · 💵 cobrar ${formatarCentavos(cobrar)}` : ''}</small>
          <span>${status}</span>
          ${minhas.length ? `<span class="frota-reserva">📌 Reservou para a volta: ${minhas.map(p => '#' + esc(p.numeroPedido || '')).join(', ')}</span>` : ''}
        </div>
        ${pos && lista.length ? '<button class="btn-outline-sm" type="button" data-ver>Ver</button>' : ''}
      </div>`;
    }).join('') || '<p class="gc-dica">Nenhum motoboy cadastrado. Cadastre em ⚙ Configurações → Equipe e entregadores.</p>';
    overlay.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => {
      const pos = ultimaPos.get(b.closest('[data-uid]').dataset.uid);
      if (pos && mapa) { mapa.setView([pos.lat, pos.lng], 16); $('#fr-mapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
  }

  function centralizar() {
    if (!mapa) return;
    const pts = [];
    if (lojaPos) pts.push([lojaPos.lat, lojaPos.lng]);
    ultimaPos.forEach(p => pts.push([p.lat, p.lng]));
    pedidos.filter(p => p.status === 'entrega' && coordsValidas(p.destinoCoords)).forEach(p => pts.push([p.destinoCoords.lat, p.destinoCoords.lng]));
    if (pts.length > 1) mapa.fitBounds(L.latLngBounds(pts).pad(0.2));
    else if (pts.length) mapa.setView(pts[0], 15);
  }
  $('[data-centralizar]').onclick = centralizar;

  // Tempo real: pedidos em preparo (reservas, sem motoboy) e em rota
  const parar = onSnapshot(
    query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('status', 'in', ['preparo', 'entrega'])),
    (snap) => { pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() })); desenhar(); },
    (err) => { console.error(err); $('#fr-lista').innerHTML = '<p class="gc-dica">Não foi possível carregar os pedidos.</p>'; }
  );
  const relogio = setInterval(desenhar, 15000); // atualiza o "GPS há X s"
  const fechar = () => { parar(); clearInterval(relogio); if (mapa) mapa.remove(); overlay.remove(); };
  $('[data-fechar]').onclick = fechar;
  desenhar();
}
