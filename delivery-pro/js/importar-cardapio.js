// Ativação relâmpago: importa um cardápio pronto por segmento ou uma planilha CSV.
// Os preços dos modelos são só sugestões — o dono ajusta depois em "Gerenciar cardápio".
import { db, showToast, esc, formatarCentavos } from './config.js';
import { AppState } from './router.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const novoId = (prefixo) => `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const r$ = (v) => Math.round(v * 100);
const ops = (lista) => lista.map(([nome, preco]) => ({ nome, precoCentavos: r$(preco) }));
const item = (cat, nome, preco, descricao = '', grupos) => ({ cat, nome, preco, descricao, grupos });

const ADICIONAIS_LANCHE = { titulo: 'Adicionais', minimo: 0, maximo: 5, regraDePreco: 'SOMA', opcoes: ops([['Bacon', 5], ['Cheddar', 4], ['Ovo', 3], ['Hambúrguer extra', 9], ['Cebola caramelizada', 4]]) };

const MODELOS = {
  pizzaria: {
    nome: '🍕 Pizzaria', layout: 'gastronomia',
    categorias: ['🍕 Pizzas', '🥤 Bebidas', '🍫 Sobremesas'],
    itens: [
      item('🍕 Pizzas', 'Pizza Grande (8 fatias)', 0, 'Escolha 1 ou 2 sabores (meio a meio). Cobra o sabor mais caro.', [
        { titulo: 'Sabores', minimo: 1, maximo: 2, regraDePreco: 'MAIOR_VALOR', opcoes: ops([['Mussarela', 42], ['Calabresa', 45], ['Marguerita', 46], ['Napolitana', 46], ['Frango com Catupiry', 49], ['Bacon', 50], ['Portuguesa', 52], ['Atum', 52], ['Quatro Queijos', 54], ['Chocolate', 48]]) },
        { titulo: 'Borda recheada', minimo: 0, maximo: 1, regraDePreco: 'SOMA', opcoes: ops([['Catupiry', 8], ['Cheddar', 8], ['Chocolate', 10]]) }
      ]),
      item('🍕 Pizzas', 'Pizza Broto (4 fatias)', 0, 'Um sabor.', [
        { titulo: 'Sabor', minimo: 1, maximo: 1, regraDePreco: 'SOMA', opcoes: ops([['Mussarela', 25], ['Calabresa', 27], ['Frango com Catupiry', 29], ['Portuguesa', 30]]) }
      ]),
      item('🥤 Bebidas', 'Refrigerante 2L', 12, 'Coca-Cola ou Guaraná'),
      item('🥤 Bebidas', 'Refrigerante lata 350ml', 6),
      item('🥤 Bebidas', 'Suco natural 500ml', 9, 'Laranja ou limão'),
      item('🥤 Bebidas', 'Água sem gás 500ml', 4),
      item('🍫 Sobremesas', 'Pudim de leite', 10),
      item('🍫 Sobremesas', 'Brownie com sorvete', 14)
    ]
  },
  hamburgueria: {
    nome: '🍔 Hamburgueria', layout: 'gastronomia',
    categorias: ['🍔 Lanches', '🍟 Porções', '🎁 Combos', '🥤 Bebidas'],
    itens: [
      item('🍔 Lanches', 'X-Burger', 22, 'Pão, hambúrguer 150g e queijo', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'X-Salada', 25, 'Pão, hambúrguer 150g, queijo, alface e tomate', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'X-Bacon', 29, 'Pão, hambúrguer 150g, queijo e bacon', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'X-Egg', 26, 'Pão, hambúrguer 150g, queijo e ovo', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'X-Tudo', 35, 'Hambúrguer, queijo, bacon, ovo, presunto, alface e tomate', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'Smash Duplo', 32, 'Dois smash 90g, cheddar e molho da casa', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'Chicken Burger', 27, 'Frango empanado, queijo e maionese temperada', [ADICIONAIS_LANCHE]),
      item('🍔 Lanches', 'Burger Vegetariano', 28, 'Hambúrguer de grão-de-bico, queijo e salada'),
      item('🍟 Porções', 'Batata frita P', 15),
      item('🍟 Porções', 'Batata frita G', 25),
      item('🍟 Porções', 'Batata com cheddar e bacon', 32),
      item('🍟 Porções', 'Onion rings', 22),
      item('🍟 Porções', 'Nuggets (10 un.)', 20),
      item('🎁 Combos', 'Combo X-Burger + batata P + refri lata', 38),
      item('🎁 Combos', 'Combo Smash Duplo + batata P + refri lata', 46),
      item('🥤 Bebidas', 'Refrigerante lata 350ml', 6),
      item('🥤 Bebidas', 'Refrigerante 2L', 12),
      item('🥤 Bebidas', 'Suco natural 500ml', 9),
      item('🥤 Bebidas', 'Milkshake 400ml', 18, 'Chocolate, morango ou ovomaltine')
    ]
  },
  adega: {
    nome: '🍺 Adega', layout: 'varejo',
    categorias: ['🍺 Cervejas (+18)', '🥃 Destilados (+18)', '🍷 Vinhos (+18)', '🧊 Gelo e conveniência'],
    itens: [
      item('🍺 Cervejas (+18)', 'Heineken long neck 330ml', 9),
      item('🍺 Cervejas (+18)', 'Corona long neck 330ml', 9),
      item('🍺 Cervejas (+18)', 'Stella Artois long neck 330ml', 8),
      item('🍺 Cervejas (+18)', 'Brahma lata 350ml', 4.5),
      item('🍺 Cervejas (+18)', 'Skol lata 350ml', 4.5),
      item('🍺 Cervejas (+18)', 'Budweiser lata 350ml', 5),
      item('🍺 Cervejas (+18)', 'Original 600ml', 11),
      item('🥃 Destilados (+18)', 'Vodka Smirnoff 998ml', 49.9),
      item('🥃 Destilados (+18)', 'Whisky Red Label 1L', 129.9),
      item('🥃 Destilados (+18)', "Whiskey Jack Daniel's 1L", 179.9),
      item('🥃 Destilados (+18)', 'Gin Tanqueray 750ml', 139.9),
      item('🥃 Destilados (+18)', 'Cachaça 51 965ml', 19.9),
      item('🍷 Vinhos (+18)', 'Vinho tinto suave 750ml', 29.9),
      item('🍷 Vinhos (+18)', 'Vinho tinto seco 750ml', 39.9),
      item('🧊 Gelo e conveniência', 'Gelo em cubos 5kg', 12),
      item('🧊 Gelo e conveniência', 'Energético 250ml', 12),
      item('🧊 Gelo e conveniência', 'Refrigerante 2L', 11),
      item('🧊 Gelo e conveniência', 'Carvão 3kg', 18),
      item('🧊 Gelo e conveniência', 'Copo descartável (50 un.)', 8)
    ]
  },
  farmacia: {
    nome: '💊 Farmácia', layout: 'varejo',
    categorias: ['🪥 Higiene', '👶 Bebê', '🧴 Cuidados', '🥤 Conveniência'],
    itens: [
      item('🪥 Higiene', 'Creme dental 90g', 6.9),
      item('🪥 Higiene', 'Escova de dentes', 8.9),
      item('🪥 Higiene', 'Fio dental 50m', 9.9),
      item('🪥 Higiene', 'Desodorante aerosol', 15.9),
      item('🪥 Higiene', 'Sabonete em barra', 3.5),
      item('🪥 Higiene', 'Shampoo 350ml', 18.9),
      item('🪥 Higiene', 'Condicionador 350ml', 19.9),
      item('🪥 Higiene', 'Absorvente (8 un.)', 7.9),
      item('👶 Bebê', 'Fralda tamanho M (30 un.)', 49.9),
      item('👶 Bebê', 'Lenço umedecido (50 un.)', 12.9),
      item('👶 Bebê', 'Pomada para assaduras', 19.9),
      item('🧴 Cuidados', 'Protetor solar FPS 50', 49.9),
      item('🧴 Cuidados', 'Hidratante corporal', 22.9),
      item('🧴 Cuidados', 'Álcool em gel 70% 500ml', 12.9),
      item('🧴 Cuidados', 'Curativos (10 un.)', 6.9),
      item('🧴 Cuidados', 'Termômetro digital', 24.9),
      item('🧴 Cuidados', 'Preservativo (3 un.)', 9.9),
      item('🥤 Conveniência', 'Água mineral 500ml', 3),
      item('🥤 Conveniência', 'Isotônico 500ml', 7.9),
      item('🥤 Conveniência', 'Barra de cereal', 3.5)
    ]
  }
};

// Modelo → formato do cardápio (categorias + produtos com IDs novos)
function montarDoModelo(m) {
  const cats = m.categorias.map(nome => ({ id: novoId('c'), nome }));
  const idDe = (nome) => cats.find(c => c.nome === nome).id;
  const produtos = m.itens.map(i => {
    const p = { id: novoId('p'), categoriaId: idDe(i.cat), nome: i.nome, descricao: i.descricao || '', precoCentavos: r$(i.preco) };
    if (i.grupos) p.grupos = JSON.parse(JSON.stringify(i.grupos));
    return p;
  });
  return { categorias: cats, produtos };
}

// ---- Planilha CSV: categoria;produto;descricao;preco;foto ----
const MODELO_CSV = 'categoria;produto;descricao;preco;foto\nPizzas;Pizza de Calabresa;Molho, mussarela e calabresa;45,90;\nBebidas;Refrigerante 2L;Coca-Cola ou Guaraná;12,00;\n';

function lerLinhasCsv(texto) {
  const linhas = String(texto).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return { sep: ';', linhas: [] };
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const quebrar = (linha) => {
    const campos = []; let atual = ''; let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
      else if (c === sep && !aspas) { campos.push(atual); atual = ''; }
      else atual += c;
    }
    campos.push(atual);
    return campos.map(x => x.trim());
  };
  return { sep, linhas: linhas.map(quebrar) };
}
const precoDoTexto = (t) => {
  let s = String(t || '').replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

function montarDoCsv(texto) {
  const { linhas } = lerLinhasCsv(texto);
  if (linhas.length < 2) return { erro: 'A planilha está vazia. Use o modelo (primeira linha com os títulos).' };
  const cab = linhas[0].map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const col = (...nomes) => cab.findIndex(h => nomes.includes(h));
  const iCat = col('categoria'), iNome = col('produto', 'nome', 'item'), iDesc = col('descricao'), iPreco = col('preco', 'valor'), iFoto = col('foto', 'imagem', 'imagemurl');
  if (iNome < 0 || iPreco < 0) return { erro: 'A planilha precisa das colunas "produto" e "preco". Baixe o modelo para ver o formato.' };
  const cats = []; const produtos = []; const problemas = [];
  linhas.slice(1, 301).forEach((l, k) => {
    const nome = (l[iNome] || '').slice(0, 80);
    const preco = precoDoTexto(l[iPreco]);
    if (!nome) return;
    if (preco === null) { problemas.push(`linha ${k + 2} (${nome}): preço inválido`); return; }
    const nomeCat = ((iCat >= 0 && l[iCat]) || 'Outros').slice(0, 40);
    let cat = cats.find(c => c.nome.toLowerCase() === nomeCat.toLowerCase());
    if (!cat) { cat = { id: novoId('c'), nome: nomeCat }; cats.push(cat); }
    const p = { id: novoId('p'), categoriaId: cat.id, nome, descricao: ((iDesc >= 0 && l[iDesc]) || '').slice(0, 300), precoCentavos: preco };
    const foto = iFoto >= 0 ? (l[iFoto] || '') : '';
    if (/^https:\/\/\S+$/i.test(foto)) p.imagemUrl = foto;
    produtos.push(p);
  });
  if (!produtos.length) return { erro: 'Nenhum produto válido encontrado.', problemas };
  return { categorias: cats, produtos, problemas };
}

export function abrirImportarCardapio() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>📥 Importar cardápio</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Comece em 1 minuto: escolha um modelo pronto do seu ramo ou envie uma planilha. Depois é só ajustar preços e fotos em "Gerenciar cardápio".</p>

      <h4 class="gc-subtitulo">1. Modelo pronto</h4>
      <div class="imp-modelos">
        ${Object.entries(MODELOS).map(([k, m]) => `<button type="button" class="imp-modelo" data-modelo="${k}"><strong>${m.nome}</strong><span>${m.itens.length} itens${m.layout === 'varejo' ? ' · grade varejo' : ''}</span></button>`).join('')}
      </div>

      <h4 class="gc-subtitulo">2. Ou uma planilha (CSV)</h4>
      <p class="gc-dica">Colunas: <code>categoria;produto;descricao;preco;foto</code>. Dá para montar no Excel ou Google Planilhas e salvar como CSV.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn-outline-sm" id="imp-baixar">⬇ Baixar planilha modelo</button>
        <label class="btn-outline-sm" style="cursor:pointer;">📄 Escolher planilha<input type="file" id="imp-arquivo" accept=".csv,text/csv" hidden /></label>
      </div>

      <div id="imp-previa" class="imp-previa hidden"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const previa = overlay.querySelector('#imp-previa');
  let escolhido = null; // { categorias, produtos, layout, origem }

  const mostrarPrevia = () => {
    const porCat = escolhido.categorias.map(c => ({ c, n: escolhido.produtos.filter(p => p.categoriaId === c.id).length }));
    previa.classList.remove('hidden');
    previa.innerHTML = `
      <strong>${esc(escolhido.origem)}: ${escolhido.produtos.length} produtos</strong>
      <ul>${porCat.map(x => `<li>${esc(x.c.nome)} — ${x.n}</li>`).join('')}</ul>
      ${escolhido.problemas && escolhido.problemas.length ? `<p class="gc-dica" style="color:var(--danger);">Ignorados: ${esc(escolhido.problemas.slice(0, 5).join('; '))}${escolhido.problemas.length > 5 ? '…' : ''}</p>` : ''}
      <p class="gc-dica">Exemplo: ${esc(escolhido.produtos[0].nome)} — ${escolhido.produtos[0].precoCentavos ? formatarCentavos(escolhido.produtos[0].precoCentavos) : 'preço pelas opções'}</p>
      <label class="gc-check"><input type="radio" name="imp-modo" value="adicionar" checked /> Adicionar ao cardápio atual</label>
      <label class="gc-check" style="margin-top:4px !important;"><input type="radio" name="imp-modo" value="substituir" /> Substituir o cardápio atual (apaga o que existe)</label>
      ${escolhido.layout ? `<label class="gc-check" style="margin-top:4px !important;"><input type="checkbox" id="imp-layout" checked /> Usar o visual ${escolhido.layout === 'varejo' ? '"Varejo" (grade em 2 colunas)' : '"Gastronomia" (lista com foto)'}</label>` : ''}
      <button class="btn-primary" type="button" id="imp-confirmar" style="margin-top:12px;">✅ Importar agora</button>`;
    previa.querySelector('#imp-confirmar').onclick = importar;
    previa.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  overlay.querySelectorAll('[data-modelo]').forEach(b => {
    b.onclick = () => {
      const m = MODELOS[b.dataset.modelo];
      overlay.querySelectorAll('[data-modelo]').forEach(x => x.classList.toggle('ativo', x === b));
      escolhido = { ...montarDoModelo(m), layout: m.layout, origem: `Modelo ${m.nome.replace(/^\S+\s/, '')}` };
      mostrarPrevia();
    };
  });
  overlay.querySelector('#imp-baixar').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + MODELO_CSV], { type: 'text/csv;charset=utf-8' }));
    a.download = 'modelo-cardapio.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  overlay.querySelector('#imp-arquivo').onchange = async (e) => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    if (arq.size > 500 * 1024) { showToast('Planilha grande demais (máximo 500 KB).'); return; }
    const r = montarDoCsv(await arq.text());
    if (r.erro) { showToast(r.erro, 6000); return; }
    overlay.querySelectorAll('[data-modelo]').forEach(x => x.classList.remove('ativo'));
    escolhido = { ...r, layout: null, origem: `Planilha "${arq.name}"` };
    mostrarPrevia();
  };

  async function importar() {
    const modo = previa.querySelector('input[name="imp-modo"]:checked').value;
    if (modo === 'substituir' && !confirm('Substituir o cardápio atual? Os produtos que existem hoje serão apagados.')) return;
    const btn = previa.querySelector('#imp-confirmar');
    btn.disabled = true; btn.textContent = 'Importando...';
    try {
      const ref = doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo');
      let base = { categorias: [], produtos: [] };
      if (modo === 'adicionar') {
        const snap = await getDoc(ref);
        if (snap.exists()) base = { categorias: snap.data().categorias || [], produtos: (snap.data().produtos || []).filter(p => !p.excluido) };
      }
      // Categoria com o mesmo nome é reaproveitada (não duplica)
      const categorias = [...base.categorias];
      const trocaId = {};
      escolhido.categorias.forEach(c => {
        const existe = categorias.find(x => x.nome.toLowerCase() === c.nome.toLowerCase());
        if (existe) trocaId[c.id] = existe.id; else { categorias.push(c); trocaId[c.id] = c.id; }
      });
      const produtos = [...base.produtos, ...escolhido.produtos.map(p => ({ ...p, categoriaId: trocaId[p.categoriaId] }))];
      if (produtos.length > 600) throw new Error('O cardápio passaria de 600 produtos. Importe menos itens.');
      await setDoc(ref, { categorias, produtos, atualizadoEm: serverTimestamp() });
      const usarLayout = escolhido.layout && previa.querySelector('#imp-layout')?.checked;
      if (usarLayout) {
        await updateDoc(doc(db, 'lojas', AppState.lojaId), { layoutVitrine: escolhido.layout });
        AppState.lojaDados.layoutVitrine = escolhido.layout;
      }
      overlay.remove();
      showToast(`✅ ${escolhido.produtos.length} produtos importados! Ajuste preços e fotos em "Gerenciar cardápio".`, 6000);
    } catch (err) {
      console.error(err);
      showToast(err.code === 'permission-denied' ? 'Só o dono pode importar o cardápio.' : (err.message || 'Erro ao importar.'), 6000);
      btn.disabled = false; btn.textContent = '✅ Importar agora';
    }
  }
}
