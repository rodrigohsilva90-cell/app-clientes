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
  // Áreas sem entrega (polígonos desenhados no mapa)
  let areas = (Array.isArray(f.areas) ? f.areas : []).map(a => ({ nome: a.nome || 'Área', pontos: (a.pontos || []).map(p => ({ lat: p.lat, lng: p.lng })), sempre: !!a.sempre, inicio: a.inicio || '20:00', fim: a.fim || '06:00' }));
  let desenhando = null; // pontos da área sendo desenhada
  const horaOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');

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

          <strong style="display:block; margin-top:14px;">4. Adicional noturno (automático)</strong>
          <label class="gc-check"><input type="checkbox" id="ce-not-ativo" ${f.noturnoAtivo ? 'checked' : ''} /> Cobrar sozinho nesse horário</label>
          <div class="gc-linha">
            <div><label>Valor (R$)</label><input id="ce-not-valor" inputmode="decimal" value="${centavosTexto(f.noturnoCentavos)}" /></div>
            <div><label>Das</label><input id="ce-not-ini" type="time" value="${esc(f.noturnoInicio || '22:00')}" /></div>
            <div><label>Até</label><input id="ce-not-fim" type="time" value="${esc(f.noturnoFim || '06:00')}" /></div>
          </div>
          <p class="gc-dica">O cliente vê "Adicional noturno" no frete só dentro desse horário. Pode somar com o adicional de chuva.</p>

          <strong style="display:block; margin-top:14px;">5. Áreas sem entrega</strong>
          <p class="gc-dica">Desenhe no mapa os bairros ou ruas onde vocês não entregam (sempre ou só à noite). Quem estiver dentro recebe a opção de <strong>retirar na loja</strong>.</p>
          <div id="ce-areas"></div>
          <button class="btn-outline-sm gc-largo" id="ce-nova-area" type="button">✏ Desenhar área no mapa</button>
          <div id="ce-desenho" class="ce-desenho hidden">
            <span id="ce-desenho-txt">Toque no mapa para marcar os cantos da área (pelo menos 3).</span>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <button class="btn-primary" id="ce-area-ok" type="button" style="width:auto;">✔ Concluir área</button>
              <button class="btn-outline-sm" id="ce-area-desfazer" type="button">↶ Desfazer ponto</button>
              <button class="btn-outline-sm" id="ce-area-cancelar" type="button">Cancelar</button>
            </div>
          </div>

          <strong style="display:block; margin-top:14px;">6. Texto no topo do cardápio (opcional)</strong>
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
    adicionalTexto: $('#ce-adic-texto').value.trim().slice(0, 30),
    noturnoAtivo: $('#ce-not-ativo').checked,
    noturnoCentavos: reaisParaCentavos($('#ce-not-valor').value),
    noturnoInicio: $('#ce-not-ini').value,
    noturnoFim: $('#ce-not-fim').value,
    areas: areas.map(a => ({
      nome: (a.nome || 'Área').trim().slice(0, 40) || 'Área',
      pontos: a.pontos.slice(0, 60).map(p => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })),
      sempre: !!a.sempre, inicio: a.inicio, fim: a.fim
    }))
  });

  // ---- Mapa ----
  if (typeof L === 'undefined') {
    $('#ce-mapa').innerHTML = '<p style="padding:20px;">Mapa indisponível. Verifique a internet e reabra.</p>';
  }
  const centro = local || { lat: -23.55, lng: -46.63 };
  const mapa = typeof L !== 'undefined' ? L.map($('#ce-mapa')).setView([centro.lat, centro.lng], local ? 15 : 11) : null;
  let pino = null, circulo = null, pinoTeste = null;
  let camadaAreas = null, linhaDesenho = null;
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

  // Desenha as áreas sem entrega (vermelho) e a área que está sendo desenhada (tracejado)
  function desenharAreas() {
    if (!mapa) return;
    if (camadaAreas) camadaAreas.remove();
    camadaAreas = L.layerGroup(areas.map(a => L.polygon(a.pontos.map(p => [p.lat, p.lng]), { color: '#dc2626', weight: 2, fillOpacity: 0.18 })
      .bindTooltip(`⛔ ${a.nome}${a.sempre ? '' : ` (${a.inicio}–${a.fim})`}`))).addTo(mapa);
    if (linhaDesenho) { linhaDesenho.remove(); linhaDesenho = null; }
    if (desenhando && desenhando.length) {
      linhaDesenho = L.layerGroup([
        L.polygon(desenhando.map(p => [p.lat, p.lng]), { color: '#dc2626', dashArray: '6 6', weight: 2, fillOpacity: 0.08 }),
        ...desenhando.map(p => L.circleMarker([p.lat, p.lng], { radius: 5, color: '#dc2626', fillOpacity: 1 }))
      ]).addTo(mapa);
    }
  }

  function listarAreas() {
    const box = $('#ce-areas');
    box.innerHTML = areas.length ? areas.map((a, i) => `
      <div class="ce-area">
        <div class="gc-linha">
          <div style="flex:2;"><label>Nome</label><input data-area="${i}" data-campo="nome" maxlength="40" value="${esc(a.nome)}" /></div>
          <div><label>Quando</label>
            <select data-area="${i}" data-campo="sempre">
              <option value="noite" ${a.sempre ? '' : 'selected'}>Num horário</option>
              <option value="sempre" ${a.sempre ? 'selected' : ''}>Sempre</option>
            </select>
          </div>
        </div>
        ${a.sempre ? '' : `
          <div class="gc-linha">
            <div><label>Das</label><input type="time" data-area="${i}" data-campo="inicio" value="${esc(a.inicio)}" /></div>
            <div><label>Até</label><input type="time" data-area="${i}" data-campo="fim" value="${esc(a.fim)}" /></div>
          </div>`}
        <button class="btn-outline-sm gc-perigo" type="button" data-remover-area="${i}">🗑 Remover área</button>
      </div>`).join('') : '<p class="gc-dica" style="margin:0 0 6px;">Nenhuma área bloqueada.</p>';
  }
  $('#ce-areas').addEventListener('input', (e) => {
    const i = e.target.dataset.area;
    if (i === undefined) return;
    const a = areas[Number(i)];
    const campo = e.target.dataset.campo;
    if (campo === 'sempre') { a.sempre = e.target.value === 'sempre'; listarAreas(); }
    else a[campo] = e.target.value;
    desenharAreas();
    atualizarTeste();
  });
  $('#ce-areas').addEventListener('change', (e) => { if (e.target.dataset.campo === 'sempre') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  $('#ce-areas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remover-area]');
    if (!b || !confirm(`Remover a área "${areas[Number(b.dataset.removerArea)].nome}"?`)) return;
    areas.splice(Number(b.dataset.removerArea), 1);
    listarAreas(); desenharAreas(); atualizarTeste();
  });

  const modoDesenho = (ligado) => {
    desenhando = ligado ? [] : null;
    $('#ce-desenho').classList.toggle('hidden', !ligado);
    $('#ce-nova-area').classList.toggle('hidden', ligado);
    $('#ce-desenho-txt').textContent = 'Toque no mapa para marcar os cantos da área (pelo menos 3).';
    desenharAreas();
    if (ligado) { $('#ce-mapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast('Toque no mapa, canto por canto, em volta da área.'); }
  };
  $('#ce-nova-area').onclick = () => {
    if (!mapa) { showToast('Mapa indisponível.'); return; }
    if (areas.length >= 20) { showToast('Limite de 20 áreas.'); return; }
    modoDesenho(true);
  };
  $('#ce-area-cancelar').onclick = () => modoDesenho(false);
  $('#ce-area-desfazer').onclick = () => { if (desenhando && desenhando.length) { desenhando.pop(); desenharAreas(); } };
  $('#ce-area-ok').onclick = () => {
    if (!desenhando || desenhando.length < 3) { showToast('Marque pelo menos 3 cantos no mapa.'); return; }
    areas.push({ nome: `Área ${areas.length + 1}`, pontos: desenhando, sempre: false, inicio: '20:00', fim: '06:00' });
    modoDesenho(false);
    listarAreas();
    desenharAreas();
    atualizarTeste();
    showToast('Área criada! Dê um nome, escolha o horário e toque em 💾 Salvar.');
  };

  function atualizarTeste() {
    const caixa = $('#ce-teste');
    if (!pontoTeste || !local) return;
    const r = calcularFrete({ localizacao: local, frete: lerFrete(), fusoHorario: loja.fusoHorario }, pontoTeste);
    caixa.innerHTML = r.fora
      ? `📍 Ponto de teste a <strong>${r.distanciaKm} km</strong>: <strong style="color:var(--danger);">fora da área de entrega</strong>.`
      : r.bloqueado
      ? `📍 Ponto de teste a <strong>${r.distanciaKm} km</strong>: <strong style="color:var(--danger);">⛔ dentro de "${esc(r.area.nome)}" — sem entrega agora</strong> (cliente pode retirar na loja).`
      : `📍 Ponto de teste a <strong>${r.distanciaKm} km</strong>: frete de <strong>${formatarCentavos(r.freteCentavos)}</strong>${r.adicional ? ` (inclui ${esc(r.adicional)})` : ''}.`;
  }

  if (mapa) {
    mapa.on('click', (e) => {
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (desenhando) {
        desenhando.push(p);
        $('#ce-desenho-txt').textContent = `${desenhando.length} canto(s) marcado(s).${desenhando.length >= 3 ? ' Toque em ✔ Concluir área quando terminar.' : ''}`;
        desenharAreas();
        return;
      }
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
    if (frete.noturnoCentavos === null) { showToast('Confira o valor do adicional noturno (formato 3,00).'); return; }
    if (frete.noturnoAtivo && (!horaOk(frete.noturnoInicio) || !horaOk(frete.noturnoFim) || frete.noturnoInicio === frete.noturnoFim)) { showToast('Confira o horário do adicional noturno.'); return; }
    const areaRuim = frete.areas.find(a => !a.sempre && (!horaOk(a.inicio) || !horaOk(a.fim) || a.inicio === a.fim));
    if (areaRuim) { showToast(`Confira o horário da área "${areaRuim.nome}".`); return; }
    if (desenhando) { showToast('Termine (✔ Concluir área) ou cancele o desenho antes de salvar.'); return; }
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
  listarAreas();
  desenharAreas();
  if (mapa && areas.length && !local) mapa.fitBounds(L.polygon(areas[0].pontos.map(p => [p.lat, p.lng])).getBounds());
}
