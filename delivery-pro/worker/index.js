export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // 1. CORS Preflight para chamadas da API
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // 2. Rota de Manifest PWA dinâmico por loja: /{slug}/manifest.webmanifest
    if (pathParts.length === 2 && pathParts[1] === 'manifest.webmanifest') {
      const slug = pathParts[0].toLowerCase();
      // Em produção, busca nome/cor/ícone da loja no KV ou Firestore REST
      const manifest = {
        name: `Delivery — ${slug.toUpperCase()}`,
        short_name: slug.toUpperCase(),
        start_url: `/${slug}`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ea1d2c',
        icons: [
          { src: 'https://via.placeholder.com/192', sizes: '192x192', type: 'image/png' },
          { src: 'https://via.placeholder.com/512', sizes: '512x512', type: 'image/png' }
        ]
      };
      return new Response(JSON.stringify(manifest), {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // 3. Endpoints de API Segura (Checkout, Pix, Webhooks)
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', region: 'edge', timestamp: Date.now() });
      }
      if (url.pathname === '/api/pedidos' && request.method === 'POST') {
        return criarPedidoSeguro(request, env);
      }
      if (url.pathname === '/api/lojas' && request.method === 'POST') {
        return criarLoja(request, env);
      }
      return jsonResponse({ error: 'Rota de API não encontrada' }, 404);
    }

    // 4. Fallback para os arquivos estáticos do Cloudflare Pages
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Worker ativo');
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// =====================================================================
// CHECKOUT SEGURO: o navegador manda só O QUE foi escolhido; o preço é
// recalculado aqui com o cardápio oficial do Firestore e o pedido é gravado
// pelo Worker (conta de serviço). Clientes não gravam pedidos direto no banco.
// Secret necessário: FIREBASE_SERVICE_ACCOUNT (JSON da conta de serviço).
// =====================================================================

class ErroPedido extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

const FORMAS_PAGAMENTO = ['pix', 'cartao_entrega', 'dinheiro'];

// Limite simples por IP (por instância do Worker): no máximo 8 pedidos a cada 10 minutos
const tentativasPorIp = new Map();
function dentroDoLimite(ip) {
  const agora = Date.now();
  const janela = 10 * 60 * 1000;
  const lista = (tentativasPorIp.get(ip) || []).filter(t => agora - t < janela);
  if (lista.length >= 8) return false;
  lista.push(agora);
  tentativasPorIp.set(ip, lista);
  if (tentativasPorIp.size > 5000) tentativasPorIp.clear();
  return true;
}

async function criarPedidoSeguro(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Pedidos online temporariamente indisponíveis (configuração pendente na loja).', 503);

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(ip)) throw new ErroPedido('Muitos pedidos em pouco tempo. Aguarde alguns minutos.', 429);

    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Pedido em formato inválido.'); }

    // ---- Dados do cliente ----
    const slug = String(corpo.slug || '').toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new ErroPedido('Loja inválida.');
    const token = String(corpo.checkoutToken || '');
    if (!/^chk_[A-Za-z0-9_]{8,80}$/.test(token)) throw new ErroPedido('Atualize a página e tente de novo.');
    const nome = String(corpo.clienteNome || '').trim();
    const whatsapp = String(corpo.clienteWhatsapp || '').replace(/\D/g, '');
    const tipoEntrega = corpo.tipoEntrega === 'retirada' ? 'retirada' : 'entrega';
    const endereco = tipoEntrega === 'retirada' ? 'Retirada na loja' : String(corpo.enderecoTexto || '').trim();
    const destino = corpo.destinoCoords && coordsValidas({ lat: Number(corpo.destinoCoords.lat), lng: Number(corpo.destinoCoords.lng) })
      ? { lat: Number(corpo.destinoCoords.lat), lng: Number(corpo.destinoCoords.lng) } : null;
    const formaPagamento = String(corpo.formaPagamento || '');
    const trocoParaCentavos = Number(corpo.trocoParaCentavos) || 0;
    const origem = String(corpo.origem || 'direto').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'direto';
    if (nome.length < 2 || nome.length > 80) throw new ErroPedido('Informe seu nome.');
    if (whatsapp.length < 10 || whatsapp.length > 13) throw new ErroPedido('Informe um WhatsApp válido com DDD.');
    if (endereco.length < 5 || endereco.length > 250) throw new ErroPedido('Informe o endereço completo.');
    if (!FORMAS_PAGAMENTO.includes(formaPagamento)) throw new ErroPedido('Forma de pagamento inválida.');
    if (!Number.isInteger(trocoParaCentavos) || trocoParaCentavos < 0 || trocoParaCentavos > 100000000) throw new ErroPedido('Valor de troco inválido.');

    const itensPedidos = Array.isArray(corpo.itens) ? corpo.itens : [];
    if (!itensPedidos.length) throw new ErroPedido('Sua sacola está vazia.');
    if (itensPedidos.length > 50) throw new ErroPedido('Pedido com itens demais.');

    // ---- Dados oficiais da loja ----
    const fs = await firestore(env);
    const slugDoc = await fs.ler(`slugs/${slug}`);
    if (!slugDoc || !slugDoc.ativo || !slugDoc.lojaId) throw new ErroPedido('Loja não encontrada ou fechada.', 404);
    const lojaId = String(slugDoc.lojaId);
    const [loja, cardapio, estado] = await Promise.all([
      fs.ler(`lojas/${lojaId}`),
      fs.ler(`lojas/${lojaId}/publico/cardapio_completo`),
      fs.ler(`lojas/${lojaId}/publico/estado`)
    ]);
    if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
    const produtos = (cardapio?.produtos || []).filter(p => !p.excluido);

    // ---- Recalcula cada item com o cardápio oficial ----
    const itens = itensPedidos.map(pedido => {
      const prod = produtos.find(p => p.id === pedido.produtoId);
      if (!prod) throw new ErroPedido('Um item da sua sacola não está mais no cardápio. Remova-o e adicione de novo.');
      if (prod.controlarEstoque && Number(prod.estoque) <= 0) throw new ErroPedido(`"${prod.nome}" está esgotado.`);
      const quantidade = Number(pedido.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new ErroPedido(`Quantidade inválida em "${prod.nome}".`);
      const { unitarioCentavos, detalhes } = calcularItemOficial(prod, pedido.selecoes || {});
      return { produtoId: prod.id, nome: prod.nome, quantidade, unitarioCentavos, detalhes };
    });

    const subtotalCentavos = itens.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);
    if (subtotalCentavos <= 0) throw new ErroPedido('Total do pedido inválido.');
    const minimo = Number(loja.pedidoMinimoCentavos) || 0;
    if (subtotalCentavos < minimo) throw new ErroPedido(`O pedido mínimo desta loja é ${reais(minimo)}.`);

    // ---- Frete recalculado no servidor ----
    let freteCentavos = 0;
    let distanciaKm = null;
    if (tipoEntrega === 'entrega') {
      const frete = calcularFrete(loja, destino);
      if (frete.configurado) {
        if (frete.precisaLocal) throw new ErroPedido('Marque sua localização no mapa para calcularmos a entrega.');
        if (frete.fora) throw new ErroPedido(`Seu endereço (${frete.distanciaKm} km) fica fora da área de entrega. Escolha retirar na loja.`);
        freteCentavos = frete.freteCentavos;
        distanciaKm = frete.distanciaKm;
      }
    }
    const totalCentavos = subtotalCentavos + freteCentavos;
    if (formaPagamento === 'dinheiro' && trocoParaCentavos && trocoParaCentavos < totalCentavos) {
      throw new ErroPedido(`O troco precisa ser para um valor maior que o total (${reais(totalCentavos)}).`);
    }

    const pedido = {
      checkoutToken: token,
      numeroPedido: 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900),
      clienteNome: nome,
      clienteWhatsapp: whatsapp,
      enderecoTexto: endereco,
      tipoEntrega,
      destinoCoords: tipoEntrega === 'entrega' ? destino : null,
      itens,
      subtotalCentavos,
      freteCentavos,
      distanciaKm,
      totalCentavos,
      formaPagamento,
      trocoParaCentavos: formaPagamento === 'dinheiro' ? trocoParaCentavos : 0,
      status: 'novo',
      origem,
      canal: 'vitrine',
      turnoId: estado && estado.caixaAberto && estado.turnoId ? String(estado.turnoId) : null
    };

    // O ID do pedido é o próprio token: clicar duas vezes não cria dois pedidos
    const caminho = `lojas/${lojaId}/pedidos/${token}`;
    const criado = await fs.criarSeNaoExiste(caminho, pedido, ['criadoEm']);
    const final = criado ? pedido : await fs.ler(caminho);
    return jsonResponse({ id: token, numeroPedido: final?.numeroPedido, totalCentavos: final?.totalCentavos, duplicado: !criado }, criado ? 201 : 200);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('criarPedidoSeguro', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível registrar o pedido agora. Tente novamente.' }, 500);
  }
}

// Mesmas regras de preço da vitrine (js/cardapio.js), usando os índices das opções escolhidas
function calcularItemOficial(prod, selecoes) {
  let total = Number(prod.precoCentavos) || 0;
  const detalhes = [];
  (prod.grupos || []).forEach((grp, gi) => {
    const opcoes = grp.opcoes || [];
    const idxs = Array.isArray(selecoes[gi]) ? selecoes[gi] : [];
    if (!idxs.every(n => Number.isInteger(n) && n >= 0 && n < opcoes.length) || new Set(idxs).size !== idxs.length) {
      throw new ErroPedido(`Opção inválida em "${prod.nome}". Remova o item e adicione de novo.`);
    }
    const minimo = Number(grp.minimo) || 0;
    const maximo = Number(grp.maximo) || 1;
    if (idxs.length < minimo || idxs.length > maximo) {
      throw new ErroPedido(`Em "${prod.nome}", escolha de ${minimo} a ${maximo} em "${grp.titulo}". Remova o item e adicione de novo.`);
    }
    if (!idxs.length) return;
    const escolhidas = idxs.map(n => opcoes[n]);
    const precos = escolhidas.map(o => Number(o.precoCentavos) || 0);
    if (grp.regraDePreco === 'MAIOR_VALOR') total += Math.max(...precos);
    else if (grp.regraDePreco === 'MEDIA') total += Math.round(precos.reduce((a, b) => a + b, 0) / precos.length);
    else total += precos.reduce((a, b) => a + b, 0);
    detalhes.push(`${grp.titulo}: ${escolhidas.map(o => o.nome).join(' / ')}`);
  });
  return { unitarioCentavos: total, detalhes };
}

// ---- Frete: MESMA conta de js/frete.js (se mudar lá, mude aqui) ----
const FATOR_RUAS = 1.35;
function distanciaRetaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function coordsValidas(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}
function calcularFrete(loja, destino) {
  const f = loja && loja.frete;
  const origem = loja && loja.localizacao;
  if (!f || !coordsValidas(origem)) return { configurado: false, freteCentavos: 0 };
  if (!coordsValidas(destino)) return { configurado: true, precisaLocal: true };
  const km = distanciaRetaKm(origem, destino) * FATOR_RUAS;
  const distanciaKm = Math.round(km * 10) / 10;
  if (Number(f.raioMaxKm) > 0 && km > Number(f.raioMaxKm)) return { configurado: true, fora: true, distanciaKm };
  const excedente = Math.max(0, km - (Number(f.kmInclusos) || 0));
  let freteCentavos = (Number(f.baseCentavos) || 0) + Math.ceil((excedente * (Number(f.porKmCentavos) || 0)) / 50) * 50;
  const adicional = f.adicionalAtivo && Number(f.adicionalCentavos) > 0 ? (f.adicionalTexto || 'Adicional') : null;
  if (adicional) freteCentavos += Number(f.adicionalCentavos);
  return { configurado: true, freteCentavos, distanciaKm, adicional };
}

function reais(centavos) {
  return 'R$ ' + (centavos / 100).toFixed(2).replace('.', ',');
}

// ---------------- Firestore REST com conta de serviço ----------------
let tokenCache = { valor: null, expira: 0 };

async function tokenGoogle(conta) {
  const agora = Math.floor(Date.now() / 1000);
  if (tokenCache.valor && tokenCache.expira - 60 > agora) return tokenCache.valor;
  const b64url = (dados) => btoa(typeof dados === 'string' ? dados : String.fromCharCode(...new Uint8Array(dados)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({
    iss: conta.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600
  }));
  const pem = conta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cabecalho}.${corpo}`));
  const jwt = `${cabecalho}.${corpo}.${b64url(assinatura)}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  const dados = await resp.json();
  if (!resp.ok || !dados.access_token) throw new Error('Falha ao autenticar no Google: ' + JSON.stringify(dados));
  tokenCache = { valor: dados.access_token, expira: agora + (dados.expires_in || 3600) };
  return tokenCache.valor;
}

async function firestore(env) {
  const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const base = `projects/${conta.project_id}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${base}`;
  const cabecalhos = async () => ({ Authorization: `Bearer ${await tokenGoogle(conta)}`, 'Content-Type': 'application/json' });

  return {
    async ler(caminho) {
      const resp = await fetch(`${url}/${caminho}`, { headers: await cabecalhos() });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`Firestore GET ${caminho}: ${resp.status} ${await resp.text()}`);
      return deCampos((await resp.json()).fields || {});
    },
    // Várias gravações juntas (tudo ou nada). Cada item: { caminho, dados, novo: true|false, horaServidor: [campos] }
    async gravarJuntos(itens) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({
          writes: itens.map(it => ({
            update: { name: `${base}/${it.caminho}`, fields: paraCampos(it.dados) },
            ...(it.novo ? { currentDocument: { exists: false } } : {}),
            updateTransforms: (it.horaServidor || []).map(c => ({ fieldPath: c, setToServerValue: 'REQUEST_TIME' }))
          }))
        })
      });
      if (resp.ok) return true;
      const texto = await resp.text();
      if (resp.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(texto)) return false;
      throw new Error(`Firestore commit: ${resp.status} ${texto}`);
    },
    // Cria o documento só se ele ainda não existir. Retorna false se já existia.
    async criarSeNaoExiste(caminho, dados, camposHoraServidor = []) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({
          writes: [{
            update: { name: `${base}/${caminho}`, fields: paraCampos(dados) },
            currentDocument: { exists: false },
            updateTransforms: camposHoraServidor.map(c => ({ fieldPath: c, setToServerValue: 'REQUEST_TIME' }))
          }]
        })
      });
      if (resp.ok) return true;
      const texto = await resp.text();
      if (resp.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(texto)) return false;
      throw new Error(`Firestore commit ${caminho}: ${resp.status} ${texto}`);
    }
  };
}

function paraValor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraValor) } };
  return { mapValue: { fields: paraCampos(v) } };
}
function paraCampos(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = paraValor(v);
  return out;
}
function deValor(x) {
  if ('stringValue' in x) return x.stringValue;
  if ('integerValue' in x) return Number(x.integerValue);
  if ('doubleValue' in x) return x.doubleValue;
  if ('booleanValue' in x) return x.booleanValue;
  if ('nullValue' in x) return null;
  if ('timestampValue' in x) return x.timestampValue;
  if ('arrayValue' in x) return (x.arrayValue.values || []).map(deValor);
  if ('mapValue' in x) return deCampos(x.mapValue.fields || {});
  return null;
}
function deCampos(campos) {
  const out = {};
  for (const [k, v] of Object.entries(campos)) out[k] = deValor(v);
  return out;
}

// =====================================================================
// CADASTRO DE LOJA (teste grátis): o dono cria o login no app e manda o
// token; aqui conferimos a assinatura do token (Web Crypto) e criamos
// loja + link + equipe + perfil numa gravação única.
// =====================================================================
const SLUGS_RESERVADOS = new Set(['api', 'master', 'admin', 'painel', 'motoboy', 'pedido', 'js', 'css', 'sw', 'www', 'app', 'login', 'entrar', 'cadastro', 'suporte', 'ajuda', 'termos', 'privacidade', 'manifest']);

async function criarLoja(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Cadastro temporariamente indisponível.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite('cad:' + ip)) throw new ErroPedido('Muitas tentativas. Aguarde alguns minutos.', 429);

    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo e tente outra vez.', 401); }

    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const nomeDono = String(corpo.nomeDono || '').trim().slice(0, 60);
    const nomeLoja = String(corpo.nomeLoja || '').trim().slice(0, 60);
    const slug = String(corpo.slug || '').toLowerCase();
    const whatsapp = String(corpo.whatsapp || '').replace(/\D/g, '');
    if (nomeDono.length < 2) throw new ErroPedido('Informe seu nome.');
    if (nomeLoja.length < 2) throw new ErroPedido('Informe o nome da loja.');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(slug)) {
      const e = new ErroPedido('Endereço inválido: use de 3 a 30 letras minúsculas, números ou traço.'); e.campo = 'slug'; throw e;
    }
    if (SLUGS_RESERVADOS.has(slug)) { const e = new ErroPedido('Esse endereço é reservado. Escolha outro.'); e.campo = 'slug'; throw e; }
    if (whatsapp.length < 10 || whatsapp.length > 13) throw new ErroPedido('Informe o WhatsApp com DDD.');

    const fs = await firestore(env);
    const uid = usuario.sub;

    // Já tem loja? Não cria outra: devolve a existente
    const perfil = await fs.ler(`usuarios/${uid}`);
    if (perfil && perfil.slug) return jsonResponse({ slug: perfil.slug, jaExistia: true });

    if (await fs.ler(`slugs/${slug}`)) { const e = new ErroPedido('Esse endereço já está em uso. Escolha outro.', 409); e.campo = 'slug'; throw e; }

    const lojaId = 'l_' + [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');
    const trialAte = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ok = await fs.gravarJuntos([
      { caminho: `slugs/${slug}`, dados: { lojaId, ativo: true }, novo: true },
      {
        caminho: `lojas/${lojaId}`, novo: true, horaServidor: ['criadoEm'],
        dados: {
          nome: nomeLoja, slug, donoUid: uid, whatsapp,
          corPrimaria: '#ea1d2c', tempoEstimado: '30-45 min',
          plano: 'teste', trialAte, ativo: true, origemParceiro: String(corpo.parceiroRef || '').slice(0, 40) || null
        }
      },
      { caminho: `lojas/${lojaId}/equipe/${uid}`, dados: { papel: 'dono', nome: nomeDono, email: usuario.email || null }, novo: true },
      {
        caminho: `usuarios/${uid}`, horaServidor: ['criadoEm'],
        dados: { nome: nomeDono, email: usuario.email || null, lojaId, slug, roles: ['balcao', 'cliente'] }
      }
    ]);
    if (!ok) { const e = new ErroPedido('Esse endereço acabou de ser usado. Escolha outro.', 409); e.campo = 'slug'; throw e; }
    return jsonResponse({ slug, lojaId, trialAte: trialAte.toISOString() }, 201);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message, campo: err.campo || null }, err.status);
    console.error('criarLoja', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível criar a loja agora. Tente novamente.' }, 500);
  }
}

// ---- Validação do token de login do Firebase (JWT RS256) com Web Crypto ----
let chavesGoogleCache = { chaves: null, expira: 0 };

function base64urlParaBytes(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function chavesPublicasFirebase() {
  if (chavesGoogleCache.chaves && chavesGoogleCache.expira > Date.now()) return chavesGoogleCache.chaves;
  const resp = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!resp.ok) throw new Error('Não foi possível obter as chaves do Firebase');
  const idade = Number((resp.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const { keys } = await resp.json();
  chavesGoogleCache = { chaves: keys, expira: Date.now() + idade * 1000 };
  return keys;
}

async function verificarTokenFirebase(token, projectId) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const [h, p, s] = partes;
  const texto = (b) => new TextDecoder().decode(base64urlParaBytes(b));
  const cabecalho = JSON.parse(texto(h));
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) throw new Error('algoritmo inválido');
  const jwk = (await chavesPublicasFirebase()).find(k => k.kid === cabecalho.kid);
  if (!jwk) throw new Error('chave desconhecida');
  const chave = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valido = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, base64urlParaBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!valido) throw new Error('assinatura inválida');
  const dados = JSON.parse(texto(p));
  const agora = Math.floor(Date.now() / 1000);
  if (dados.aud !== projectId) throw new Error('aud');
  if (dados.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss');
  if (!dados.sub || typeof dados.sub !== 'string') throw new Error('sub');
  if (!(dados.exp > agora) || dados.iat > agora + 300) throw new Error('tempo');
  return dados;
}
