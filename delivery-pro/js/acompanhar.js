// Página de acompanhamento do pedido pelo cliente: /{slug}/pedido/{id}
// O ID do pedido é longo e aleatório, funciona como "senha" do link.
import { db, formatarCentavos, esc, showToast } from './config.js';
import { AppState } from './router.js';
import { criarMapaRastreamento, criarMarcadorMoto, criarLinhaRota } from './geo.js';
import { cartaoNotificacao } from './push-cliente.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const CHAVE_LOCAL = (lojaId) => `meus_pedidos_${lojaId}`;
const VALIDADE_MS = 24 * 60 * 60 * 1000; // aviso no cardápio some depois de 24h
const FINAIS = ['concluido', 'ocorrencia', 'cancelado'];

// ---- Pedidos guardados no aparelho do cliente (sem login) ----
export function salvarPedidoLocal(lojaId, pedido) {
  try {
    const lista = pedidosRecentes(lojaId).filter(p => p.id !== pedido.id);
    lista.unshift({ ...pedido, em: Date.now() });
    localStorage.setItem(CHAVE_LOCAL(lojaId), JSON.stringify(lista.slice(0, 5)));
  } catch (_) {}
}

export function pedidosRecentes(lojaId) {
  try {
    const lista = JSON.parse(localStorage.getItem(CHAVE_LOCAL(lojaId)) || '[]');
    return lista.filter(p => p && p.id && Date.now() - p.em < VALIDADE_MS);
  } catch (_) {
    return [];
  }
}

// Pedido entregue e ainda sem nota: fica na lista para o cliente avaliar pelo cardápio
function marcarParaAvaliar(lojaId, pedidoId) {
  try {
    const lista = pedidosRecentes(lojaId).map(p => (p.id === pedidoId ? { ...p, avaliar: true } : p));
    localStorage.setItem(CHAVE_LOCAL(lojaId), JSON.stringify(lista));
  } catch (_) {}
}

// Avaliação de 1 toque (o servidor só aceita pedido concluído e ainda não avaliado)
export async function enviarAvaliacao(pedidoId, nota) {
  try {
    const r = await fetch('/api/avaliar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: AppState.slug, pedidoId, nota })
    });
    const ok = r.ok || r.status === 409;
    if (ok) removerPedidoLocal(AppState.lojaId, pedidoId);
    return ok;
  } catch (_) { return false; }
}

function removerPedidoLocal(lojaId, pedidoId) {
  try {
    const lista = pedidosRecentes(lojaId).filter(p => p.id !== pedidoId);
    localStorage.setItem(CHAVE_LOCAL(lojaId), JSON.stringify(lista));
  } catch (_) {}
}

// ---- Tela de acompanhamento ----
let pararEscuta = null;
let mapa = null;
let marcadorMoto = null;
let linhaRota = null;

export function iniciarAcompanhamento(pedidoId) {
  const root = document.getElementById('app-root');
  if (pararEscuta) { pararEscuta(); pararEscuta = null; }
  mapa = null;
  marcadorMoto = null;
  linhaRota = null;

  root.innerHTML = `
    <a href="/${esc(AppState.slug)}" class="btn-outline-sm" style="text-decoration:none; display:inline-block; margin-bottom:12px;">${AppState.lojaDados && AppState.lojaDados.layoutVitrine === 'varejo' ? '← Voltar à loja' : '← Voltar ao cardápio'}</a>
    <div class="card" id="acomp-status"><p>Carregando seu pedido...</p></div>
    <div class="card hidden acomp-chegando" id="acomp-chegando">🏁 <strong>O entregador está chegando ao seu endereço!</strong><span>Fique de olho no portão ou no interfone.</span></div>
    <div class="card hidden acomp-retirada" id="acomp-retirada"></div>
    <div class="card hidden acomp-tentativa" id="acomp-tentativa"></div>
    <div class="card hidden acomp-parada" id="acomp-parada"></div>
    <div class="card hidden" id="acomp-mapa-card">
      <strong>🛵 Entregador a caminho</strong>
      <p class="acomp-antes hidden" id="acomp-antes"></p>
      <small class="acomp-atualizado" id="acomp-atualizado"></small>
      <div id="acomp-mapa" style="height:260px; border-radius:8px; margin-top:10px; z-index:1;"></div>
    </div>
    <div class="card hidden" id="acomp-push"></div>
    <div class="card hidden" id="acomp-avaliar"></div>
    <div class="card hidden acomp-fid" id="acomp-fidelidade"></div>
    <div class="card hidden" id="acomp-itens"></div>
    <p class="selo-organico hidden" id="acomp-selo">Tecnologia <strong>Delivery Pro</strong> · Tem um comércio? <a href="/?ref=selo">Crie seu cardápio grátis</a></p>
  `;

  if (!pedidoId) {
    document.getElementById('acomp-status').innerHTML = '<h3>Pedido não encontrado.</h3>';
    return;
  }

  pararEscuta = onSnapshot(
    doc(db, 'lojas', AppState.lojaId, 'pedidos', pedidoId),
    (snap) => {
      if (!snap.exists()) {
        document.getElementById('acomp-status').innerHTML = '<h3>Pedido não encontrado.</h3>';
        return;
      }
      let p = { id: snap.id, ...snap.data() };
      // Já está com o motoboy, mas ele ainda não saiu da loja: para o cliente continua "pronto", sem mapa
      if (p.status === 'entrega' && p.motoboyCoords && p.motoboyCoords.naLoja) p = { ...p, status: 'preparo', comEntregador: true, motoboyCoords: null };
      renderStatus(p);
      renderItens(p);
      renderMapa(p);
      renderAvaliacao(p);
      renderRetirada(p);
      if (p.status === 'concluido') { renderFidelidade(p); confirmarPinoPeloGps(p); }
      const boxPush = document.getElementById('acomp-push');
      if (FINAIS.includes(p.status)) boxPush?.classList.add('hidden');
      else if (boxPush && !boxPush.dataset.feito) { boxPush.dataset.feito = '1'; cartaoNotificacao(boxPush, p.id); }
      if (FINAIS.includes(p.status)) {
        if (p.status === 'concluido' && !p.avaliado) marcarParaAvaliar(AppState.lojaId, p.id);
        else removerPedidoLocal(AppState.lojaId, p.id);
        if (pararEscuta) { pararEscuta(); pararEscuta = null; } // encerra o tempo real após a entrega
      }
    },
    (err) => {
      console.error(err);
      document.getElementById('acomp-status').innerHTML = '<h3>Não foi possível carregar o pedido.</h3><p style="color:var(--text-muted);">Verifique sua internet e recarregue a página.</p>';
    }
  );
}

// Varejo (adega, farmácia, mercadinho) separa o pedido em vez de preparar
const etapaPreparo = () => (AppState.lojaDados && AppState.lojaDados.layoutVitrine === 'varejo'
  ? { icone: '📦', titulo: 'Em separação', texto: 'A loja está separando seus produtos.' }
  : { icone: '🔥', titulo: 'Em preparo', texto: 'A loja está preparando seu pedido.' });

function etapasDo(p) {
  if (p.tipoEntrega === 'retirada') {
    return [
      { status: 'novo', icone: '📝', titulo: 'Pedido recebido', texto: 'Aguardando a loja confirmar.' },
      { status: 'preparo', ...etapaPreparo() },
      { status: 'concluido', icone: '✅', titulo: 'Retirado', texto: 'Obrigado pela preferência!' }
    ];
  }
  return [
    { status: 'novo', icone: '📝', titulo: 'Pedido recebido', texto: 'Aguardando a loja confirmar.' },
    { status: 'preparo', ...(p.comEntregador ? { icone: '📦', titulo: 'Pronto, com o entregador', texto: 'O entregador já pegou seu pedido e sai da loja em instantes. Avisamos quando ele sair.' } : etapaPreparo()) },
    { status: 'entrega', icone: '🛵', titulo: 'Saiu para entrega', texto: 'O entregador está a caminho.' },
    { status: 'concluido', icone: '✅', titulo: 'Entregue', texto: 'Bom apetite!' }
  ];
}

// ---- Pix automático: QR Code + copia e cola enquanto o pedido aguarda o pagamento ----
let relogioPix = null;
let conferirPixTimer = null; // confere no banco a cada 10 s, caso o aviso do Mercado Pago atrase
let esperavaPix = false; // para avisar (vibrar) quando o Pix for confirmado
function renderPix(p, box, numero) {
  const expira = p.pix && (p.pix.expiraEm?.toMillis ? p.pix.expiraEm.toMillis() : Date.parse(p.pix.expiraEm));
  if (!p.pix || !p.pix.qrCode) {
    box.innerHTML = `<h2>Pedido #${numero}</h2><p style="margin-top:8px;">⏳ Gerando o Pix...</p>`;
    return;
  }
  if (expira && Date.now() > expira) {
    box.innerHTML = `<h2>Pedido #${numero}</h2><div class="pix-expirado">⌛ O tempo para pagar este Pix acabou e o pedido não foi enviado para a loja. <a href="/${esc(AppState.slug)}">Fazer o pedido de novo</a></div>`;
    return;
  }
  if (box.dataset.pixDesenhado === p.pix.mpId) return; // já está na tela (não piscar)
  box.dataset.pixDesenhado = p.pix.mpId;
  box.innerHTML = `
    <h2>Pedido #${numero}</h2>
    <div class="pix-box">
      <strong>Pague com Pix para enviar o pedido à loja</strong>
      <span class="pix-valor">${formatarCentavos(p.totalCentavos)}</span>
      ${p.pix.qrBase64 ? `<img class="pix-qr" alt="QR Code Pix" src="data:image/png;base64,${esc(p.pix.qrBase64)}" />` : ''}
      <p class="gc-dica">No celular: toque em <strong>Copiar código</strong>, abra o app do seu banco → Pix → <strong>Pix Copia e Cola</strong>.</p>
      <button class="btn-primary pix-copiar-grande" type="button" id="pix-copiar">📋 Copiar código Pix</button>
      <textarea id="pix-codigo" class="pix-codigo" readonly rows="3">${esc(p.pix.qrCode)}</textarea>
      <div class="pix-barra"><span id="pix-barra"></span></div>
      <p class="pix-tempo" id="pix-tempo"></p>
      <button class="btn-outline-sm" type="button" id="pix-ja-paguei" style="width:100%;">Já paguei</button>
      <p class="pix-sem-comprovante">✅ <strong>Não precisa enviar comprovante.</strong> Esta tela atualiza sozinha assim que o banco confirmar, e a loja recebe o pedido na hora.</p>
    </div>`;
  box.querySelector('#pix-copiar').onclick = async () => {
    const campo = box.querySelector('#pix-codigo');
    try { await navigator.clipboard.writeText(p.pix.qrCode); }
    catch (_) { campo.select(); document.execCommand('copy'); }
    box.querySelector('#pix-copiar').textContent = '✅ Código copiado! Cole no app do banco';
  };
  box.querySelector('#pix-ja-paguei').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Conferindo com o banco...';
    try {
      const r = await fetch('/api/mp/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: AppState.slug, pedidoId: p.id }) });
      const d = await r.json().catch(() => ({}));
      btn.textContent = d.pago || d.status === 'novo' ? '✅ Pagamento confirmado!' : 'Ainda não confirmado. Aguarde alguns segundos e toque de novo.';
    } catch (_) { btn.textContent = 'Sem conexão. Tente de novo.'; }
    setTimeout(() => { btn.disabled = false; }, 4000);
  };
  if (relogioPix) clearInterval(relogioPix);
  const atualizar = () => {
    const el = document.getElementById('pix-tempo');
    if (!el) { clearInterval(relogioPix); return; }
    const resta = Math.max(0, (expira || 0) - Date.now());
    const barra = document.getElementById('pix-barra');
    if (barra) {
      const fracao = Math.min(1, resta / (30 * 60000));
      barra.style.width = `${Math.round(fracao * 100)}%`;
      barra.style.background = fracao < 0.2 ? 'var(--danger)' : fracao < 0.5 ? 'var(--warning)' : 'var(--success)';
    }
    if (!resta) { renderPix(p, box, numero); clearInterval(relogioPix); return; }
    el.textContent = resta ? `⏱ Pague em até ${Math.floor(resta / 60000)}:${String(Math.floor(resta / 1000) % 60).padStart(2, '0')}` : '⌛ Tempo esgotado';
  };
  atualizar();
  relogioPix = setInterval(atualizar, 1000);
  if (conferirPixTimer) clearInterval(conferirPixTimer);
  conferirPixTimer = setInterval(() => {
    if (!document.getElementById('pix-tempo')) { clearInterval(conferirPixTimer); conferirPixTimer = null; return; }
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    // Se aprovado, o servidor muda o pedido e esta tela troca sozinha (pelo aviso em tempo real)
    fetch('/api/mp/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: AppState.slug, pedidoId: p.id }) }).catch(() => {});
  }, 10000);
}

function renderStatus(p) {
  const box = document.getElementById('acomp-status');
  if (!box) return;
  const numero = esc(p.numeroPedido || p.id.slice(0, 6).toUpperCase());
  if (p.status === 'aguardando_pagamento') { esperavaPix = true; return renderPix(p, box, numero); }
  delete box.dataset.pixDesenhado;
  if (esperavaPix) {
    esperavaPix = false;
    if (p.status !== 'cancelado') {
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (_) {}
      showToast('✅ Pix confirmado! A loja já recebeu seu pedido.', 5000);
    }
  }
  if (relogioPix) { clearInterval(relogioPix); relogioPix = null; }
  if (conferirPixTimer) { clearInterval(conferirPixTimer); conferirPixTimer = null; }

  if (p.status === 'ocorrencia' || p.status === 'cancelado') {
    box.innerHTML = `
      <h2>Pedido #${numero}</h2>
      <div style="background:#fee2e2; color:#991b1b; padding:12px; border-radius:8px; margin-top:12px;">
        ${p.status === 'cancelado'
          ? `❌ Este pedido foi cancelado pela loja.${p.motivoCancelamento ? `<br/><small>Motivo: ${esc(p.motivoCancelamento)}</small>` : ''}<br/><small>Se você já pagou, fale com a loja para o estorno.</small>`
          : '⚠️ Houve um problema com este pedido. A loja vai entrar em contato com você.'}
      </div>
    `;
    return;
  }

  const etapas = etapasDo(p);
  const atual = Math.max(0, etapas.findIndex(e => e.status === p.status));
  box.innerHTML = `
    <h2>Pedido #${numero}</h2>
    <p style="color:var(--text-muted); font-size:14px; margin:4px 0 14px;">Esta tela atualiza sozinha. Pode deixar aberta.</p>
    ${etapas.map((e, i) => {
      const feita = i < atual;
      const agora = i === atual;
      const cor = feita || agora ? 'var(--primary)' : 'var(--border)';
      return `
        <div style="display:flex; gap:12px; align-items:flex-start; padding:8px 0; opacity:${feita || agora ? '1' : '0.5'};">
          <div style="width:36px; height:36px; border-radius:50%; border:3px solid ${cor}; display:flex; align-items:center; justify-content:center; flex-shrink:0; ${agora ? 'background:var(--primary);' : ''}">${feita ? '✔' : e.icone}</div>
          <div>
            <strong style="${agora ? 'color:var(--primary);' : ''}">${e.titulo}</strong>
            ${agora ? `<div style="font-size:14px; color:var(--text-muted);">${e.texto}</div>` : ''}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

// Retirada no balcão: código grande, "Como chegar", "Cheguei" (perto da loja) e compartilhar o comprovante
function renderRetirada(p) {
  const box = document.getElementById('acomp-retirada');
  if (!box) return;
  const ativo = p.tipoEntrega === 'retirada' && ['novo', 'preparo'].includes(p.status);
  box.classList.toggle('hidden', !ativo);
  if (!ativo) return;
  const loja = AppState.lojaDados || {};
  const local = loja.localizacao && Number.isFinite(Number(loja.localizacao.lat)) ? loja.localizacao : null;
  const rota = local ? `https://www.google.com/maps/dir/?api=1&destination=${local.lat},${local.lng}` : null;
  const comprovante = `Pedido #${p.numeroPedido || ''} na ${loja.nome || 'loja'} — retirada no balcão. Acompanhe: ${window.location.href}`;
  if (box.dataset.pedido === p.id && box.dataset.chegou === String(Boolean(p.clienteChegouEm))) return;
  box.dataset.pedido = p.id; box.dataset.chegou = String(Boolean(p.clienteChegouEm));
  box.innerHTML = `
    <span class="acomp-cod-rotulo">Código de retirada</span>
    <div class="acomp-cod">#${esc(p.numeroPedido || '')}</div>
    <p class="gc-dica">Fale este número no balcão.</p>
    ${p.clienteChegouEm ? '<p class="acomp-chegou-ok">✅ A loja já sabe que você chegou!</p>' : `<button class="btn-primary" type="button" id="acomp-cheguei">📣 Cheguei no balcão</button><small class="gc-dica" id="acomp-cheguei-dica">Funciona quando você estiver perto da loja.</small>`}
    <div class="acomp-ret-acoes">
      ${rota ? `<a class="btn-outline-sm" href="${rota}" target="_blank" rel="noopener">📍 Como chegar na loja</a>` : ''}
      <a class="btn-outline-sm" href="https://wa.me/?text=${encodeURIComponent(comprovante)}" target="_blank" rel="noopener">🧾 Compartilhar comprovante</a>
    </div>`;
  const btn = document.getElementById('acomp-cheguei');
  if (!btn) return;
  btn.onclick = () => {
    const dica = document.getElementById('acomp-cheguei-dica');
    const enviar = async () => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/cheguei', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: AppState.slug, pedidoId: p.id }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.erro || 'Não foi possível avisar agora.');
        dica.textContent = '✅ Avisamos a loja! Já vão te entregar.';
      } catch (err) { dica.textContent = err.message; btn.disabled = false; }
    };
    if (!local || !navigator.geolocation) return enviar();
    dica.textContent = '📡 Conferindo se você está perto da loja...';
    navigator.geolocation.getCurrentPosition((pos) => {
      const d = distanciaMetros({ lat: pos.coords.latitude, lng: pos.coords.longitude }, local);
      if (d > 150) { dica.textContent = `Você está a ${d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(d) + ' m'} da loja. Toque de novo quando chegar.`; return; }
      enviar();
    }, () => enviar(), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  };
}

// Cartão fidelidade depois da entrega (o carimbo é dado quando a loja/motoboy conclui o pedido)
let fidelidadeMostrada = false;
function renderFidelidade(p) {
  const box = document.getElementById('acomp-fidelidade');
  const fid = AppState.lojaDados && AppState.lojaDados.fidelidade;
  const whats = String(p.clienteWhatsapp || '').replace(/\D/g, '');
  if (!box || fidelidadeMostrada || !fid || !fid.ativo || whats.length < 10 || !AppState.slug) return;
  fidelidadeMostrada = true;
  setTimeout(async () => {
    try {
      const r = await fetch(`/api/fidelidade?loja=${encodeURIComponent(AppState.slug)}&whats=${whats}`);
      const f = r.ok ? await r.json() : null;
      if (!f || !f.ativo) return;
      const premio = (f.premioCentavos / 100).toFixed(2).replace('.', ',');
      box.classList.remove('hidden');
      box.innerHTML = f.premios > 0
        ? `<strong>🎉 Você completou o cartão fidelidade!</strong><p>Tem <strong>${f.premios} prêmio${f.premios > 1 ? 's' : ''} de R$ ${premio}</strong> para usar no próximo pedido. É só pedir com este mesmo WhatsApp.</p>`
        : `<strong>🎁 Cartão fidelidade: ${f.carimbos} de ${f.meta}</strong><div class="acomp-carimbos">${'●'.repeat(f.carimbos)}${'○'.repeat(Math.max(0, f.meta - f.carimbos))}</div><p class="gc-dica">Faltam ${f.meta - f.carimbos} pedido(s) para ganhar R$ ${premio} de desconto.</p>`;
    } catch (_) {}
  }, 4000);
}

// Se o motoboy deu baixa a menos de 40 m do pino do cliente, o endereço salvo neste aparelho
// fica "confirmado pelo entregador" e o cliente não precisa ajustar o pino da próxima vez.
function confirmarPinoPeloGps(p) {
  try {
    const d = p.destinoCoords, b = p.coordsBaixa;
    if (p.tipoEntrega !== 'entrega' || !d || !b || !Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(d.lat))) return;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - d.lat), dLng = rad(b.lng - d.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(d.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    if (2 * 6371000 * Math.asin(Math.sqrt(h)) > 40) return;
    const lista = JSON.parse(localStorage.getItem('enderecos_v1') || 'null');
    if (!Array.isArray(lista)) return;
    let mudou = false;
    lista.forEach(e => {
      if (e && e.endereco === p.enderecoTexto && !e.gpsVerificado) { e.gpsVerificado = true; e.destino = { lat: Number(d.lat), lng: Number(d.lng) }; mudou = true; }
    });
    if (mudou) localStorage.setItem('enderecos_v1', JSON.stringify(lista));
  } catch (_) {}
}

function renderAvaliacao(p) {
  const box = document.getElementById('acomp-avaliar');
  if (!box) return;
  document.getElementById('acomp-selo')?.classList.toggle('hidden', p.status !== 'concluido');
  if (p.status !== 'concluido') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (p.avaliado) { box.innerHTML = `<p>💚 Obrigado pela avaliação${p.avaliacaoNota ? ` (${'★'.repeat(p.avaliacaoNota)})` : ''}!</p>`; return; }
  box.innerHTML = `
    <strong>Como foi o seu pedido?</strong>
    <p class="gc-dica">Toque nas estrelas — leva 1 segundo.</p>
    <div class="av-estrelas grande">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-nota="${n}" aria-label="${n} estrela(s)">☆</button>`).join('')}</div>`;
  box.querySelectorAll('[data-nota]').forEach(b => {
    b.onclick = async () => {
      const nota = Number(b.dataset.nota);
      box.querySelectorAll('[data-nota]').forEach(x => { x.disabled = true; x.textContent = Number(x.dataset.nota) <= nota ? '★' : '☆'; });
      const ok = await enviarAvaliacao(p.id, nota);
      box.innerHTML = ok ? `<p>💚 Obrigado pela avaliação (${'★'.repeat(nota)})!</p>` : '<p>Não foi possível enviar agora. Tente de novo pelo cardápio.</p>';
    };
  });
}

function renderItens(p) {
  const box = document.getElementById('acomp-itens');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `
    <strong>Resumo</strong>
    ${(p.itens || []).map(i => `
      <div style="display:flex; justify-content:space-between; font-size:14px; padding:6px 0; border-bottom:1px solid var(--border);">
        <div>
          ${esc(i.quantidade)}x ${esc(i.nome)}
          ${i.detalhes?.length ? `<div style="font-size:12px; color:var(--text-muted);">${esc(i.detalhes.join(' | '))}</div>` : ''}
        </div>
        <span>${formatarCentavos(i.unitarioCentavos * i.quantidade)}</span>
      </div>
    `).join('')}
    ${p.freteCentavos ? `<div style="display:flex; justify-content:space-between; font-size:14px; margin-top:8px;"><span>Entrega</span><span>${formatarCentavos(p.freteCentavos)}</span></div>` : ''}
    <div style="display:flex; justify-content:space-between; margin-top:10px;">
      <span>Total (${esc((p.formaPagamento || '').toUpperCase())})</span>
      <strong>${formatarCentavos(p.totalCentavos)}</strong>
    </div>
    ${p.tipoEntrega !== 'retirada' ? `<p style="font-size:13px; color:var(--text-muted); margin-top:8px;">📍 ${esc(p.enderecoTexto)}</p>` : ''}
  `;
}

function distanciaMetros(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let ultimaPosicaoEm = 0;
let relogioPosicao = null;
function desenharIdadePosicao() {
  const el = document.getElementById('acomp-atualizado');
  if (!el) { clearInterval(relogioPosicao); relogioPosicao = null; return; }
  if (!ultimaPosicaoEm) { el.textContent = ''; return; }
  const s = Math.max(0, Math.round((Date.now() - ultimaPosicaoEm) / 1000));
  el.textContent = s < 60 ? `Posição atualizada há ${s} s` : `Posição atualizada há ${Math.round(s / 60)} min (o sinal do entregador pode estar fraco)`;
}

function renderMapa(p) {
  const card = document.getElementById('acomp-mapa-card');
  if (!card) return;
  const coords = p.motoboyCoords;
  const aviso = document.getElementById('acomp-chegando');
  // O entregador passou e ninguém atendeu: avisa o cliente (ele volta depois das outras entregas)
  const tent = document.getElementById('acomp-tentativa');
  if (tent) {
    const t = p.status === 'entrega' && p.tentativaAusente;
    tent.classList.toggle('hidden', !t);
    if (t) {
      const hora = t.em && t.em.toDate ? t.em.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      tent.innerHTML = `📵 <strong>O entregador passou aí${hora ? ` às ${hora}` : ''} e não conseguiu falar com você.</strong><span>Ele foi fazer outra entrega e volta em seguida. Fique de olho no portão e no telefone; a loja pode te ligar.</span>`;
    }
  }
  // "Atualizado há X s": no celular, o GPS do entregador pode pausar quando ele abre o Google Maps/Waze
  ultimaPosicaoEm = p.gpsAtualizadoEm && p.gpsAtualizadoEm.toMillis ? p.gpsAtualizadoEm.toMillis() : ultimaPosicaoEm;
  if (!relogioPosicao) relogioPosicao = setInterval(desenharIdadePosicao, 5000);
  desenharIdadePosicao();
  // Entrega feita pela própria loja (sem app de motoboy): sem mapa ao vivo, mostra um aviso claro
  if (p.status === 'entrega' && p.entregaPropria && !(coords && Number.isFinite(coords.lat))) {
    const parada0 = document.getElementById('acomp-parada');
    if (parada0) { parada0.classList.remove('hidden'); parada0.innerHTML = '🛵 <strong>Seu pedido saiu com o entregador da própria loja.</strong><span>Não temos o mapa ao vivo nessa entrega, mas ele já está a caminho. Fique de olho no portão e no telefone.</span>'; }
    card.classList.add('hidden');
    return;
  }
  // Entregador fazendo outra entrega antes desta: não mostra onde ele está (privacidade do outro cliente)
  const parada = document.getElementById('acomp-parada');
  const emParada = p.status === 'entrega' && coords && !coords.chegou && Number(coords.antes) >= 1 && !Number.isFinite(coords.lat);
  if (parada) {
    parada.classList.toggle('hidden', !emParada);
    if (emParada) parada.innerHTML = `🛵 <strong>Seu pedido já saiu!</strong><span>O entregador está fazendo ${Number(coords.antes) === 1 ? '1 parada rápida' : `${Number(coords.antes)} paradas rápidas`} no caminho antes de seguir para você. O mapa ao vivo aparece quando ele estiver vindo direto.</span>`;
  }
  if (emParada) { card.classList.add('hidden'); if (aviso) aviso.classList.add('hidden'); return; }
  // Privacidade: a 50 m do destino o mapa ao vivo é encerrado
  const perto = coords && (coords.chegou || (p.destinoCoords && Number.isFinite(coords.lat) && distanciaMetros(coords, p.destinoCoords) <= 50));
  if (aviso) aviso.classList.toggle('hidden', !(p.status === 'entrega' && perto));
  if (p.status !== 'entrega' || !coords || perto || !Number.isFinite(coords.lat) || typeof L === 'undefined') {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  // Rota com várias entregas: mostra só quantas vêm antes (nunca os endereços dos outros clientes)
  const antes = Number(coords.antes) || 0;
  const avisoAntes = document.getElementById('acomp-antes');
  if (avisoAntes) {
    avisoAntes.classList.toggle('hidden', antes < 1);
    avisoAntes.textContent = antes === 1 ? 'O entregador fará 1 entrega antes da sua.' : `O entregador fará ${antes} entregas antes da sua.`;
  }
  if (!mapa) {
    mapa = criarMapaRastreamento('acomp-mapa', coords, 15);
    marcadorMoto = criarMarcadorMoto(mapa, coords);
    if (p.destinoCoords) {
      L.marker([p.destinoCoords.lat, p.destinoCoords.lng]).addTo(mapa).bindPopup('Seu endereço');
      mapa.fitBounds(L.latLngBounds([[coords.lat, coords.lng], [p.destinoCoords.lat, p.destinoCoords.lng]]).pad(0.3));
      linhaRota = criarLinhaRota(mapa); // linha azul do caminho que falta
      linhaRota.acompanhar(coords, p.destinoCoords, marcadorMoto, 300); // a moto já nasce em cima da linha
    }
  } else {
    // A moto anda pela linha azul até o ponto da rua mais perto do GPS (o GPS oscila uns metros)
    if (linhaRota && p.destinoCoords) linhaRota.acompanhar(coords, p.destinoCoords, marcadorMoto, 2500);
    else marcadorMoto.moverSuavemente(coords, 2000);
    mapa.panTo([coords.lat, coords.lng]);
  }
}
