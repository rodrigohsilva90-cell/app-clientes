import { db, formatarCentavos, showToast, WORKER_API_URL } from './config.js';
import { AppState } from './router.js';
import { montarItem } from './cardapio.js';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let carrinho = [];
let produtoSelecionado = null;
let selecoesAtuais = {};
let checkoutToken = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

export async function iniciarVitrine() {
  const root = document.getElementById('app-root');
  const loja = AppState.lojaDados;
  const storageKey = `carrinho_${AppState.lojaId}`;

  // Recupera carrinho salvo localmente (custo zero de banco)
  try {
    const salvo = localStorage.getItem(storageKey);
    if (salvo) carrinho = JSON.parse(salvo);
  } catch (_) { carrinho = []; }

  // Busca documento único consolidado do cardápio
  const cardapioSnap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
  const dadosCardapio = cardapioSnap.exists() ? cardapioSnap.data() : { categorias: [], produtos: [] };

  const modoLayout = loja.layoutVitrine || 'gastronomia'; // 'gastronomia' | 'varejo'
  const tempoEstimado = loja.tempoEstimado || '30-45 min';

  root.innerHTML = `
    <div class="card" style="border-left: 5px solid var(--primary);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div>
          <h2>${loja.nome}</h2>
          <p style="color: var(--text-muted); font-size: 14px;">⏱️ Tempo estimado: <strong>${tempoEstimado}</strong></p>
        </div>
        <span class="badge" style="background:#dcfce7; color:#166534;">● Aberto agora</span>
      </div>
    </div>

    <div id="lista-categorias"></div>

    <!-- Barra Flutuante do Carrinho -->
    <div id="barra-carrinho" class="card hidden" style="position:sticky; bottom:12px; background:var(--primary); color:#fff; display:flex; justify-content:space-between; align-items:center; cursor:pointer; z-index:800;">
      <span id="carrinho-resumo">0 itens</span>
      <strong id="carrinho-total">R$ 0,00 — Ver Sacola</strong>
    </div>

    <!-- Modal de Montagem de Produto (Meio a Meio / Adicionais) -->
    <div id="modal-produto" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;">
      <div class="card" style="max-width:500px; width:100%; max-height:85vh; overflow-y:auto;" id="modal-produto-conteudo"></div>
    </div>

    <!-- Modal de Checkout -->
    <div id="modal-checkout" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;">
      <div class="card" style="max-width:500px; width:100%; max-height:90vh; overflow-y:auto;" id="modal-checkout-conteudo"></div>
    </div>
  `;

  renderizarProdutos(dadosCardapio, modoLayout);
  atualizarBarraCarrinho();

  document.getElementById('barra-carrinho').onclick = () => abrirModalCheckout();
}

function renderizarProdutos(dados, modoLayout) {
  const container = document.getElementById('lista-categorias');
  const { categorias = [], produtos = [] } = dados;

  if (!produtos.length) {
    container.innerHTML = `<div class="card"><p>Nenhum produto cadastrado nesta vitrine ainda.</p></div>`;
    return;
  }

  container.innerHTML = categorias.map(cat => {
    const itensCat = produtos.filter(p => p.categoriaId === cat.id && !p.excluido);
    if (!itensCat.length) return '';

    const gridStyle = modoLayout === 'varejo'
      ? 'display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:12px;'
      : 'display:flex; flex-direction:column; gap:10px;';

    return `
      <h3 style="margin: 16px 0 8px;">${cat.nome}</h3>
      <div style="${gridStyle}">
        ${itensCat.map(prod => {
          const esgotado = prod.controlarEstoque && (prod.estoque <= 0);
          return `
            <div class="card" style="margin-bottom:0; display:flex; justify-content:space-between; align-items:center; gap:12px; opacity:${esgotado ? '0.55' : '1'};">
              <div style="flex:1;">
                <strong>${prod.nome}</strong>
                <p style="font-size:13px; color:var(--text-muted); margin:4px 0;">${prod.descricao || ''}</p>
                <span style="font-weight:700; color:var(--primary);">${formatarCentavos(prod.precoCentavos)}</span>
                ${esgotado ? '<span class="badge" style="margin-left:6px;">Esgotado</span>' : ''}
              </div>
              <button class="btn-outline-sm" ${esgotado ? 'disabled' : ''} data-prod-id="${prod.id}">
                ${modoLayout === 'varejo' && (!prod.grupos || !prod.grupos.length) ? '+ Adicionar' : 'Escolher'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  container.querySelectorAll('button[data-prod-id]').forEach(btn => {
    btn.onclick = () => {
      const prod = produtos.find(p => p.id === btn.dataset.prodId);
      if (!prod) return;
      if (!prod.grupos || prod.grupos.length === 0) {
        adicionarAoCarrinho({
          produtoId: prod.id,
          nome: prod.nome,
          quantidade: 1,
          unitarioCentavos: prod.precoCentavos,
          detalhes: []
        });
      } else {
        abrirModalProduto(prod);
      }
    };
  });
}

function abrirModalProduto(prod) {
  produtoSelecionado = prod;
  selecoesAtuais = {};
  const modal = document.getElementById('modal-produto');
  const content = document.getElementById('modal-produto-conteudo');

  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3>${prod.nome}</h3>
      <button class="btn-outline-sm" id="fechar-modal-prod">✕</button>
    </div>
    ${(prod.grupos || []).map((grp, idx) => `
      <div style="border-top:1px solid var(--border); padding:10px 0;">
        <strong>${grp.titulo}</strong>
        <small style="display:block; color:var(--text-muted); margin-bottom:6px;">
          Escolha de ${grp.minimo || 0} até ${grp.maximo || 1} (${grp.regraDePreco || 'SOMA'})
        </small>
        ${(grp.opcoes || []).map((op, opIdx) => `
          <label style="display:flex; justify-content:space-between; padding:6px 0; cursor:pointer;">
            <span>
              <input type="checkbox" data-grp="${idx}" data-op="${opIdx}" />
              ${op.nome}
            </span>
            <span>+${formatarCentavos(op.precoCentavos)}</span>
          </label>
        `).join('')}
      </div>
    `).join('')}
    <button class="btn-primary" id="confirmar-item-modal" style="margin-top:12px;">Adicionar à Sacola</button>
  `;

  modal.classList.remove('hidden');
  document.getElementById('fechar-modal-prod').onclick = () => modal.classList.add('hidden');

  content.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.onchange = () => {
      const gIdx = Number(chk.dataset.grp);
      const oIdx = Number(chk.dataset.op);
      const grupo = prod.grupos[gIdx];
      selecoesAtuais[gIdx] = selecoesAtuais[gIdx] || [];

      if (chk.checked) {
        if (selecoesAtuais[gIdx].length >= (grupo.maximo || 1)) {
          chk.checked = false;
          showToast(`Máximo de ${grupo.maximo} opção(ões) neste grupo.`);
          return;
        }
        selecoesAtuais[gIdx].push(grupo.opcoes[oIdx]);
      } else {
        selecoesAtuais[gIdx] = selecoesAtuais[gIdx].filter(o => o !== grupo.opcoes[oIdx]);
      }
    };
  });

  document.getElementById('confirmar-item-modal').onclick = () => {
    const resultado = montarItem(prod, selecoesAtuais);
    if (resultado.erro) {
      showToast(resultado.erro);
      return;
    }
    adicionarAoCarrinho(resultado.item);
    modal.classList.add('hidden');
  };
}

function adicionarAoCarrinho(item) {
  carrinho.push(item);
  localStorage.setItem(`carrinho_${AppState.lojaId}`, JSON.stringify(carrinho));
  atualizarBarraCarrinho();
  showToast(`${item.nome} adicionado!`);
}

function atualizarBarraCarrinho() {
  const barra = document.getElementById('barra-carrinho');
  if (!barra) return;
  if (!carrinho.length) {
    barra.classList.add('hidden');
    return;
  }
  const totalCentavos = carrinho.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);
  document.getElementById('carrinho-resumo').textContent = `${carrinho.length} item(ns)`;
  document.getElementById('carrinho-total').textContent = `${formatarCentavos(totalCentavos)} — Finalizar`;
  barra.classList.remove('hidden');
}

function abrirModalCheckout() {
  const modal = document.getElementById('modal-checkout');
  const content = document.getElementById('modal-checkout-conteudo');
  const subtotalCentavos = carrinho.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);

  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3>Finalizar Pedido</h3>
      <button class="btn-outline-sm" id="fechar-checkout">✕</button>
    </div>
    <div style="margin-bottom:12px;">
      ${carrinho.map((item, idx) => `
        <div style="display:flex; justify-content:space-between; font-size:14px; padding:6px 0; border-bottom:1px solid var(--border);">
          <div>
            <strong>${item.quantidade}x ${item.nome}</strong>
            <div style="font-size:12px; color:var(--text-muted);">${item.detalhes.join(' | ')}</div>
          </div>
          <div>
            <span>${formatarCentavos(item.unitarioCentavos * item.quantidade)}</span>
            <button class="btn-outline-sm" style="padding:2px 6px; margin-left:6px;" data-rem="${idx}">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>

    <label style="display:block; font-size:13px; font-weight:600;">Seu Nome</label>
    <input id="chk-nome" type="text" placeholder="Ex: João Silva" style="width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;" />

    <label style="display:block; font-size:13px; font-weight:600;">WhatsApp (com DDD)</label>
    <input id="chk-whats" type="tel" placeholder="11999999999" style="width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;" />

    <label style="display:block; font-size:13px; font-weight:600;">Endereço Completo e Referência</label>
    <input id="chk-endereco" type="text" placeholder="Rua das Flores, 123 - Centro" style="width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;" />

    <label style="display:block; font-size:13px; font-weight:600;">Forma de Pagamento</label>
    <select id="chk-pagamento" style="width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;">
      <option value="pix">Pix Online (Aprovação Instantânea)</option>
      <option value="cartao_entrega">Cartão na Entrega (Maquininha)</option>
      <option value="dinheiro">Dinheiro na Entrega</option>
    </select>

    <div id="box-troco" class="hidden" style="margin-bottom:10px;">
      <label style="display:block; font-size:13px; font-weight:600;">Troco para quanto? (R$)</label>
      <input id="chk-troco" type="number" placeholder="Ex: 100" style="width:100%; padding:10px; margin-top:4px; border:1px solid var(--border); border-radius:8px;" />
    </div>

    <div style="display:flex; justify-content:space-between; font-size:16px; margin:12px 0;">
      <span>Total do Pedido:</span>
      <strong>${formatarCentavos(subtotalCentavos)}</strong>
    </div>

    <button class="btn-primary" id="btn-enviar-pedido">Enviar Pedido Agora</button>
  `;

  modal.classList.remove('hidden');
  document.getElementById('fechar-checkout').onclick = () => modal.classList.add('hidden');

  content.querySelectorAll('button[data-rem]').forEach(btn => {
    btn.onclick = () => {
      carrinho.splice(Number(btn.dataset.rem), 1);
      localStorage.setItem(`carrinho_${AppState.lojaId}`, JSON.stringify(carrinho));
      atualizarBarraCarrinho();
      if (!carrinho.length) modal.classList.add('hidden');
      else abrirModalCheckout();
    };
  });

  const selPag = document.getElementById('chk-pagamento');
  selPag.onchange = () => {
    document.getElementById('box-troco').classList.toggle('hidden', selPag.value !== 'dinheiro');
  };

  document.getElementById('btn-enviar-pedido').onclick = async () => {
    const nome = document.getElementById('chk-nome').value.trim();
    const whatsapp = document.getElementById('chk-whats').value.replace(/\D/g, '');
    const endereco = document.getElementById('chk-endereco').value.trim();
    const pagamento = selPag.value;
    const trocoParaCentavos = pagamento === 'dinheiro' ? Math.round((Number(document.getElementById('chk-troco').value) || 0) * 100) : 0;

    if (!nome || whatsapp.length < 10 || !endereco) {
      showToast('Preencha nome, WhatsApp válido e endereço.');
      return;
    }

    const btn = document.getElementById('btn-enviar-pedido');
    btn.disabled = true;
    btn.textContent = 'Enviando pedido...';

    try {
      const pedidoRef = await addDoc(collection(db, 'lojas', AppState.lojaId, 'pedidos'), {
        checkoutToken,
        numeroPedido: Math.floor(100 + Math.random() * 900),
        clienteNome: nome,
        clienteWhatsapp: whatsapp,
        enderecoTexto: endereco,
        itens: carrinho,
        totalCentavos: subtotalCentavos,
        formaPagamento: pagamento,
        trocoParaCentavos,
        status: 'novo',
        origem: new URLSearchParams(window.location.search).get('origem') || 'direto',
        criadoEm: serverTimestamp()
      });

      carrinho = [];
      localStorage.removeItem(`carrinho_${AppState.lojaId}`);
      checkoutToken = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      modal.classList.add('hidden');
      atualizarBarraCarrinho();
      showToast('Pedido enviado com sucesso!');

      document.getElementById('app-root').innerHTML = `
        <div class="card" style="text-align:center; padding:32px 16px;">
          <h2>Pedido Confirmado! 🎉</h2>
          <p style="margin:10px 0; color:var(--text-muted);">Código de acompanhamento: <strong>${pedidoRef.id.slice(0, 6).toUpperCase()}</strong></p>
          <p>Assim que o motoboy sair, o rastreamento ao vivo aparecerá aqui.</p>
          <button class="btn-outline-sm" style="margin-top:16px;" onclick="window.location.reload()">Fazer outro pedido</button>
        </div>
      `;
    } catch (err) {
      console.error(err);
      showToast('Erro ao enviar pedido. Tente novamente.');
      btn.disabled = false;
      btn.textContent = 'Enviar Pedido Agora';
    }
  };
}
