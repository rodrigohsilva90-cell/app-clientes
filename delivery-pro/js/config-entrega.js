// Painel do dono: local da loja no mapa e regras do frete (salvo no documento da loja)
import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { calcularFrete, coordsValidas } from './frete.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const reaisParaCentavos = (t) => {
  let s = String(t ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const centavosTexto = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');
const numero = (t) => {
  const n = Number(String(t ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function abrirConfigEntrega() {
  const loja = AppState.lojaDados || {};
  const f = loja.frete || {};
  let local = coordsValidas(loja.localizacao) ? { ...loja.localizacao } : null;
  let pontoTeste = null;

  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="gc-janela" style="height:auto; max-height:94vh;">
      <header class="gc-topo">
        <h3>🛵 Entrega e frete</h3>
        <div style="display:flex; gap:8px;">
          <button class="btn-primary" id="ce-salvar" style="width:auto;">💾 Salvar</button>
          <button class="btn-outline-sm" id="ce-fechar">✕</button>
        </div>
      </header>
      <div class="ce-corpo">
        <div>
          <strong>1. Onde fica a loja?</strong>
          <p class="gc-dica">Toque no mapa para marcar o local exato (ou use o GPS estando na loja). Arraste o pino para ajustar.</p>
          <button class="btn-outline-sm" id="ce-gps" style="margin-bottom:8px;">📍 Usar minha localização atual</button>
          <div id="ce-mapa" class="ce-mapa"></div>
          <p class="gc-dica" id="ce-teste">Depois de marcar a loja, toque em qualquer outro ponto com o botão <strong>Simular</strong> ligado para ver quanto ficaria o frete até lá.</p>
          <label class="gc-check"><input type="checkbox" id="ce-simular" /> Simular frete (toque no mapa = endereço de um cliente)</label>
        </div>
        <div class="gc-form">
          <strong>2. Como cobrar a entrega</strong>
          <div class="gc-linha">
            <div><label>Taxa base (R$)</label><input id="ce-base" inputmode="decimal" value="${centavosTexto(f.baseCentavos)}" /></div>
            <div><label>Km incluídos na base</label><input id="ce-inclusos" inputmode="decimal" value="${f.kmInclusos ?? 2}" /></div>
          </div>
          <div class="gc-linha">
            <div><label>R$ por km a mais</label><input id="ce-porkm" inputmode="decimal" value="${centavosTexto(f.porKmCentavos)}" /></div>
            <div><label>Entrega até (km)</label><input id="ce-raio" inputmode="decimal" value="${f.raioMaxKm ?? 8}" /></div>
          </div>
          <p class="gc-dica">A distância é calculada em linha reta × 1,35 (aproximação das ruas). Exemplo: base R$ 5,00 com 2 km incluídos e R$ 1,50 por km → 4 km custa R$ 8,00.</p>

          <strong style="display:block; margin-top:14px;">3. Adicional (chuva, madrugada…)</strong>
          <label class="gc-check"><input type="checkbox" id="ce-adic-ativo" ${f.adicionalAtivo ? 'checked' : ''} /> Cobrar adicional agora</label>
          <div class="gc-linha">
            <div><label>Valor (R$)</label><input id="ce-adic-valor" inputmode="decimal" value="${centavosTexto(f.adicionalCentavos)}" /></div>
            <div><label>Motivo mostrado ao cliente</label><input id="ce-adic-texto" maxlength="30" value="${esc(f.adicionalTexto || 'Adicional chuva')}" /></div>
          </div>

          <strong style="display:block; margin-top:14px;">4. Texto no topo do cardápio (opcional)</strong>
          <input id="ce-texto-taxa" maxlength="30" placeholder="Ex: R$ 5 a R$ 15 (vazio = automático)" value="${esc(loja.taxaEntregaTexto || '')}" />
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const $ = (s) => overlay.querySelector(s);
  $('#ce-fechar').onclick = () => { overlay.remove(); document.body.style.overflow = ''; };

  const lerFrete = () => ({
    baseCentavos: reaisParaCentavos($('#ce-base').value),
    kmInclusos: numero($('#ce-inclusos').value),
    porKmCentavos: reaisParaCentavos($('#ce-porkm').value),
    raioMaxKm: numero($('#ce-raio').value),
    adicionalAtivo: $('#ce-adic-ativo').checked,
    adicionalCentavos: reaisParaCentavos($('#ce-adic-valor').value),
    adicionalTexto: $('#ce-adic-texto').value.trim().slice(0, 30)
  });

  // ---- Mapa ----
  if (typeof L === 'undefined') {
    $('#ce-mapa').innerHTML = '<p style="padding:20px;">Mapa indisponível. Verifique a internet e reabra.</p>';
  }
  const centro = local || { lat: -23.55, lng: -46.63 };
  const mapa = typeof L !== 'undefined' ? L.map($('#ce-mapa')).setView([centro.lat, centro.lng], local ? 15 : 11) : null;
  let pino = null, circulo = null, pinoTeste = null;
  if (mapa) {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    setTimeout(() => mapa.invalidateSize(), 150);
  }

  function desenhar() {
    if (!mapa) return;
    if (local) {
      if (!pino) {
        pino = L.marker([local.lat, local.lng], { draggable: true, title: 'Loja' }).addTo(mapa).bindTooltip('🏪 Loja', { permanent: true, direction: 'top', offset: [-15, -10] });
        pino.on('dragend', () => { const p = pino.getLatLng(); local = { lat: p.lat, lng: p.lng }; desenhar(); });
      } else pino.setLatLng([local.lat, local.lng]);
      const raioKm = numero($('#ce-raio').value) || 0;
      // círculo aproximado da área (raio em linha reta = raio de ruas / 1,35)
      if (circulo) circulo.remove();
      if (raioKm > 0) circulo = L.circle([local.lat, local.lng], { radius: (raioKm / 1.35) * 1000, color: '#16a34a', weight: 1, fillOpacity: 0.06 }).addTo(mapa);
    }
    atualizarTeste();
  }

  function atualizarTeste() {
    const caixa = $('#ce-teste');
    if (!pontoTeste || !local) return;
    const r = calcularFrete({ localizacao: local, frete: lerFrete() }, pontoTeste);
    caixa.innerHTML = r.fora
      ? `📍 Ponto de teste a <strong>${r.distanciaKm} km</strong>: <strong style="color:var(--danger);">fora da área de entrega</strong>.`
      : `📍 Ponto de teste a <strong>${r.distanciaKm} km</strong>: frete de <strong>${formatarCentavos(r.freteCentavos)}</strong>${r.adicional ? ` (inclui ${esc(r.adicional)})` : ''}.`;
  }

  if (mapa) {
    mapa.on('click', (e) => {
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      if ($('#ce-simular').checked && local) {
        pontoTeste = p;
        if (!pinoTeste) pinoTeste = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#dc2626' }).addTo(mapa);
        else pinoTeste.setLatLng([p.lat, p.lng]);
        atualizarTeste();
      } else {
        local = p;
        desenhar();
      }
    });
  }
  overlay.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { if (i.id === 'ce-raio') desenhar(); else atualizarTeste(); }));

  $('#ce-gps').onclick = () => {
    if (!navigator.geolocation) { showToast('GPS indisponível neste aparelho.'); return; }
    showToast('Buscando sua localização...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        local = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapa) mapa.setView([local.lat, local.lng], 16);
        desenhar();
      },
      () => showToast('Não foi possível obter a localização. Toque no mapa para marcar.'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  $('#ce-salvar').onclick = async () => {
    const frete = lerFrete();
    if (!local) { showToast('Marque no mapa onde fica a loja.'); return; }
    if ([frete.baseCentavos, frete.porKmCentavos, frete.adicionalCentavos].includes(null)) { showToast('Confira os valores em R$ (use o formato 5,00).'); return; }
    if (frete.kmInclusos === null || frete.raioMaxKm === null || frete.raioMaxKm <= 0) { showToast('Confira os campos de km (o raio de entrega precisa ser maior que zero).'); return; }
    const btn = $('#ce-salvar');
    btn.disabled = true;
    try {
      const textoTaxa = $('#ce-texto-taxa').value.trim().slice(0, 30);
      await updateDoc(doc(db, 'lojas', AppState.lojaId), {
        localizacao: { lat: local.lat, lng: local.lng },
        frete,
        taxaEntregaTexto: textoTaxa || null
      });
      AppState.lojaDados = { ...AppState.lojaDados, localizacao: local, frete, taxaEntregaTexto: textoTaxa || null };
      showToast('Configuração de entrega salva!');
    } catch (err) {
      console.error(err);
      showToast(err.code === 'permission-denied' ? 'Só o dono da loja pode alterar o frete.' : 'Erro ao salvar. Tente de novo.');
    } finally {
      btn.disabled = false;
    }
  };

  desenhar();
}
