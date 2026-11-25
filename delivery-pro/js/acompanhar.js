// Página de acompanhamento do pedido pelo cliente: /{slug}/pedido/{id}
// O ID do pedido é longo e aleatório, funciona como "senha" do link.
import { db, formatarCentavos, esc } from './config.js';
import { AppState } from './router.js';
import { criarMapaRastreamento, criarMarcadorMoto } from './geo.js';
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

export function iniciarAcompanhamento(pedidoId) {
  const root = document.getElementById('app-root');
  if (pararEscuta) { pararEscuta(); pararEscuta = null; }
  mapa = null;
  marcadorMoto = null;

  root.innerHTML = `
    <a href="/${esc(AppState.slug)}" class="btn-outline-sm" style="text-decoration:none; display:inline-block; margin-bottom:12px;">← Voltar ao cardápio</a>
    <div class="card" id="acomp-status"><p>Carregando seu pedido...</p></div>
    <div class="card hidden" id="acomp-mapa-card">
      <strong>🛵 Entregador a caminho</strong>
      <div id="acomp-mapa" style="height:260px; border-radius:8px; margin-top:10px; z-index:1;"></div>
    </div>
    <div class="card hidden" id="acomp-avaliar"></div>
    <div class="card hidden" id="acomp-itens"></div>
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
      const p = { id: snap.id, ...snap.data() };
      renderStatus(p);
      renderItens(p);
      renderMapa(p);
      renderAvaliacao(p);
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

function etapasDo(p) {
  if (p.tipoEntrega === 'retirada') {
    return [
      { status: 'novo', icone: '📝', titulo: 'Pedido recebido', texto: 'Aguardando a loja confirmar.' },
      { status: 'preparo', icone: '🔥', titulo: 'Em preparo', texto: 'A loja está preparando seu pedido.' },
      { status: 'concluido', icone: '✅', titulo: 'Retirado', texto: 'Obrigado pela preferência!' }
    ];
  }
  return [
    { status: 'novo', icone: '📝', titulo: 'Pedido recebido', texto: 'Aguardando a loja confirmar.' },
    { status: 'preparo', icone: '🔥', titulo: 'Em preparo', texto: 'A loja está preparando seu pedido.' },
    { status: 'entrega', icone: '🛵', titulo: 'Saiu para entrega', texto: 'O entregador está a caminho.' },
    { status: 'concluido', icone: '✅', titulo: 'Entregue', texto: 'Bom apetite!' }
  ];
}

function renderStatus(p) {
  const box = document.getElementById('acomp-status');
  if (!box) return;
  const numero = esc(p.numeroPedido || p.id.slice(0, 6).toUpperCase());

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

function renderAvaliacao(p) {
  const box = document.getElementById('acomp-avaliar');
  if (!box) return;
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

function renderMapa(p) {
  const card = document.getElementById('acomp-mapa-card');
  if (!card) return;
  const coords = p.motoboyCoords;
  if (p.status !== 'entrega' || !coords || typeof L === 'undefined') {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  if (!mapa) {
    mapa = criarMapaRastreamento('acomp-mapa', coords, 15);
    if (p.destinoCoords) L.marker([p.destinoCoords.lat, p.destinoCoords.lng]).addTo(mapa).bindPopup('Seu endereço');
    marcadorMoto = criarMarcadorMoto(mapa, coords);
  } else {
    marcadorMoto.moverSuavemente(coords, 2000);
    mapa.panTo([coords.lat, coords.lng]);
  }
}
