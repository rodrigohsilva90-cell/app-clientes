import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { montarItem } from './cardapio.js';
import { abrirGestaoCardapio } from './gestao-cardapio.js';
import { abrirConfigEntrega } from './config-entrega.js';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, updateDoc, addDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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
        <button id="btn-gerenciar-cardapio" class="btn-outline-sm">🍕 Gerenciar cardápio</button>
        <button id="btn-config-entrega" class="btn-outline-sm">🛵 Entrega e frete</button>
        <button id="btn-cardapio-exemplo" class="btn-outline-sm">📋 Cardápio de exemplo</button>
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
  document.getElementById('btn-cardapio-exemplo').onclick = criarCardapioExemplo;
  document.getElementById('btn-gerenciar-cardapio').onclick = abrirGestaoCardapio;
  document.getElementById('btn-config-entrega').onclick = abrirConfigEntrega;

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
    where('status', 'in', ['novo', 'preparo', 'entrega'])
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

    // Ordena por chegada aqui no navegador (dispensa índice composto no Firestore)
    const tempo = (p) => (p.criadoEm?.toMillis ? p.criadoEm.toMillis() : Date.now());
    const pedidos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tempo(a) - tempo(b));

    pedidos.forEach((p) => {
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
    botaoAcao = p.tipoEntrega === 'retirada'
      ? `<button class="btn-primary" data-next="concluido">✅ Cliente retirou</button>`
      : `<button class="btn-primary" data-next="entrega">Despachar Motoboy</button>`;
  } else if (p.status === 'entrega') {
    botaoAcao = `<button class="btn-outline-sm" style="width:100%;" data-next="concluido">Marcar Entregue</button>`;
  }

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong>Pedido #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
      <button class="btn-outline-sm" style="padding:2px 8px;" data-print="1" title="Imprimir Comanda">🖨️</button>
    </div>
    <p style="font-size:14px; margin:4px 0;"><strong>${esc(p.clienteNome)}</strong> ${p.clienteWhatsapp ? `(${esc(p.clienteWhatsapp)})` : ''}</p>
    <p style="font-size:13px; color:var(--text-muted);">${esc(p.enderecoTexto)}</p>
    <div style="margin:8px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
      ${(p.itens || []).map(i => `<div>${esc(i.quantidade)}x ${esc(i.nome)} ${i.detalhes?.length ? `(${esc(i.detalhes.join(', '))})` : ''}</div>`).join('')}
    </div>
    ${p.freteCentavos ? `<div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted);"><span>🛵 Entrega${p.distanciaKm ? ` (${esc(p.distanciaKm)} km)` : ''}</span><span>${formatarCentavos(p.freteCentavos)}</span></div>` : ''}
    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
      <span>${esc((p.formaPagamento || '').toUpperCase())}${p.tipoEntrega === 'retirada' ? ' · 🏪 RETIRADA' : ''}</span>
      <strong>${formatarCentavos(p.totalCentavos)}</strong>
    </div>
    ${trocoTxt}
    ${p.status === 'entrega' ? `<div style="font-size:13px; margin-bottom:8px;">🛵 Com: <strong>${esc(p.motoboyNome || (p.motoboyId ? 'entregador (app)' : 'sem entregador'))}</strong></div>` : ''}
    ${botaoAcao}
  `;

  div.querySelector('[data-print]')?.addEventListener('click', () => imprimirComandaTermica(p));

  const btnNext = div.querySelector('[data-next]');
  if (btnNext) {
    btnNext.onclick = async () => {
      const novoStatus = btnNext.dataset.next;
      if (novoStatus === 'entrega') return despacharParaEntregador(p);
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
      ${p.freteCentavos ? `Subtotal: ${formatarCentavos(p.subtotalCentavos ?? (p.totalCentavos - p.freteCentavos))}<br/>Entrega: ${formatarCentavos(p.freteCentavos)}<br/>` : ''}
      ${p.tipoEntrega === 'retirada' ? '*** RETIRADA NA LOJA ***<br/>' : ''}
      <strong>TOTAL: ${formatarCentavos(p.totalCentavos)}</strong><br/>
      Pagamento: ${esc((p.formaPagamento || '').toUpperCase())}
      ${p.trocoParaCentavos > p.totalCentavos ? `<br/>TROCO P/ ${formatarCentavos(p.trocoParaCentavos)}: ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)}` : ''}
    </div>
  `;
  window.print();
}

// Pedido de balcão/telefone: o atendente escolhe os itens do próprio cardápio
async function abrirPedidoManualRapido() {
  let produtos = [];
  let categorias = [];
  try {
    const snap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
    const dados = snap.exists() ? snap.data() : {};
    produtos = (dados.produtos || []).filter(p => !p.excluido);
    categorias = dados.categorias || [];
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar o cardápio.');
    return;
  }
  if (!produtos.length) {
    showToast('Cardápio vazio: cadastre produtos primeiro (botão "Cardápio de exemplo").');
    return;
  }

  const sacola = [];
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:12px;';
  overlay.innerHTML = `
    <div class="card" style="max-width:920px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>Pedido Balcão / Telefone</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div id="pm-cardapio"></div>
        <div>
          <h4 style="margin-bottom:6px;">🧾 Itens do pedido</h4>
          <div id="pm-sacola"></div>

          <label style="display:block; font-size:13px; font-weight:600; margin-top:10px;">Nome do cliente</label>
          <input id="pm-nome" type="text" placeholder="Ex: Maria" style="${campo}" />

          <label style="display:block; font-size:13px; font-weight:600;">Telefone (opcional)</label>
          <input id="pm-tel" type="tel" placeholder="11999999999" style="${campo}" />

          <label style="display:block; font-size:13px; font-weight:600;">Tipo</label>
          <select id="pm-tipo" style="${campo}">
            <option value="retirada">Retirada no balcão</option>
            <option value="entrega">Entrega (motoboy)</option>
          </select>

          <div id="pm-box-endereco" class="hidden">
            <label style="display:block; font-size:13px; font-weight:600;">Endereço e referência</label>
            <input id="pm-endereco" type="text" placeholder="Rua, número - bairro" style="${campo}" />
          </div>

          <label style="display:block; font-size:13px; font-weight:600;">Pagamento</label>
          <select id="pm-pag" style="${campo}">
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
            <option value="pix">Pix</option>
          </select>

          <div id="pm-box-troco">
            <label style="display:block; font-size:13px; font-weight:600;">Troco para quanto? (R$, opcional)</label>
            <input id="pm-troco" type="number" placeholder="Ex: 100" style="${campo}" />
          </div>

          <div style="display:flex; justify-content:space-between; font-size:17px; margin:8px 0 12px;">
            <span>Total:</span><strong id="pm-total">R$ 0,00</strong>
          </div>
          <button class="btn-primary" id="pm-lancar">Lançar pedido na cozinha</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  $('[data-fechar]').onclick = () => overlay.remove();
  $('#pm-tipo').onchange = () => $('#pm-box-endereco').classList.toggle('hidden', $('#pm-tipo').value !== 'entrega');
  $('#pm-pag').onchange = () => $('#pm-box-troco').classList.toggle('hidden', $('#pm-pag').value !== 'dinheiro');

  const totalSacola = () => sacola.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);

  function adicionar(item) {
    const chave = JSON.stringify([item.produtoId, item.detalhes, item.unitarioCentavos]);
    const igual = sacola.find(i => JSON.stringify([i.produtoId, i.detalhes, i.unitarioCentavos]) === chave);
    if (igual) igual.quantidade += 1;
    else sacola.push(item);
    renderSacola();
  }

  function renderSacola() {
    const box = $('#pm-sacola');
    if (!sacola.length) {
      box.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Toque nos produtos ao lado para adicionar.</p>';
    } else {
      box.innerHTML = sacola.map((i, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:14px;">
          <div style="flex:1;">
            <strong>${esc(i.nome)}</strong>
            ${i.detalhes.length ? `<div style="font-size:12px; color:var(--text-muted);">${esc(i.detalhes.join(' | '))}</div>` : ''}
            <div style="font-size:12px;">${formatarCentavos(i.unitarioCentavos)} cada</div>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="btn-outline-sm" style="padding:2px 10px;" data-menos="${idx}">−</button>
            <strong style="min-width:22px; text-align:center;">${i.quantidade}</strong>
            <button class="btn-outline-sm" style="padding:2px 10px;" data-mais="${idx}">+</button>
          </div>
        </div>
      `).join('');
      box.querySelectorAll('[data-mais]').forEach(b => b.onclick = () => { sacola[Number(b.dataset.mais)].quantidade += 1; renderSacola(); });
      box.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => {
        const i = Number(b.dataset.menos);
        sacola[i].quantidade -= 1;
        if (sacola[i].quantidade <= 0) sacola.splice(i, 1);
        renderSacola();
      });
    }
    $('#pm-total').textContent = formatarCentavos(totalSacola());
  }

  function renderListaProdutos() {
    const idsCategorias = new Set(categorias.map(c => c.id));
    const grupos = [
      ...categorias.map(c => ({ nome: c.nome, itens: produtos.filter(p => p.categoriaId === c.id) })),
      { nome: 'Outros', itens: produtos.filter(p => !idsCategorias.has(p.categoriaId)) }
    ].filter(g => g.itens.length);

    $('#pm-cardapio').innerHTML = grupos.map(g => `
      <h4 style="margin:6px 0;">${esc(g.nome)}</h4>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:8px; margin-bottom:10px;">
        ${g.itens.map(p => {
          const esgotado = p.controlarEstoque && p.estoque <= 0;
          return `
            <button class="btn-outline-sm" data-prod="${esc(p.id)}" ${esgotado ? 'disabled' : ''} style="text-align:left; padding:10px; min-height:64px; ${esgotado ? 'opacity:0.5;' : ''}">
              <div>${esc(p.nome)}</div>
              <div style="color:var(--primary); font-size:13px;">${p.grupos?.length ? 'Escolher opções' : formatarCentavos(p.precoCentavos)}</div>
              ${esgotado ? '<div style="font-size:12px;">Esgotado</div>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    `).join('');

    $('#pm-cardapio').querySelectorAll('[data-prod]').forEach(btn => {
      btn.onclick = () => {
        const prod = produtos.find(p => p.id === btn.dataset.prod);
        if (!prod) return;
        if (!prod.grupos || !prod.grupos.length) {
          const r = montarItem(prod, {});
          adicionar(r.item);
          showToast(`${prod.nome} adicionado`);
        } else {
          renderOpcoes(prod);
        }
      };
    });
  }

  function renderOpcoes(prod) {
    const selecoes = {};
    $('#pm-cardapio').innerHTML = `
      <button class="btn-outline-sm" data-voltar style="margin-bottom:8px;">← Voltar ao cardápio</button>
      <h4>${esc(prod.nome)}</h4>
      ${prod.grupos.map((grp, gi) => `
        <div style="border-top:1px solid var(--border); padding:8px 0;">
          <strong>${esc(grp.titulo)}</strong>
          <small style="display:block; color:var(--text-muted);">Escolha de ${grp.minimo || 0} até ${grp.maximo || 1}</small>
          ${(grp.opcoes || []).map((op, oi) => `
            <label style="display:flex; justify-content:space-between; padding:6px 0; cursor:pointer;">
              <span><input type="checkbox" data-g="${gi}" data-o="${oi}" /> ${esc(op.nome)}</span>
              <span>+${formatarCentavos(op.precoCentavos)}</span>
            </label>
          `).join('')}
        </div>
      `).join('')}
      <button class="btn-primary" data-add-opcoes style="margin-top:8px;">Adicionar ao pedido</button>
    `;
    $('[data-voltar]').onclick = renderListaProdutos;
    $('#pm-cardapio').querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.onchange = () => {
        const gi = Number(chk.dataset.g);
        const grupo = prod.grupos[gi];
        const opcao = grupo.opcoes[Number(chk.dataset.o)];
        selecoes[gi] = selecoes[gi] || [];
        if (chk.checked) {
          if (selecoes[gi].length >= (grupo.maximo || 1)) {
            chk.checked = false;
            showToast(`Máximo de ${grupo.maximo || 1} em "${grupo.titulo}".`);
            return;
          }
          selecoes[gi].push(opcao);
        } else {
          selecoes[gi] = selecoes[gi].filter(o => o !== opcao);
        }
      };
    });
    $('[data-add-opcoes]').onclick = () => {
      const r = montarItem(prod, selecoes);
      if (r.erro) { showToast(r.erro); return; }
      adicionar(r.item);
      showToast(`${prod.nome} adicionado`);
      renderListaProdutos();
    };
  }

  $('#pm-lancar').onclick = async () => {
    const nome = $('#pm-nome').value.trim();
    const telefone = $('#pm-tel').value.replace(/\D/g, '');
    const tipo = $('#pm-tipo').value;
    const endereco = $('#pm-endereco').value.trim();
    const pagamento = $('#pm-pag').value;
    const totalCentavos = totalSacola();
    const trocoParaCentavos = pagamento === 'dinheiro' ? Math.round((Number($('#pm-troco').value) || 0) * 100) : 0;

    if (!sacola.length) { showToast('Adicione pelo menos um item.'); return; }
    if (!nome) { showToast('Informe o nome do cliente.'); return; }
    if (tipo === 'entrega' && !endereco) { showToast('Informe o endereço de entrega.'); return; }
    if (trocoParaCentavos && trocoParaCentavos < totalCentavos) { showToast('O valor do troco é menor que o total.'); return; }

    const btn = $('#pm-lancar');
    btn.disabled = true;
    btn.textContent = 'Lançando...';
    try {
      await addDoc(collection(db, 'lojas', AppState.lojaId, 'pedidos'), {
        numeroPedido: Math.floor(100 + Math.random() * 900),
        clienteNome: nome,
        clienteWhatsapp: telefone,
        enderecoTexto: tipo === 'entrega' ? endereco : 'Retirada no balcão',
        tipoEntrega: tipo,
        itens: sacola,
        totalCentavos,
        formaPagamento: pagamento,
        trocoParaCentavos,
        status: 'preparo',
        origem: 'balcao',
        criadoEm: serverTimestamp()
      });
      overlay.remove();
      showToast('Pedido lançado direto na cozinha!');
    } catch (err) {
      console.error(err);
      showToast('Erro ao lançar o pedido.');
      btn.disabled = false;
      btn.textContent = 'Lançar pedido na cozinha';
    }
  };

  renderListaProdutos();
  renderSacola();
}

// Cria um cardápio de teste (pizza meio a meio + bebidas) no documento único da vitrine
async function criarCardapioExemplo() {
  if (!confirm('Criar o cardápio de exemplo? Isso SUBSTITUI o cardápio atual desta loja.')) return;
  const cardapio = {
    categorias: [
      { id: 'pizzas', nome: '🍕 Pizzas' },
      { id: 'bebidas', nome: '🥤 Bebidas' }
    ],
    produtos: [
      {
        id: 'pizza_grande', categoriaId: 'pizzas', nome: 'Pizza Grande (8 fatias)',
        descricao: 'Escolha 1 sabor ou 2 sabores (meio a meio). Cobra o sabor mais caro.',
        precoCentavos: 0,
        grupos: [
          {
            titulo: 'Sabores', minimo: 1, maximo: 2, regraDePreco: 'MAIOR_VALOR',
            opcoes: [
              { nome: 'Mussarela', precoCentavos: 4200 },
              { nome: 'Calabresa', precoCentavos: 4500 },
              { nome: 'Frango com Catupiry', precoCentavos: 4900 },
              { nome: 'Portuguesa', precoCentavos: 5200 }
            ]
          },
          {
            titulo: 'Borda recheada', minimo: 0, maximo: 1, regraDePreco: 'SOMA',
            opcoes: [
              { nome: 'Catupiry', precoCentavos: 800 },
              { nome: 'Cheddar', precoCentavos: 800 }
            ]
          }
        ]
      },
      { id: 'refri_2l', categoriaId: 'bebidas', nome: 'Refrigerante 2L', descricao: 'Coca-Cola ou Guaraná', precoCentavos: 1200 },
      { id: 'agua', categoriaId: 'bebidas', nome: 'Água sem gás 500ml', descricao: '', precoCentavos: 400 }
    ],
    atualizadoEm: serverTimestamp()
  };
  try {
    await setDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'), cardapio);
    showToast('Cardápio de exemplo criado! Abra a vitrine para ver.');
  } catch (err) {
    console.error(err);
    showToast(err.code === 'permission-denied' ? 'Sem permissão: entre com a conta da equipe.' : 'Erro ao criar o cardápio.');
  }
}

// Despacha o pedido para um entregador escolhido da lista (ele passa a ver no app na hora)
async function despacharParaEntregador(p) {
  let entregadores = [];
  try {
    const snap = await getDocs(collection(db, 'lojas', AppState.lojaId, 'entregadores'));
    entregadores = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || 'Entregador' }));
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar a lista de entregadores.');
    return;
  }
  if (!entregadores.length) {
    showToast('Nenhum entregador cadastrado nesta loja.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;';
  overlay.innerHTML = `
    <div class="card" style="max-width:380px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>Quem vai entregar o #${esc(p.numeroPedido || p.id.slice(0, 4))}?</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      ${entregadores.map(e => `
        <button class="btn-outline-sm" data-uid="${esc(e.uid)}" style="width:100%; text-align:left; padding:12px; margin-bottom:8px; font-size:15px;">🛵 ${esc(e.nome)}</button>
      `).join('')}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelectorAll('[data-uid]').forEach(btn => {
    btn.onclick = async () => {
      const escolhido = entregadores.find(e => e.uid === btn.dataset.uid);
      btn.disabled = true;
      try {
        await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
          status: 'entrega',
          motoboyId: escolhido.uid,
          motoboyNome: escolhido.nome,
          saiuParaEntregaEm: serverTimestamp(),
          atualizadoEm: serverTimestamp()
        });
        overlay.remove();
        showToast(`Pedido #${p.numeroPedido || ''} enviado para ${escolhido.nome}`);
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        showToast('Erro ao despachar o pedido.');
      }
    };
  });
}
