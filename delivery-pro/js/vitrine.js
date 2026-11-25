import { db, formatarCentavos, showToast, esc, WORKER_API_URL } from './config.js';
import { AppState } from './router.js';
import { montarItem } from './cardapio.js';
import { salvarPedidoLocal, pedidosRecentes } from './acompanhar.js';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let carrinho = [];
let produtoSelecionado = null;
let selecoesAtuais = {};
// Chave única por tentativa de compra (vira o ID do pedido: clicar duas vezes não duplica)
const novoCheckoutToken = () => `chk_${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '')}`;
let checkoutToken = novoCheckoutToken();

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

  const urlSegura = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? esc(u) : '');
  const banner = urlSegura(loja.bannerUrl);
  const logo = urlSegura(loja.logoUrl);
  const iniciais = esc((loja.nome || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
  const chips = [
    loja.taxaEntregaTexto ? `🛵 ${esc(loja.taxaEntregaTexto)}` : '',
    `⏱️ ${esc(tempoEstimado)}`,
    loja.pedidoMinimoCentavos ? `💲 Mín. ${formatarCentavos(loja.pedidoMinimoCentavos)}` : ''
  ].filter(Boolean);

  root.innerHTML = `
    <section class="vt-capa" style="${banner ? `background-image:url('${banner}');` : ''}"></section>
    <div class="vt-loja">
      <div class="vt-logo">${logo ? `<img src="${logo}" alt="" />` : `<span>${iniciais}</span>`}</div>
      <div class="vt-loja-info">
        <h1>${esc(loja.nome)}</h1>
        <span class="vt-aberto">● Aberto</span>
        <div class="vt-chips">${chips.map(c => `<span class="vt-chip">${c}</span>`).join('')}</div>
      </div>
    </div>

    ${pedidosRecentes(AppState.lojaId).map(p => `
      <a href="/${AppState.slug}/pedido/${encodeURIComponent(p.id)}" class="card" style="display:flex; justify-content:space-between; align-items:center; gap:8px; text-decoration:none; color:inherit; border:2px solid var(--primary);">
        <span>📦 Seu pedido <strong>#${String(p.numero || '').replace(/[^0-9]/g, '')}</strong> está em andamento</span>
        <strong style="color:var(--primary); white-space:nowrap;">Acompanhar →</strong>
      </a>
    `).join('')}

    <div class="vt-barra" id="vt-barra">
      <nav class="vt-abas" id="vt-abas"></nav>
      <input class="vt-busca" id="vt-busca" type="search" placeholder="🔍 Buscar no cardápio" />
    </div>

    <div id="lista-categorias"></div>

    <!-- Barra Flutuante do Carrinho -->
    <div id="barra-carrinho" class="vt-carrinho hidden">
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

// Menor preço possível do produto (para mostrar "A partir de")
function precoMinimo(prod) {
  let total = Number(prod.precoCentavos) || 0;
  for (const grp of prod.grupos || []) {
    const minimo = grp.minimo || 0;
    const precos = (grp.opcoes || []).map(o => Number(o.precoCentavos) || 0).sort((a, b) => a - b);
    if (!minimo || !precos.length) continue;
    total += grp.regraDePreco === 'SOMA' || !grp.regraDePreco
      ? precos.slice(0, minimo).reduce((a, b) => a + b, 0)
      : precos[0];
  }
  return total;
}

function renderizarProdutos(dados, modoLayout) {
  const container = document.getElementById('lista-categorias');
  const abas = document.getElementById('vt-abas');
  const { categorias = [], produtos = [] } = dados;
  const ativos = produtos.filter(p => !p.excluido);

  if (!ativos.length) {
    container.innerHTML = `<div class="card"><p>Nenhum produto cadastrado nesta vitrine ainda.</p></div>`;
    document.getElementById('vt-barra').classList.add('hidden');
    return;
  }

  const idsCategorias = new Set(categorias.map(c => c.id));
  const secoes = [
    ...categorias.map(c => ({ id: c.id, nome: c.nome, itens: ativos.filter(p => p.categoriaId === c.id) })),
    { id: '_outros', nome: 'Outros', itens: ativos.filter(p => !idsCategorias.has(p.categoriaId)) }
  ].filter(s => s.itens.length);

  const urlSegura = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? esc(u) : '');

  abas.innerHTML = secoes.map((s, i) => `<button class="vt-aba${i === 0 ? ' ativa' : ''}" data-alvo="sec-${esc(s.id)}">${esc(s.nome)}</button>`).join('');

  container.innerHTML = secoes.map(s => `
    <section class="vt-secao" id="sec-${esc(s.id)}">
      <h2 class="vt-secao-titulo">${esc(s.nome)}</h2>
      <div class="vt-grade">
        ${s.itens.map(prod => {
          const esgotado = prod.controlarEstoque && (prod.estoque <= 0);
          const temOpcoes = prod.grupos && prod.grupos.length;
          const foto = urlSegura(prod.imagemUrl);
          const preco = temOpcoes ? precoMinimo(prod) : Number(prod.precoCentavos) || 0;
          return `
            <button class="vt-produto${esgotado ? ' esgotado' : ''}" data-prod-id="${esc(prod.id)}" data-busca="${esc(`${prod.nome} ${prod.descricao || ''}`.toLowerCase())}" ${esgotado ? 'disabled' : ''}>
              <div class="vt-foto">${foto ? `<img src="${foto}" alt="" loading="lazy" />` : '<span>🍽️</span>'}</div>
              <div class="vt-produto-info">
                <strong>${esc(prod.nome)}</strong>
                ${prod.descricao ? `<p>${esc(prod.descricao)}</p>` : ''}
                <span class="vt-preco">${esgotado ? 'Esgotado' : `${temOpcoes ? '<small>A partir de</small> ' : ''}${formatarCentavos(preco)}`}</span>
              </div>
              ${esgotado ? '' : '<span class="vt-mais">+</span>'}
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `).join('') + '<p class="vt-vazio hidden" id="vt-vazio">Nenhum produto encontrado.</p>';

  // Toque no produto: adiciona direto ou abre as opções
  container.querySelectorAll('[data-prod-id]').forEach(btn => {
    btn.onclick = () => {
      const prod = ativos.find(p => p.id === btn.dataset.prodId);
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

  // Barra de categorias gruda logo abaixo do topo, qualquer que seja a altura dele
  const topo = document.getElementById('global-topbar');
  document.getElementById('vt-barra').style.top = `${topo && !topo.classList.contains('hidden') ? topo.offsetHeight : 0}px`;

  // Abas: rolar até a categoria
  const alturaFixa = () => (document.getElementById('global-topbar')?.offsetHeight || 0) + document.getElementById('vt-barra').offsetHeight + 8;
  let travadoAte = 0; // após tocar numa aba, ela fica marcada enquanto a página rola
  abas.querySelectorAll('[data-alvo]').forEach(aba => {
    aba.onclick = () => {
      travadoAte = Date.now() + 1000;
      abas.querySelectorAll('.vt-aba').forEach(a => a.classList.toggle('ativa', a === aba));
      const alvo = document.getElementById(aba.dataset.alvo);
      if (alvo) window.scrollTo({ top: alvo.getBoundingClientRect().top + window.scrollY - alturaFixa(), behavior: 'smooth' });
    };
  });

  // Marca a aba da categoria que está na tela
  const marcarAba = () => {
    if (Date.now() < travadoAte) return;
    let atual = secoes[0] && `sec-${secoes[0].id}`;
    for (const s of container.querySelectorAll('.vt-secao:not(.hidden)')) {
      if (s.getBoundingClientRect().top - alturaFixa() <= 20) atual = s.id;
    }
    // No fim da página, a última categoria fica marcada mesmo sem chegar ao topo
    const visiveis = container.querySelectorAll('.vt-secao:not(.hidden)');
    if (visiveis.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) atual = visiveis[visiveis.length - 1].id;
    abas.querySelectorAll('.vt-aba').forEach(a => {
      const ativa = a.dataset.alvo === atual;
      a.classList.toggle('ativa', ativa);
      if (ativa && abas.scrollWidth > abas.clientWidth) abas.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
    });
  };
  window.addEventListener('scroll', () => requestAnimationFrame(marcarAba), { passive: true });

  // Busca no cardápio
  document.getElementById('vt-busca').oninput = (e) => {
    const termo = e.target.value.trim().toLowerCase();
    let algum = false;
    container.querySelectorAll('.vt-secao').forEach(sec => {
      let visiveis = 0;
      sec.querySelectorAll('[data-busca]').forEach(card => {
        const mostra = !termo || card.dataset.busca.includes(termo);
        card.classList.toggle('hidden', !mostra);
        if (mostra) visiveis++;
      });
      sec.classList.toggle('hidden', !visiveis);
      if (visiveis) algum = true;
    });
    document.getElementById('vt-vazio').classList.toggle('hidden', algum);
  };
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
      // O Worker recalcula os preços com o cardápio oficial e grava o pedido
      const resp = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: AppState.slug,
          checkoutToken,
          clienteNome: nome,
          clienteWhatsapp: whatsapp,
          enderecoTexto: endereco,
          formaPagamento: pagamento,
          trocoParaCentavos,
          origem: new URLSearchParams(window.location.search).get('origem') || 'direto',
          itens: carrinho.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, selecoes: i.selecoes || {} }))
        })
      });
      const resultado = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(resultado.erro || 'Erro ao enviar pedido. Tente novamente.', 6000);
        btn.disabled = false;
        btn.textContent = 'Enviar Pedido Agora';
        return;
      }
      const pedidoRef = { id: resultado.id };
      const numeroPedido = resultado.numeroPedido;

      carrinho = [];
      localStorage.removeItem(`carrinho_${AppState.lojaId}`);
      checkoutToken = novoCheckoutToken();
      salvarPedidoLocal(AppState.lojaId, { id: pedidoRef.id, numero: numeroPedido });
      showToast('Pedido enviado com sucesso!');
      // Vai direto para a tela de acompanhamento (o link fica salvo no aparelho)
      window.location.href = `/${AppState.slug}/pedido/${pedidoRef.id}`;
    } catch (err) {
      console.error(err);
      showToast('Erro ao enviar pedido. Tente novamente.');
      btn.disabled = false;
      btn.textContent = 'Enviar Pedido Agora';
    }
  };
}
