// Painel do dono: notas que os clientes deram (1 toque) e alertas de pino de endereço errado.
// O alerta aparece quando o motoboy deu baixa longe (mais de 150 m) do pino marcado pelo cliente.
import { db, esc } from './config.js';
import { AppState } from './router.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ms = (v) => (v && v.toMillis ? v.toMillis() : (Date.parse(v) || 0));

export async function abrirAvaliacoes() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>⭐ Avaliações dos clientes</h3>
        <button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div id="av-conteudo"><p>Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const box = overlay.querySelector('#av-conteudo');

  let lista = [];
  try {
    const snap = await getDocs(query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('avaliado', '==', true)));
    lista = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.avaliadoEm) - ms(a.avaliadoEm));
  } catch (err) {
    console.error(err);
    box.innerHTML = '<p>Não foi possível carregar as avaliações.</p>';
    return;
  }
  if (!lista.length) {
    box.innerHTML = '<p class="gc-dica">Ainda não há avaliações. Quando um pedido é entregue, o cliente pode dar a nota com 1 toque na tela de acompanhamento.</p>';
    return;
  }

  const recentes = lista.slice(0, 100);
  const media = recentes.reduce((a, p) => a + (Number(p.avaliacaoNota) || 0), 0) / recentes.length;
  const alertas = recentes.filter(p => p.alertaPinoMetros);
  const estrelas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const primeiroNome = (n) => esc(String(n || 'Cliente').trim().split(/\s+/)[0]);

  box.innerHTML = `
    <div class="ass-numeros">
      <div><strong>${media.toFixed(1).replace('.', ',')} ★</strong><span>nota média (${recentes.length} avaliações)</span></div>
      <div${alertas.length ? ' class="av-alerta-box"' : ''}><strong>${alertas.length}</strong><span>pinos de endereço para conferir</span></div>
    </div>
    ${alertas.length ? `
      <h4 class="gc-subtitulo">📍 Pinos para conferir</h4>
      <p class="gc-dica">O motoboy entregou longe do ponto que o cliente marcou no mapa. Peça para o cliente ajustar o pino no próximo pedido.</p>
      ${alertas.slice(0, 20).map(p => `
        <div class="av-linha alerta">
          <span>#${esc(p.numeroPedido || '')} · ${primeiroNome(p.clienteNome)}</span>
          <span>${esc(p.enderecoTexto || '')}</span>
          <strong>a ${p.alertaPinoMetros >= 1000 ? `${(p.alertaPinoMetros / 1000).toFixed(1).replace('.', ',')} km` : `${p.alertaPinoMetros} m`}</strong>
        </div>`).join('')}` : ''}
    <h4 class="gc-subtitulo">Últimas notas</h4>
    ${recentes.slice(0, 50).map(p => `
      <div class="av-linha">
        <span>#${esc(p.numeroPedido || '')} · ${primeiroNome(p.clienteNome)}</span>
        <span class="av-nota${Number(p.avaliacaoNota) <= 2 ? ' baixa' : ''}">${estrelas(Number(p.avaliacaoNota) || 0)}</span>
        <small>${ms(p.avaliadoEm) ? new Date(ms(p.avaliadoEm)).toLocaleDateString('pt-BR') : ''}</small>
      </div>`).join('')}
  `;
}
