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
    nome: '🍕 Pizzaria', layout: 'gastronomia', cor: '#c0392b', tempo: '40-60 min',
    descricao: 'Pizzas no capricho, massa artesanal e entrega rápida. Peça meio a meio!',
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
    nome: '🍔 Hamburgueria', layout: 'gastronomia', cor: '#d35400', tempo: '30-50 min',
    descricao: 'Hambúrgueres artesanais suculentos, batata crocante e combos que matam a fome.',
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
    nome: '🍺 Adega', layout: 'varejo', cor: '#7f1d1d', tempo: '20-40 min',
    descricao: 'Cerveja gelada, destilados, vinhos e gelo na sua porta. Venda proibida para menores de 18 anos.',
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
  acai: {
    nome: '🍇 Açaí', layout: 'gastronomia', cor: '#6b21a8', tempo: '20-40 min',
    descricao: 'Açaí cremoso do seu jeito, com os complementos que você ama.',
    categorias: ['🍇 Açaí', '🍦 Sorvetes', '🥤 Bebidas'],
    itens: [
      item('🍇 Açaí', 'Açaí 300ml', 14, 'Monte do seu jeito', [{ titulo: 'Complementos', minimo: 0, maximo: 5, regraDePreco: 'SOMA', opcoes: ops([['Leite condensado', 2], ['Granola', 2], ['Paçoca', 2], ['Banana', 2], ['Leite em pó', 2], ['Morango', 3], ['Creme de avelã', 5]]) }]),
      item('🍇 Açaí', 'Açaí 500ml', 19, 'Monte do seu jeito', [{ titulo: 'Complementos', minimo: 0, maximo: 6, regraDePreco: 'SOMA', opcoes: ops([['Leite condensado', 2], ['Granola', 2], ['Paçoca', 2], ['Banana', 2], ['Leite em pó', 2], ['Morango', 3], ['Creme de avelã', 5]]) }]),
      item('🍇 Açaí', 'Açaí 700ml', 25, 'Monte do seu jeito', [{ titulo: 'Complementos', minimo: 0, maximo: 8, regraDePreco: 'SOMA', opcoes: ops([['Leite condensado', 2], ['Granola', 2], ['Paçoca', 2], ['Banana', 2], ['Leite em pó', 2], ['Morango', 3], ['Creme de avelã', 5]]) }]),
      item('🍇 Açaí', 'Barca de açaí 1L (para dividir)', 39, 'Vem com 4 complementos à escolha da casa'),
      item('🍦 Sorvetes', 'Pote de sorvete 1,5L', 28, 'Creme, chocolate ou napolitano'),
      item('🍦 Sorvetes', 'Milkshake 400ml', 18, 'Chocolate, morango ou ovomaltine'),
      item('🥤 Bebidas', 'Água sem gás 500ml', 4),
      item('🥤 Bebidas', 'Refrigerante lata 350ml', 6)
    ]
  },
  marmitaria: {
    nome: '🍱 Marmitaria', layout: 'gastronomia', cor: '#15803d', tempo: '30-45 min',
    descricao: 'Comida caseira de verdade, feita no dia e entregue quentinha.',
    categorias: ['🍱 Marmitas', '🍽 Pratos do dia', '🥤 Bebidas e sobremesas'],
    itens: [
      item('🍱 Marmitas', 'Marmita P', 18, 'Arroz, feijão, salada e 1 proteína', [{ titulo: 'Proteína', minimo: 1, maximo: 1, regraDePreco: 'SOMA', opcoes: ops([['Frango grelhado', 0], ['Linguiça', 2], ['Bife acebolado', 3], ['Peixe empanado', 4]]) }]),
      item('🍱 Marmitas', 'Marmita M', 22, 'Arroz, feijão, salada, farofa e 1 proteína', [{ titulo: 'Proteína', minimo: 1, maximo: 1, regraDePreco: 'SOMA', opcoes: ops([['Frango grelhado', 0], ['Linguiça', 2], ['Bife acebolado', 3], ['Peixe empanado', 4]]) }]),
      item('🍱 Marmitas', 'Marmita G', 26, 'Tudo da M em tamanho grande', [{ titulo: 'Proteína', minimo: 1, maximo: 2, regraDePreco: 'SOMA', opcoes: ops([['Frango grelhado', 0], ['Linguiça', 2], ['Bife acebolado', 3], ['Peixe empanado', 4]]) }]),
      item('🍽 Pratos do dia', 'Feijoada completa (sábado)', 32),
      item('🍽 Pratos do dia', 'Parmegiana com arroz e fritas', 34),
      item('🍽 Pratos do dia', 'Strogonoff de frango', 28),
      item('🥤 Bebidas e sobremesas', 'Refrigerante lata 350ml', 6),
      item('🥤 Bebidas e sobremesas', 'Suco natural 500ml', 8),
      item('🥤 Bebidas e sobremesas', 'Pudim de leite', 8)
    ]
  },
  petshop: {
    nome: '🐾 Pet shop', layout: 'varejo', cor: '#1d4ed8', tempo: '40-60 min',
    descricao: 'Ração, petiscos e cuidados para o seu pet, sem sair de casa.',
    categorias: ['🐶 Cães', '🐱 Gatos', '🧼 Higiene e acessórios'],
    itens: [
      item('🐶 Cães', 'Ração cães adultos 15kg', 159.9),
      item('🐶 Cães', 'Ração cães filhotes 3kg', 59.9),
      item('🐶 Cães', 'Petisco bifinho 65g', 12.9),
      item('🐶 Cães', 'Osso mastigável', 9.9),
      item('🐱 Gatos', 'Ração gatos adultos 10kg', 139.9),
      item('🐱 Gatos', 'Sachê para gatos 85g', 3.5),
      item('🐱 Gatos', 'Areia sanitária 4kg', 24.9),
      item('🧼 Higiene e acessórios', 'Tapete higiênico (30 un.)', 49.9),
      item('🧼 Higiene e acessórios', 'Shampoo pet 500ml', 22.9),
      item('🧼 Higiene e acessórios', 'Brinquedo mordedor', 19.9),
      item('🧼 Higiene e acessórios', 'Coleira ajustável', 29.9),
      item('🧼 Higiene e acessórios', 'Comedouro inox', 14.9)
    ]
  },
  mercadinho: {
    nome: '🛒 Mercadinho', layout: 'varejo', cor: '#15803d', tempo: '40-60 min',
    descricao: 'As compras do dia a dia entregues rapidinho na sua casa.',
    categorias: ['🍚 Mercearia', '🥛 Frios e padaria', '🥤 Bebidas', '🧽 Limpeza e higiene'],
    itens: [
      item('🍚 Mercearia', 'Arroz 5kg', 27.9),
      item('🍚 Mercearia', 'Feijão carioca 1kg', 8.9),
      item('🍚 Mercearia', 'Café 500g', 19.9),
      item('🍚 Mercearia', 'Óleo de soja 900ml', 7.9),
      item('🍚 Mercearia', 'Açúcar 1kg', 4.99),
      item('🥛 Frios e padaria', 'Leite integral 1L', 5.49),
      item('🥛 Frios e padaria', 'Pão de forma', 9.9),
      item('🥛 Frios e padaria', 'Ovos (12 un.)', 12.9),
      item('🥤 Bebidas', 'Refrigerante 2L', 9.9),
      item('🥤 Bebidas', 'Água mineral 1,5L', 3.5),
      item('🧽 Limpeza e higiene', 'Papel higiênico (12 rolos)', 21.9),
      item('🧽 Limpeza e higiene', 'Detergente 500ml', 2.99),
      item('🧽 Limpeza e higiene', 'Sabão em pó 1kg', 14.9)
    ]
  },
  farmacia: {
    nome: '💊 Farmácia', layout: 'varejo', cor: '#0f766e', tempo: '30-50 min',
    descricao: 'Higiene, cuidados e conveniência com entrega rápida perto de você.',
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

// Ramos disponíveis (para o Master criar loja de demonstração com o visual certo)
export const RAMOS = Object.fromEntries(Object.entries(MODELOS).map(([k, m]) => [k, { nome: m.nome, cor: m.cor, layout: m.layout, descricao: m.descricao, tempo: m.tempo, itens: m.itens.length }]));
// fotos = { termo: { url, autor, link } } (buscadas pelo Master no Unsplash). Sem fotos, sai sem imagem.
export function cardapioDoRamo(ramo, fotos = {}) {
  const m = MODELOS[ramo];
  if (!m) return null;
  const c = montarDoModelo(m);
  c.produtos.forEach(p => {
    const f = fotos[BUSCA_FOTO[p.nome]];
    if (f && f.url) { p.imagemUrl = f.url; p.imagemCredito = { autor: f.autor || '', link: f.link || '' }; }
  });
  return c;
}

// Termo de busca (inglês) da foto de cada produto no Unsplash. Produtos iguais usam a mesma foto.
export const BUSCA_FOTO = { "Absorvente (8 un.)": "feminine hygiene pads", "Areia sanitária 4kg": "cat litter box", "Arroz 5kg": "rice bag grocery", "Açaí 300ml": "acai bowl", "Açaí 500ml": "acai bowl granola", "Açaí 700ml": "acai bowl fruits", "Açúcar 1kg": "sugar bowl", "Barca de açaí 1L (para dividir)": "acai bowl sharing", "Barra de cereal": "granola bar", "Batata com cheddar e bacon": "cheese fries bacon", "Batata frita G": "french fries", "Batata frita P": "french fries basket", "Brahma lata 350ml": "beer can", "Brinquedo mordedor": "dog chew toy", "Brownie com sorvete": "brownie ice cream", "Budweiser lata 350ml": "beer cans cold", "Burger Vegetariano": "veggie burger", "Cachaça 51 965ml": "cachaca bottle", "Café 500g": "coffee beans bag", "Carvão 3kg": "charcoal barbecue", "Chicken Burger": "chicken burger", "Coleira ajustável": "dog collar", "Combo Smash Duplo + batata P + refri lata": "burger fries soda combo", "Combo X-Burger + batata P + refri lata": "burger and fries meal", "Comedouro inox": "dog food bowl", "Condicionador 350ml": "hair conditioner bottle", "Copo descartável (50 un.)": "disposable cups", "Corona long neck 330ml": "beer bottle lime", "Creme dental 90g": "toothpaste", "Curativos (10 un.)": "adhesive bandage", "Desodorante aerosol": "deodorant spray", "Detergente 500ml": "dish soap bottle", "Energético 250ml": "energy drink can", "Escova de dentes": "toothbrush", "Feijoada completa (sábado)": "feijoada", "Feijão carioca 1kg": "beans", "Fio dental 50m": "dental floss", "Fralda tamanho M (30 un.)": "baby diapers", "Gelo em cubos 5kg": "ice cubes", "Gin Tanqueray 750ml": "gin bottle", "Heineken long neck 330ml": "green beer bottle", "Hidratante corporal": "body lotion", "Isotônico 500ml": "sports drink bottle", "Leite integral 1L": "milk carton", "Lenço umedecido (50 un.)": "baby wipes", "Marmita G": "brazilian lunch plate rice beans", "Marmita M": "rice beans chicken plate", "Marmita P": "lunch box rice beans", "Milkshake 400ml": "milkshake", "Nuggets (10 un.)": "chicken nuggets", "Onion rings": "onion rings", "Original 600ml": "beer bottle", "Osso mastigável": "dog bone treat", "Ovos (12 un.)": "eggs carton", "Papel higiênico (12 rolos)": "toilet paper rolls", "Parmegiana com arroz e fritas": "chicken parmigiana", "Petisco bifinho 65g": "dog treats", "Pizza Broto (4 fatias)": "small pizza", "Pizza Grande (8 fatias)": "pizza", "Pomada para assaduras": "baby cream", "Pote de sorvete 1,5L": "ice cream tub", "Preservativo (3 un.)": "pharmacy shelf", "Protetor solar FPS 50": "sunscreen", "Pudim de leite": "flan caramel pudding", "Pão de forma": "sliced bread", "Ração cães adultos 15kg": "dog food", "Ração cães filhotes 3kg": "puppy eating", "Ração gatos adultos 10kg": "cat food", "Refrigerante 2L": "soda bottle", "Refrigerante lata 350ml": "soda can", "Sabonete em barra": "bar soap", "Sabão em pó 1kg": "laundry detergent", "Sachê para gatos 85g": "cat eating wet food", "Shampoo 350ml": "shampoo bottle", "Shampoo pet 500ml": "dog bath", "Skol lata 350ml": "beer can ice", "Smash Duplo": "smash burger", "Stella Artois long neck 330ml": "beer glass bottle", "Strogonoff de frango": "chicken stroganoff", "Suco natural 500ml": "orange juice", "Tapete higiênico (30 un.)": "puppy pad", "Termômetro digital": "digital thermometer", "Vinho tinto seco 750ml": "red wine bottle", "Vinho tinto suave 750ml": "red wine glass", "Vodka Smirnoff 998ml": "vodka bottle", "Whiskey Jack Daniel's 1L": "whiskey bottle", "Whisky Red Label 1L": "whisky glass", "X-Bacon": "bacon burger", "X-Burger": "cheeseburger", "X-Egg": "burger with egg", "X-Salada": "burger lettuce tomato", "X-Tudo": "loaded burger", "Água mineral 1,5L": "water bottle", "Água mineral 500ml": "mineral water bottle", "Água sem gás 500ml": "water bottle small", "Óleo de soja 900ml": "cooking oil bottle", "Álcool em gel 70% 500ml": "hand sanitizer" };

// Capa e logo de cada ramo (busca no Unsplash)
export const BUSCA_RAMO = {
  pizzaria: { capa: 'pizzeria wood oven', logo: 'pizza top view' },
  hamburgueria: { capa: 'burger restaurant', logo: 'burger close up' },
  adega: { capa: 'bar drinks shelf', logo: 'beer glass' },
  acai: { capa: 'acai bowls table', logo: 'acai bowl top view' },
  marmitaria: { capa: 'home cooked food table', logo: 'rice and beans' },
  petshop: { capa: 'pet shop dog', logo: 'happy dog' },
  mercadinho: { capa: 'grocery store aisle', logo: 'grocery basket' },
  farmacia: { capa: 'pharmacy store', logo: 'pharmacy cross' }
};

// Todas as buscas necessárias (sem repetir)
export function buscasDosModelos() {
  const termos = new Set(Object.values(BUSCA_FOTO));
  Object.values(BUSCA_RAMO).forEach(r => { termos.add(r.capa); termos.add(r.logo); });
  return [...termos];
}

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
