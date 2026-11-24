import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let audioCtx = null;
let wakeLock = null;
let campainhaAtiva = false;
let pedidosConhecidos = new Set();

export function iniciarBalcao() {
  const root = document.getElementById('app-root');

  root.innerHTML = `
    <!-- Barra de Ativação de Som e Controle de Pico -->
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <strong>Painel Operacional — ${AppState.lojaDados.nome}</strong>
        <div id="status-som" style="font-size:13px; color:var(--warning);">🔇 Campainha aguardando ativação</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="btn-ativar-caixa" class="btn-primary" style="width:auto;">🔊 Abrir Caixa e Ativar Campainha</button>
        <button id="btn-pedido-manual" class="btn-outline-sm">+ Pedido Balcão / Tel</button>
      </div>
    </div>

    <!-- Kanban de Pedidos -->
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">
      <div>
        <h3 style="margin-bottom:8px;">🔔 Novos Pedidos</h3>
        <div id="col-novo"></div>
      </div>
      <div>
        <h3 style="margin-bottom:8px;">🔥 Em Preparo</h3>
        <div id="col-preparo"></div>
      </div>
      <div>
        <h3 style="margin-bottom:8px;">🛵 Saiu para Entrega</h3>
        <div id="col-entrega"></div>
      </div>
    </div>

    <!-- Área oculta exclusiva para Impressão Térmica (58mm/80mm) -->
    <div id="print-receipt"></div>
  `;

  document.getElementById('btn-ativar-caixa').onclick = ativarSomEWakeLock;
  document.getElementById('btn-pedido-manual').onclick = abrirPedidoManualRapido;

  escutarPedidosEmTempoReal();
}

async function ativarSomEWakeLock() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    tocarBipeCampainha();
    campainhaAtiva = true;

    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }

    const statusEl = document.getElementById('status-som');
    statusEl.textContent = '🔊 Campainha ativa e tela mantida acordada';
    statusEl.style.color = 'var(--success)';
    document.getElementById('btn-ativar-caixa').classList.add('hidden');
    showToast('Caixa aberto! Campainha pronta para novos pedidos.');
  } catch (err) {
    showToast('Não foi possível ativar o áudio automático.');
  }
}

function tocarBipeCampainha() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

function escutarPedidosEmTempoReal() {
  const q = query(
    collection(db, 'lojas', AppState.lojaId, 'pedidos'),
    where('status', 'in', ['novo', 'preparo', 'entrega']),
    orderBy('criadoEm', 'asc')
  );

  onSnapshot(q, (snapshot) => {
    const colunas = {
      novo: document.getElementById('col-novo'),
      preparo: document.getElementById('col-preparo'),
      entrega: document.getElementById('col-entrega')
    };
    colunas.novo.innerHTML = '';
    colunas.preparo.innerHTML = '';
    colunas.entrega.innerHTML = '';

    let temNovoPedido = false;

    snapshot.forEach((docSnap) => {
      const p = { id: docSnap.id, ...docSnap.data() };
      if (p.status === 'novo' && !pedidosConhecidos.has(p.id)) {
        temNovoPedido = true;
      }
      pedidosConhecidos.add(p.id);

      const card = criarCardPedidoBalcao(p);
      if (colunas[p.status]) colunas[p.status].appendChild(card);
    });

    if (temNovoPedido && campainhaAtiva) {
      tocarBipeCampainha();
    }
  }, (err) => {
    console.error(err);
    document.getElementById('col-novo').innerHTML = err.code === 'permission-denied'
      ? '<div class="card">🔒 Entre com uma conta da equipe desta loja (botão "Entrar" no topo).</div>'
      : '<div class="card">Erro ao carregar pedidos. Veja o console (F12).</div>';
  });
}

function criarCardPedidoBalcao(p) {
  const div = document.createElement('div');
  div.className = 'card';
  div.style.borderLeft = p.status === 'novo' ? '4px solid var(--danger)' : '4px solid var(--primary)';

  const trocoTxt = (p.formaPagamento === 'dinheiro' && p.trocoParaCentavos > p.totalCentavos)
    ? `<div style="color:var(--warning); font-weight:700; font-size:13px;">💵 Levar troco: ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)}</div>`
    : '';

  let botaoAcao = '';
  if (p.status === 'novo') {
    botaoAcao = `<button class="btn-primary" data-next="preparo">Aceitar Pedido</button>`;
  } else if (p.status === 'preparo') {
    botaoAcao = `<button class="btn-primary" data-next="entrega">Despachar Motoboy</button>`;
  } else if (p.status === 'entrega') {
    botaoAcao = `<button class="btn-outline-sm" style="width:100%;" data-next="concluido">Marcar Entregue</button>`;
  }

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong>Pedido #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
      <button class="btn-outline-sm" style="padding:2px 8px;" data-print="1" title="Imprimir Comanda">🖨️</button>
    </div>
    <p style="font-size:14px; margin:4px 0;"><strong>${esc(p.clienteNome)}</strong> (${esc(p.clienteWhatsapp)})</p>
    <p style="font-size:13px; color:var(--text-muted);">${esc(p.enderecoTexto)}</p>
    <div style="margin:8px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
      ${(p.itens || []).map(i => `<div>${esc(i.quantidade)}x ${esc(i.nome)} ${i.detalhes?.length ? `(${esc(i.detalhes.join(', '))})` : ''}</div>`).join('')}
    </div>
    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
      <span>${esc((p.formaPagamento || '').toUpperCase())}</span>
      <strong>${formatarCentavos(p.totalCentavos)}</strong>
    </div>
    ${trocoTxt}
    ${botaoAcao}
  `;

  div.querySelector('[data-print]')?.addEventListener('click', () => imprimirComandaTermica(p));

  const btnNext = div.querySelector('[data-next]');
  if (btnNext) {
    btnNext.onclick = async () => {
      const novoStatus = btnNext.dataset.next;
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
        status: novoStatus,
        atualizadoEm: serverTimestamp()
      });
      showToast(`Pedido #${esc(p.numeroPedido)} movido para ${novoStatus.toUpperCase()}`);
    };
  }

  return div;
}

function imprimirComandaTermica(p) {
  const area = document.getElementById('print-receipt');
  area.innerHTML = `
    <div style="text-align:center; border-bottom:1px dashed #000; padding-bottom:6px;">
      <strong>${AppState.lojaDados.nome.toUpperCase()}</strong><br/>
      PEDIDO #${esc(p.numeroPedido || p.id.slice(0, 4))}<br/>
      ${new Date().toLocaleString('pt-BR')}
    </div>
    <div style="padding:6px 0; border-bottom:1px dashed #000;">
      Cliente: ${esc(p.clienteNome)}<br/>
      Tel: ${esc(p.clienteWhatsapp)}<br/>
      End: ${esc(p.enderecoTexto)}
    </div>
    <div style="padding:6px 0; border-bottom:1px dashed #000;">
      ${(p.itens || []).map(i => `
        <div>${esc(i.quantidade)}x ${esc(i.nome)} - ${formatarCentavos(i.unitarioCentavos * i.quantidade)}</div>
        ${i.detalhes?.length ? `<div style="font-size:11px;">  * ${esc(i.detalhes.join(' | '))}</div>` : ''}
      `).join('')}
    </div>
    <div style="padding-top:6px;">
      <strong>TOTAL: ${formatarCentavos(p.totalCentavos)}</strong><br/>
      Pagamento: ${esc((p.formaPagamento || '').toUpperCase())}
      ${p.trocoParaCentavos > p.totalCentavos ? `<br/>TROCO P/ ${formatarCentavos(p.trocoParaCentavos)}: ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)}` : ''}
    </div>
  `;
  window.print();
}

async function abrirPedidoManualRapido() {
  const cliente = prompt('Nome do cliente (Balcão / Telefone):');
  if (!cliente) return;
  const descricao = prompt('Item e valor (Ex: 1x Pizza Calabresa):');
  const valorReais = Number(prompt('Valor total em R$ (Ex: 45.00):') || 0);
  if (!descricao || valorReais <= 0) return;

  await addDoc(collection(db, 'lojas', AppState.lojaId, 'pedidos'), {
    numeroPedido: Math.floor(100 + Math.random() * 900),
    clienteNome: `${cliente} (Balcão)`,
    clienteWhatsapp: '00000000000',
    enderecoTexto: 'Retirada / Pedido Manual no Balcão',
    itens: [{ nome: descricao, quantidade: 1, unitarioCentavos: Math.round(valorReais * 100), detalhes: [] }],
    totalCentavos: Math.round(valorReais * 100),
    formaPagamento: 'balcao',
    status: 'preparo',
    criadoEm: serverTimestamp()
  });
  showToast('Pedido manual lançado direto na cozinha!');
}
