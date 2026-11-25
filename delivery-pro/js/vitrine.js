import { db, formatarCentavos, showToast, esc, WORKER_API_URL } from './config.js';
import { AppState } from './router.js';
import { montarItem } from './cardapio.js';
import { salvarPedidoLocal, pedidosRecentes } from './acompanhar.js';
import { calcularFrete, coordsValidas } from './frete.js';
import { situacaoLoja } from './horario.js';
import { statusAssinatura } from './plano.js';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let carrinho = [];
let produtoSelecionado = null;
let selecoesAtuais = {};
// Chave única por tentativa de compra (vira o ID do pedido: clicar duas vezes não duplica)
const novoCheckoutToken = () => `chk_${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '')}`;
let checkoutToken = novoCheckoutToken();
let situacao = { aberta: true };

export async function iniciarVitrine() {
  const root = document.getElementById('app-root');
  const loja = AppState.lojaDados;
  if (!statusAssinatura(loja).ativa) {
    root.innerHTML = `<div class="card" style="text-align:center; padding:40px 20px;"><h2>${esc(loja.nome)}</h2><p style="color:var(--text-muted); margin-top:8px;">Esta loja está temporariamente indisponível para pedidos online. Volte em breve!</p></div>`;
    return;
  }
  const storageKey = `carrinho_${AppState.lojaId}`;

  // Recupera carrinho salvo localmente (custo zero de banco)
  try {
    const salvo = localStorage.getItem(storageKey);
    if (salvo) carrinho = JSON.parse(salvo);
  } catch (_) { carrinho = []; }

  // Busca documento único consolidado do cardápio
  const cardapioSnap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
  const dadosCardapio = cardapioSnap.exists() ? cardapioSnap.data() : { categorias: [], produtos: [] };

  // Aberto/fechado agora (horário de funcionamento + pausa)
  let estadoLoja = null;
  try {
    const est = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'estado'));
    estadoLoja = est.exists() ? est.data() : null;
  } catch (_) {}
  situacao = situacaoLoja(loja, estadoLoja);

  const modoLayout = loja.layoutVitrine || 'gastronomia'; // 'gastronomia' | 'varejo'
  const tempoEstimado = loja.tempoEstimado || '30-45 min';

  const urlSegura = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? esc(u) : '');
  const banner = urlSegura(loja.bannerUrl);
  const logo = urlSegura(loja.logoUrl);
  const iniciais = esc((loja.nome || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
  const chips = [
    loja.taxaEntregaTexto ? `🛵 ${esc(loja.taxaEntregaTexto)}`
      : (loja.frete && coordsValidas(loja.localizacao) ? `🛵 a partir de ${formatarCentavos((loja.frete.baseCentavos || 0) + (loja.frete.adicionalAtivo ? (loja.frete.adicionalCentavos || 0) : 0))}` : ''),
    `⏱️ ${esc(tempoEstimado)}`,
    loja.pedidoMinimoCentavos ? `💲 Mín. ${formatarCentavos(loja.pedidoMinimoCentavos)}` : ''
  ].filter(Boolean);

  root.innerHTML = `
    <section class="vt-capa" style="${banner ? `background-image:url('${banner}');` : ''}"></section>
    <div class="vt-loja">
      <div class="vt-logo">${logo ? `<img src="${logo}" alt="" />` : `<span>${iniciais}</span>`}</div>
      <div class="vt-loja-info">
        <h1>${esc(loja.nome)}</h1>
        <span class="vt-aberto${situacao.aberta ? '' : ' fechado'}">● ${esc(situacao.aberta && situacao.semHorario ? 'Aberto' : situacao.texto)}</span>
        <div class="vt-chips">${chips.map(c => `<span class="vt-chip">${c}</span>`).join('')}</div>
      </div>
    </div>

    ${situacao.aberta ? '' : `
      <div class="vt-fechado-aviso">🔒 <strong>${situacao.pausada ? 'A loja pausou os pedidos por alguns minutos.' : 'A loja está fechada agora.'}</strong>
        ${situacao.pausada ? '' : `<span>${esc(situacao.texto.replace('Fechado · ', '').replace(/^./, c => c.toUpperCase()))}.</span>`}
        Você pode olhar o cardápio à vontade.</div>`}

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

  document.getElementById('barra-carrinho').onclick = () => {
    if (!situacao.aberta) {
      showToast(situacao.pausada ? 'A loja pausou os pedidos. Tente em alguns minutos.' : `A loja está fechada. ${situacao.texto.replace('Fechado · ', '').replace(/^./, c => c.toUpperCase())}.`, 5000);
      return;
    }
    abrirModalCheckout();
  };
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

// Dados do cliente e último local marcado ficam só neste aparelho (para não digitar de novo)
const CHAVE_CLIENTE = 'dados_cliente_v1';
function lerDadosCliente() {
  try { return JSON.parse(localStorage.getItem(CHAVE_CLIENTE) || '{}'); } catch (_) { return {}; }
}
function salvarDadosCliente(d) {
  try { localStorage.setItem(CHAVE_CLIENTE, JSON.stringify({ ...lerDadosCliente(), ...d })); } catch (_) {}
}

function abrirModalCheckout() {
  const modal = document.getElementById('modal-checkout');
  const content = document.getElementById('modal-checkout-conteudo');
  const loja = AppState.lojaDados || {};
  const subtotalCentavos = carrinho.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);
  const salvo = lerDadosCliente();
  const temFrete = calcularFrete(loja, null).configurado;
  let destino = coordsValidas(salvo.destino) ? salvo.destino : null;
  let mapa = null;
  let pino = null;
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;';
  const rotulo = 'display:block; font-size:13px; font-weight:600;';

  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3>Finalizar Pedido</h3>
      <button class="btn-outline-sm" id="fechar-checkout">✕</button>
    </div>
    <div style="margin-bottom:12px;">
      ${carrinho.map((item, idx) => `
        <div style="display:flex; justify-content:space-between; font-size:14px; padding:6px 0; border-bottom:1px solid var(--border);">
          <div>
            <strong>${esc(item.quantidade)}x ${esc(item.nome)}</strong>
            <div style="font-size:12px; color:var(--text-muted);">${esc((item.detalhes || []).join(' | '))}</div>
          </div>
          <div style="white-space:nowrap;">
            <span>${formatarCentavos(item.unitarioCentavos * item.quantidade)}</span>
            <button class="btn-outline-sm" style="padding:2px 6px; margin-left:6px;" data-rem="${idx}">🗑️</button>
          </div>
        </div>
      `).join('')}
    </div>

    <label style="${rotulo}">Seu Nome</label>
    <input id="chk-nome" type="text" placeholder="Ex: João Silva" value="${esc(salvo.nome || '')}" style="${campo}" />

    <label style="${rotulo}">WhatsApp (com DDD)</label>
    <input id="chk-whats" type="tel" placeholder="11999999999" value="${esc(salvo.whatsapp || '')}" style="${campo}" />

    <label style="${rotulo}">Como quer receber?</label>
    <div class="chk-tipo">
      <label><input type="radio" name="chk-tipo" value="entrega" ${salvo.tipo !== 'retirada' ? 'checked' : ''} /> 🛵 Entrega</label>
      <label><input type="radio" name="chk-tipo" value="retirada" ${salvo.tipo === 'retirada' ? 'checked' : ''} /> 🏪 Retirar na loja</label>
    </div>

    <div id="box-entrega">
      <label style="${rotulo}">Endereço completo e referência</label>
      <input id="chk-endereco" type="text" placeholder="Rua das Flores, 123 - Centro (portão azul)" value="${esc(salvo.endereco || '')}" style="${campo}" />
      ${temFrete ? `
        <label style="${rotulo}">Marque sua localização no mapa</label>
        <button class="btn-outline-sm" id="chk-gps" type="button" style="margin:4px 0 6px;">📍 Usar minha localização</button>
        <div id="chk-mapa" class="chk-mapa"></div>
        <p class="gc-dica">Toque no mapa ou arraste o pino até a sua porta. Isso calcula a entrega e guia o motoboy.</p>
      ` : ''}
    </div>

    <label style="${rotulo}">Forma de Pagamento</label>
    <select id="chk-pagamento" style="${campo}">
      <option value="pix">Pix Online (Aprovação Instantânea)</option>
      <option value="cartao_entrega">Cartão na Entrega (Maquininha)</option>
      <option value="dinheiro">Dinheiro na Entrega</option>
    </select>

    <div id="box-troco" class="hidden" style="margin-bottom:10px;">
      <label style="${rotulo}">Troco para quanto? (R$)</label>
      <input id="chk-troco" type="number" placeholder="Ex: 100" style="${campo}" />
    </div>

    <div class="chk-resumo">
      <div><span>Subtotal</span><span>${formatarCentavos(subtotalCentavos)}</span></div>
      <div id="chk-linha-frete"><span>Entrega</span><span id="chk-frete">—</span></div>
      <div class="chk-total"><span>Total</span><strong id="chk-total">${formatarCentavos(subtotalCentavos)}</strong></div>
      <p id="chk-aviso-frete" class="chk-aviso hidden"></p>
    </div>

    <button class="btn-primary" id="btn-enviar-pedido">Enviar Pedido Agora</button>
  `;

  modal.classList.remove('hidden');
  const fecharCheckout = () => { modal.classList.add('hidden'); if (mapa) { mapa.remove(); mapa = null; } };
  document.getElementById('fechar-checkout').onclick = fecharCheckout;

  content.querySelectorAll('button[data-rem]').forEach(btn => {
    btn.onclick = () => {
      guardarCampos();
      carrinho.splice(Number(btn.dataset.rem), 1);
      localStorage.setItem(`carrinho_${AppState.lojaId}`, JSON.stringify(carrinho));
      atualizarBarraCarrinho();
      if (mapa) { mapa.remove(); mapa = null; }
      if (!carrinho.length) modal.classList.add('hidden');
      else abrirModalCheckout();
    };
  });

  const selPag = document.getElementById('chk-pagamento');
  selPag.onchange = () => {
    document.getElementById('box-troco').classList.toggle('hidden', selPag.value !== 'dinheiro');
  };
  const tipoAtual = () => content.querySelector('input[name="chk-tipo"]:checked').value;

  function guardarCampos() {
    salvarDadosCliente({
      nome: document.getElementById('chk-nome').value.trim(),
      whatsapp: document.getElementById('chk-whats').value.trim(),
      endereco: document.getElementById('chk-endereco').value.trim(),
      tipo: tipoAtual(),
      destino
    });
  }

  // Recalcula entrega e total (o Worker refaz a mesma conta ao receber o pedido)
  let freteAtual = { freteCentavos: 0 };
  function atualizarTotais() {
    const retirada = tipoAtual() === 'retirada';
    document.getElementById('box-entrega').classList.toggle('hidden', retirada);
    const linhaFrete = document.getElementById('chk-linha-frete');
    const aviso = document.getElementById('chk-aviso-frete');
    const btn = document.getElementById('btn-enviar-pedido');
    aviso.classList.add('hidden');
    btn.disabled = false;

    if (retirada) {
      freteAtual = { freteCentavos: 0 };
      linhaFrete.classList.add('hidden');
    } else {
      freteAtual = calcularFrete(loja, destino);
      linhaFrete.classList.remove('hidden');
      const valor = document.getElementById('chk-frete');
      if (!freteAtual.configurado) {
        valor.textContent = 'a combinar';
        freteAtual = { freteCentavos: 0 };
      } else if (freteAtual.precisaLocal) {
        valor.textContent = 'marque no mapa';
        btn.disabled = true;
      } else if (freteAtual.fora) {
        valor.textContent = 'indisponível';
        aviso.innerHTML = `📍 Seu endereço fica a ${freteAtual.distanciaKm} km, fora da área de entrega. <button class="btn-outline-sm" type="button" id="chk-virar-retirada">Retirar na loja</button>`;
        aviso.classList.remove('hidden');
        document.getElementById('chk-virar-retirada').onclick = () => {
          content.querySelector('input[name="chk-tipo"][value="retirada"]').checked = true;
          atualizarTotais();
        };
        btn.disabled = true;
      } else {
        valor.textContent = `${formatarCentavos(freteAtual.freteCentavos)} (${freteAtual.distanciaKm} km${freteAtual.adicional ? ` · ${freteAtual.adicional}` : ''})`;
      }
    }
    document.getElementById('chk-total').textContent = formatarCentavos(subtotalCentavos + (freteAtual.freteCentavos || 0));
    if (!retirada && temFrete) setTimeout(() => iniciarMapa(), 50);
  }

  function marcar(p) {
    destino = { lat: p.lat, lng: p.lng };
    if (mapa) {
      if (!pino) {
        pino = L.marker([p.lat, p.lng], { draggable: true }).addTo(mapa);
        pino.on('dragend', () => marcar(pino.getLatLng()));
      } else pino.setLatLng([p.lat, p.lng]);
    }
    salvarDadosCliente({ destino });
    atualizarTotais();
  }

  function iniciarMapa() {
    const div = document.getElementById('chk-mapa');
    if (!div || typeof L === 'undefined') return;
    if (mapa) { mapa.invalidateSize(); return; }
    const centro = destino || loja.localizacao;
    mapa = L.map(div).setView([centro.lat, centro.lng], destino ? 16 : 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
    L.circleMarker([loja.localizacao.lat, loja.localizacao.lng], { radius: 7, color: 'var(--primary)' }).addTo(mapa).bindTooltip('🏪 Loja');
    if (destino) {
      pino = L.marker([destino.lat, destino.lng], { draggable: true }).addTo(mapa);
      pino.on('dragend', () => marcar(pino.getLatLng()));
    }
    mapa.on('click', (e) => marcar(e.latlng));
    setTimeout(() => mapa && mapa.invalidateSize(), 200);
  }

  document.getElementById('chk-gps')?.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Localização indisponível neste aparelho. Marque no mapa.'); return; }
    showToast('Buscando sua localização...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapa) mapa.setView([p.lat, p.lng], 17);
        marcar(p);
      },
      () => showToast('Não conseguimos sua localização. Toque no mapa para marcar.'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
  content.querySelectorAll('input[name="chk-tipo"]').forEach(r => r.onchange = atualizarTotais);
  atualizarTotais();

  document.getElementById('btn-enviar-pedido').onclick = async () => {
    const nome = document.getElementById('chk-nome').value.trim();
    const whatsapp = document.getElementById('chk-whats').value.replace(/\D/g, '');
    const tipoEntrega = tipoAtual();
    const endereco = document.getElementById('chk-endereco').value.trim();
    const pagamento = selPag.value;
    const trocoParaCentavos = pagamento === 'dinheiro' ? Math.round((Number(document.getElementById('chk-troco').value) || 0) * 100) : 0;

    if (!nome || whatsapp.length < 10) {
      showToast('Preencha seu nome e um WhatsApp válido.');
      return;
    }
    if (tipoEntrega === 'entrega' && endereco.length < 5) {
      showToast('Preencha o endereço completo para a entrega.');
      return;
    }
    guardarCampos();

    const btn = document.getElementById('btn-enviar-pedido');
    btn.disabled = true;
    btn.textContent = 'Enviando pedido...';

    try {
      // O Worker recalcula preços e frete com os dados oficiais e grava o pedido
      const resp = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: AppState.slug,
          checkoutToken,
          clienteNome: nome,
          clienteWhatsapp: whatsapp,
          tipoEntrega,
          enderecoTexto: tipoEntrega === 'entrega' ? endereco : '',
          destinoCoords: tipoEntrega === 'entrega' && destino ? destino : null,
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

      carrinho = [];
      localStorage.removeItem(`carrinho_${AppState.lojaId}`);
      checkoutToken = novoCheckoutToken();
      salvarPedidoLocal(AppState.lojaId, { id: resultado.id, numero: resultado.numeroPedido });
      showToast('Pedido enviado com sucesso!');
      // Vai direto para a tela de acompanhamento (o link fica salvo no aparelho)
      window.location.href = `/${AppState.slug}/pedido/${resultado.id}`;
    } catch (err) {
      console.error(err);
      showToast('Erro ao enviar pedido. Tente novamente.');
      btn.disabled = false;
      btn.textContent = 'Enviar Pedido Agora';
    }
  };
}
