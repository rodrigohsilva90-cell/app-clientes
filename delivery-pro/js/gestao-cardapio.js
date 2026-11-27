// Gerenciador de cardápio do painel da loja: categorias, produtos, preços, fotos e grupos de opções.
// Edita um rascunho em memória e grava tudo de uma vez no documento único publico/cardapio_completo.
import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { enviarFoto } from './fotos.js';
import { diaDaLoja, esgotadoAgora, estoqueAtual, usaGrade, chaveGradeNomes, totalGrade, textoLoja } from './frete.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const REGRAS = [
  { valor: 'SOMA', nome: 'Soma (cada opção cobra o seu preço)' },
  { valor: 'MAIOR_VALOR', nome: 'Cobra a mais cara (meio a meio)' },
  { valor: 'MEDIA', nome: 'Média dos preços' }
];

const DIAS_OFERTA = [['seg', 'Seg'], ['ter', 'Ter'], ['qua', 'Qua'], ['qui', 'Qui'], ['sex', 'Sex'], ['sab', 'Sáb'], ['dom', 'Dom']];

const ehVarejo = () => AppState.lojaDados && AppState.lojaDados.layoutVitrine === 'varejo';
// Linhas (tamanhos) e colunas (cores) da grade de estoque; ['-'] quando o produto não tem o grupo
function eixosGrade(p) {
  const nomes = (tipo) => { const g = (p.grupos || []).find(x => x.tipo === tipo); return g ? g.opcoes.map(o => String(o.nome || '').trim()).filter(Boolean) : ['-']; };
  return { tamanhos: nomes('tamanho'), cores: nomes('cor') };
}
const chavesGrade = (p) => { const { tamanhos, cores } = eixosGrade(p); return tamanhos.flatMap(t => cores.map(c => chaveGradeNomes(t === '-' ? null : t, c === '-' ? null : c))); };
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
  // Fotos extras (varejo): a 1ª foto continua em imagemUrl; as outras ficam em fotosExtras enquanto edita
  rascunho.produtos.forEach(p => { p.fotosExtras = (Array.isArray(p.fotos) ? p.fotos.slice(1) : []).filter(u => urlSegura(u)); });

  let selecionadoId = null;  // produto aberto no formulário
  const estoqueEditado = new Set(); // produtos cujo estoque foi mexido aqui (os outros mantêm o valor do servidor ao salvar)
  let alterado = false;

  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="gc-janela">
      <header class="gc-topo">
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn-outline-sm gc-voltar" id="gc-voltar" type="button">← Lista</button>
          <h3>${ehVarejo() ? '🏷️' : '🍕'} Produtos e preços</h3>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <span id="gc-status" class="gc-status"></span>
          <button class="btn-outline-sm" id="gc-desfazer" title="Voltar o cardápio para como estava antes do último salvamento">↩ Desfazer</button>
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
  $('#gc-lista').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'gc-nova-cat-nome') { e.preventDefault(); $('#gc-lista [data-acao="nova-categoria"]').click(); }
  });
  $('#gc-voltar').onclick = () => { selecionadoId = null; renderLista(); renderEditor(); };
  const secoesAbertas = new Map(); // seção do formulário aberta/fechada (por produto)
  $('#gc-editor').addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.tagName === 'DETAILS' && d.dataset.secao && selecionadoId) secoesAbertas.set(`${selecionadoId}:${d.dataset.secao}`, d.open);
  }, true);
  const aberta = (secao, padrao) => ((secoesAbertas.get(`${selecionadoId}:${secao}`) ?? padrao) ? 'open' : '');
  // Preço que aparece na lista: o normal, ou "a partir de" quando depende das opções
  const precoNaLista = (p) => {
    const base = Number(p.precoCentavos) || 0;
    const obrig = (p.grupos || []).filter(g => Number(g.minimo) > 0 && (g.opcoes || []).length);
    const extra = obrig.reduce((a, g) => a + Math.min(...g.opcoes.map(o => Number(o.precoCentavos) || 0)), 0);
    if (!base && !extra) return (p.grupos || []).length ? 'preço nas opções' : '<em>sem preço</em>';
    return `${obrig.length ? 'a partir de ' : ''}${formatarCentavos(base + extra)}`;
  };

  // ---------- Lista da esquerda: categorias e produtos ----------
  function renderLista() {
    const lista = $('#gc-lista');
    const semCategoria = rascunho.produtos.filter(p => !rascunho.categorias.some(c => c.id === p.categoriaId));
    const blocos = [
      ...rascunho.categorias.map((c, ci) => ({ cat: c, ci, itens: rascunho.produtos.filter(p => p.categoriaId === c.id) })),
      ...(semCategoria.length ? [{ cat: { id: '', nome: 'Sem categoria' }, ci: -1, itens: semCategoria }] : [])
    ];

    lista.innerHTML = `
      <div class="gc-nova-cat">
        <input id="gc-nova-cat-nome" maxlength="40" placeholder="Nova categoria (ex: Pizzas, Bebidas)" aria-label="Nome da nova categoria" />
        <button class="btn-primary" type="button" data-acao="nova-categoria">+ Criar</button>
      </div>
      ${!blocos.length ? '<p class="gc-dica">Comece criando uma categoria (ex: Pizzas, Bebidas). Depois toque em "+ Produto" dentro dela.</p>' : ''}
      ${blocos.map(b => `
        <div class="gc-cat">
          <div class="gc-cat-topo">
            <strong>${esc(b.cat.nome)} <small class="gc-cat-qtd">${b.itens.length} ${b.itens.length === 1 ? 'produto' : 'produtos'}</small></strong>
            ${b.ci >= 0 ? `
              <span class="gc-acoes">
                <button title="Subir" data-acao="cat-subir" data-i="${b.ci}">↑</button>
                <button title="Descer" data-acao="cat-descer" data-i="${b.ci}">↓</button>
                <button title="Renomear" data-acao="cat-renomear" data-i="${b.ci}">✏️</button>
                <button title="Excluir" data-acao="cat-excluir" data-i="${b.ci}">🗑️</button>
              </span>` : ''}
          </div>
          ${listaDaCategoria(b)}
          ${b.ci >= 0 ? `<div class="gc-add-linha">
            <button class="gc-add-prod" data-acao="novo-produto" data-cat="${esc(b.cat.id)}">+ Produto em ${esc(b.cat.nome)}</button>
            <button class="gc-add-sub" data-acao="nova-sub" data-i="${b.ci}" title="Ex.: Broto e Grande dentro de Pizzas">+ Subcategoria</button>
          </div>` : ''}
        </div>
      `).join('')}
    `;
  }

  // Um produto na lista da esquerda
  const itemDaLista = (p) => `
            <div class="gc-item${p.id === selecionadoId ? ' ativo' : ''}" data-acao="abrir" data-id="${esc(p.id)}">
              <span class="gc-item-foto">${urlSegura(p.imagemUrl) ? `<img src="${esc(urlSegura(p.imagemUrl))}" alt="" loading="lazy" />` : '🍽️'}</span>
              <span class="gc-item-info">
                <span class="gc-item-nome">${esc(p.nome || '(sem nome)')}${p.oferta && p.oferta.precoCentavos ? ' 🔥' : ''}</span>
                <small class="gc-item-preco">${precoNaLista(p)}</small>
              </span>
              <span class="gc-acoes">
                <button title="${esgotadoAgora(p, AppState.lojaDados) ? 'Esgotado: toque para voltar a vender' : 'À venda: toque para marcar esgotado'}" class="gc-venda${esgotadoAgora(p, AppState.lojaDados) ? ' off' : ''}" data-acao="prod-venda" data-id="${esc(p.id)}">${esgotadoAgora(p, AppState.lojaDados) ? '⛔ Esgotado' : '✅ Ativo'}</button>
                <button title="Subir" data-acao="prod-subir" data-id="${esc(p.id)}">↑</button>
                <button title="Descer" data-acao="prod-descer" data-id="${esc(p.id)}">↓</button>
              </span>
            </div>
          `;
  // Produtos da categoria: os sem subcategoria primeiro, depois cada subcategoria com o seu título
  function listaDaCategoria(b) {
    const subs = (b.cat.subcategorias || []);
    if (!subs.length) return b.itens.map(itemDaLista).join('');
    const ids = new Set(subs.map(x => x.id));
    const soltos = b.itens.filter(p => !ids.has(p.subcategoriaId));
    return soltos.map(itemDaLista).join('') + subs.map((sb, si) => {
      const itens = b.itens.filter(p => p.subcategoriaId === sb.id);
      return `<div class="gc-sub">
        <div class="gc-sub-topo">
          <span>↳ <strong>${esc(sb.nome)}</strong> <small class="gc-cat-qtd">${itens.length}</small></span>
          <span class="gc-acoes">
            <button title="Renomear" data-acao="sub-renomear" data-i="${b.ci}" data-s="${si}">✏️</button>
            <button title="Excluir" data-acao="sub-excluir" data-i="${b.ci}" data-s="${si}">🗑️</button>
          </span>
        </div>
        ${itens.map(itemDaLista).join('')}
        <button class="gc-add-prod gc-add-prod-sub" data-acao="novo-produto" data-cat="${esc(b.cat.id)}" data-sub="${esc(sb.id)}">+ Produto em ${esc(sb.nome)}</button>
      </div>`;
    }).join('');
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
      const campo = $('#gc-nova-cat-nome');
      const nome = campo ? campo.value : '';
      if (!nome || !nome.trim()) { showToast('Escreva o nome da categoria (ex: Pizzas).'); if (campo) campo.focus(); return; }
      if (cats.some(c => c.nome.trim().toLowerCase() === nome.trim().toLowerCase())) { showToast('Já existe uma categoria com esse nome.'); return; }
      cats.push({ id: novoId('cat'), nome: nome.trim().slice(0, 40) });
      marcarAlterado();
      showToast(`Categoria "${nome.trim()}" criada. Agora toque em "+ Produto em ${nome.trim()}".`);
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
    } else if (acao === 'nova-sub') {
      const nome = prompt(`Nova subcategoria dentro de "${cats[i].nome}"\n(ex.: Broto, Grande, Pedaço, Inteiro):`);
      if (!nome || !nome.trim()) return;
      cats[i].subcategorias = cats[i].subcategorias || [];
      if (cats[i].subcategorias.some(x => x.nome.trim().toLowerCase() === nome.trim().toLowerCase())) { showToast('Já existe essa subcategoria.'); return; }
      if (cats[i].subcategorias.length >= 12) { showToast('Limite de 12 subcategorias por categoria.'); return; }
      cats[i].subcategorias.push({ id: novoId('sub'), nome: nome.trim().slice(0, 30) });
      marcarAlterado();
      showToast(`Subcategoria "${nome.trim()}" criada. Toque em "+ Produto em ${nome.trim()}".`);
    } else if (acao === 'sub-renomear') {
      const sb = cats[i].subcategorias[Number(alvo.dataset.s)];
      const nome = prompt('Novo nome da subcategoria:', sb.nome);
      if (!nome || !nome.trim()) return;
      sb.nome = nome.trim().slice(0, 30);
      marcarAlterado();
    } else if (acao === 'sub-excluir') {
      const sb = cats[i].subcategorias[Number(alvo.dataset.s)];
      const dela = rascunho.produtos.filter(p => p.subcategoriaId === sb.id);
      if (!confirm(`Excluir a subcategoria "${sb.nome}"?${dela.length ? `\n\nOs ${dela.length} produto(s) dela continuam em "${cats[i].nome}", só sem subcategoria.` : ''}`)) return;
      dela.forEach(p => { delete p.subcategoriaId; });
      cats[i].subcategorias.splice(Number(alvo.dataset.s), 1);
      marcarAlterado();
    } else if (acao === 'cat-excluir') {
      const qtd = rascunho.produtos.filter(p => p.categoriaId === cats[i].id).length;
      if (qtd) { showToast(`Esta categoria tem ${qtd} produto(s). Mova ou exclua os produtos antes.`); return; }
      if (!confirm(`Excluir a categoria "${cats[i].nome}"?`)) return;
      cats.splice(i, 1);
      marcarAlterado();
    } else if (acao === 'novo-produto') {
      const p = { id: novoId('p'), categoriaId: alvo.dataset.cat, nome: '', descricao: '', precoCentavos: 0, grupos: [], ...(alvo.dataset.sub ? { subcategoriaId: alvo.dataset.sub } : {}) };
      rascunho.produtos.push(p);
      selecionadoId = p.id;
      marcarAlterado();
    } else if (acao === 'abrir') {
      selecionadoId = alvo.dataset.id;
      setTimeout(() => { $('#gc-editor').scrollTop = 0; }, 0);
    } else if (acao === 'prod-venda') {
      e.stopPropagation();
      const p = rascunho.produtos.find(x => x.id === alvo.dataset.id);
      if (!p) return;
      if (usaGrade(p)) { selecionadoId = p.id; secoesAbertas.set(`${p.id}:estoque`, true); showToast('Este produto usa estoque por tamanho/cor: ajuste as quantidades na tabela.'); renderLista(); renderEditor(); return; }
      estoqueEditado.add(p.id);
      if (esgotadoAgora(p, AppState.lojaDados)) {
        if (Number(p.estoqueDiario) > 0) { p.estoque = Number(p.estoqueDiario); p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
        else { delete p.controlarEstoque; delete p.estoque; }
      } else { p.controlarEstoque = true; p.estoque = 0; p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
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
    overlay.querySelector('.gc-janela').classList.toggle('editando', Boolean(p)); // celular: lista OU produto
    if (!p) {
      ed.innerHTML = `
        <div class="gc-vazio">
          <p>👈 Escolha um produto na lista para editar, ou toque em <strong>+ Produto</strong> dentro de uma categoria.</p>
          <p class="gc-dica">As mudanças só aparecem para os clientes depois de tocar em <strong>💾 Salvar</strong>.</p>
        </div>`;
      return;
    }
    const esgotado = Boolean(esgotadoAgora(p, AppState.lojaDados));
    const gT = (p.grupos || []).findIndex(g => g.tipo === 'tamanho');
    const tamanhos = gT >= 0 ? p.grupos[gT] : null;
    const gC = (p.grupos || []).findIndex(g => g.tipo === 'cor');
    const cores = gC >= 0 ? p.grupos[gC] : null;
    const outrosGrupos = (p.grupos || []).filter(g => g.tipo !== 'tamanho' && g.tipo !== 'cor').length;
    const varejo = ehVarejo();
    const grade = usaGrade(p);
    const foto = urlSegura(p.imagemUrl);
    p.grupos = p.grupos || [];

    ed.innerHTML = `
      <div class="gc-form">
        <section class="gc-secao">
        <h4 class="gc-secao-titulo">📝 Informações</h4>
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
          ${(() => {
            const cat = rascunho.categorias.find(c => c.id === p.categoriaId);
            const subs = (cat && cat.subcategorias) || [];
            return subs.length ? `<div>
            <label>Subcategoria</label>
            <select data-campo="subcategoriaId">
              <option value="">— nenhuma —</option>
              ${subs.map(sb => `<option value="${esc(sb.id)}" ${sb.id === p.subcategoriaId ? 'selected' : ''}>${esc(sb.nome)}</option>`).join('')}
            </select>
          </div>` : '';
          })()}
          <div>
            <label>Preço (R$)</label>
            ${tamanhos ? `<input value="no tamanho" disabled title="O preço vem do tamanho escolhido" />` : `<input data-campo="preco" inputmode="decimal" value="${centavosParaTexto(p.precoCentavos)}" placeholder="0,00" />`}
          </div>
        </div>
        <p class="gc-dica">${tamanhos ? 'O preço é o de cada tamanho (veja abaixo).' : p.grupos.length ? 'Produto com opções: o preço acima é somado ao das opções escolhidas. Para pizza por sabor, deixe 0,00.' : 'Preço final do produto.'}</p>

        </section>
        <details class="gc-secao" data-secao="tamanhos" ${aberta('tamanhos', Boolean(tamanhos))}>
        <summary>📏 Tamanhos e preços <small>${tamanhos ? tamanhos.opcoes.map(o => esc(o.nome || '?')).join(' · ') : 'ex.: Inteiro, Fatia, Pedaço'}</small></summary>
        ${tamanhos ? `
          <p class="gc-dica">O cliente toca no produto, vê os tamanhos com o preço de cada um e escolhe um.</p>
          ${tamanhos.opcoes.map((o, oi) => `
            <div class="gc-opcao">
              <input data-g="${gT}" data-o="${oi}" data-ocampo="nome" data-antes="${esc(o.nome || '')}" value="${esc(o.nome || '')}" placeholder="${varejo ? 'Ex.: P, M, G ou 38' : 'Ex.: Inteiro'}" />
              <input data-g="${gT}" data-o="${oi}" data-ocampo="preco" inputmode="decimal" value="${centavosParaTexto(o.precoCentavos)}" placeholder="0,00" />
              <button class="btn-outline-sm" data-acao="rem-opcao" data-g="${gT}" data-o="${oi}" title="Remover tamanho">✕</button>
            </div>`).join('')}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline-sm" data-acao="add-opcao" data-g="${gT}">+ Tamanho</button>
            <button class="btn-outline-sm gc-perigo" data-acao="rem-tamanhos">Tirar tamanhos</button>
          </div>`
        : `<p class="gc-dica">Use quando o mesmo produto tem vários tamanhos com preços diferentes. Ex.: Bolo de chocolate → Inteiro R$ 60, Fatia R$ 9, Pedaço R$ 6.</p>
           <button class="btn-outline-sm gc-largo" data-acao="add-tamanhos">+ Adicionar tamanhos</button>`}
        </details>
        ${varejo ? `
        <details class="gc-secao" data-secao="cores" ${aberta('cores', Boolean(cores))}>
        <summary>🎨 Cores <small>${cores ? cores.opcoes.map(o => esc(o.nome || '?')).join(' · ') : 'ex.: Preto, Branco, Azul'}</small></summary>
        ${cores ? `
          <p class="gc-dica">O cliente escolhe uma cor. Todas custam o mesmo preço do tamanho.</p>
          ${cores.opcoes.map((o, oi) => `
            <div class="gc-opcao gc-opcao-cor">
              <input data-g="${gC}" data-o="${oi}" data-ocampo="nome" data-antes="${esc(o.nome || '')}" value="${esc(o.nome || '')}" placeholder="Ex.: Preto" />
              <button class="btn-outline-sm" data-acao="rem-opcao" data-g="${gC}" data-o="${oi}" title="Remover cor">✕</button>
            </div>`).join('')}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline-sm" data-acao="add-opcao" data-g="${gC}">+ Cor</button>
            <button class="btn-outline-sm gc-perigo" data-acao="rem-cores">Tirar cores</button>
          </div>`
        : `<p class="gc-dica">Para roupa, sapato, capinha... O cliente escolhe a cor na hora de comprar.</p>
           <button class="btn-outline-sm gc-largo" data-acao="add-cores">+ Adicionar cores</button>`}
        </details>` : ''}
        <section class="gc-secao">
        <h4 class="gc-secao-titulo">📷 Foto</h4>
        <div class="gc-foto-linha">
          <div class="gc-foto">${foto ? `<img src="${esc(foto)}" alt="" />` : '🍽️'}</div>
          <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
            <button class="btn-outline-sm" data-acao="enviar-foto">📷 ${foto ? 'Trocar foto' : 'Enviar foto'}</button>
            <input data-campo="imagemUrl" value="${esc(p.imagemUrl || '')}" placeholder="ou cole um link https://..." />
          </div>
        </div>
        ${varejo ? `
          <label style="margin-top:12px;">Mais fotos <small>(até 4: costas, detalhe, no corpo...)</small></label>
          <div class="gc-galeria">
            ${(p.fotosExtras || []).map((u, i) => `
              <div class="gc-galeria-item"><img src="${esc(urlSegura(u))}" alt="" loading="lazy" />
                <button type="button" title="Usar como foto principal" data-acao="foto-principal" data-i="${i}">★</button>
                <button type="button" title="Remover foto" data-acao="foto-remover" data-i="${i}">✕</button>
              </div>`).join('')}
            ${(p.fotosExtras || []).length < 4 ? `<button type="button" class="gc-galeria-add" data-acao="foto-extra" ${foto ? '' : 'disabled title="Envie a foto principal primeiro"'}>📷<span>+ Foto</span></button>` : ''}
          </div>` : ''}

        </section>
        <details class="gc-secao" data-secao="estoque" ${aberta('estoque', esgotado || p.controlarEstoque)}>
        <summary>📦 Disponibilidade e estoque <small>${esgotado ? '⛔ esgotado' : grade ? `${totalGrade(p)} em estoque` : p.controlarEstoque ? `${esc(estoqueAtual(p, AppState.lojaDados))} em estoque` : 'à venda'}</small></summary>
        ${varejo && (tamanhos || cores) ? `
          <label class="gc-check"><input type="checkbox" data-campo="controlarGrade" ${grade ? 'checked' : ''} /> Controlar estoque por ${tamanhos && cores ? 'tamanho e cor' : tamanhos ? 'tamanho' : 'cor'}</label>
          ${grade ? (() => {
            const { tamanhos: ts, cores: cs } = eixosGrade(p);
            return `<div class="gc-grade-scroll"><table class="gc-grade">
              <tr><th></th>${cs.map(c => `<th>${c === '-' ? 'Qtd.' : esc(c)}</th>`).join('')}</tr>
              ${ts.map(t => `<tr><th>${t === '-' ? 'Qtd.' : esc(t)}</th>${cs.map(c => { const k = chaveGradeNomes(t === '-' ? null : t, c === '-' ? null : c); return `<td><input type="number" min="0" inputmode="numeric" data-grade="${esc(k)}" value="${Number(p.estoqueGrade[k]) || 0}" aria-label="${esc(k.replace('|', ' '))}" /></td>`; }).join('')}</tr>`).join('')}
            </table></div>
            <p class="gc-dica">Quantas peças tem de cada uma. Cada venda tira 1 da combinação escolhida; com 0, o cliente não consegue escolher aquela opção.</p>`;
          })() : ''}` : ''}
        ${grade ? '' : `<label class="gc-check"><input type="checkbox" data-campo="esgotado" ${esgotado ? 'checked' : ''} /> Esgotado (pausar venda deste produto)</label>
        <div class="gc-linha">
          <div><label>📦 Quantidade em estoque <small>(vazio = sem controle)</small></label>
            <input data-campo="estoqueQtd" type="number" min="0" inputmode="numeric" placeholder="ex: 24" value="${p.controlarEstoque ? esc(estoqueAtual(p, AppState.lojaDados)) : ''}" /></div>
          <div><label>🔁 Repor todo dia para <small>(opcional)</small></label>
            <input data-campo="estoqueDiario" type="number" min="0" inputmode="numeric" placeholder="ex: 30" value="${Number(p.estoqueDiario) > 0 ? esc(p.estoqueDiario) : ''}" /></div>
        </div>
        <p class="gc-dica" style="margin-top:-4px;">Cada venda tira do estoque sozinha. Quando chega a 0, aparece "Esgotado" no cardápio${Number(p.estoqueDiario) > 0 ? ' e volta cheio no dia seguinte' : ''}.</p>`}

        </details>
        <details class="gc-secao" data-secao="oferta" ${aberta('oferta', Boolean(p.oferta && p.oferta.precoCentavos))}>
        <summary>🔥 Oferta do dia <small>${p.oferta && p.oferta.precoCentavos ? `por ${formatarCentavos(p.oferta.precoCentavos)}` : 'nenhuma'}</small></summary>
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

        </details>
        <details class="gc-secao" data-secao="opcoes" ${aberta('opcoes', outrosGrupos > 0)}>
        <summary>🧩 Opções: sabores, bordas, adicionais <small>${outrosGrupos ? `${outrosGrupos} grupo(s)` : 'nenhuma'}</small></summary>
        <p class="gc-dica">Use para o cliente escolher: sabores da pizza, ponto da carne, borda, adicionais. Ex.: grupo "Sabores", escolha de 1 até 2.</p>
        <div id="gc-grupos">
          ${p.grupos.map((g, gi) => (g.tipo === 'tamanho' || g.tipo === 'cor') ? '' : `
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
        </details>

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
    else if (el.dataset.grade !== undefined) {
      estoqueEditado.add(p.id);
      p.estoqueGrade = p.estoqueGrade || {};
      p.estoqueGrade[el.dataset.grade] = Math.max(0, Math.round(Number(el.value) || 0));
    }
    else if (campo === 'estoqueQtd') {
      estoqueEditado.add(p.id);
      if (el.value.trim() === '' && !(Number(p.estoqueDiario) > 0)) { delete p.controlarEstoque; delete p.estoque; }
      else { p.controlarEstoque = true; p.estoque = Math.max(0, Math.round(Number(el.value) || 0)); p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
    } else if (campo === 'estoqueDiario') {
      estoqueEditado.add(p.id);
      const n = Math.max(0, Math.round(Number(el.value) || 0));
      if (n > 0) { p.estoqueDiario = n; if (!p.controlarEstoque) { p.controlarEstoque = true; p.estoque = n; } p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
      else delete p.estoqueDiario;
    }
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
    if (campo === 'nome' || campo === 'preco' || el.dataset.ocampo === 'preco') renderLista();
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
    if (el.dataset.campo === 'categoriaId') {
      p.categoriaId = el.value;
      const cat = rascunho.categorias.find(c => c.id === p.categoriaId);
      if (!(cat && (cat.subcategorias || []).some(sb => sb.id === p.subcategoriaId))) delete p.subcategoriaId;
    } else if (el.dataset.ocampo === 'nome' && el.dataset.antes !== undefined) {
      // Renomeou um tamanho/cor: a quantidade da grade acompanha o nome novo
      const g = p.grupos[Number(el.dataset.g)];
      const antes = el.dataset.antes.trim(), depois = el.value.trim();
      if (usaGrade(p) && antes && depois && antes !== depois) {
        const pos = g.tipo === 'cor' ? 1 : 0;
        p.estoqueGrade = Object.fromEntries(Object.entries(p.estoqueGrade).map(([k, v]) => { const partes = k.split('|'); if (partes[pos] === antes) partes[pos] = depois; return [partes.join('|'), v]; }));
      }
      if (usaGrade(p)) { const antigo = p.estoqueGrade; p.estoqueGrade = Object.fromEntries(chavesGrade(p).map(k => [k, Number(antigo[k]) || 0])); }
    } else if (el.dataset.campo === 'controlarGrade') {
      estoqueEditado.add(p.id);
      if (el.checked) {
        const antigo = p.estoqueGrade || {};
        p.estoqueGrade = Object.fromEntries(chavesGrade(p).map(k => [k, Number(antigo[k]) || 0]));
        p.controlarGrade = true;
        delete p.controlarEstoque; delete p.estoque; delete p.estoqueDiario;
        secoesAbertas.set(`${p.id}:estoque`, true);
      } else { delete p.controlarGrade; }
    } else if (el.dataset.campo === 'subcategoriaId') {
      if (el.value) p.subcategoriaId = el.value; else delete p.subcategoriaId;
    }
    else if (el.dataset.campo === 'esgotado') {
      estoqueEditado.add(p.id);
      if (el.checked) { p.controlarEstoque = true; p.estoque = 0; p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
      else if (Number(p.estoqueDiario) > 0) { p.estoque = Number(p.estoqueDiario); p.estoqueRepostoEm = diaDaLoja(AppState.lojaDados); }
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

    if (acao === 'foto-extra') {
      alvo.disabled = true;
      enviarFoto('produto').then(url => {
        alvo.disabled = false;
        if (!url || !rascunho.produtos.includes(p)) return;
        p.fotosExtras = [...(p.fotosExtras || []), url].slice(0, 4);
        marcarAlterado(); renderEditor();
        showToast('Foto adicionada! Toque em 💾 Salvar para publicar.');
      });
      return;
    }
    if (acao === 'foto-principal' || acao === 'foto-remover') {
      const i = Number(alvo.dataset.i);
      const extras = [...(p.fotosExtras || [])];
      if (acao === 'foto-principal') { const nova = extras[i]; extras[i] = p.imagemUrl; p.imagemUrl = nova; }
      else extras.splice(i, 1);
      p.fotosExtras = extras.filter(u => urlSegura(u));
      marcarAlterado(); renderLista(); renderEditor();
      return;
    }
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
    if (acao === 'add-tamanhos') {
      // O preço que já estava vira o primeiro tamanho; o produto passa a custar o tamanho escolhido
      const base = Number(p.precoCentavos) || 0;
      p.grupos.unshift({ tipo: 'tamanho', titulo: 'Tamanho', minimo: 1, maximo: 1, regraDePreco: 'SOMA', opcoes: [{ nome: '', precoCentavos: base }, { nome: '', precoCentavos: 0 }] });
      p.precoCentavos = 0;
      secoesAbertas.set(`${p.id}:tamanhos`, true);
    } else if (acao === 'rem-tamanhos') {
      if (!confirm('Tirar os tamanhos deste produto? Depois informe o preço único dele.')) return;
      const i = p.grupos.findIndex(g => g.tipo === 'tamanho');
      if (i >= 0) { p.precoCentavos = Number(p.grupos[i].opcoes[0]?.precoCentavos) || 0; p.grupos.splice(i, 1); }
    } else if (acao === 'add-cores') {
      const iT = p.grupos.findIndex(g => g.tipo === 'tamanho');
      p.grupos.splice(iT + 1, 0, { tipo: 'cor', titulo: 'Cor', minimo: 1, maximo: 1, regraDePreco: 'SOMA', opcoes: [{ nome: '', precoCentavos: 0 }, { nome: '', precoCentavos: 0 }] });
      secoesAbertas.set(`${p.id}:cores`, true);
    } else if (acao === 'rem-cores') {
      if (!confirm('Tirar as cores deste produto?')) return;
      const i = p.grupos.findIndex(g => g.tipo === 'cor');
      if (i >= 0) p.grupos.splice(i, 1);
    } else if (acao === 'add-grupo') {
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
      const cor = (p.grupos || []).find(g => g.tipo === 'cor');
      if (cor) {
        if (cor.opcoes.some(o => !(o.nome || '').trim())) { abrir(); return `"${nome}": dê um nome para cada cor.`; }
      }
      for (const gv of [(p.grupos || []).find(g => g.tipo === 'tamanho'), cor].filter(Boolean)) {
        const nomes = gv.opcoes.map(o => String(o.nome || '').trim().toLowerCase());
        if (new Set(nomes).size !== nomes.length) { abrir(); return `"${nome}": há ${gv.tipo === 'cor' ? 'cores' : 'tamanhos'} com o mesmo nome.`; }
        if (nomes.some(n => n.includes('|'))) { abrir(); return `"${nome}": não use o sinal | nos nomes.`; }
      }
      const tam = (p.grupos || []).find(g => g.tipo === 'tamanho');
      if (tam) {
        if ((tam.opcoes || []).length < 1) { abrir(); return `"${nome}": adicione pelo menos um tamanho.`; }
        if (tam.opcoes.some(o => !(o.nome || '').trim())) { abrir(); return `"${nome}": dê um nome para cada tamanho (ex.: Inteiro, Fatia).`; }
        if (tam.opcoes.some(o => !(Number(o.precoCentavos) > 0))) { abrir(); return `"${nome}": informe o preço de cada tamanho.`; }
        if (p.oferta && p.oferta.precoCentavos) { abrir(); return `"${nome}" tem tamanhos: a oferta do dia não vale para produto com tamanhos. Tire a oferta.`; }
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
      ...(() => {
        const cat = rascunho.categorias.find(c => c.id === p.categoriaId);
        const sb = cat && (cat.subcategorias || []).find(x => x.id === p.subcategoriaId);
        return sb ? { subcategoriaId: sb.id, subcategoriaNome: sb.nome } : {};
      })(),
      nome: p.nome.trim(),
      descricao: (p.descricao || '').trim(),
      precoCentavos: p.precoCentavos || 0
    };
    const foto = urlSegura(p.imagemUrl);
    if (foto) out.imagemUrl = foto;
    const extras = (p.fotosExtras || []).map(urlSegura).filter(u => u && u !== foto).slice(0, 4);
    if (foto && extras.length && ehVarejo()) out.fotos = [foto, ...extras];
    // Crédito do fotógrafo (fotos de exemplo do Unsplash): só vale enquanto a foto for a do Unsplash
    if (foto && p.imagemCredito && /^https:\/\/images\.unsplash\.com\//.test(foto)) out.imagemCredito = { autor: String(p.imagemCredito.autor || '').slice(0, 80), link: String(p.imagemCredito.link || '').slice(0, 300) };
    if (usaGrade(p) && (p.grupos || []).some(g => g.tipo === 'tamanho' || g.tipo === 'cor')) {
      out.controlarGrade = true;
      out.estoqueGrade = Object.fromEntries(chavesGrade(p).map(k => [k, Math.max(0, Math.round(Number(p.estoqueGrade[k]) || 0))]));
    } else if (p.controlarEstoque) { out.controlarEstoque = true; out.estoque = Number(p.estoque) || 0; }
    if (p.controlarEstoque && Number(p.estoqueDiario) > 0) { out.estoqueDiario = Number(p.estoqueDiario); if (p.estoqueRepostoEm) out.estoqueRepostoEm = String(p.estoqueRepostoEm); }
    if (p.oferta && p.oferta.precoCentavos > 0 && (p.oferta.dias || []).length) out.oferta = { precoCentavos: p.oferta.precoCentavos, dias: [...p.oferta.dias] };
    if (p.grupos?.length) {
      out.grupos = p.grupos.map(g => ({
        titulo: g.titulo.trim(),
        minimo: Number(g.minimo) || 0,
        maximo: Number(g.maximo) || 1,
        regraDePreco: g.regraDePreco || 'SOMA',
        ...(g.tipo === 'tamanho' || g.tipo === 'cor' ? { tipo: g.tipo } : {}),
        opcoes: g.opcoes.map(o => ({ nome: o.nome.trim(), precoCentavos: o.precoCentavos || 0 }))
      }));
    }
    return out;
  }

  // ↩ Desfazer: volta o cardápio para a versão salva antes da última alteração (o estoque atual é mantido)
  $('#gc-desfazer').onclick = async () => {
    try {
      const refAtual = doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo');
      const refBackup = doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_backup');
      const b = await getDoc(refBackup);
      if (!b.exists()) { showToast('Ainda não há uma versão anterior para voltar.'); return; }
      const anterior = b.data();
      const quando = anterior.salvoEm?.toDate ? anterior.salvoEm.toDate().toLocaleString('pt-BR') : 'antes do último salvamento';
      if (!confirm(`Voltar o cardápio para como estava em ${quando}?\n\nA versão de agora fica guardada: se mudar de ideia, toque em ↩ Desfazer de novo.`)) return;
      const atual = (await getDoc(refAtual)).data() || {};
      const estoqueAgora = new Map((atual.produtos || []).map(x => [x.id, x]));
      const produtos = (anterior.produtos || []).map(x => {
        const ag = estoqueAgora.get(x.id);
        return ag && ag.controlarEstoque && x.controlarEstoque ? { ...x, estoque: ag.estoque, ...(ag.estoqueRepostoEm ? { estoqueRepostoEm: ag.estoqueRepostoEm } : {}) } : x;
      });
      await setDoc(refBackup, { categorias: atual.categorias || [], produtos: atual.produtos || [], salvoEm: serverTimestamp() });
      await setDoc(refAtual, { categorias: anterior.categorias || [], produtos, atualizadoEm: serverTimestamp() });
      alterado = false;
      overlay.remove();
      showToast(textoLoja('↩ Cardápio restaurado!', AppState.lojaDados));
      abrirGestaoCardapio();
    } catch (err) { console.error(err); showToast('Não foi possível desfazer agora.'); }
  };

  $('#gc-salvar').onclick = async () => {
    const erro = validar();
    if (erro) { showToast(erro, 5000); return; }
    const btn = $('#gc-salvar');
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    try {
      const ref = doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo');
      const atual = await getDoc(ref);
      const doServidor = atual.exists() ? atual.data() : null;
      // Backup da versão anterior (para "↩ Desfazer última alteração")
      if (doServidor) await setDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_backup'), { categorias: doServidor.categorias || [], produtos: doServidor.produtos || [], salvoEm: serverTimestamp() });
      // Estoque que mudou com vendas enquanto você editava: mantém o número do servidor
      const estoqueServidor = new Map((doServidor && doServidor.produtos || []).map(x => [x.id, x]));
      const produtosFinais = rascunho.produtos.map(limpar).map(x => {
        const sv = estoqueServidor.get(x.id);
        if (!estoqueEditado.has(x.id) && sv && x.controlarGrade && sv.estoqueGrade) return { ...x, estoqueGrade: Object.fromEntries(Object.keys(x.estoqueGrade).map(k => [k, k in sv.estoqueGrade ? Number(sv.estoqueGrade[k]) || 0 : x.estoqueGrade[k]])) };
        if (estoqueEditado.has(x.id) || !sv || !x.controlarEstoque) return x;
        return { ...x, estoque: Number(sv.estoque) || 0, ...(sv.estoqueRepostoEm ? { estoqueRepostoEm: sv.estoqueRepostoEm } : {}) };
      });
      await setDoc(ref, {
        categorias: rascunho.categorias.map(c => ({ id: c.id, nome: c.nome, ...((c.subcategorias || []).length ? { subcategorias: c.subcategorias.map(sb => ({ id: sb.id, nome: sb.nome.trim().slice(0, 30) })) } : {}) })),
        produtos: produtosFinais,
        atualizadoEm: serverTimestamp()
      });
      estoqueEditado.clear();
      alterado = false;
      $('#gc-status').textContent = '✓ Salvo';
      showToast(textoLoja('Cardápio salvo! Os clientes já veem a versão nova.', AppState.lojaDados));
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
