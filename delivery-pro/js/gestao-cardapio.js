// Gerenciador de cardápio do painel da loja: categorias, produtos, preços, fotos e grupos de opções.
// Edita um rascunho em memória e grava tudo de uma vez no documento único publico/cardapio_completo.
import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { enviarFoto } from './fotos.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const REGRAS = [
  { valor: 'SOMA', nome: 'Soma (cada opção cobra o seu preço)' },
  { valor: 'MAIOR_VALOR', nome: 'Cobra a mais cara (meio a meio)' },
  { valor: 'MEDIA', nome: 'Média dos preços' }
];

const DIAS_OFERTA = [['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']];

const novoId = (prefixo) => `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const copia = (obj) => JSON.parse(JSON.stringify(obj));
const urlSegura = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : '');

// "42,50" | "42.5" | "R$ 1.234,00" -> centavos inteiros (ou null se inválido)
function reaisParaCentavos(texto) {
  let s = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
const centavosParaTexto = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');

export async function abrirGestaoCardapio() {
  let rascunho;
  try {
    const snap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
    const dados = snap.exists() ? snap.data() : {};
    rascunho = { categorias: copia(dados.categorias || []), produtos: copia(dados.produtos || []) };
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar o cardápio.');
    return;
  }
  rascunho.produtos = rascunho.produtos.filter(p => !p.excluido);

  let selecionadoId = null;  // produto aberto no formulário
  let alterado = false;

  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="gc-janela">
      <header class="gc-topo">
        <h3>🍕 Produtos e preços</h3>
        <div style="display:flex; gap:8px; align-items:center;">
          <span id="gc-status" class="gc-status"></span>
          <button class="btn-primary" id="gc-salvar" style="width:auto;">💾 Salvar</button>
          <button class="btn-outline-sm" id="gc-fechar">✕</button>
        </div>
      </header>
      <div class="gc-corpo">
        <aside class="gc-lista" id="gc-lista"></aside>
        <section class="gc-editor" id="gc-editor"></section>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const $ = (sel) => overlay.querySelector(sel);

  const marcarAlterado = () => {
    alterado = true;
    $('#gc-status').textContent = '● Alterações não salvas';
  };

  const fechar = () => {
    if (alterado && !confirm('Existem alterações não salvas. Sair mesmo assim?')) return;
    overlay.remove();
    document.body.style.overflow = '';
  };
  $('#gc-fechar').onclick = fechar;

  // ---------- Lista da esquerda: categorias e produtos ----------
  function renderLista() {
    const lista = $('#gc-lista');
    const semCategoria = rascunho.produtos.filter(p => !rascunho.categorias.some(c => c.id === p.categoriaId));
    const blocos = [
      ...rascunho.categorias.map((c, ci) => ({ cat: c, ci, itens: rascunho.produtos.filter(p => p.categoriaId === c.id) })),
      ...(semCategoria.length ? [{ cat: { id: '', nome: 'Sem categoria' }, ci: -1, itens: semCategoria }] : [])
    ];

    lista.innerHTML = `
      <button class="btn-outline-sm gc-largo" data-acao="nova-categoria">+ Nova categoria</button>
      ${!blocos.length ? '<p class="gc-dica">Comece criando uma categoria (ex: Pizzas, Bebidas).</p>' : ''}
      ${blocos.map(b => `
        <div class="gc-cat">
          <div class="gc-cat-topo">
            <strong>${esc(b.cat.nome)}</strong>
            ${b.ci >= 0 ? `
              <span class="gc-acoes">
                <button title="Subir" data-acao="cat-subir" data-i="${b.ci}">↑</button>
                <button title="Descer" data-acao="cat-descer" data-i="${b.ci}">↓</button>
                <button title="Renomear" data-acao="cat-renomear" data-i="${b.ci}">✏️</button>
                <button title="Excluir" data-acao="cat-excluir" data-i="${b.ci}">🗑️</button>
              </span>` : ''}
          </div>
          ${b.itens.map(p => `
            <div class="gc-item${p.id === selecionadoId ? ' ativo' : ''}" data-acao="abrir" data-id="${esc(p.id)}">
              <span class="gc-item-nome">${esc(p.nome || '(sem nome)')}${p.oferta && p.oferta.precoCentavos ? ' 🔥' : ''}${p.controlarEstoque && p.estoque <= 0 ? ' <em>· esgotado</em>' : ''}</span>
              <span class="gc-acoes">
                <button title="${p.controlarEstoque && p.estoque <= 0 ? 'Esgotado: toque para voltar a vender' : 'À venda: toque para marcar esgotado'}" class="gc-venda${p.controlarEstoque && p.estoque <= 0 ? ' off' : ''}" data-acao="prod-venda" data-id="${esc(p.id)}">${p.controlarEstoque && p.estoque <= 0 ? '⛔ Esgotado' : '✅ Ativo'}</button>
                <button title="Subir" data-acao="prod-subir" data-id="${esc(p.id)}">↑</button>
                <button title="Descer" data-acao="prod-descer" data-id="${esc(p.id)}">↓</button>
              </span>
            </div>
          `).join('')}
          ${b.ci >= 0 ? `<button class="gc-add-prod" data-acao="novo-produto" data-cat="${esc(b.cat.id)}">+ Produto em ${esc(b.cat.nome)}</button>` : ''}
        </div>
      `).join('')}
    `;
  }

  // Move o produto para cima/baixo entre os da mesma categoria
  function moverProduto(id, direcao) {
    const p = rascunho.produtos.find(x => x.id === id);
    const mesmos = rascunho.produtos.filter(x => x.categoriaId === p.categoriaId);
    const pos = mesmos.indexOf(p);
    const vizinho = mesmos[pos + direcao];
    if (!vizinho) return;
    const a = rascunho.produtos.indexOf(p);
    const b = rascunho.produtos.indexOf(vizinho);
    [rascunho.produtos[a], rascunho.produtos[b]] = [rascunho.produtos[b], rascunho.produtos[a]];
    marcarAlterado();
  }

  $('#gc-lista').onclick = (e) => {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;
    const i = Number(alvo.dataset.i);
    const cats = rascunho.categorias;

    if (acao === 'nova-categoria') {
      const nome = prompt('Nome da nova categoria (ex: Pizzas, Lanches, Bebidas):');
      if (!nome || !nome.trim()) return;
      cats.push({ id: novoId('cat'), nome: nome.trim().slice(0, 40) });
      marcarAlterado();
    } else if (acao === 'cat-renomear') {
      const nome = prompt('Novo nome da categoria:', cats[i].nome);
      if (!nome || !nome.trim()) return;
      cats[i].nome = nome.trim().slice(0, 40);
      marcarAlterado();
    } else if (acao === 'cat-subir' && i > 0) {
      [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
      marcarAlterado();
    } else if (acao === 'cat-descer' && i < cats.length - 1) {
      [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
      marcarAlterado();
    } else if (acao === 'cat-excluir') {
      const qtd = rascunho.produtos.filter(p => p.categoriaId === cats[i].id).length;
      if (qtd) { showToast(`Esta categoria tem ${qtd} produto(s). Mova ou exclua os produtos antes.`); return; }
      if (!confirm(`Excluir a categoria "${cats[i].nome}"?`)) return;
      cats.splice(i, 1);
      marcarAlterado();
    } else if (acao === 'novo-produto') {
      const p = { id: novoId('p'), categoriaId: alvo.dataset.cat, nome: '', descricao: '', precoCentavos: 0, grupos: [] };
      rascunho.produtos.push(p);
      selecionadoId = p.id;
      marcarAlterado();
    } else if (acao === 'abrir') {
      selecionadoId = alvo.dataset.id;
    } else if (acao === 'prod-venda') {
      e.stopPropagation();
      const p = rascunho.produtos.find(x => x.id === alvo.dataset.id);
      if (!p) return;
      if (p.controlarEstoque && p.estoque <= 0) { delete p.controlarEstoque; delete p.estoque; }
      else { p.controlarEstoque = true; p.estoque = 0; }
      marcarAlterado();
      showToast('Toque em 💾 Salvar para os clientes verem a mudança.');
    } else if (acao === 'prod-subir' || acao === 'prod-descer') {
      e.stopPropagation();
      moverProduto(alvo.dataset.id, acao === 'prod-subir' ? -1 : 1);
    }
    renderLista();
    renderEditor();
  };

  // ---------- Editor da direita: um produto ----------
  function renderEditor() {
    const ed = $('#gc-editor');
    const p = rascunho.produtos.find(x => x.id === selecionadoId);
    if (!p) {
      ed.innerHTML = `
        <div class="gc-vazio">
          <p>👈 Escolha um produto na lista para editar, ou toque em <strong>+ Produto</strong> dentro de uma categoria.</p>
          <p class="gc-dica">As mudanças só aparecem para os clientes depois de tocar em <strong>💾 Salvar</strong>.</p>
        </div>`;
      return;
    }
    const esgotado = Boolean(p.controlarEstoque && p.estoque <= 0);
    const foto = urlSegura(p.imagemUrl);
    p.grupos = p.grupos || [];

    ed.innerHTML = `
      <div class="gc-form">
        <label>Nome do produto</label>
        <input data-campo="nome" value="${esc(p.nome)}" maxlength="80" placeholder="Ex: Pizza Grande" />

        <label>Descrição</label>
        <textarea data-campo="descricao" rows="2" maxlength="300" placeholder="Ex: 8 fatias, molho artesanal">${esc(p.descricao || '')}</textarea>

        <div class="gc-linha">
          <div>
            <label>Categoria</label>
            <select data-campo="categoriaId">
              ${rascunho.categorias.map(c => `<option value="${esc(c.id)}" ${c.id === p.categoriaId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Preço (R$)</label>
            <input data-campo="preco" inputmode="decimal" value="${centavosParaTexto(p.precoCentavos)}" placeholder="0,00" />
          </div>
        </div>
        <p class="gc-dica">${p.grupos.length ? 'Produto com opções: o preço acima é somado ao das opções escolhidas. Para pizza por sabor, deixe 0,00.' : 'Preço final do produto.'}</p>

        <label>Foto</label>
        <div class="gc-foto-linha">
          <div class="gc-foto">${foto ? `<img src="${esc(foto)}" alt="" />` : '🍽️'}</div>
          <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
            <button class="btn-outline-sm" data-acao="enviar-foto">📷 ${foto ? 'Trocar foto' : 'Enviar foto'}</button>
            <input data-campo="imagemUrl" value="${esc(p.imagemUrl || '')}" placeholder="ou cole um link https://..." />
          </div>
        </div>

        <label class="gc-check"><input type="checkbox" data-campo="esgotado" ${esgotado ? 'checked' : ''} /> Esgotado (pausar venda deste produto)</label>

        <h4 class="gc-subtitulo">🔥 Oferta do dia <small>(preço promocional nos dias marcados)</small></h4>
        <div class="gc-linha">
          <div>
            <label>De (preço normal)</label>
            <input value="${centavosParaTexto(p.precoCentavos)}" disabled />
          </div>
          <div>
            <label>Por (preço da oferta)</label>
            <input data-campo="ofertaPreco" inputmode="decimal" value="${p.oferta && p.oferta.precoCentavos ? centavosParaTexto(p.oferta.precoCentavos) : ''}" placeholder="vazio = sem oferta" />
          </div>
        </div>
        <div class="gc-dias">
          ${DIAS_OFERTA.map(([d, nome]) => `<label class="gc-dia"><input type="checkbox" data-dia="${d}" ${p.oferta && (p.oferta.dias || []).includes(d) ? 'checked' : ''} /> ${nome}</label>`).join('')}
        </div>
        <p class="gc-dica">Nos dias marcados o cliente vê "de ${formatarCentavos(p.precoCentavos || 0)} por ..." e paga o preço da oferta. Nos outros dias vale o preço normal.</p>

        <h4 class="gc-subtitulo">Grupos de opções <small>(sabores, bordas, adicionais)</small></h4>
        <div id="gc-grupos">
          ${p.grupos.map((g, gi) => `
            <div class="gc-grupo">
              <div class="gc-linha">
                <div style="flex:2;">
                  <label>Título do grupo</label>
                  <input data-g="${gi}" data-gcampo="titulo" value="${esc(g.titulo || '')}" placeholder="Ex: Sabores" />
                </div>
                <div>
                  <label>Mínimo</label>
                  <input data-g="${gi}" data-gcampo="minimo" type="number" min="0" value="${Number(g.minimo) || 0}" />
                </div>
                <div>
                  <label>Máximo</label>
                  <input data-g="${gi}" data-gcampo="maximo" type="number" min="1" value="${Number(g.maximo) || 1}" />
                </div>
              </div>
              <label>Como cobrar</label>
              <select data-g="${gi}" data-gcampo="regraDePreco">
                ${REGRAS.map(r => `<option value="${r.valor}" ${(g.regraDePreco || 'SOMA') === r.valor ? 'selected' : ''}>${r.nome}</option>`).join('')}
              </select>
              <div class="gc-opcoes">
                ${(g.opcoes || []).map((o, oi) => `
                  <div class="gc-opcao">
                    <input data-g="${gi}" data-o="${oi}" data-ocampo="nome" value="${esc(o.nome || '')}" placeholder="Nome da opção" />
                    <input data-g="${gi}" data-o="${oi}" data-ocampo="preco" inputmode="decimal" value="${centavosParaTexto(o.precoCentavos)}" placeholder="0,00" />
                    <button class="btn-outline-sm" data-acao="rem-opcao" data-g="${gi}" data-o="${oi}" title="Remover opção">✕</button>
                  </div>
                `).join('')}
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn-outline-sm" data-acao="add-opcao" data-g="${gi}">+ Opção</button>
                <button class="btn-outline-sm gc-perigo" data-acao="rem-grupo" data-g="${gi}">Remover grupo</button>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn-outline-sm gc-largo" data-acao="add-grupo">+ Adicionar grupo de opções</button>

        <div class="gc-rodape">
          <button class="btn-outline-sm" data-acao="duplicar">📄 Duplicar</button>
          <button class="btn-outline-sm gc-perigo" data-acao="excluir">🗑️ Excluir produto</button>
        </div>
      </div>
    `;
  }

  // Digitação nos campos: atualiza o rascunho sem redesenhar (para não perder o cursor)
  $('#gc-editor').oninput = (e) => {
    const p = rascunho.produtos.find(x => x.id === selecionadoId);
    if (!p) return;
    const el = e.target;
    const campo = el.dataset.campo;
    if (campo === 'nome' || campo === 'descricao') p[campo] = el.value;
    else if (campo === 'imagemUrl') p.imagemUrl = el.value.trim();
    else if (campo === 'preco') p.precoCentavos = reaisParaCentavos(el.value);
    else if (campo === 'ofertaPreco') {
      p.oferta = p.oferta || { dias: [] };
      p.oferta.precoCentavos = el.value.trim() ? reaisParaCentavos(el.value) : 0;
    }
    else if (el.dataset.gcampo) {
      const g = p.grupos[Number(el.dataset.g)];
      g[el.dataset.gcampo] = el.dataset.gcampo === 'titulo' ? el.value : Number(el.value);
    } else if (el.dataset.ocampo) {
      const o = p.grupos[Number(el.dataset.g)].opcoes[Number(el.dataset.o)];
      if (el.dataset.ocampo === 'nome') o.nome = el.value;
      else o.precoCentavos = reaisParaCentavos(el.value);
    } else return;
    marcarAlterado();
    if (campo === 'nome') renderLista();
  };

  // Mudanças que redesenham (selects, checkbox, foto)
  $('#gc-editor').onchange = (e) => {
    const p = rascunho.produtos.find(x => x.id === selecionadoId);
    if (!p) return;
    const el = e.target;
    if (el.dataset.dia) {
      p.oferta = p.oferta || { precoCentavos: 0, dias: [] };
      p.oferta.dias = DIAS_OFERTA.map(([d]) => d).filter(d => d === el.dataset.dia ? el.checked : (p.oferta.dias || []).includes(d));
      marcarAlterado();
      return;
    }
    if (el.dataset.campo === 'categoriaId') p.categoriaId = el.value;
    else if (el.dataset.campo === 'esgotado') {
      if (el.checked) { p.controlarEstoque = true; p.estoque = 0; }
      else { delete p.controlarEstoque; delete p.estoque; }
    } else if (el.dataset.gcampo === 'regraDePreco') {
      p.grupos[Number(el.dataset.g)].regraDePreco = el.value;
      marcarAlterado();
      return;
    } else if (el.dataset.campo !== 'imagemUrl') return;
    marcarAlterado();
    renderLista();
    renderEditor();
  };

  $('#gc-editor').onclick = (e) => {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const p = rascunho.produtos.find(x => x.id === selecionadoId);
    if (!p) return;
    const gi = Number(alvo.dataset.g);
    const acao = alvo.dataset.acao;

    if (acao === 'enviar-foto') {
      alvo.disabled = true;
      enviarFoto('produto').then(url => {
        alvo.disabled = false;
        if (!url || !rascunho.produtos.includes(p)) return;
        p.imagemUrl = url;
        marcarAlterado();
        renderLista();
        renderEditor();
        showToast('Foto pronta! Toque em 💾 Salvar para publicar.');
      });
      return;
    }
    if (acao === 'add-grupo') {
      p.grupos.push({ titulo: '', minimo: 0, maximo: 1, regraDePreco: 'SOMA', opcoes: [{ nome: '', precoCentavos: 0 }] });
    } else if (acao === 'rem-grupo') {
      if (!confirm('Remover este grupo de opções?')) return;
      p.grupos.splice(gi, 1);
    } else if (acao === 'add-opcao') {
      p.grupos[gi].opcoes = p.grupos[gi].opcoes || [];
      p.grupos[gi].opcoes.push({ nome: '', precoCentavos: 0 });
    } else if (acao === 'rem-opcao') {
      p.grupos[gi].opcoes.splice(Number(alvo.dataset.o), 1);
    } else if (acao === 'duplicar') {
      const c = copia(p);
      c.id = novoId('p');
      c.nome = `${p.nome} (cópia)`;
      rascunho.produtos.splice(rascunho.produtos.indexOf(p) + 1, 0, c);
      selecionadoId = c.id;
    } else if (acao === 'excluir') {
      if (!confirm(`Excluir "${p.nome || 'este produto'}" do cardápio?`)) return;
      rascunho.produtos.splice(rascunho.produtos.indexOf(p), 1);
      selecionadoId = null;
    } else return;
    marcarAlterado();
    renderLista();
    renderEditor();
  };

  // ---------- Conferência e gravação ----------
  function validar() {
    if (!rascunho.categorias.length) return 'Crie pelo menos uma categoria.';
    for (const p of rascunho.produtos) {
      const nome = (p.nome || '').trim();
      const abrir = () => { selecionadoId = p.id; renderLista(); renderEditor(); };
      if (!nome) { abrir(); return 'Há um produto sem nome.'; }
      if (!rascunho.categorias.some(c => c.id === p.categoriaId)) { abrir(); return `"${nome}" está sem categoria.`; }
      if (p.precoCentavos === null) { abrir(); return `Preço inválido em "${nome}". Use o formato 25,90.`; }
      if (!p.grupos?.length && !(p.precoCentavos > 0)) { abrir(); return `"${nome}" está com preço zero. Informe o preço ou adicione opções.`; }
      if (p.oferta && (p.oferta.precoCentavos || (p.oferta.dias || []).length)) {
        const por = p.oferta.precoCentavos;
        if (por === null) { abrir(); return `Preço da oferta inválido em "${nome}". Use o formato 19,90.`; }
        if (!por) { abrir(); return `Informe o preço da oferta de "${nome}" (ou desmarque os dias).`; }
        if (por >= (p.precoCentavos || 0)) { abrir(); return `A oferta de "${nome}" precisa ser mais barata que o preço normal.`; }
        if (!(p.oferta.dias || []).length) { abrir(); return `Marque em quais dias vale a oferta de "${nome}".`; }
      }
      for (const g of p.grupos || []) {
        const titulo = (g.titulo || '').trim();
        const opcoes = g.opcoes || [];
        if (!titulo) { abrir(); return `Um grupo de opções de "${nome}" está sem título.`; }
        if (!opcoes.length) { abrir(); return `O grupo "${titulo}" de "${nome}" não tem opções.`; }
        if (opcoes.some(o => !(o.nome || '').trim())) { abrir(); return `Há uma opção sem nome em "${titulo}" (${nome}).`; }
        if (opcoes.some(o => o.precoCentavos === null)) { abrir(); return `Preço inválido numa opção de "${titulo}" (${nome}).`; }
        const min = Number(g.minimo) || 0;
        const max = Number(g.maximo) || 0;
        if (max < 1 || min < 0 || min > max) { abrir(); return `Em "${titulo}" (${nome}), o mínimo deve ser menor ou igual ao máximo, e o máximo pelo menos 1.`; }
        if (min > opcoes.length) { abrir(); return `Em "${titulo}" (${nome}), o mínimo é maior que o número de opções.`; }
      }
    }
    return null;
  }

  // Limpa o produto antes de gravar (só os campos que a vitrine usa)
  function limpar(p) {
    const out = {
      id: p.id,
      categoriaId: p.categoriaId,
      nome: p.nome.trim(),
      descricao: (p.descricao || '').trim(),
      precoCentavos: p.precoCentavos || 0
    };
    const foto = urlSegura(p.imagemUrl);
    if (foto) out.imagemUrl = foto;
    // Crédito do fotógrafo (fotos de exemplo do Unsplash): só vale enquanto a foto for a do Unsplash
    if (foto && p.imagemCredito && /^https:\/\/images\.unsplash\.com\//.test(foto)) out.imagemCredito = { autor: String(p.imagemCredito.autor || '').slice(0, 80), link: String(p.imagemCredito.link || '').slice(0, 300) };
    if (p.controlarEstoque) { out.controlarEstoque = true; out.estoque = Number(p.estoque) || 0; }
    if (p.oferta && p.oferta.precoCentavos > 0 && (p.oferta.dias || []).length) out.oferta = { precoCentavos: p.oferta.precoCentavos, dias: [...p.oferta.dias] };
    if (p.grupos?.length) {
      out.grupos = p.grupos.map(g => ({
        titulo: g.titulo.trim(),
        minimo: Number(g.minimo) || 0,
        maximo: Number(g.maximo) || 1,
        regraDePreco: g.regraDePreco || 'SOMA',
        opcoes: g.opcoes.map(o => ({ nome: o.nome.trim(), precoCentavos: o.precoCentavos || 0 }))
      }));
    }
    return out;
  }

  $('#gc-salvar').onclick = async () => {
    const erro = validar();
    if (erro) { showToast(erro, 5000); return; }
    const btn = $('#gc-salvar');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      await setDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'), {
        categorias: rascunho.categorias.map(c => ({ id: c.id, nome: c.nome })),
        produtos: rascunho.produtos.map(limpar),
        atualizadoEm: serverTimestamp()
      });
      alterado = false;
      $('#gc-status').textContent = '✓ Salvo';
      showToast('Cardápio salvo! Os clientes já veem a versão nova.');
    } catch (err) {
      console.error(err);
      showToast(err.code === 'permission-denied' ? 'Sem permissão para alterar o cardápio.' : 'Erro ao salvar. Tente de novo.');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Salvar';
    }
  };

  renderLista();
  renderEditor();
}
