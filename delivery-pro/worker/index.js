export default {
  async fetch(request, env, ctx) {
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

    // 2. Ícone e manifest (instalação do app) por loja
    if (url.pathname === '/icone.svg') {
      return new Response(iconeSvg('Delivery Pro', '#ea1d2c'), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    if (pathParts.length === 2 && (pathParts[1] === 'manifest.webmanifest' || pathParts[1] === 'icone.svg')) {
      const slug = pathParts[0].toLowerCase();
      const pub = await dadosPublicosLoja(env, slug, ctx);
      if (pathParts[1] === 'icone.svg') {
        return new Response(iconeSvg(pub ? pub.nome : slug, pub ? pub.cor : '#ea1d2c'), {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' }
        });
      }
      const nome = pub ? pub.nome : slug;
      const curto = nome.length <= 12 ? nome : nome.split(/\s+/).filter(p => !/^(d[aeo]s?|e)$/i.test(p)).slice(0, 2).join(' ').slice(0, 12);
      const manifest = {
        id: `/${slug}`,
        name: nome,
        short_name: curto || nome.slice(0, 12),
        description: pub ? descricaoLoja(pub) : undefined,
        start_url: `/${slug}?origem=app`,
        scope: `/${slug}`,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: pub ? pub.cor : '#ea1d2c',
        icons: [{ src: `/${slug}/icone.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
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
      if (url.pathname === '/api/avaliar' && request.method === 'POST') {
        return avaliarPedido(request, env);
      }
      if (url.pathname === '/api/lojas' && request.method === 'POST') {
        return criarLoja(request, env);
      }
      if (url.pathname === '/api/equipe' && request.method === 'POST') {
        return gerenciarEquipe(request, env);
      }
      if (url.pathname === '/api/master' && request.method === 'POST') {
        return painelMaster(request, env);
      }
      if (url.pathname === '/api/saas' && request.method === 'GET') {
        return jsonResponse(await configSaasPublica(env));
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
    if (!statusAssinatura(loja).ativa) throw new ErroPedido('Esta loja está temporariamente indisponível para pedidos online.', 403);
    const situacao = situacaoLoja(loja, estado);
    if (!situacao.aberta) {
      throw new ErroPedido(situacao.pausada
        ? 'A loja pausou os pedidos por alguns minutos. Tente de novo em instantes.'
        : (situacao.texto === 'Fechado' ? 'A loja está fechada no momento.' : `A loja está fechada agora (${situacao.texto.replace('Fechado · ', '')}).`), 409);
    }
    const produtos = (cardapio?.produtos || []).filter(p => !p.excluido);

    // ---- Recalcula cada item com o cardápio oficial ----
    const itens = itensPedidos.map(pedido => {
      const prod = produtos.find(p => p.id === pedido.produtoId);
      if (!prod) throw new ErroPedido('Um item da sua sacola não está mais no cardápio. Remova-o e adicione de novo.');
      if (prod.controlarEstoque && Number(prod.estoque) <= 0) throw new ErroPedido(`"${prod.nome}" está esgotado.`);
      const quantidade = Number(pedido.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new ErroPedido(`Quantidade inválida em "${prod.nome}".`);
      const { unitarioCentavos, detalhes } = calcularItemOficial(prod, pedido.selecoes || {}, loja);
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

// Oferta do dia: MESMA conta de js/cardapio.js (se mudar lá, mude aqui)
function ofertaDoDia(prod, loja, data = new Date()) {
  const o = prod && prod.oferta;
  const de = Number(prod && prod.precoCentavos) || 0;
  if (!o || !Array.isArray(o.dias) || !o.dias.length) return null;
  const por = Number(o.precoCentavos);
  if (!Number.isInteger(por) || por < 0 || por >= de) return null;
  const { dia } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  return o.dias.includes(DIAS[dia]) ? { deCentavos: de, porCentavos: por } : null;
}

// =====================================================================
// AVALIAÇÃO DE 1 TOQUE: só pedido concluído e ainda não avaliado.
// Cruza o pino do cliente com o GPS da baixa do motoboy: se ficaram
// longe, marca alertaPinoMetros para o lojista conferir o endereço.
// =====================================================================
const LIMITE_PINO_M = 150;
async function avaliarPedido(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível no momento.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(`av:${ip}`)) throw new ErroPedido('Muitas tentativas. Aguarde alguns minutos.', 429);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const slug = String(corpo.slug || '').toLowerCase();
    const pedidoId = String(corpo.pedidoId || '');
    const nota = Number(corpo.nota);
    if (!/^[a-z0-9-]{2,40}$/.test(slug) || !/^[A-Za-z0-9_]{8,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new ErroPedido('Nota inválida.');
    const fs = await firestore(env);
    const slugDoc = await fs.ler(`slugs/${slug}`);
    if (!slugDoc || !slugDoc.lojaId) throw new ErroPedido('Loja não encontrada.', 404);
    const caminho = `lojas/${slugDoc.lojaId}/pedidos/${pedidoId}`;
    const pedido = await fs.ler(caminho);
    if (!pedido) throw new ErroPedido('Pedido não encontrado.', 404);
    if (pedido.status !== 'concluido') throw new ErroPedido('Só dá para avaliar depois da entrega.', 409);
    if (pedido.avaliado) throw new ErroPedido('Este pedido já foi avaliado.', 409);
    const dados = { avaliado: true, avaliacaoNota: nota, avaliadoEm: new Date() };
    const destino = pedido.destinoCoords;
    const baixa = pedido.coordsBaixa;
    if (pedido.tipoEntrega === 'entrega' && coordsValidas(destino) && coordsValidas(baixa)) {
      const metros = Math.round(distanciaRetaKm(destino, baixa) * 1000);
      if (metros > LIMITE_PINO_M) dados.alertaPinoMetros = metros;
    }
    await fs.atualizar(caminho, dados);
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('avaliarPedido', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível enviar agora.' }, 500);
  }
}

// Mesmas regras de preço da vitrine (js/cardapio.js), usando os índices das opções escolhidas
function calcularItemOficial(prod, selecoes, loja) {
  const oferta = ofertaDoDia(prod, loja);
  let total = oferta ? oferta.porCentavos : Number(prod.precoCentavos) || 0;
  const detalhes = oferta ? ['Oferta do dia'] : [];
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

// ---- Horário de funcionamento: MESMA conta de js/horario.js (se mudar lá, mude aqui) ----
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const NOMES_DIA = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado' };
const DIA_INGLES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function agoraNoFuso(fuso, data) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(data);
  const v = (t) => partes.find(p => p.type === t)?.value;
  return { dia: DIA_INGLES[v('weekday')], min: Number(v('hour')) * 60 + Number(v('minute')) };
}
const paraMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const paraHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
function situacaoLoja(loja, estado, data = new Date()) {
  if (estado && estado.pausada) return { aberta: false, pausada: true, texto: 'Pausada no momento' };
  const h = loja && loja.horarios;
  if (!h) return { aberta: true, semHorario: true, texto: 'Aberto' };
  const { dia, min } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  const hoje = h[DIAS[dia]] || [];
  const ontem = h[DIAS[(dia + 6) % 7]] || [];
  for (const faixa of hoje) {
    const a = paraMin(faixa.abre), f = paraMin(faixa.fecha);
    if (a === null || f === null) continue;
    if (f > a ? (min >= a && min < f) : min >= a) return { aberta: true, texto: `Aberto · fecha às ${paraHora(f)}` };
  }
  for (const faixa of ontem) {
    const a = paraMin(faixa.abre), f = paraMin(faixa.fecha);
    if (a === null || f === null) continue;
    if (f <= a && min < f) return { aberta: true, texto: `Aberto · fecha às ${paraHora(f)}` };
  }
  for (let d = 0; d < 8; d++) {
    const chave = DIAS[(dia + d) % 7];
    const aberturas = (h[chave] || []).map(x => paraMin(x.abre)).filter(x => x !== null).sort((x, y) => x - y);
    const proxima = aberturas.find(a => d > 0 || a > min);
    if (proxima !== undefined) {
      const quando = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : NOMES_DIA[chave];
      return { aberta: false, texto: `Fechado · abre ${quando} às ${paraHora(proxima)}` };
    }
  }
  return { aberta: false, texto: 'Fechado' };
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
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
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
    // Atualiza só os campos informados de um documento existente
    async atualizar(caminho, dados) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ writes: [{ update: { name: `${base}/${caminho}`, fields: paraCampos(dados) }, updateMask: { fieldPaths: Object.keys(dados) }, currentDocument: { exists: true } }] })
      });
      if (!resp.ok) throw new Error(`Firestore update ${caminho}: ${resp.status} ${await resp.text()}`);
    },
    // Lista todos os documentos de uma coleção (até 2000)
    async listar(colecao) {
      const docs = [];
      let pagina = '';
      for (let i = 0; i < 10; i++) {
        const resp = await fetch(`${url}/${colecao}?pageSize=200${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`, { headers: await cabecalhos() });
        if (!resp.ok) throw new Error(`Firestore list ${colecao}: ${resp.status} ${await resp.text()}`);
        const r = await resp.json();
        (r.documents || []).forEach(d => docs.push({ id: d.name.split('/').pop(), ...deCampos(d.fields || {}) }));
        if (!r.nextPageToken) break;
        pagina = r.nextPageToken;
      }
      return docs;
    },
    // Quantidade e soma dos pedidos de uma loja desde uma data (inclui cancelados)
    async resumoPedidos(lojaId, desdeIso) {
      const resp = await fetch(`${url}/lojas/${lojaId}:runAggregationQuery`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ structuredAggregationQuery: {
          structuredQuery: { from: [{ collectionId: 'pedidos' }], where: { fieldFilter: { field: { fieldPath: 'criadoEm' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: desdeIso } } } },
          aggregations: [{ alias: 'n', count: {} }, { alias: 'total', sum: { field: { fieldPath: 'totalCentavos' } } }]
        } })
      });
      if (!resp.ok) throw new Error(`Firestore agg: ${resp.status} ${await resp.text()}`);
      const r = await resp.json();
      const campos = (r[0] && r[0].result && r[0].result.aggregateFields) || {};
      return { pedidos: deValor(campos.n || { integerValue: '0' }) || 0, totalCentavos: Math.round(deValor(campos.total || { integerValue: '0' }) || 0) };
    },
    async ultimoPedido(lojaId) {
      const resp = await fetch(`${url}/lojas/${lojaId}:runQuery`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'pedidos' }], orderBy: [{ field: { fieldPath: 'criadoEm' }, direction: 'DESCENDING' }], limit: 1, select: { fields: [{ fieldPath: 'criadoEm' }] } } })
      });
      if (!resp.ok) throw new Error(`Firestore query: ${resp.status} ${await resp.text()}`);
      const r = await resp.json();
      const d = r.find(x => x.document);
      return d ? deValor(d.document.fields.criadoEm || { nullValue: null }) : null;
    },
    // Apaga documentos (tudo ou nada)
    async apagar(caminhos) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ writes: caminhos.map(c => ({ delete: `${base}/${c}` })) })
      });
      if (!resp.ok) throw new Error(`Firestore delete: ${resp.status} ${await resp.text()}`);
    },
    // Logins (Firebase Authentication) via Identity Toolkit
    async buscarLoginPorEmail(email) {
      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${conta.project_id}/accounts:lookup`, {
        method: 'POST', headers: await cabecalhos(), body: JSON.stringify({ email: [email] })
      });
      if (!resp.ok) throw new Error(`Auth lookup: ${resp.status} ${await resp.text()}`);
      const r = await resp.json();
      return r.users && r.users[0] ? r.users[0].localId : null;
    },
    async criarLogin(email, senha, nome) {
      const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${conta.project_id}/accounts`, {
        method: 'POST', headers: await cabecalhos(), body: JSON.stringify({ email, password: senha, displayName: nome })
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = r.error?.message || '';
        if (msg.includes('EMAIL_EXISTS')) return null;
        if (msg.includes('WEAK_PASSWORD')) throw new ErroPedido('Senha fraca: use pelo menos 6 caracteres.');
        if (msg.includes('INVALID_EMAIL')) throw new ErroPedido('E-mail inválido.');
        throw new Error(`Auth create: ${resp.status} ${JSON.stringify(r)}`);
      }
      return r.localId;
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

// =====================================================================
// EQUIPE: o dono adiciona/remove balcão, cozinha e entregadores.
// Conferimos o token e se quem pede é o DONO da loja informada.
// =====================================================================
async function gerenciarEquipe(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível no momento.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite('eq:' + ip)) throw new ErroPedido('Muitas tentativas. Aguarde alguns minutos.', 429);
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo e tente outra vez.', 401); }

    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');

    const fs = await firestore(env);
    const eu = await fs.ler(`lojas/${lojaId}/equipe/${usuario.sub}`);
    if (!eu || eu.papel !== 'dono') throw new ErroPedido('Só o dono da loja pode mexer na equipe.', 403);
    const loja = await fs.ler(`lojas/${lojaId}`);
    if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
    // Endereço (slug) da loja: o gravado nela, ou o enviado pelo app se apontar para esta loja
    let slugLoja = loja.slug || null;
    const slugEnviado = String(corpo.slug || '').toLowerCase();
    if (!slugLoja && /^[a-z0-9-]{2,40}$/.test(slugEnviado)) {
      const s = await fs.ler(`slugs/${slugEnviado}`);
      if (s && s.lojaId === lojaId) slugLoja = slugEnviado;
    }

    if (corpo.acao === 'remover') {
      const uid = String(corpo.uid || '');
      const tipo = corpo.tipo === 'entregadores' ? 'entregadores' : 'equipe';
      if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) throw new ErroPedido('Pessoa inválida.');
      if (uid === usuario.sub) throw new ErroPedido('Você não pode remover a si mesmo.');
      const alvo = await fs.ler(`lojas/${lojaId}/${tipo}/${uid}`);
      if (!alvo) throw new ErroPedido('Essa pessoa já não está na equipe.', 404);
      if (alvo.papel === 'dono') throw new ErroPedido('O dono não pode ser removido.');
      const caminhos = [`lojas/${lojaId}/${tipo}/${uid}`];
      const perfil = await fs.ler(`usuarios/${uid}`);
      if (perfil && perfil.lojaId === lojaId) caminhos.push(`usuarios/${uid}`);
      await fs.apagar(caminhos);
      return jsonResponse({ ok: true });
    }

    if (corpo.acao !== 'adicionar') throw new ErroPedido('Ação inválida.');
    const papel = ['balcao', 'cozinha', 'entregador'].includes(corpo.papel) ? corpo.papel : null;
    const nome = String(corpo.nome || '').trim().slice(0, 60);
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    if (!papel) throw new ErroPedido('Escolha a função.');
    if (nome.length < 2) throw new ErroPedido('Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new ErroPedido('E-mail inválido.');
    if (senha.length < 6 || senha.length > 100) throw new ErroPedido('A senha inicial precisa ter pelo menos 6 caracteres.');

    let uid = await fs.criarLogin(email, senha, nome);
    const contaExistente = !uid;
    if (!uid) uid = await fs.buscarLoginPorEmail(email);
    if (!uid) throw new Error('login não encontrado após EMAIL_EXISTS');
    if (uid === usuario.sub) throw new ErroPedido('Esse é o seu próprio e-mail.');

    const itens = [];
    if (papel === 'entregador') {
      itens.push({ caminho: `lojas/${lojaId}/entregadores/${uid}`, dados: { nome, email } });
    } else {
      const atual = await fs.ler(`lojas/${lojaId}/equipe/${uid}`);
      if (atual && atual.papel === 'dono') throw new ErroPedido('Essa pessoa já é dona desta loja.');
      itens.push({ caminho: `lojas/${lojaId}/equipe/${uid}`, dados: { papel, nome, email } });
    }
    // Perfil para o login levar direto à tela certa (não sobrescreve quem já é dono de outra loja)
    const perfil = await fs.ler(`usuarios/${uid}`);
    if (!perfil || !perfil.slug || perfil.lojaId === lojaId) {
      itens.push({
        caminho: `usuarios/${uid}`,
        dados: {
          nome, email, lojaId, slug: slugLoja,
          inicio: papel === 'entregador' ? 'motoboy' : 'painel',
          roles: papel === 'entregador' ? ['motoboy'] : ['balcao']
        }
      });
    }
    await fs.gravarJuntos(itens);
    return jsonResponse({ ok: true, uid, contaExistente }, 201);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('gerenciarEquipe', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível concluir agora. Tente novamente.' }, 500);
  }
}

// =====================================================================
// DADOS PÚBLICOS DA LOJA (nome, cor, fotos) para prévia do WhatsApp,
// manifest e ícone. Guardados 5 minutos para não gastar leituras.
// =====================================================================
const cacheLojas = new Map();

async function dadosPublicosLoja(env, slug, ctx) {
  if (!env.FIREBASE_SERVICE_ACCOUNT || !/^[a-z0-9-]{2,40}$/.test(slug) || SLUGS_RESERVADOS.has(slug)) return null;
  const agora = Date.now();
  const naMemoria = cacheLojas.get(slug);
  if (naMemoria && naMemoria.expira > agora) return naMemoria.dados;

  const chave = new Request(`https://cache-interno.delivery-pro/loja/${slug}`);
  try {
    const salvo = await caches.default.match(chave);
    if (salvo) {
      const dados = await salvo.json();
      cacheLojas.set(slug, { dados, expira: agora + 300000 });
      return dados;
    }
  } catch (_) {}

  let dados = null;
  try {
    const fs = await firestore(env);
    const s = await fs.ler(`slugs/${slug}`);
    if (s && s.ativo && s.lojaId) {
      const l = await fs.ler(`lojas/${s.lojaId}`);
      if (l) {
        const https = (u) => (typeof u === 'string' && /^https:\/\/\S+$/i.test(u) ? u : null);
        dados = {
          nome: String(l.nome || slug).slice(0, 60),
          descricao: l.descricao ? String(l.descricao).slice(0, 160) : null,
          cor: /^#[0-9a-f]{6}$/i.test(l.corPrimaria || '') ? l.corPrimaria : '#ea1d2c',
          logoUrl: https(l.logoUrl),
          bannerUrl: https(l.bannerUrl),
          tempoEstimado: l.tempoEstimado ? String(l.tempoEstimado).slice(0, 20) : null
        };
      }
    }
  } catch (err) {
    console.error('dadosPublicosLoja', err && err.message);
    return null;
  }
  cacheLojas.set(slug, { dados, expira: agora + 300000 });
  if (cacheLojas.size > 500) cacheLojas.clear();
  try {
    const gravar = caches.default.put(chave, new Response(JSON.stringify(dados), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(gravar); else await gravar;
  } catch (_) {}
  return dados;
}

function descricaoLoja(pub) {
  return pub.descricao || `Faça seu pedido na ${pub.nome}${pub.tempoEstimado ? ` · entrega em ${pub.tempoEstimado}` : ''}. Acompanhe a entrega ao vivo.`;
}

function escAttr(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function personalizarCasca(html, pub, slug, url) {
  const titulo = `${pub.nome} — Peça online`;
  const desc = descricaoLoja(pub);
  const img = pub.bannerUrl || pub.logoUrl;
  return html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/, `<title id="page-title">${escAttr(titulo)}</title>`)
    .replace(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${escAttr(pub.cor)}" id="meta-theme-color" />`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escAttr(titulo)}" />`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escAttr(desc)}" />\n  <meta name="description" content="${escAttr(desc)}" />`)
    .replace(/<link rel="manifest"[^>]*>/, `<link rel="manifest" href="/${slug}/manifest.webmanifest" id="pwa-manifest" />`)
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="/${slug}/icone.svg" type="image/svg+xml" id="pwa-icone" />${pub.logoUrl ? `\n  <link rel="apple-touch-icon" href="${escAttr(pub.logoUrl)}" />` : ''}`)
    .replace('</head>', `  <meta property="og:url" content="${escAttr(url.origin + '/' + slug)}" />
  <meta property="og:site_name" content="${escAttr(pub.nome)}" />
  <meta name="apple-mobile-web-app-title" content="${escAttr(pub.nome)}" />${img ? `
  <meta property="og:image" content="${escAttr(img)}" />
  <meta name="twitter:card" content="summary_large_image" />` : ''}
</head>`);
}

// Ícone quadrado com as iniciais da loja na cor dela
function iconeSvg(nome, cor) {
  const palavras = String(nome || '?').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(p => p && !/^(d[aeo]s?|e)$/i.test(p));
  const ini = escAttr(((palavras[0] || '?')[0] + (palavras[1] ? palavras[1][0] : '')).toUpperCase());
  const corOk = /^#[0-9a-f]{6}$/i.test(cor || '') ? cor : '#ea1d2c';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="104" fill="${corOk}"/>` +
    `<text x="256" y="256" dy=".35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${ini.length > 1 ? 210 : 280}" fill="#ffffff">${ini}</text></svg>`;
}

// =====================================================================
// ASSINATURA: MESMA conta de js/plano.js (se mudar lá, mude aqui)
// =====================================================================
const CARENCIA_MS = 48 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const emMs = (v) => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
function statusAssinatura(loja, agora = Date.now()) {
  const plano = loja && loja.plano;
  if (!plano) return { ativa: true, plano: 'livre' };
  if (plano === 'bloqueada') return { ativa: false, plano, motivo: 'bloqueada' };
  if (plano === 'teste') {
    const fim = emMs(loja.trialAte);
    if (!fim) return { ativa: true, plano, emTeste: true };
    return fim > agora
      ? { ativa: true, plano, emTeste: true, fim, diasRestantes: Math.ceil((fim - agora) / DIA_MS) }
      : { ativa: false, plano, motivo: 'teste_vencido', fim };
  }
  const fim = emMs(loja.pagoAte);
  if (!fim) return { ativa: true, plano };
  if (fim > agora) return { ativa: true, plano, fim, diasRestantes: Math.ceil((fim - agora) / DIA_MS) };
  if (fim + CARENCIA_MS > agora) return { ativa: true, plano, fim, emCarencia: true };
  return { ativa: false, plano, motivo: 'pagamento_vencido', fim };
}

// Configuração pública do SaaS (WhatsApp de vendas, preços), guardada 5 min
let configSaasCache = { dados: null, expira: 0 };
async function configSaasPublica(env) {
  if (configSaasCache.dados && configSaasCache.expira > Date.now()) return configSaasCache.dados;
  let dados = {};
  try {
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      const c = await (await firestore(env)).ler('config/saas');
      if (c) dados = {
        whatsappSuporte: c.whatsappSuporte || null,
        precoEssencialCentavos: Number(c.precoEssencialCentavos) || null,
        precoProCentavos: Number(c.precoProCentavos) || null,
        comissaoMarketplacePct: Number(c.comissaoMarketplacePct) || 20
      };
    }
  } catch (err) { console.error('configSaas', err && err.message); }
  configSaasCache = { dados, expira: Date.now() + 300000 };
  return dados;
}

// =====================================================================
// PAINEL MASTER: só para os logins listados em MASTER_UIDS (variável do Worker)
// =====================================================================
async function painelMaster(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível no momento.', 503);
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
    const masters = String(env.MASTER_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!masters.includes(usuario.sub)) throw new ErroPedido('Acesso restrito ao administrador.', 403);

    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const fs = await firestore(env);

    if (corpo.acao === 'listar') {
      const lojas = (await fs.listar('lojas')).map(l => ({
        id: l.id, nome: l.nome || l.id, slug: l.slug || null, plano: l.plano || null,
        trialAte: l.trialAte || null, pagoAte: l.pagoAte || null, criadoEm: l.criadoEm || null,
        whatsapp: l.whatsapp || null, origemParceiro: l.origemParceiro || null
      }));
      // Lojas antigas sem "slug" gravado: busca no índice de endereços
      if (lojas.some(l => !l.slug)) {
        const slugs = await fs.listar('slugs');
        lojas.forEach(l => { if (!l.slug) { const s = slugs.find(x => x.lojaId === l.id); if (s) l.slug = s.id; } });
      }
      lojas.sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
      return jsonResponse({ lojas });
    }

    if (corpo.acao === 'estatisticas') {
      const ids = (Array.isArray(corpo.lojaIds) ? corpo.lojaIds : []).filter(id => /^[A-Za-z0-9_-]{2,60}$/.test(id)).slice(0, 10);
      const desde = new Date(Date.now() - 7 * DIA_MS).toISOString();
      const estatisticas = {};
      await Promise.all(ids.map(async (id) => {
        try {
          const [r, ultimo] = await Promise.all([fs.resumoPedidos(id, desde), fs.ultimoPedido(id)]);
          estatisticas[id] = { pedidos7d: r.pedidos, total7dCentavos: r.totalCentavos, ultimoPedido: ultimo };
        } catch (err) { console.error('estatisticas', id, err && err.message); }
      }));
      return jsonResponse({ estatisticas });
    }

    if (corpo.acao === 'plano') {
      const lojaId = String(corpo.lojaId || '');
      if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
      const plano = ['teste', 'essencial', 'pro', 'bloqueada'].includes(corpo.plano) ? corpo.plano : null;
      if (!plano) throw new ErroPedido('Plano inválido.');
      const dias = Math.min(366, Math.max(0, Number(corpo.dias) || 0));
      const loja = await fs.ler(`lojas/${lojaId}`);
      if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
      const agora = Date.now();
      const dados = { plano };
      if (plano === 'teste') {
        // soma a partir do fim atual do teste (se ainda vale) ou de agora
        const base = Math.max(agora, emMs(loja.trialAte) || 0);
        dados.trialAte = new Date(base + (dias || 7) * DIA_MS);
      } else if (plano === 'essencial' || plano === 'pro') {
        const base = Math.max(agora, (loja.plano === plano && emMs(loja.pagoAte)) || 0);
        dados.pagoAte = new Date(base + (dias || 30) * DIA_MS);
      }
      await fs.atualizar(`lojas/${lojaId}`, dados);
      cacheLojas.clear();
      return jsonResponse({ ok: true, loja: { plano, trialAte: dados.trialAte ? dados.trialAte.toISOString() : loja.trialAte || null, pagoAte: dados.pagoAte ? dados.pagoAte.toISOString() : loja.pagoAte || null } });
    }

    if (corpo.acao === 'lerConfig') {
      return jsonResponse({ config: (await fs.ler('config/saas')) || {} });
    }

    if (corpo.acao === 'salvarConfig') {
      const c = corpo.config || {};
      const inteiro = (v) => (Number.isInteger(v) && v >= 0 && v < 100000000 ? v : 0);
      await fs.gravarJuntos([{ caminho: 'config/saas', dados: {
        whatsappSuporte: String(c.whatsappSuporte || '').replace(/\D/g, '').slice(0, 13) || null,
        precoEssencialCentavos: inteiro(c.precoEssencialCentavos),
        precoProCentavos: inteiro(c.precoProCentavos),
        comissaoMarketplacePct: Math.min(50, Math.max(0, Number(c.comissaoMarketplacePct) || 0))
      } }]);
      configSaasCache = { dados: null, expira: 0 };
      return jsonResponse({ ok: true });
    }

    throw new ErroPedido('Ação inválida.');
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('painelMaster', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível concluir agora.' }, 500);
  }
}
