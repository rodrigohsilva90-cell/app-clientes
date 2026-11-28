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

    // Fotos enviadas pelas lojas (guardadas no KV "FOTOS"; o endereço nunca muda, então o cache é longo)
    if (pathParts[0] === 'fotos' && pathParts.length === 3 && request.method === 'GET') {
      return servirFoto(env, `${pathParts[1]}/${pathParts[2]}`);
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
        start_url: /^[A-Za-z0-9_]{8,100}$/.test(url.searchParams.get('pedido') || '') ? `/${slug}/pedido/${url.searchParams.get('pedido')}` : `/${slug}?origem=app`,
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
      if (url.pathname === '/api/publico' && request.method === 'GET') {
        return jsonResponse({ turnstile: env.TURNSTILE_SITEKEY || null, push: chavePublicaPush(env) });
      }
      if (url.pathname === '/api/mp/webhook' && request.method === 'POST') {
        return webhookMercadoPago(request, env, url);
      }
      if (url.pathname === '/api/termos' && request.method === 'POST') {
        return aceitarTermos(request, env);
      }
      if (url.pathname === '/api/mp/webhook-saas' && request.method === 'POST') {
        return webhookSaas(request, env, url);
      }
      if (url.pathname === '/api/assinatura' && request.method === 'POST') {
        return pagarAssinatura(request, env);
      }
      if (url.pathname === '/api/mp/verificar' && request.method === 'POST') {
        return verificarPix(request, env);
      }
      if (url.pathname === '/api/mp/config' && request.method === 'POST') {
        return configMercadoPago(request, env);
      }
      if (url.pathname === '/api/carrinho' && request.method === 'POST') {
        return registrarCarrinho(request, env);
      }
      if (url.pathname === '/api/fidelidade' && request.method === 'GET') {
        return consultarFidelidade(request, env, url);
      }
      if (url.pathname === '/api/fidelidade/carimbar' && request.method === 'POST') {
        return carimbarPedido(request, env);
      }
      if (url.pathname === '/api/motoboy/turno' && request.method === 'POST') {
        return turnoMotoboy(request, env);
      }
      if (url.pathname === '/api/motoboy/reserva' && request.method === 'POST') {
        return reservaMotoboy(request, env);
      }
      if (url.pathname === '/api/acertos' && request.method === 'POST') {
        return acertosMotoboy(request, env);
      }
      if (url.pathname === '/api/estoque' && request.method === 'POST') {
        return ajustarEstoque(request, env);
      }
      if (url.pathname === '/api/pin' && request.method === 'POST') {
        return pinDono(request, env);
      }
      if (url.pathname === '/api/cheguei' && request.method === 'POST') {
        return clienteChegou(request, env);
      }
      if (url.pathname === '/api/entrega/tentativa' && request.method === 'POST') {
        return tentativaEntrega(request, env);
      }
      if (url.pathname === '/api/clientes' && request.method === 'POST') {
        return painelClientes(request, env);
      }
      if (url.pathname === '/api/carrinhos' && request.method === 'POST') {
        return painelCarrinhos(request, env);
      }
      if (url.pathname === '/api/push' && request.method === 'POST') {
        return inscreverPush(request, env);
      }
      if (url.pathname === '/api/notificar' && request.method === 'POST') {
        return notificarCliente(request, env);
      }
      if (url.pathname === '/api/foto' && request.method === 'POST') {
        return receberFoto(request, env, url);
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
function dentroDoLimite(ip, maximo = 8) {
  const agora = Date.now();
  const janela = 10 * 60 * 1000;
  const lista = (tentativasPorIp.get(ip) || []).filter(t => agora - t < janela);
  if (lista.length >= maximo) return false;
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
    // Pino conferido pelo cliente; "manual" = ele arrastou o mapa (o motoboy é avisado para ligar se precisar)
    const pinoManual = Boolean(destino && corpo.destinoCoords.pinoManual === true);
    const pinoConfirmado = Boolean(destino && corpo.destinoCoords.confirmado === true);
    const partes = corpo.enderecoPartes && typeof corpo.enderecoPartes === 'object' ? corpo.enderecoPartes : {};
    const enderecoPartes = tipoEntrega === 'entrega'
      ? Object.fromEntries(['rua', 'numero', 'bairro', 'compl', 'cep', 'apelido'].map(k => [k, String(partes[k] || '').trim().slice(0, 120)]))
      : null;
    // Tipo do local (muda a tolerância do GPS na baixa) e quem vai receber (pedido para outra pessoa)
    const tipoLocal = ['casa', 'condominio', 'rural'].includes(corpo.tipoLocal) ? corpo.tipoLocal : 'casa';
    const recebedorNome = tipoEntrega === 'entrega' ? String(corpo.recebedorNome || '').trim().slice(0, 60) : '';
    const recebedorWhats = tipoEntrega === 'entrega' ? String(corpo.recebedorWhats || '').replace(/\D/g, '').slice(0, 13) : '';
    const optInMarketing = corpo.optInMarketing === true;
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
    if (tipoEntrega === 'entrega' && modoOperacaoAtual(loja) === 'retirada') {
      throw new ErroPedido('Neste momento a loja está só com retirada no balcão. Escolha "Retirar na loja".', 409);
    }
    const produtos = (cardapio?.produtos || []).filter(p => !p.excluido);
    const caminho = `lojas/${lojaId}/pedidos/${token}`;

    // Mesmo pedido enviado de novo (internet oscilando): devolve o que já foi gravado
    const jaExiste = await fs.ler(caminho);
    if (jaExiste) return jsonResponse({ id: token, numeroPedido: jaExiste.numeroPedido, totalCentavos: jaExiste.totalCentavos, duplicado: true, aguardandoPix: jaExiste.status === 'aguardando_pagamento' }, 200);

    // Anti-trote: verificação invisível do Cloudflare Turnstile
    if (env.TURNSTILE_SECRET && !(await turnstileValido(env, corpo.turnstileToken, ip))) {
      throw new ErroPedido('Não conseguimos confirmar a verificação de segurança. Toque em enviar de novo.', 403);
    }

    // Trava: um pedido de entrega em andamento por WhatsApp
    if (tipoEntrega === 'entrega') {
      const doCliente = await fs.consultarIgual(`lojas/${lojaId}`, 'pedidos', 'clienteWhatsapp', whatsapp, 20);
      const limite = Date.now() - 4 * 60 * 60 * 1000;
      const aberto = doCliente.find(p => p.id !== token && p.tipoEntrega === 'entrega' && ['novo', 'preparo', 'entrega'].includes(p.status) && (Date.parse(p.criadoEm) || 0) > limite);
      if (aberto) throw new ErroPedido(`Você já tem um pedido em andamento (#${aberto.numeroPedido || ''}). Aguarde ele chegar antes de fazer outro, ou fale com a loja.`, 409);
    }

    // ---- Recalcula cada item com o cardápio oficial ----
    const hojeLoja = diaDaLoja(loja);
    const pedidoPorProduto = {};
    itensPedidos.forEach(i => { pedidoPorProduto[i.produtoId] = (pedidoPorProduto[i.produtoId] || 0) + (Number(i.quantidade) || 0); });
    // Estoque por tamanho/cor (varejo): soma o pedido de cada variação
    const pedidoPorVariacao = {};
    itensPedidos.forEach(i => {
      const pr = produtos.find(p => p.id === i.produtoId);
      if (!pr || !usaGrade(pr)) return;
      const k = chaveGrade(pr, i.selecoes);
      if (k) pedidoPorVariacao[`${pr.id}#${k}`] = (pedidoPorVariacao[`${pr.id}#${k}`] || 0) + (Number(i.quantidade) || 0);
    });
    const itens = itensPedidos.map(pedido => {
      const prod = produtos.find(p => p.id === pedido.produtoId);
      if (!prod) throw new ErroPedido('Um item da sua sacola não está mais à venda. Remova-o e adicione de novo.');
      let variacao = null;
      if (usaGrade(prod)) {
        variacao = chaveGrade(prod, pedido.selecoes);
        if (!variacao) throw new ErroPedido(`Escolha o tamanho e a cor de "${prod.nome}".`);
        const tem = Number(prod.estoqueGrade[variacao]) || 0;
        const nomeVar = variacao.split('|').filter(x => x !== '-').join(' / ');
        if (tem <= 0) throw new ErroPedido(`"${prod.nome}" (${nomeVar}) está esgotado. Escolha outro tamanho ou cor.`);
        if (pedidoPorVariacao[`${prod.id}#${variacao}`] > tem) throw new ErroPedido(`Só temos ${tem} unidade(s) de "${prod.nome}" (${nomeVar}). Diminua a quantidade.`);
      } else if (prod.controlarEstoque) {
        const tem = estoqueAtual(prod, hojeLoja);
        if (tem <= 0) throw new ErroPedido(`"${prod.nome}" está esgotado.`);
        if (pedidoPorProduto[prod.id] > tem) throw new ErroPedido(`Só temos ${tem} unidade(s) de "${prod.nome}". Diminua a quantidade.`);
      }
      const quantidade = Number(pedido.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new ErroPedido(`Quantidade inválida em "${prod.nome}".`);
      const { unitarioCentavos, detalhes } = calcularItemOficial(prod, pedido.selecoes || {}, loja);
      return { produtoId: prod.id, nome: nomeNoPedido(prod), quantidade, unitarioCentavos, detalhes, ...(variacao ? { variacao } : {}) };
    });

    const subtotalCentavos = itens.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);
    if (subtotalCentavos <= 0) throw new ErroPedido('Total do pedido inválido.');
    const minimo = Number(loja.pedidoMinimoCentavos) || 0;
    if (subtotalCentavos < minimo) throw new ErroPedido(`O pedido mínimo desta loja é ${reais(minimo)}.`);

    // ---- Frete recalculado no servidor ----
    let freteCentavos = 0;
    let distanciaKm = null;
    if (tipoEntrega === 'entrega') {
      const frete = calcularFrete(loja, destino, new Date(), subtotalCentavos);
      if (frete.configurado) {
        if (frete.precisaLocal) throw new ErroPedido('Marque sua localização no mapa para calcularmos a entrega.');
        if (frete.fora) throw new ErroPedido(`Seu endereço (${frete.distanciaKm} km) fica fora da área de entrega. Escolha retirar na loja.`);
        if (frete.bloqueado) throw new ErroPedido(`Não entregamos em ${frete.area.nome} ${frete.area.sempre ? 'no momento' : `das ${frete.area.inicio} às ${frete.area.fim}`}. Escolha retirar na loja.`, 409);
        freteCentavos = frete.freteCentavos;
        distanciaKm = frete.distanciaKm;
      }
    }
    let totalCentavos = subtotalCentavos + freteCentavos;
    // Pix automático (Mercado Pago da própria loja): o pedido só vai para a cozinha depois de pago
    const pixOnline = formaPagamento === 'pix' && loja.pixOnline === true && Boolean(env.MP_CHAVE);
    // Anti-flood: no máximo 2 Pix esperando pagamento ao mesmo tempo por WhatsApp
    if (pixOnline) {
      const recentes = await fs.consultarIgual(`lojas/${lojaId}`, 'pedidos', 'clienteWhatsapp', whatsapp, 20);
      const desde = Date.now() - 35 * 60 * 1000;
      const esperando = recentes.filter(p => p.id !== token && p.status === 'aguardando_pagamento' && (Date.parse(p.criadoEm) || 0) > desde);
      if (esperando.length >= 2) throw new ErroPedido('Você já tem 2 Pix esperando pagamento. Pague um deles ou espere 30 minutos para fazer outro pedido.', 429);
    }
    if (formaPagamento === 'dinheiro' && trocoParaCentavos && trocoParaCentavos < totalCentavos) {
      throw new ErroPedido(`O troco precisa ser para um valor maior que o total (${reais(totalCentavos)}).`);
    }

    const caminhoCliente = `lojas/${lojaId}/clientes/${whatsapp}`;
    const fichaCliente = await fs.ler(caminhoCliente);
    // Cliente com 2 ausências seguidas (confirmadas pelo balcão): só com Pix antecipado, se a loja tiver Pix automático
    const restrito = Boolean(fichaCliente && Number(fichaCliente.ausenciasSeguidas) >= 2);
    if (restrito && tipoEntrega === 'entrega' && loja.pixOnline === true && env.MP_CHAVE && !pixOnline) {
      throw new ErroPedido('Para este WhatsApp, a loja pede o pagamento pelo Pix antes da entrega. Escolha "Pix" e pague pelo QR Code.', 409);
    }
    const clienteVip = Boolean(fichaCliente && Number(fichaCliente.totalPedidos) >= 5);
    // Anti-trote: primeira compra alta (WhatsApp sem pedido concluído na loja) só com Pix antecipado
    const at = loja.antiTrote;
    if (at && at.ativo && tipoEntrega === 'entrega' && loja.pixOnline === true && env.MP_CHAVE && !pixOnline
      && !(fichaCliente && Number(fichaCliente.totalPedidos) > 0) && subtotalCentavos >= (Number(at.limiteCentavos) || 8000)) {
      throw new ErroPedido(`Na primeira compra acima de ${reais(Number(at.limiteCentavos) || 8000)}, a loja pede o pagamento pelo Pix antes da entrega. Escolha "Pix" e pague pelo QR Code.`, 409);
    }

    // Prêmio do cartão fidelidade (desconto). Reserva o prêmio de forma atômica antes de gravar.
    const fid = loja.fidelidade && loja.fidelidade.ativo ? loja.fidelidade : null;
    let descontoFidelidadeCentavos = 0;
    if (fid && corpo.usarPremio === true && Number(fid.premioCentavos) > 0) {
      const meta = Math.max(1, Number(fid.meta) || 10);
      const r = await fs.incrementar(caminhoCliente, { premiosUsados: 1, carimbos: 0 });
      if (r.premiosUsados <= Math.floor((r.carimbos || 0) / meta)) {
        descontoFidelidadeCentavos = Math.min(Number(fid.premioCentavos), subtotalCentavos);
        totalCentavos -= descontoFidelidadeCentavos;
      } else {
        await fs.incrementar(caminhoCliente, { premiosUsados: -1 });
      }
    }
    const devolverPremio = async () => { if (descontoFidelidadeCentavos) { try { await fs.incrementar(caminhoCliente, { premiosUsados: -1 }); } catch (_) {} } };

    const pedido = {
      checkoutToken: token,
      numeroPedido: 100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900),
      clienteNome: nome,
      clienteWhatsapp: whatsapp,
      enderecoTexto: endereco,
      tipoEntrega,
      destinoCoords: tipoEntrega === 'entrega' ? destino : null,
      pinoManual: tipoEntrega === 'entrega' ? pinoManual : false,
      pinoConfirmado: tipoEntrega === 'entrega' ? pinoConfirmado : false,
      enderecoPartes,
      tipoLocal: tipoEntrega === 'entrega' ? tipoLocal : null,
      recebedorNome: recebedorNome || null,
      recebedorWhats: recebedorWhats.length >= 10 ? recebedorWhats : null,
      clienteVip,
      clientePedidosAntes: Number(fichaCliente && fichaCliente.totalPedidos) || 0,
      clienteRestrito: restrito,
      descontoFidelidadeCentavos,
      adicionalChuva: Boolean(loja.repasse && loja.repasse.chuvaAtiva),
      itens,
      subtotalCentavos,
      freteCentavos,
      distanciaKm,
      totalCentavos,
      formaPagamento,
      trocoParaCentavos: formaPagamento === 'dinheiro' ? trocoParaCentavos : 0,
      status: pixOnline ? 'aguardando_pagamento' : 'novo',
      origem,
      canal: 'vitrine',
      turnoId: estado && estado.caixaAberto && estado.turnoId ? String(estado.turnoId) : null
    };

    // O ID do pedido é o próprio token: clicar duas vezes não cria dois pedidos
    const criado = await fs.criarSeNaoExiste(caminho, pedido, ['criadoEm']);
    if (!criado) await devolverPremio();
    if (criado && pixOnline) {
      try {
        const pix = await criarCobrancaPix(env, fs, lojaId, token, pedido, loja, new URL(request.url).origin);
        await fs.atualizar(caminho, { pix });
      } catch (err) {
        console.error('pix', err && err.message);
        try { await fs.apagar([caminho]); } catch (_) {}
        await devolverPremio();
        throw new ErroPedido('O Pix automático está indisponível agora. Escolha outra forma de pagamento ou tente de novo em instantes.', 502);
      }
    }
    if (criado) { try { await fs.apagar([`lojas/${lojaId}/carrinhos/${whatsapp}`]); } catch (_) {} }
    // Estoque vivo: dá baixa do que foi vendido (com trava de versão para dois pedidos ao mesmo tempo)
    if (criado) { try { await baixarEstoque(fs, lojaId, loja, itens.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, variacao: i.variacao || null }))); } catch (err) { console.error('estoque', err && err.message); } }
    // Ficha do cliente (CRM da loja): só dados do último pedido + contadores, sem histórico duplicado
    if (criado) {
      try {
        await fs.incrementar(caminhoCliente, { pedidosFeitos: 1 }, {
          nome, whatsapp, ultimoPedidoEm: new Date(), optInMarketing,
          ...(tipoEntrega === 'entrega' ? { ultimoEnderecoTexto: endereco } : {})
        });
      } catch (err) { console.error('crm', err && err.message); }
    }
    const final = criado ? pedido : await fs.ler(caminho);
    return jsonResponse({ id: token, numeroPedido: final?.numeroPedido, totalCentavos: final?.totalCentavos, duplicado: !criado, aguardandoPix: pixOnline }, criado ? 201 : 200);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('criarPedidoSeguro', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível registrar o pedido agora. Tente novamente.' }, 500);
  }
}

// =====================================================================
// FOTOS: o painel comprime no celular (WebP ou JPEG, até 1200 px) e manda
// aqui. Só o dono da loja envia. Guardadas no KV (binding FOTOS).
// =====================================================================
const FOTO_MAX_BYTES = 450 * 1024;
const envios = new Map();
function dentroDoLimiteFotos(chave) {
  const agora = Date.now();
  const lista = (envios.get(chave) || []).filter(t => agora - t < 10 * 60 * 1000);
  if (lista.length >= 80) return false;
  lista.push(agora);
  envios.set(chave, lista);
  if (envios.size > 2000) envios.clear();
  return true;
}
function tipoDaImagem(b) {
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return ['webp', 'image/webp'];
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['jpg', 'image/jpeg'];
  return null;
}
async function receberFoto(request, env, url) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.FOTOS) throw new ErroPedido('Envio de fotos indisponível no momento.', 503);
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo e tente outra vez.', 401); }
    if (!dentroDoLimiteFotos(usuario.sub)) throw new ErroPedido('Muitas fotos em pouco tempo. Aguarde alguns minutos.', 429);
    const lojaId = String(url.searchParams.get('loja') || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
    const fs = await firestore(env);
    const eu = await fs.ler(`lojas/${lojaId}/equipe/${usuario.sub}`);
    if (!eu || eu.papel !== 'dono') throw new ErroPedido('Só o dono da loja pode enviar fotos.', 403);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw new ErroPedido('Foto vazia.');
    if (bytes.length > FOTO_MAX_BYTES) throw new ErroPedido('Foto grande demais. Tente outra.', 413);
    const tipo = tipoDaImagem(bytes);
    if (!tipo) throw new ErroPedido('Formato de foto não aceito. Use JPG, PNG ou WebP.');
    const nome = `${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(6))).map(x => x.toString(16).padStart(2, '0')).join('')}.${tipo[0]}`;
    await env.FOTOS.put(`${lojaId}/${nome}`, bytes, { metadata: { tipo: tipo[1], uid: usuario.sub } });
    return jsonResponse({ url: `${url.origin}/fotos/${lojaId}/${nome}` }, 201);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('receberFoto', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível enviar a foto agora.' }, 500);
  }
}
async function servirFoto(env, chave) {
  if (!env.FOTOS || !/^[A-Za-z0-9_-]{2,60}\/[a-z0-9]{8,40}\.(webp|jpg)$/.test(chave)) return new Response('Foto não encontrada', { status: 404 });
  const { value, metadata } = await env.FOTOS.getWithMetadata(chave, { type: 'arrayBuffer', cacheTtl: 86400 });
  if (!value) return new Response('Foto não encontrada', { status: 404 });
  return new Response(value, {
    headers: {
      'Content-Type': (metadata && metadata.tipo) || (chave.endsWith('.jpg') ? 'image/jpeg' : 'image/webp'),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

// =====================================================================
// PIX AUTOMÁTICO — MERCADO PAGO (cada loja usa a SUA conta: o dinheiro cai
// direto para o lojista). O Access Token fica criptografado (AES-GCM, chave
// no secret MP_CHAVE) em lojas/{id}/segredos/mercadopago, que o navegador
// nunca lê. O pedido nasce "aguardando_pagamento" e só vira "novo" (toca
// no balcão) quando o Mercado Pago confirma o pagamento.
// =====================================================================
const MP_API = 'https://api.mercadopago.com';
const PIX_VALIDADE_MS = 30 * 60 * 1000;
async function chaveCripto(env) {
  return crypto.subtle.importKey('raw', b64uDec(env.MP_CHAVE), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function cifrarTexto(env, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveCripto(env), new TextEncoder().encode(texto));
  return { iv: b64uEnc(iv), dado: b64uEnc(c) };
}
async function decifrarTexto(env, obj) {
  const t = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(obj.iv) }, await chaveCripto(env), b64uDec(obj.dado));
  return new TextDecoder().decode(t);
}
async function tokenDaLoja(env, fs, lojaId) {
  const seg = await fs.ler(`lojas/${lojaId}/segredos/mercadopago`);
  if (!seg || !seg.token) throw new Error('loja sem Mercado Pago');
  return decifrarTexto(env, seg.token);
}
async function chamarMP(token, caminho, opcoes = {}) {
  const r = await fetch(MP_API + caminho, { ...opcoes, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`MP ${caminho} ${r.status}: ${(d && (d.message || d.error)) || ''}`);
  return d;
}

async function criarCobrancaPix(env, fs, lojaId, pedidoId, pedido, loja, origem) {
  const token = await tokenDaLoja(env, fs, lojaId);
  const expira = new Date(Date.now() + PIX_VALIDADE_MS);
  const wa = String(pedido.clienteWhatsapp || '').replace(/\D/g, '');
  const pag = await chamarMP(token, '/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': pedidoId },
    body: JSON.stringify({
      transaction_amount: Math.round(pedido.totalCentavos) / 100,
      description: `Pedido #${pedido.numeroPedido} - ${String((loja && loja.nome) || 'Delivery').slice(0, 60)}`,
      payment_method_id: 'pix',
      payer: { email: `cliente${wa || 'pedido'}@pagamento.delivery-pro.app`, first_name: String(pedido.clienteNome || 'Cliente').split(/\s+/)[0].slice(0, 40) },
      external_reference: `${lojaId}:${pedidoId}`,
      notification_url: `${origem}/api/mp/webhook?loja=${encodeURIComponent(lojaId)}`,
      date_of_expiration: expira.toISOString().replace('Z', '-00:00')
    })
  });
  const dados = pag.point_of_interaction && pag.point_of_interaction.transaction_data;
  if (!dados || !dados.qr_code) throw new Error('MP sem QR Code');
  return { mpId: String(pag.id), qrCode: dados.qr_code, qrBase64: dados.qr_code_base64 || null, expiraEm: expira, status: pag.status || 'pending' };
}

// Confere o pagamento DIRETO no Mercado Pago (não confia no que chega de fora) e atualiza o pedido
async function sincronizarPagamento(env, fs, lojaId, mpId) {
  const token = await tokenDaLoja(env, fs, lojaId);
  const pag = await chamarMP(token, `/v1/payments/${encodeURIComponent(mpId)}`);
  const [refLoja, pedidoId] = String(pag.external_reference || '').split(':');
  if (refLoja !== lojaId || !/^[A-Za-z0-9_]{8,100}$/.test(pedidoId || '')) return { ignorado: true };
  const caminho = `lojas/${lojaId}/pedidos/${pedidoId}`;
  const pedido = await fs.ler(caminho);
  if (!pedido || pedido.status !== 'aguardando_pagamento') return { pedidoId, status: pedido && pedido.status };
  const valorOk = Math.round(Number(pag.transaction_amount) * 100) === Math.round(Number(pedido.totalCentavos));
  if (pag.status === 'approved' && valorOk) {
    await fs.atualizar(caminho, { status: 'novo', pagoEm: new Date(), pagamentoStatus: 'aprovado', pagamentoMpId: String(mpId) });
    return { pedidoId, status: 'novo', pago: true };
  }
  if (['cancelled', 'rejected', 'expired'].includes(pag.status)) {
    await fs.atualizar(caminho, { status: 'cancelado', motivoCancelamento: 'Pix não foi pago a tempo', canceladoEm: new Date() });
    return { pedidoId, status: 'cancelado' };
  }
  return { pedidoId, status: 'aguardando_pagamento', mp: pag.status };
}

async function webhookMercadoPago(request, env, url) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MP_CHAVE) return new Response('ok');
    const lojaId = String(url.searchParams.get('loja') || '');
    let corpo = {};
    try { corpo = await request.json(); } catch (_) {}
    const tipo = corpo.type || corpo.topic || url.searchParams.get('type') || url.searchParams.get('topic');
    const mpId = String((corpo.data && corpo.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
    if (tipo !== 'payment' || !/^\d{3,30}$/.test(mpId) || !/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) return new Response('ok');
    const fs = await firestore(env);
    await sincronizarPagamento(env, fs, lojaId, mpId);
    return new Response('ok');
  } catch (err) {
    console.error('webhookMP', err && err.stack || err);
    return new Response('erro', { status: 500 }); // o Mercado Pago tenta de novo depois
  }
}

// Botão "Já paguei" na tela do cliente (caso o aviso do Mercado Pago demore)
async function verificarPix(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MP_CHAVE) throw new ErroPedido('Indisponível.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    // A tela do Pix confere sozinha a cada 10 s (caso o aviso do Mercado Pago atrase): limite maior aqui
    if (!dentroDoLimite(`pix:${ip}`, 90)) throw new ErroPedido('Aguarde um pouco e tente de novo.', 429);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_]{8,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const fs = await firestore(env);
    const lojaId = await lojaPeloSlug(fs, corpo.slug);
    const pedido = await fs.ler(`lojas/${lojaId}/pedidos/${pedidoId}`);
    if (!pedido) throw new ErroPedido('Pedido não encontrado.', 404);
    if (pedido.status !== 'aguardando_pagamento' || !pedido.pix || !pedido.pix.mpId) return jsonResponse({ status: pedido.status });
    return jsonResponse(await sincronizarPagamento(env, fs, lojaId, pedido.pix.mpId));
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('verificarPix', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível conferir agora.' }, 500);
  }
}

// =====================================================================
// TERMOS DE USO / PRIVACIDADE: mesma versão de js/termos.js. O aceite do
// dono fica registrado na loja (versão, data e quem aceitou).
// =====================================================================
const VERSAO_TERMOS = '2026-11-25';
async function aceitarTermos(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    if (corpo.versao !== VERSAO_TERMOS) throw new ErroPedido('Atualize a página e tente de novo.', 409);
    const lojaId = String(corpo.lojaId || '');
    const { fs, uid } = await usuarioDaEquipe(request, env, lojaId, ['dono']);
    await fs.atualizar(`lojas/${lojaId}`, { termosVersao: VERSAO_TERMOS, termosAceitoEm: new Date(), termosAceitoPor: uid });
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('aceitarTermos', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível registrar agora.' }, 500);
  }
}

// Confere o Access Token direto no Mercado Pago antes de guardar
async function validarTokenMP(bruto) {
  const token = String(bruto || '').trim();
  if (!/^APP_USR-[A-Za-z0-9-]{20,200}$/.test(token)) {
    throw new ErroPedido(/^TEST-/.test(token) ? 'Esse é o token de TESTE. Use o "Access Token" de PRODUÇÃO (começa com APP_USR-).' : 'Token inválido. Copie o "Access Token" de produção (começa com APP_USR-).');
  }
  let eu;
  try { eu = await chamarMP(token, '/users/me'); }
  catch (_) { throw new ErroPedido('O Mercado Pago não aceitou esse token. Confira se copiou o Access Token de produção inteiro.'); }
  return { token, conta: String(eu.nickname || eu.email || eu.id || 'conta Mercado Pago').slice(0, 80), mpUserId: String(eu.id || '') };
}

// =====================================================================
// MENSALIDADES DAS LOJAS (Pix no Mercado Pago do dono do SaaS).
// O dono da loja paga pelo painel; quando o Mercado Pago confirma, a
// assinatura ganha +30 dias (somando ao que ainda falta, se renovar antes).
// cobrancasSaas/{mpId} = cobrança criada; assinaturasPagas/{mpId} = já
// aplicada (garante que um pagamento nunca vale duas vezes).
// =====================================================================
const DIAS_POR_PAGAMENTO = 30;
async function tokenDoSaas(env, fs) {
  const seg = await fs.ler('config/mercadopago');
  if (!seg || !seg.token) throw new ErroPedido('Pagamento online ainda não disponível. Fale com o suporte pelo WhatsApp.', 503);
  return decifrarTexto(env, seg.token);
}

async function pagarAssinatura(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MP_CHAVE) throw new ErroPedido('Indisponível no momento.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs } = await usuarioDaEquipe(request, env, lojaId, ['dono']);
    const tokenSaas = await tokenDoSaas(env, fs);

    if (corpo.acao === 'verificar') {
      const mpId = String(corpo.mpId || '');
      if (!/^\d{3,30}$/.test(mpId)) throw new ErroPedido('Cobrança inválida.');
      const cob = await fs.ler(`cobrancasSaas/${mpId}`);
      if (!cob || cob.lojaId !== lojaId) throw new ErroPedido('Cobrança não encontrada.', 404);
      return jsonResponse(await aplicarPagamentoSaas(env, fs, mpId, tokenSaas));
    }

    const plano = ['essencial', 'pro'].includes(corpo.plano) ? corpo.plano : null;
    if (!plano) throw new ErroPedido('Escolha o plano.');
    const [cfg, loja] = await Promise.all([fs.ler('config/saas'), fs.ler(`lojas/${lojaId}`)]);
    const valorCentavos = Number(plano === 'pro' ? cfg && cfg.precoProCentavos : cfg && cfg.precoEssencialCentavos) || 0;
    if (valorCentavos < 100) throw new ErroPedido('O preço deste plano ainda não foi definido. Fale com o suporte.');
    if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
    const usuarioEmail = await emailDoUsuario(request, env);
    const ref = `assinatura:${lojaId}:${plano}:${crypto.randomUUID()}`;
    const origem = new URL(request.url).origin;
    const pag = await chamarMP(tokenSaas, '/v1/payments', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': ref },
      body: JSON.stringify({
        transaction_amount: valorCentavos / 100,
        description: `Delivery Pro - plano ${plano === 'pro' ? 'Pro' : 'Essencial'} (30 dias) - ${String(loja.nome || lojaId).slice(0, 50)}`,
        payment_method_id: 'pix',
        payer: { email: usuarioEmail || `loja-${lojaId.toLowerCase()}@pagamento.delivery-pro.app` },
        external_reference: ref,
        notification_url: `${origem}/api/mp/webhook-saas`,
        date_of_expiration: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('Z', '-00:00')
      })
    });
    const dados = pag.point_of_interaction && pag.point_of_interaction.transaction_data;
    if (!dados || !dados.qr_code) throw new Error('MP sem QR Code');
    const mpId = String(pag.id);
    await fs.gravarJuntos([{ caminho: `cobrancasSaas/${mpId}`, dados: { lojaId, lojaNome: loja.nome || null, plano, valorCentavos, ref, status: 'pendente', criadoEm: new Date() } }]);
    return jsonResponse({ mpId, qrCode: dados.qr_code, qrBase64: dados.qr_code_base64 || null, valorCentavos, plano });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('pagarAssinatura', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível gerar o Pix agora. Tente de novo em instantes.' }, 500);
  }
}

async function emailDoUsuario(request, env) {
  try {
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const t = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const u = await verificarTokenFirebase(t, conta.project_id);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email || '') ? u.email : null;
  } catch (_) { return null; }
}

// Confere no Mercado Pago e, se pago (valor certo), estende a assinatura UMA vez
async function aplicarPagamentoSaas(env, fs, mpId, tokenSaas) {
  const pag = await chamarMP(tokenSaas || await tokenDoSaas(env, fs), `/v1/payments/${encodeURIComponent(mpId)}`);
  const cob = await fs.ler(`cobrancasSaas/${mpId}`);
  if (!cob || pag.external_reference !== cob.ref) return { ignorado: true };
  if (cob.status === 'aprovado') return { pago: true, jaAplicado: true };
  const valorOk = Math.round(Number(pag.transaction_amount) * 100) === Math.round(Number(cob.valorCentavos));
  if (pag.status === 'approved' && valorOk) {
    const primeira = await fs.criarSeNaoExiste(`assinaturasPagas/${mpId}`, { lojaId: cob.lojaId, plano: cob.plano, valorCentavos: cob.valorCentavos }, ['aplicadoEm']);
    if (primeira) {
      const loja = await fs.ler(`lojas/${cob.lojaId}`);
      const agora = Date.now();
      const base = Math.max(agora, (loja && loja.plano === cob.plano && emMs(loja.pagoAte)) || 0);
      await fs.atualizar(`lojas/${cob.lojaId}`, { plano: cob.plano, pagoAte: new Date(base + DIAS_POR_PAGAMENTO * DIA_MS) });
      cacheLojas.clear();
    }
    await fs.atualizar(`cobrancasSaas/${mpId}`, { status: 'aprovado', pagoEm: new Date() });
    return { pago: true };
  }
  if (['cancelled', 'rejected', 'expired'].includes(pag.status)) {
    await fs.atualizar(`cobrancasSaas/${mpId}`, { status: 'expirado' });
    return { pago: false, status: 'expirado' };
  }
  return { pago: false, status: 'pendente' };
}

async function webhookSaas(request, env, url) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MP_CHAVE) return new Response('ok');
    let corpo = {};
    try { corpo = await request.json(); } catch (_) {}
    const tipo = corpo.type || corpo.topic || url.searchParams.get('type') || url.searchParams.get('topic');
    const mpId = String((corpo.data && corpo.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id') || '');
    if (tipo !== 'payment' || !/^\d{3,30}$/.test(mpId)) return new Response('ok');
    const fs = await firestore(env);
    await aplicarPagamentoSaas(env, fs, mpId);
    return new Response('ok');
  } catch (err) {
    if (err instanceof ErroPedido) return new Response('ok');
    console.error('webhookSaas', err && err.stack || err);
    return new Response('erro', { status: 500 });
  }
}

// Painel do dono: conectar / ver / desligar o Mercado Pago da loja
async function configMercadoPago(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MP_CHAVE) throw new ErroPedido('Pix automático indisponível no momento.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs } = await usuarioDaEquipe(request, env, lojaId, ['dono']);
    const caminhoSeg = `lojas/${lojaId}/segredos/mercadopago`;
    if (corpo.acao === 'status') {
      const seg = await fs.ler(caminhoSeg);
      return jsonResponse({ conectado: Boolean(seg && seg.token), conta: (seg && seg.conta) || null, atualizadoEm: (seg && seg.atualizadoEm) || null });
    }
    if (corpo.acao === 'desligar') {
      await fs.apagar([caminhoSeg]);
      await fs.atualizar(`lojas/${lojaId}`, { pixOnline: false });
      cacheLojas.clear();
      return jsonResponse({ ok: true });
    }
    if (corpo.acao === 'salvar') {
      const { token, conta, mpUserId } = await validarTokenMP(corpo.token);
      await fs.gravarJuntos([{ caminho: caminhoSeg, dados: { token: await cifrarTexto(env, token), conta, mpUserId, atualizadoEm: new Date() } }]);
      await fs.atualizar(`lojas/${lojaId}`, { pixOnline: true });
      cacheLojas.clear();
      return jsonResponse({ ok: true, conta });
    }
    throw new ErroPedido('Ação inválida.');
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('configMP', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível salvar agora.' }, 500);
  }
}

// =====================================================================
// ANTI-TROTE: Cloudflare Turnstile (invisível na maioria das vezes)
// =====================================================================
async function turnstileValido(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', token);
    if (ip && ip !== 'local') form.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json();
    return d.success === true;
  } catch (err) {
    console.error('turnstile', err && err.message);
    return true; // serviço fora do ar: não trava as vendas da loja
  }
}

// Login da equipe (token Firebase) + papel na loja
async function usuarioDaEquipe(request, env, lojaId, papeis) {
  const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let usuario;
  try { usuario = await verificarTokenFirebase(token, conta.project_id); }
  catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
  if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
  const fs = await firestore(env);
  const eu = await fs.ler(`lojas/${lojaId}/equipe/${usuario.sub}`);
  if (!eu || (papeis && !papeis.includes(eu.papel))) throw new ErroPedido('Sem permissão nesta loja.', 403);
  return { fs, uid: usuario.sub, papel: eu.papel };
}

async function lojaPeloSlug(fs, slug) {
  slug = String(slug || '').toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new ErroPedido('Loja inválida.');
  const s = await fs.ler(`slugs/${slug}`);
  if (!s || !s.lojaId) throw new ErroPedido('Loja não encontrada.', 404);
  return String(s.lojaId);
}

// =====================================================================
// CARTÃO FIDELIDADE + FICHA DE CLIENTES (CRM) da loja
// lojas/{id}/clientes/{whatsapp}: { nome, whatsapp, pedidosFeitos, totalPedidos, totalGastoCentavos,
//   carimbos (total acumulado), premiosUsados, ultimoPedidoEm, ultimaCompraEm, ultimoEnderecoTexto }
// Prêmios disponíveis = floor(carimbos / meta) - premiosUsados. Só o Worker lê e grava.
// =====================================================================
function resumoFidelidade(fid, c) {
  const meta = Math.max(1, Number(fid.meta) || 10);
  const carimbos = Number(c && c.carimbos) || 0;
  const premios = Math.max(0, Math.floor(carimbos / meta) - (Number(c && c.premiosUsados) || 0));
  return { ativo: true, meta, carimbos: carimbos % meta, premios, premioCentavos: Number(fid.premioCentavos) || 0, minimoCentavos: Number(fid.minimoCentavos) || 0 };
}

// Público: devolve SÓ números (carimbos, meta, prêmios). Nunca nome, endereço ou histórico.
async function consultarFidelidade(request, env, url) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(`fid:${ip}`)) throw new ErroPedido('Muitas consultas. Aguarde alguns minutos.', 429);
    const whatsapp = String(url.searchParams.get('whats') || '').replace(/\D/g, '');
    if (whatsapp.length < 10 || whatsapp.length > 13) throw new ErroPedido('WhatsApp inválido.');
    const fs = await firestore(env);
    const lojaId = await lojaPeloSlug(fs, url.searchParams.get('loja'));
    const loja = await fs.ler(`lojas/${lojaId}`);
    const fid = loja && loja.fidelidade && loja.fidelidade.ativo ? loja.fidelidade : null;
    if (!fid) return jsonResponse({ ativo: false });
    const c = await fs.ler(`lojas/${lojaId}/clientes/${whatsapp}`);
    return jsonResponse(resumoFidelidade(fid, c));
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('consultarFidelidade', err && err.stack || err);
    return jsonResponse({ erro: 'Indisponível.' }, 500);
  }
}

// Chamado pelo balcão ou pelo motoboy quando o pedido é concluído: soma na ficha do cliente e dá o carimbo.
// Cada pedido conta uma vez só (marca "contabilizadoEm" com trava de versão).
async function carimbarPedido(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId) || !/^[A-Za-z0-9_-]{6,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
    const fs = await firestore(env);
    const caminho = `lojas/${lojaId}/pedidos/${pedidoId}`;
    const [eu, entregador, lido, loja] = await Promise.all([
      fs.ler(`lojas/${lojaId}/equipe/${usuario.sub}`),
      fs.ler(`lojas/${lojaId}/entregadores/${usuario.sub}`),
      fs.lerComVersao(caminho),
      fs.ler(`lojas/${lojaId}`)
    ]);
    if (!lido) throw new ErroPedido('Pedido não encontrado.', 404);
    const p = lido.dados;
    if (!eu && !(entregador && p.motoboyId === usuario.sub)) throw new ErroPedido('Sem permissão nesta loja.', 403);
    if (p.status !== 'concluido') return jsonResponse({ ok: true, contado: false });
    if (p.contabilizadoEm) return jsonResponse({ ok: true, contado: false, jaContado: true });
    // Repasse do motoboy desta corrida (regra da loja), gravado no pedido na conclusão
    const repasseCalc = p.motoboyId && p.repasseMotoboyCentavos == null ? { repasseMotoboyCentavos: calcularRepasse(loja && loja.repasse, p, loja) } : {};
    const whatsapp = String(p.clienteWhatsapp || '').replace(/\D/g, '');
    if (whatsapp.length < 10 || whatsapp.length > 13) {
      await fs.atualizarSeVersao(caminho, { contabilizadoEm: new Date(), ...repasseCalc }, lido.versao);
      return jsonResponse({ ok: true, contado: false, semWhatsapp: true });
    }
    // Trava: só quem conseguir marcar primeiro soma (evita contar duas vezes)
    if (!(await fs.atualizarSeVersao(caminho, { contabilizadoEm: new Date(), ...repasseCalc }, lido.versao))) return jsonResponse({ ok: true, contado: false, jaContado: true });
    const fid = loja && loja.fidelidade && loja.fidelidade.ativo ? loja.fidelidade : null;
    const valor = Number(p.totalCentavos) || 0;
    const ganhaCarimbo = Boolean(fid) && (Number(p.subtotalCentavos) || valor) >= (Number(fid.minimoCentavos) || 0);
    // Dia da semana e hora do pedido (horário da loja): para saber quando cada cliente costuma pedir
    const quando = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', p.criadoEm ? new Date(p.criadoEm) : new Date());
    const r = await fs.incrementar(`lojas/${lojaId}/clientes/${whatsapp}`,
      { totalPedidos: 1, totalGastoCentavos: valor, carimbos: ganhaCarimbo ? 1 : 0, premiosUsados: 0, [`dias.d${quando.dia}`]: 1, [`horas.h${Math.floor(quando.min / 60)}`]: 1 },
      // Entrega concluída: zera a contagem de ausências (tira a exigência de Pix antecipado)
      { ausenciasSeguidas: 0, whatsapp, nome: String(p.clienteNome || 'Cliente').slice(0, 80), ultimaCompraEm: new Date(),
        ...(p.tipoEntrega === 'entrega' && p.enderecoTexto ? { ultimoEnderecoTexto: String(p.enderecoTexto).slice(0, 250) } : {}) });
    return jsonResponse({ ok: true, contado: true, carimbo: ganhaCarimbo, fidelidade: fid ? resumoFidelidade(fid, r) : null });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('carimbarPedido', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível registrar.' }, 500);
  }
}

// =====================================================================
// GANHOS DO MOTOBOY: regra de repasse da loja, extrato do turno e acerto com o balcão
// lojas/{id}.repasse = { tipo: 'fixo'|'taxa'|'faixas', diariaCentavos, porEntregaCentavos, percentualTaxa,
//   minimoCentavos, faixas: [{ ateKm, centavos }], adicionalChuvaCentavos, chuvaAtiva, metaEntregas, bonusMetaCentavos }
// lojas/{id}/turnosMotoboy/{uid} = { fundoTrocoCentavos, status: 'aberto'|'aguardando_acerto', encerradoEm }
// lojas/{id}/acertos_motoboy/{id} = resumo imutável do turno acertado (e os pedidos ganham acertoId)
// =====================================================================
function calcularRepasse(rep, p, loja = null) {
  // Loja sem regra própria de repasse: o motoboy ganha a taxa de entrega do pedido. Frete grátis para o
  // cliente não zera o motoboy: vale o que a entrega custaria pela tabela de frete da loja.
  if (!rep || !rep.tipo) {
    let v = Number(p.freteCentavos) || 0;
    if (!v && loja && loja.frete && loja.frete.modo !== 'gratis' && Number(p.distanciaKm) > 0) v = valorFreteKm(loja.frete, Number(p.distanciaKm));
    if (p.adicionalChuva) v += Number(rep && rep.adicionalChuvaCentavos) || 0;
    return Math.max(0, Math.round(v));
  }
  let v;
  if (rep.tipo === 'taxa') v = Math.round((Number(p.freteCentavos) || 0) * (Number(rep.percentualTaxa) || 100) / 100);
  else if (rep.tipo === 'faixas') {
    const km = Number(p.distanciaKm) || 0;
    const faixas = (Array.isArray(rep.faixas) ? rep.faixas : []).filter(f => Number(f.centavos) >= 0).sort((a, b) => Number(a.ateKm) - Number(b.ateKm));
    const f = faixas.find(x => km <= Number(x.ateKm)) || faixas[faixas.length - 1];
    v = f ? Number(f.centavos) || 0 : 0;
  } else v = Number(rep.porEntregaCentavos) || 0;
  // Frete grátis para o cliente não tira o ganho do motoboy: vale o mínimo por corrida
  v = Math.max(v, Number(rep.minimoCentavos) || 0);
  if (p.adicionalChuva) v += Number(rep.adicionalChuvaCentavos) || 0;
  return Math.max(0, Math.round(v));
}

async function extratoTurno(fs, lojaId, uid, loja) {
  const rep = (loja && loja.repasse) || {};
  const [turno, pedidos] = await Promise.all([
    fs.ler(`lojas/${lojaId}/turnosMotoboy/${uid}`),
    fs.consultarIgual(`lojas/${lojaId}`, 'pedidos', 'motoboyId', uid, 500)
  ]);
  const limite = Date.now() - 48 * 60 * 60 * 1000; // corridas ainda não acertadas das últimas 48 h
  const pago = (p) => p.pagamentoStatus === 'aprovado';
  const corridas = pedidos
    .filter(p => !p.acertoId && (p.status === 'concluido' || (p.status === 'cancelado' && p.manterRepasse)))
    .filter(p => (Date.parse(p.entregueEm || p.canceladoEm || p.criadoEm) || 0) >= limite)
    .map(p => {
      const concluido = p.status === 'concluido';
      const valor = Number(p.totalCentavos) || 0;
      const dinheiro = concluido && !pago(p) && p.formaPagamento === 'dinheiro' ? valor : 0;
      const cartao = concluido && !pago(p) && /cartao/.test(p.formaPagamento || '') ? valor : 0;
      // Como o cliente pagou: online (já caiu na conta da loja), dinheiro (está com o motoboy),
      // cartão na maquininha da loja, ou Pix ainda não confirmado pelo banco
      const forma = !concluido ? 'cancelado' : pago(p) ? 'online' : p.formaPagamento === 'dinheiro' ? 'dinheiro' : /cartao/.test(p.formaPagamento || '') ? 'cartao' : p.formaPagamento === 'pix' ? 'pix_pendente' : 'outro';
      return {
        id: p.id, numero: p.numeroPedido || null, bairro: (p.enderecoPartes && p.enderecoPartes.bairro) || '',
        em: p.entregueEm || p.canceladoEm || null, cancelado: p.status === 'cancelado',
        // Corrida gravada com R$ 0 quando a loja ainda não tinha regra: recalcula (padrão = taxa de entrega)
        repasseCentavos: p.repasseMotoboyCentavos != null && !(!rep.tipo && Number(p.repasseMotoboyCentavos) === 0) ? Number(p.repasseMotoboyCentavos) : calcularRepasse(rep, p, loja),
        subsidio: !(Number(p.freteCentavos) > 0), chuva: Boolean(p.adicionalChuva), dinheiroCentavos: dinheiro, cartaoCentavos: cartao,
        forma, valorCentavos: concluido ? valor : 0, freteCentavos: Number(p.freteCentavos) || 0
      };
    })
    .sort((a, b) => String(a.em).localeCompare(String(b.em)));
  const entregas = corridas.filter(c => !c.cancelado).length;
  const somaCorridas = corridas.reduce((a, c) => a + c.repasseCentavos, 0);
  const diaria = corridas.length || turno ? Number(rep.diariaCentavos) || 0 : 0;
  const meta = Number(rep.metaEntregas) || 0;
  const bonus = meta && entregas >= meta ? Number(rep.bonusMetaCentavos) || 0 : 0;
  const fundoTroco = Number(turno && turno.fundoTrocoCentavos) || 0;
  const dinheiroRecebido = corridas.reduce((a, c) => a + c.dinheiroCentavos, 0);
  const receber = diaria + somaCorridas + bonus;
  const devolver = dinheiroRecebido + fundoTroco;
  return {
    status: (turno && turno.status) || 'aberto', encerradoEm: (turno && turno.encerradoEm) || null,
    corridas, entregas, diariaCentavos: diaria, somaCorridasCentavos: somaCorridas, bonusCentavos: bonus,
    meta, bonusMetaCentavos: Number(rep.bonusMetaCentavos) || 0, fundoTrocoCentavos: fundoTroco,
    dinheiroRecebidoCentavos: dinheiroRecebido, cartaoCentavos: corridas.reduce((a, c) => a + c.cartaoCentavos, 0),
    porForma: ['online', 'dinheiro', 'cartao', 'pix_pendente'].reduce((o, f) => { const cs = corridas.filter(c => c.forma === f); o[f] = { qtd: cs.length, centavos: cs.reduce((a, c) => a + c.valorCentavos, 0) }; return o; }, {}),
    vendidoCentavos: corridas.reduce((a, c) => a + c.valorCentavos, 0),
    cancelados: corridas.filter(c => c.cancelado).length,
    receberCentavos: receber, devolverCentavos: devolver, saldoCentavos: receber - devolver,
    emRota: pedidos.filter(p => p.status === 'entrega').length, chuvaAtiva: Boolean(rep.chuvaAtiva)
  };
}

// App do motoboy: ver o extrato do turno e pedir o encerramento (o balcão confirma o acerto)
// Motoboy na rua reserva o próximo pedido "para a volta": a cozinha segue normal (o pedido continua em preparo)
// e, quando ele chega na loja, toca em "Peguei na loja" (aí sim vira "saiu para entrega").
const RESERVA_VALIDA_MS = 90 * 60 * 1000;
async function reservaMotoboy(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId) || !/^[A-Za-z0-9_]{6,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
    const fs = await firestore(env);
    const entregador = await fs.ler(`lojas/${lojaId}/entregadores/${usuario.sub}`);
    if (!entregador) throw new ErroPedido('Sua conta não é de entregador desta loja.', 403);
    const caminho = `lojas/${lojaId}/pedidos/${pedidoId}`;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const lido = await fs.lerComVersao(caminho);
      if (!lido) throw new ErroPedido('Pedido não encontrado.', 404);
      const p = lido.dados;
      const reservaAtiva = p.reservadoPor && (Date.now() - (Date.parse(p.reservadoEm) || 0)) < RESERVA_VALIDA_MS;
      let dados;
      if (corpo.acao === 'cancelar') {
        if (p.reservadoPor !== usuario.sub) return jsonResponse({ ok: true });
        dados = { reservadoPor: null, reservadoNome: null, reservadoEm: null };
      } else {
        if (p.tipoEntrega === 'retirada') throw new ErroPedido('Este pedido é para o cliente retirar na loja.', 409);
        if (p.motoboyId || !['novo', 'preparo'].includes(p.status)) throw new ErroPedido('Este pedido já saiu com outro entregador.', 409);
        if (reservaAtiva && p.reservadoPor !== usuario.sub) throw new ErroPedido(`${p.reservadoNome || 'Outro entregador'} já reservou este pedido.`, 409);
        const minhas = (await fs.consultarIgual(`lojas/${lojaId}`, 'pedidos', 'reservadoPor', usuario.sub, 20))
          .filter(x => x.id !== pedidoId && ['novo', 'preparo'].includes(x.status) && !x.motoboyId && (Date.now() - (Date.parse(x.reservadoEm) || 0)) < RESERVA_VALIDA_MS);
        if (minhas.length >= 3) throw new ErroPedido('Você já reservou 3 pedidos. Busque esses primeiro.', 409);
        dados = { reservadoPor: usuario.sub, reservadoNome: String(entregador.nome || 'Entregador').slice(0, 40), reservadoEm: new Date() };
      }
      if (await fs.atualizarSeVersao(caminho, dados, lido.versao)) return jsonResponse({ ok: true });
    }
    throw new ErroPedido('Muita gente mexendo neste pedido agora. Tente de novo.', 409);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('reservaMotoboy', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível reservar agora.' }, 500);
  }
}

async function turnoMotoboy(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
    const fs = await firestore(env);
    const [entregador, loja] = await Promise.all([fs.ler(`lojas/${lojaId}/entregadores/${usuario.sub}`), fs.ler(`lojas/${lojaId}`)]);
    if (!entregador) throw new ErroPedido('Sua conta não é de entregador desta loja.', 403);
    let ext = await extratoTurno(fs, lojaId, usuario.sub, loja);
    if (corpo.acao === 'encerrar') {
      if (ext.emRota) throw new ErroPedido('Conclua as entregas em rota antes de encerrar o turno.', 409);
      await fs.gravarJuntos([{ caminho: `lojas/${lojaId}/turnosMotoboy/${usuario.sub}`, dados: { fundoTrocoCentavos: ext.fundoTrocoCentavos, status: 'aguardando_acerto', encerradoEm: new Date(), nome: entregador.nome || 'Entregador' } }]);
      ext = { ...ext, status: 'aguardando_acerto' };
    }
    return jsonResponse(ext);
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('turnoMotoboy', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível carregar o extrato.' }, 500);
  }
}

// Caixa aberto agora (lojas/{id}/publico/estado) → id do turno, ou null
async function caixaAberto(fs, lojaId) {
  const est = await fs.ler(`lojas/${lojaId}/publico/estado`);
  return est && est.caixaAberto && est.turnoId ? String(est.turnoId) : null;
}
// Lança um movimento de dinheiro na gaveta do caixa aberto (troco do motoboy, acerto). Sem caixa aberto: não lança.
async function lancarNoCaixa(fs, lojaId, mov) {
  try {
    const turnoId = await caixaAberto(fs, lojaId);
    if (!turnoId) return false;
    await fs.adicionarNaLista(`lojas/${lojaId}/turnos/${turnoId}`, 'movimentos', [{ ...mov, valorCentavos: Math.round(mov.valorCentavos), em: new Date(), id: crypto.randomUUID() }]);
    return true;
  } catch (err) { console.error('lancarNoCaixa', err && err.message); return false; }
}

// Balcão: turnos dos motoboys, troco inicial, confirmação do acerto e histórico
async function acertosMotoboy(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs, uid: quem } = await usuarioDaEquipe(request, env, lojaId, ['dono', 'balcao']);
    const loja = await fs.ler(`lojas/${lojaId}`);
    if (corpo.acao === 'historico') {
      const lista = (await fs.listar(`lojas/${lojaId}/acertos_motoboy`)).sort((a, b) => String(b.confirmadoEm).localeCompare(String(a.confirmadoEm))).slice(0, 500);
      return jsonResponse({ acertos: lista.map(a => ({ id: a.id, nome: a.nome, confirmadoEm: a.confirmadoEm, entregas: a.entregas, receberCentavos: a.receberCentavos, devolverCentavos: a.devolverCentavos, saldoCentavos: a.saldoCentavos, diariaCentavos: a.diariaCentavos, somaCorridasCentavos: a.somaCorridasCentavos, bonusCentavos: a.bonusCentavos, fundoTrocoCentavos: a.fundoTrocoCentavos, dinheiroRecebidoCentavos: a.dinheiroRecebidoCentavos, cartaoCentavos: a.cartaoCentavos || 0, porForma: a.porForma || null, vendidoCentavos: a.vendidoCentavos || 0, pagoComo: a.pagoComo || null, uid: a.uid || null })) });
    }
    const uid = String(corpo.uid || '');
    if (corpo.acao !== 'listar' && !/^[A-Za-z0-9]{6,128}$/.test(uid)) throw new ErroPedido('Entregador inválido.');
    if (corpo.acao === 'fundoTroco') {
      const v = Math.round(Number(corpo.centavos) || 0);
      if (v < 0 || v > 100000000) throw new ErroPedido('Valor inválido.');
      const [t0, ent] = await Promise.all([fs.ler(`lojas/${lojaId}/turnosMotoboy/${uid}`), fs.ler(`lojas/${lojaId}/entregadores/${uid}`)]);
      const t = t0 || {};
      await fs.gravarJuntos([{ caminho: `lojas/${lojaId}/turnosMotoboy/${uid}`, dados: { ...t, fundoTrocoCentavos: v, status: t.status || 'aberto' } }]);
      // O troco sai da gaveta do caixa (ou volta, se diminuiu)
      const dif = v - (Number(t.fundoTrocoCentavos) || 0);
      const noCaixa = dif ? await lancarNoCaixa(fs, lojaId, { tipo: dif > 0 ? 'troco_motoboy' : 'troco_motoboy_volta', valorCentavos: Math.abs(dif), descricao: `Troco ${dif > 0 ? 'entregue a' : 'devolvido por'} ${(ent && ent.nome) || 'motoboy'}`, por: quem }) : false;
      return jsonResponse({ ok: true, noCaixa });
    }
    if (corpo.acao === 'confirmar') {
      const ent = await fs.ler(`lojas/${lojaId}/entregadores/${uid}`);
      const ext = await extratoTurno(fs, lojaId, uid, loja);
      if (ext.emRota) throw new ErroPedido('Este entregador ainda tem entrega em rota.', 409);
      const acertoId = 'a_' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      const pagoComo = corpo.pagoComo === 'pix' ? 'pix' : 'dinheiro';
      const resumo = { uid, nome: (ent && ent.nome) || 'Entregador', confirmadoPor: quem, confirmadoEm: new Date(), pagoComo,
        porForma: ext.porForma, vendidoCentavos: ext.vendidoCentavos,
        entregas: ext.entregas, diariaCentavos: ext.diariaCentavos, somaCorridasCentavos: ext.somaCorridasCentavos, bonusCentavos: ext.bonusCentavos,
        fundoTrocoCentavos: ext.fundoTrocoCentavos, dinheiroRecebidoCentavos: ext.dinheiroRecebidoCentavos, cartaoCentavos: ext.cartaoCentavos,
        receberCentavos: ext.receberCentavos, devolverCentavos: ext.devolverCentavos, saldoCentavos: ext.saldoCentavos,
        corridas: ext.corridas.map(c => ({ id: c.id, numero: c.numero, repasseCentavos: c.repasseCentavos, dinheiroCentavos: c.dinheiroCentavos, cancelado: c.cancelado })) };
      if (!(await fs.criarSeNaoExiste(`lojas/${lojaId}/acertos_motoboy/${acertoId}`, resumo))) throw new ErroPedido('Tente de novo.', 409);
      await fs.atualizarVarios(ext.corridas.map(c => ({ caminho: `lojas/${lojaId}/pedidos/${c.id}`, dados: { acertoId } })));
      await fs.apagar([`lojas/${lojaId}/turnosMotoboy/${uid}`]);
      // Na gaveta: o motoboy entrega o dinheiro dos clientes + o troco; se a loja pagou em dinheiro, sai o ganho dele
      const nome = resumo.nome;
      const naGaveta = pagoComo === 'dinheiro' ? ext.devolverCentavos - ext.receberCentavos : ext.devolverCentavos;
      const movs = [];
      if (naGaveta > 0) movs.push({ tipo: 'entrada_motoboy', valorCentavos: naGaveta, descricao: `Acerto ${nome}: ${pagoComo === 'dinheiro' ? 'devolveu (já descontado o ganho dele)' : 'dinheiro dos clientes + troco'}` });
      if (naGaveta < 0) movs.push({ tipo: 'saida_motoboy', valorCentavos: -naGaveta, descricao: `Acerto ${nome}: pago em dinheiro da gaveta` });
      let noCaixa = false;
      for (const m of movs) noCaixa = (await lancarNoCaixa(fs, lojaId, { ...m, por: quem, acertoId })) || noCaixa;
      if (!movs.length) noCaixa = Boolean(await caixaAberto(fs, lojaId));
      return jsonResponse({ ok: true, acertoId, noCaixa, resumo: { ...resumo, confirmadoEm: new Date().toISOString() } });
    }
    // listar: um resumo por entregador cadastrado
    const [entregadores, acertos] = await Promise.all([fs.listar(`lojas/${lojaId}/entregadores`), fs.listar(`lojas/${lojaId}/acertos_motoboy`)]);
    const hoje = diaDaLoja(loja);
    const deHoje = acertos.filter(a => a.confirmadoEm && diaDaLoja(loja, new Date(a.confirmadoEm)) === hoje);
    const lista = await Promise.all(entregadores.slice(0, 20).map(async (e) => {
      const ext = await extratoTurno(fs, lojaId, e.id, loja);
      const meus = deHoje.filter(a => a.uid === e.id);
      return { uid: e.id, nome: e.nome || 'Entregador', ...ext,
        acertadoHoje: { acertos: meus.length, entregas: meus.reduce((x, a) => x + (Number(a.entregas) || 0), 0), receberCentavos: meus.reduce((x, a) => x + (Number(a.receberCentavos) || 0), 0), vendidoCentavos: meus.reduce((x, a) => x + (Number(a.vendidoCentavos) || 0), 0) } };
    }));
    return jsonResponse({ entregadores: lista, repasse: (loja && loja.repasse) || null, caixaAberto: Boolean(await caixaAberto(fs, lojaId)) });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('acertosMotoboy', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível carregar.' }, 500);
  }
}

// =====================================================================
// ESTOQUE VIVO: baixa automática na venda, reposição diária e ajuste de perda (−1 quebra/consumo)
// produto: { controlarEstoque, estoque, estoqueDiario?, estoqueRepostoEm? ('AAAA-MM-DD' no fuso da loja) }
// =====================================================================
function diaDaLoja(loja, data = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: (loja && loja.fusoHorario) || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
}
// Com reposição diária, o primeiro movimento do dia começa da quantidade cheia
function estoqueAtual(prod, hoje) {
  if (Number(prod.estoqueDiario) > 0 && prod.estoqueRepostoEm !== hoje) return Number(prod.estoqueDiario);
  return Number(prod.estoque) || 0;
}
// Estoque por variação (varejo): produto.estoqueGrade = { "Tamanho|Cor": qtd } ("-" quando não tem o grupo)
const usaGrade = (p) => Boolean(p && p.controlarGrade && p.estoqueGrade && typeof p.estoqueGrade === 'object');
function chaveGrade(prod, selecoes) {
  const g = prod.grupos || [];
  const nomeDe = (tipo) => {
    const gi = g.findIndex(x => x.tipo === tipo);
    if (gi < 0) return '-';
    const idx = selecoes && Array.isArray(selecoes[gi]) ? selecoes[gi][0] : undefined;
    const o = Number.isInteger(idx) ? (g[gi].opcoes || [])[idx] : null;
    return o ? String(o.nome || '').trim() : null;
  };
  const t = nomeDe('tamanho'), c = nomeDe('cor');
  if (t === null || c === null || (t === '-' && c === '-')) return null;
  return `${t}|${c}`;
}
// Aplica uma mudança no estoque de vários produtos; tenta de novo se outro pedido gravou no meio
async function mexerNoEstoque(fs, lojaId, loja, mudar) {
  const caminho = `lojas/${lojaId}/publico/cardapio_completo`;
  const hoje = diaDaLoja(loja);
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const lido = await fs.lerComVersao(caminho);
    if (!lido) return null;
    const produtos = (lido.dados.produtos || []).map(p => ({ ...p }));
    let mexeu = false;
    const resultado = {};
    for (const p of produtos) {
      if (mudar.grade && usaGrade(p)) {
        const deltas = mudar.grade(p);
        if (!deltas) continue;
        const g = { ...p.estoqueGrade };
        for (const [k, v] of Object.entries(deltas)) if (k in g) g[k] = Math.max(0, Math.round((Number(g[k]) || 0) + v));
        p.estoqueGrade = g;
        resultado[p.id] = g;
        mexeu = true;
        continue;
      }
      if (!p.controlarEstoque && !mudar.forcar?.includes(p.id)) continue;
      const novo = mudar.calc(p, estoqueAtual(p, hoje));
      if (novo === undefined) continue;
      p.estoque = Math.max(0, Math.round(novo));
      p.controlarEstoque = true;
      if (Number(p.estoqueDiario) > 0) p.estoqueRepostoEm = hoje;
      resultado[p.id] = p.estoque;
      mexeu = true;
    }
    if (!mexeu) return resultado;
    if (await fs.atualizarSeVersao(caminho, { produtos }, lido.versao)) return resultado;
  }
  throw new Error('estoque: muitas gravações ao mesmo tempo');
}
async function baixarEstoque(fs, lojaId, loja, itens) {
  const qtd = {};
  itens.forEach(i => { qtd[i.produtoId] = (qtd[i.produtoId] || 0) + (Number(i.quantidade) || 0); });
  // Produto com grade: baixa só a variação vendida (pela chave pronta ou pelas escolhas do item)
  const grade = (p) => {
    const deltas = {};
    itens.filter(i => i.produtoId === p.id).forEach(i => {
      const k = i.variacao || chaveGrade(p, i.selecoes);
      if (k) deltas[k] = (deltas[k] || 0) - (Number(i.quantidade) || 0);
    });
    return Object.keys(deltas).length ? deltas : null;
  };
  return mexerNoEstoque(fs, lojaId, loja, { calc: (p, atual) => (qtd[p.id] ? atual - qtd[p.id] : undefined), grade });
}

// Balcão: −1 por quebra/consumo/brinde, +1, repor tudo, ou baixa de venda feita no balcão
async function ajustarEstoque(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs, uid } = await usuarioDaEquipe(request, env, lojaId, ['dono', 'balcao']);
    const loja = await fs.ler(`lojas/${lojaId}`);
    if (corpo.acao === 'venda') {
      const limparSel = (sel) => Object.fromEntries(Object.entries(sel && typeof sel === 'object' ? sel : {}).slice(0, 20).map(([k, v]) => [k, (Array.isArray(v) ? v : []).slice(0, 20).map(n => Math.round(Number(n))).filter(n => Number.isInteger(n) && n >= 0)]));
      const itens = (Array.isArray(corpo.itens) ? corpo.itens : []).slice(0, 50).map(i => ({ produtoId: String(i.produtoId || ''), quantidade: Math.max(0, Math.min(50, Math.round(Number(i.quantidade) || 0))), selecoes: limparSel(i.selecoes) }));
      const pedidoId = String(corpo.pedidoId || '');
      if (!/^[A-Za-z0-9]{6,64}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
      // Uma baixa só por pedido (se o botão for tocado duas vezes ou a internet repetir o envio)
      if (!(await fs.criarSeNaoExiste(`lojas/${lojaId}/estoqueAjustes/venda_${pedidoId}`, { acao: 'venda', pedidoId, por: uid, em: new Date(), itens }))) return jsonResponse({ ok: true, repetido: true });
      return jsonResponse({ ok: true, estoque: await baixarEstoque(fs, lojaId, loja, itens) });
    }
    const produtoId = String(corpo.produtoId || '');
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(produtoId)) throw new ErroPedido('Produto inválido.');
    const motivo = ['quebra', 'consumo', 'brinde', 'acerto', 'reposicao'].includes(corpo.motivo) ? corpo.motivo : 'acerto';
    const variacao = typeof corpo.variacao === 'string' ? corpo.variacao.slice(0, 80) : '';
    if (variacao) {
      let res;
      const v = Math.round(Number(corpo.acao === 'definir' ? corpo.valor : corpo.delta));
      if (!Number.isFinite(v) || Math.abs(v) > 100000 || (corpo.acao === 'definir' && v < 0) || (corpo.acao !== 'definir' && !v)) throw new ErroPedido('Quantidade inválida.');
      const r = await mexerNoEstoque(fs, lojaId, loja, { calc: () => undefined, grade: (p) => {
        if (p.id !== produtoId || !(variacao in p.estoqueGrade)) return null;
        return { [variacao]: corpo.acao === 'definir' ? v - (Number(p.estoqueGrade[variacao]) || 0) : v };
      } });
      res = r && r[produtoId] ? r[produtoId][variacao] : undefined;
      if (res === undefined) throw new ErroPedido('Variação não encontrada.', 409);
      try { await fs.criarSeNaoExiste(`lojas/${lojaId}/estoqueAjustes/${Date.now()}_${uid.slice(0, 8)}`, { produtoId, variacao, acao: corpo.acao || 'delta', delta: corpo.acao === 'definir' ? null : v, valor: corpo.acao === 'definir' ? v : null, motivo, por: uid, em: new Date(), resultado: res }); } catch (_) {}
      return jsonResponse({ ok: true, estoque: res });
    }
    let calc;
    if (corpo.acao === 'definir') {
      const v = Math.round(Number(corpo.valor));
      if (!Number.isFinite(v) || v < 0 || v > 100000) throw new ErroPedido('Quantidade inválida.');
      calc = (p) => (p.id === produtoId ? v : undefined);
    } else {
      const d = Math.round(Number(corpo.delta) || 0);
      if (!d || Math.abs(d) > 1000) throw new ErroPedido('Quantidade inválida.');
      calc = (p, atual) => (p.id === produtoId ? atual + d : undefined);
    }
    const r = await mexerNoEstoque(fs, lojaId, loja, { calc, forcar: corpo.acao === 'definir' ? [produtoId] : [] });
    if (!r || r[produtoId] === undefined) throw new ErroPedido('Este produto não controla estoque.', 409);
    // Registro do ajuste (quem, quando, motivo) para o dono conferir perdas
    try { await fs.criarSeNaoExiste(`lojas/${lojaId}/estoqueAjustes/${Date.now()}_${uid.slice(0, 8)}`, { produtoId, acao: corpo.acao || 'delta', delta: Number(corpo.delta) || null, valor: corpo.acao === 'definir' ? Number(corpo.valor) : null, motivo, por: uid, em: new Date(), resultado: r[produtoId] }); } catch (_) {}
    return jsonResponse({ ok: true, estoque: r[produtoId] });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('ajustarEstoque', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível ajustar o estoque.' }, 500);
  }
}

// PIN de 4 dígitos do dono: o funcionário do balcão precisa dele para cancelar pedido aceito ou dar desconto.
// Guardado só como hash com sal em lojas/{id}/segredos/pinDono (o app não consegue ler).
const hashPin = async (sal, pin) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sal}:${pin}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function pinDono(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs, uid, papel } = await usuarioDaEquipe(request, env, lojaId, ['dono', 'balcao']);
    const caminho = `lojas/${lojaId}/segredos/pinDono`;
    const pin = String(corpo.pin || '');
    if (corpo.acao === 'status') return jsonResponse({ temPin: Boolean(await fs.ler(caminho)) });
    if (corpo.acao === 'definir') {
      if (papel !== 'dono') throw new ErroPedido('Só o dono pode criar o PIN.', 403);
      if (!/^\d{4}$/.test(pin)) throw new ErroPedido('O PIN precisa ter 4 números.');
      const sal = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      await fs.gravarJuntos([{ caminho, dados: { sal, hash: await hashPin(sal, pin), criadoEm: new Date(), criadoPor: uid } }]);
      return jsonResponse({ ok: true });
    }
    // verificar: no máximo 8 tentativas a cada 10 minutos por pessoa (evita "chutar" o PIN)
    if (!dentroDoLimite(`pin:${lojaId}:${uid}`)) throw new ErroPedido('Muitas tentativas. Aguarde 10 minutos ou chame o dono.', 429);
    const sec = await fs.ler(caminho);
    if (!sec) throw new ErroPedido('O dono ainda não criou o PIN (⚙ Configurações → 🔐 PIN do dono).', 409);
    if (!/^\d{4}$/.test(pin) || (await hashPin(sec.sal, pin)) !== sec.hash) throw new ErroPedido('PIN errado.', 403);
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('pinDono', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível conferir o PIN.' }, 500);
  }
}

// Retirada: o cliente avisa "Cheguei no balcão". O ID do pedido (longo e aleatório) funciona como senha do link.
async function clienteChegou(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(`chg:${ip}`)) throw new ErroPedido('Muitas tentativas. Aguarde um pouco.', 429);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const fs = await firestore(env);
    const lojaId = await lojaPeloSlug(fs, corpo.slug);
    const caminho = `lojas/${lojaId}/pedidos/${pedidoId}`;
    const p = await fs.ler(caminho);
    if (!p || p.tipoEntrega !== 'retirada' || !['novo', 'preparo'].includes(p.status)) throw new ErroPedido('Este pedido não está aguardando retirada.', 409);
    if (!p.clienteChegouEm) await fs.atualizar(caminho, { clienteChegouEm: new Date() });
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('clienteChegou', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível avisar agora.' }, 500);
  }
}

// Motoboy chegou e o cliente não atendeu: registra a tentativa (hora + GPS) para o balcão ligar.
// O pedido continua com ele (vai para o fim da rota); não conta como ausência até o balcão confirmar.
async function tentativaEntrega(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId) || !/^[A-Za-z0-9_-]{6,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const conta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    let usuario;
    try { usuario = await verificarTokenFirebase(token, conta.project_id); }
    catch (_) { throw new ErroPedido('Sessão inválida. Entre de novo.', 401); }
    const fs = await firestore(env);
    const [entregador, p] = await Promise.all([fs.ler(`lojas/${lojaId}/entregadores/${usuario.sub}`), fs.ler(`lojas/${lojaId}/pedidos/${pedidoId}`)]);
    if (!entregador || !p || p.motoboyId !== usuario.sub || p.status !== 'entrega') throw new ErroPedido('Sem permissão para este pedido.', 403);
    const c = corpo.coords && Number.isFinite(Number(corpo.coords.lat)) && Number.isFinite(Number(corpo.coords.lng)) ? { lat: Number(corpo.coords.lat), lng: Number(corpo.coords.lng) } : null;
    await fs.atualizar(`lojas/${lojaId}/pedidos/${pedidoId}`, { tentativaAusente: { em: new Date(), coords: c }, tentativasAusente: (Number(p.tentativasAusente) || 0) + 1 });
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('tentativaEntrega', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível registrar.' }, 500);
  }
}

// Chave com o maior número num mapa de contagem ({ sex: 5, sab: 2 } → 'sex'); null se vazio
function maiorChave(m) {
  if (!m || typeof m !== 'object') return null;
  let melhor = null, n = 0;
  for (const [k, v] of Object.entries(m)) if (Number(v) > n) { n = Number(v); melhor = k; }
  return melhor;
}

// Painel: lista de clientes (dono e balcão) e anonimização a pedido do cliente (LGPD, só o dono)
async function painelClientes(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs, papel } = await usuarioDaEquipe(request, env, lojaId, ['dono', 'balcao']);
    const loja = await fs.ler(`lojas/${lojaId}`);
    const fid = loja && loja.fidelidade && loja.fidelidade.ativo ? loja.fidelidade : null;
    // Ocorrência do motoboy: o balcão decide se foi culpa do cliente (ausente / endereço inexistente)
    if (corpo.acao === 'ocorrencia') {
      const pedidoId = String(corpo.pedidoId || '');
      if (!/^[A-Za-z0-9_-]{6,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
      const caminho = `lojas/${lojaId}/pedidos/${pedidoId}`;
      const lido = await fs.lerComVersao(caminho);
      if (!lido || lido.dados.status !== 'ocorrencia') throw new ErroPedido('Este pedido não está com ocorrência.', 409);
      if (lido.dados.ocorrenciaRevisada) return jsonResponse({ ok: true, jaRevisado: true });
      const culpa = corpo.culpaCliente === true;
      if (!(await fs.atualizarSeVersao(caminho, { ocorrenciaRevisada: culpa ? 'cliente' : 'loja' }, lido.versao))) return jsonResponse({ ok: true, jaRevisado: true });
      const wa = String(lido.dados.clienteWhatsapp || '').replace(/\D/g, '');
      let ausencias = 0;
      if (culpa && wa.length >= 10) ausencias = (await fs.incrementar(`lojas/${lojaId}/clientes/${wa}`, { ausenciasSeguidas: 1, ausenciasTotal: 1 }, { whatsapp: wa })).ausenciasSeguidas;
      return jsonResponse({ ok: true, ausencias, restrito: ausencias >= 2 });
    }
    if (corpo.acao === 'liberarCliente') {
      if (papel !== 'dono') throw new ErroPedido('Só o dono pode liberar.', 403);
      const wa = String(corpo.whatsapp || '').replace(/\D/g, '');
      if (wa.length < 10 || wa.length > 13) throw new ErroPedido('WhatsApp inválido.');
      await fs.incrementar(`lojas/${lojaId}/clientes/${wa}`, {}, { ausenciasSeguidas: 0 });
      return jsonResponse({ ok: true });
    }
    if (corpo.acao === 'anonimizar') {
      if (papel !== 'dono') throw new ErroPedido('Só o dono pode apagar os dados de um cliente.', 403);
      const wa = String(corpo.whatsapp || '').replace(/\D/g, '');
      if (wa.length < 10 || wa.length > 13) throw new ErroPedido('WhatsApp inválido.');
      const pedidos = await fs.consultarIgual(`lojas/${lojaId}`, 'pedidos', 'clienteWhatsapp', wa, 500);
      const emAndamento = pedidos.filter(x => ['novo', 'preparo', 'entrega', 'aguardando_pagamento'].includes(x.status));
      if (emAndamento.length) throw new ErroPedido('Este cliente tem um pedido em andamento. Conclua antes de apagar os dados.', 409);
      // Pedidos continuam no histórico (valores), mas sem nome, telefone e endereço
      await fs.atualizarVarios(pedidos.map(x => ({ caminho: `lojas/${lojaId}/pedidos/${x.id}`, dados: { clienteNome: 'Cliente anonimizado', clienteWhatsapp: '', enderecoTexto: x.tipoEntrega === 'entrega' ? 'Endereço removido (LGPD)' : (x.enderecoTexto || ''), destinoCoords: null, enderecoPartes: null, coordsBaixa: null, motoboyCoords: null, recebedorNome: null, recebedorWhats: null, tentativaAusente: null, anonimizadoEm: new Date() } })));
      await fs.apagar([`lojas/${lojaId}/clientes/${wa}`, `lojas/${lojaId}/carrinhos/${wa}`]);
      return jsonResponse({ ok: true, pedidos: pedidos.length });
    }
    const clientes = (await fs.listar(`lojas/${lojaId}/clientes`))
      .filter(c => c.whatsapp)
      .map(c => ({
        nome: c.nome || 'Cliente', whatsapp: c.whatsapp, totalPedidos: Number(c.totalPedidos) || 0, pedidosFeitos: Number(c.pedidosFeitos) || 0,
        totalGastoCentavos: Number(c.totalGastoCentavos) || 0, ultimaCompraEm: c.ultimaCompraEm || c.ultimoPedidoEm || null,
        ultimoEnderecoTexto: c.ultimoEnderecoTexto || '', fidelidade: fid ? resumoFidelidade(fid, c) : null,
        optInMarketing: c.optInMarketing === true, ausenciasSeguidas: Number(c.ausenciasSeguidas) || 0,
        diaFavorito: maiorChave(c.dias), horaFavorita: maiorChave(c.horas)
      }))
      .sort((a, b) => b.totalGastoCentavos - a.totalGastoCentavos);
    const hoje = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', new Date()).dia;
    return jsonResponse({ clientes, hoje, fidelidade: fid ? { meta: Number(fid.meta) || 10 } : null });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('painelClientes', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível carregar.' }, 500);
  }
}

// =====================================================================
// CARRINHO ABANDONADO: o cardápio avisa quando o cliente (com WhatsApp
// preenchido) sai sem finalizar. Só aparece no painel depois de 20 min
// parado; some quando ele faz o pedido ou depois de 3 dias.
// =====================================================================
const CARRINHO_ESPERA_MS = 20 * 60 * 1000;
const CARRINHO_VALIDADE_MS = 3 * 24 * 60 * 60 * 1000;
async function registrarCarrinho(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(`car:${ip}`)) throw new ErroPedido('Muitas tentativas.', 429);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const whatsapp = String(corpo.whatsapp || '').replace(/\D/g, '');
    const nome = String(corpo.nome || '').trim().slice(0, 80);
    if (whatsapp.length < 10 || whatsapp.length > 13) throw new ErroPedido('WhatsApp inválido.');
    const itensPedidos = Array.isArray(corpo.itens) ? corpo.itens.slice(0, 30) : [];
    if (!itensPedidos.length) throw new ErroPedido('Carrinho vazio.');
    const fs = await firestore(env);
    const lojaId = await lojaPeloSlug(fs, corpo.slug);
    const [loja, cardapio] = await Promise.all([fs.ler(`lojas/${lojaId}`), fs.ler(`lojas/${lojaId}/publico/cardapio_completo`)]);
    const produtos = (cardapio?.produtos || []).filter(p => !p.excluido);
    const itens = [];
    let totalCentavos = 0;
    for (const it of itensPedidos) {
      const prod = produtos.find(p => p.id === it.produtoId);
      const quantidade = Math.min(50, Math.max(1, Number(it.quantidade) || 1));
      if (!prod) continue;
      try {
        const { unitarioCentavos, detalhes } = calcularItemOficial(prod, it.selecoes || {}, loja);
        itens.push({ nome: nomeNoPedido(prod), quantidade, detalhes });
        totalCentavos += unitarioCentavos * quantidade;
      } catch (_) {}
    }
    if (!itens.length) throw new ErroPedido('Carrinho vazio.');
    const agora = Date.now();
    await fs.gravarJuntos([{ caminho: `lojas/${lojaId}/carrinhos/${whatsapp}`, dados: {
      nome: nome || null, whatsapp, itens, totalCentavos,
      atualizadoEm: new Date(agora), visivelApos: new Date(agora + CARRINHO_ESPERA_MS)
    } }]);
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('registrarCarrinho', err && err.stack || err);
    return jsonResponse({ erro: 'Falhou.' }, 500);
  }
}

async function painelCarrinhos(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new ErroPedido('Indisponível.', 503);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const { fs } = await usuarioDaEquipe(request, env, lojaId, ['dono', 'balcao']);
    if (corpo.acao === 'remover') {
      const wa = String(corpo.whatsapp || '').replace(/\D/g, '');
      if (wa.length < 10) throw new ErroPedido('WhatsApp inválido.');
      await fs.apagar([`lojas/${lojaId}/carrinhos/${wa}`]);
      return jsonResponse({ ok: true });
    }
    const agora = Date.now();
    const todos = await fs.listar(`lojas/${lojaId}/carrinhos`);
    const vencidos = todos.filter(c => (Date.parse(c.atualizadoEm) || 0) < agora - CARRINHO_VALIDADE_MS);
    if (vencidos.length) { try { await fs.apagar(vencidos.slice(0, 100).map(c => `lojas/${lojaId}/carrinhos/${c.id}`)); } catch (_) {} }
    const carrinhos = todos
      .filter(c => !vencidos.includes(c) && (Date.parse(c.visivelApos) || 0) <= agora)
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))
      .map(c => ({ whatsapp: c.whatsapp || c.id, nome: c.nome, itens: c.itens || [], totalCentavos: c.totalCentavos || 0, atualizadoEm: c.atualizadoEm }));
    return jsonResponse({ carrinhos });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('painelCarrinhos', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível carregar.' }, 500);
  }
}

// =====================================================================
// NOTIFICAÇÕES NO CELULAR DO CLIENTE (Web Push, padrão aberto e grátis)
// Secret: VAPID_PRIVATE_JWK. A inscrição do aparelho fica em
// lojas/{id}/pushPedidos/{pedidoId} (só o Worker lê).
// =====================================================================
const encPush = new TextEncoder();
const b64uEnc = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (t) => { const x = String(t).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(x + '='.repeat((4 - (x.length % 4)) % 4)), c => c.charCodeAt(0)); };
const juntarBytes = (...partes) => { const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of partes) { out.set(p, o); o += p.length; } return out; };
let vapidCache = { raw: null, key: null, pub: null };
function chavePublicaPush(env) {
  if (!env.VAPID_PRIVATE_JWK) return null;
  try { const j = JSON.parse(env.VAPID_PRIVATE_JWK); return b64uEnc(juntarBytes(new Uint8Array([4]), b64uDec(j.x), b64uDec(j.y))); } catch (_) { return null; }
}
async function chavesVapid(env) {
  if (vapidCache.raw !== env.VAPID_PRIVATE_JWK) {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    vapidCache = { raw: env.VAPID_PRIVATE_JWK, key, pub: juntarBytes(new Uint8Array([4]), b64uDec(jwk.x), b64uDec(jwk.y)) };
  }
  return vapidCache;
}
async function hkdfPush(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
// RFC 8291 (aes128gcm)
async function cifrarPush(p256dh, authSecret, texto) {
  const uaPub = b64uDec(p256dh);
  const auth = b64uDec(authSecret);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdfPush(auth, shared, juntarBytes(encPush.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdfPush(salt, ikm, encPush.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfPush(salt, ikm, encPush.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, juntarBytes(encPush.encode(texto), new Uint8Array([2]))));
  return juntarBytes(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, cifrado);
}
function enderecoPushOk(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return false;
    const h = x.hostname;
    return h === 'fcm.googleapis.com' || h === 'updates.push.services.mozilla.com' || h === 'web.push.apple.com'
      || h.endsWith('.push.apple.com') || h.endsWith('.notify.windows.com') || h.endsWith('.push.services.mozilla.com');
  } catch (_) { return false; }
}
async function enviarPush(env, ins, msg, origem) {
  if (!ins || !enderecoPushOk(ins.endpoint) || !ins.p256dh || !ins.auth) return 400;
  const { key, pub } = await chavesVapid(env);
  const agora = Math.floor(Date.now() / 1000);
  const semAss = b64uEnc(encPush.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64uEnc(encPush.encode(JSON.stringify({ aud: new URL(ins.endpoint).origin, exp: agora + 12 * 3600, sub: origem })));
  const ass = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encPush.encode(semAss));
  const r = await fetch(ins.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${semAss}.${b64uEnc(ass)}, k=${b64uEnc(pub)}`, TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    body: await cifrarPush(ins.p256dh, ins.auth, JSON.stringify(msg))
  });
  return r.status;
}

async function inscreverPush(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.VAPID_PRIVATE_JWK) throw new ErroPedido('Notificações indisponíveis.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!dentroDoLimite(`push:${ip}`)) throw new ErroPedido('Muitas tentativas.', 429);
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_]{8,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const ins = corpo.inscricao || {};
    const dados = { endpoint: String(ins.endpoint || ''), p256dh: String((ins.keys && ins.keys.p256dh) || ''), auth: String((ins.keys && ins.keys.auth) || '') };
    if (!enderecoPushOk(dados.endpoint) || dados.endpoint.length > 1000 || !dados.p256dh || dados.p256dh.length > 200 || !dados.auth || dados.auth.length > 100) throw new ErroPedido('Inscrição inválida.');
    const fs = await firestore(env);
    const lojaId = await lojaPeloSlug(fs, corpo.slug);
    const pedido = await fs.ler(`lojas/${lojaId}/pedidos/${pedidoId}`);
    if (!pedido) throw new ErroPedido('Pedido não encontrado.', 404);
    if (['concluido', 'cancelado', 'ocorrencia'].includes(pedido.status)) throw new ErroPedido('Este pedido já terminou.', 409);
    await fs.gravarJuntos([{ caminho: `lojas/${lojaId}/pushPedidos/${pedidoId}`, dados: { ...dados, slug: String(corpo.slug).toLowerCase(), ultimoAviso: pedido.status, criadoEm: new Date() } }]);
    return jsonResponse({ ok: true });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('inscreverPush', err && err.stack || err);
    return jsonResponse({ erro: 'Não foi possível ativar agora.' }, 500);
  }
}

// A equipe chama depois de mudar o status; o Worker decide a mensagem e não repete aviso
async function notificarCliente(request, env) {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.VAPID_PRIVATE_JWK) return jsonResponse({ ok: false, motivo: 'sem_push' });
    let corpo;
    try { corpo = await request.json(); } catch (_) { throw new ErroPedido('Dados inválidos.'); }
    const lojaId = String(corpo.lojaId || '');
    const pedidoId = String(corpo.pedidoId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(pedidoId)) throw new ErroPedido('Pedido inválido.');
    const { fs } = await usuarioDaEquipe(request, env, lojaId, null);
    const caminhoPush = `lojas/${lojaId}/pushPedidos/${pedidoId}`;
    const [ins, pedido, loja] = await Promise.all([fs.ler(caminhoPush), fs.ler(`lojas/${lojaId}/pedidos/${pedidoId}`), fs.ler(`lojas/${lojaId}`)]);
    if (!ins || !pedido) return jsonResponse({ ok: false, motivo: 'sem_inscricao' });
    const chegou = pedido.status === 'entrega' && pedido.motoboyCoords && pedido.motoboyCoords.chegou === true;
    const etapa = chegou ? 'chegou' : pedido.status;
    // Motoboy pegou, mas ainda não deslizou "Iniciar rota": o aviso de saída vem depois
    if (pedido.status === 'entrega' && pedido.motoboyCoords && pedido.motoboyCoords.naLoja) return jsonResponse({ ok: true, aguardandoSaida: true });
    if (etapa === ins.ultimoAviso) return jsonResponse({ ok: true, repetido: true });
    const n = pedido.numeroPedido ? ` #${pedido.numeroPedido}` : '';
    const varejo = loja && loja.layoutVitrine === 'varejo';
    const textos = {
      preparo: [`Pedido${n} aceito!`, varejo ? 'A loja já está separando seus produtos.' : 'A loja já está preparando seu pedido.'],
      entrega: [`Pedido${n} saiu para entrega 🛵`, 'Toque para ver a moto no mapa.'],
      chegou: ['O entregador está chegando! 🏁', 'Fique de olho no portão ou no interfone.'],
      concluido: [pedido.tipoEntrega === 'retirada' ? `Pedido${n} retirado ✅` : `Pedido${n} entregue ✅`, 'Obrigado! Toque para avaliar com 1 toque.'],
      cancelado: [`Pedido${n} cancelado`, pedido.motivoCancelamento ? `Motivo: ${pedido.motivoCancelamento}` : 'Fale com a loja se precisar.'],
      ocorrencia: [`Pedido${n}: houve um problema`, 'A loja vai entrar em contato com você.']
    };
    if (!textos[etapa]) return jsonResponse({ ok: true, ignorado: true });
    const origem = new URL(request.url).origin;
    const slug = /^[a-z0-9-]{2,40}$/.test(ins.slug || '') ? ins.slug : '';
    const status = await enviarPush(env, ins, { title: `${(loja && loja.nome) || 'Seu pedido'}: ${textos[etapa][0]}`, body: textos[etapa][1], url: `/${slug}/pedido/${pedidoId}`, tag: `pedido-${pedidoId}`, icon: `/${slug}/icone.svg` }, origem);
    if (status === 404 || status === 410 || ['concluido', 'cancelado', 'ocorrencia'].includes(etapa)) await fs.apagar([caminhoPush]);
    else await fs.atualizar(caminhoPush, { ultimoAviso: etapa });
    return jsonResponse({ ok: status >= 200 && status < 300, status });
  } catch (err) {
    if (err instanceof ErroPedido) return jsonResponse({ erro: err.message }, err.status);
    console.error('notificarCliente', err && err.stack || err);
    return jsonResponse({ erro: 'Falhou.' }, 500);
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
// Igual ao app (js/frete.js): modo temporário vale até a data "ate"; depois volta ao modo padrão
function modoOperacaoAtual(loja, agora = Date.now()) {
  const m = loja && loja.modoOperacao;
  const ate = m && m.ate ? Date.parse(m.ate) : null;
  if (m && ['completo', 'retirada', 'propria'].includes(m.modo) && (!ate || ate > agora)) return m.modo;
  return ['completo', 'retirada', 'propria'].includes(loja && loja.modoPadrao) ? loja.modoPadrao : 'completo';
}

function coordsValidas(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}
const paraMinFrete = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
function dentroDoHorario(inicio, fim, loja, data = new Date()) {
  const a = paraMinFrete(inicio), b = paraMinFrete(fim);
  if (a === null || b === null || a === b) return false;
  const { min } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  return b > a ? (min >= a && min < b) : (min >= a || min < b);
}
function pontoNaArea(p, pontos) {
  if (!Array.isArray(pontos) || pontos.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i], b = pontos[j];
    if (((a.lat > p.lat) !== (b.lat > p.lat)) && (p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng)) dentro = !dentro;
  }
  return dentro;
}
function areaBloqueada(loja, destino, data = new Date()) {
  const areas = (loja && loja.frete && Array.isArray(loja.frete.areas)) ? loja.frete.areas : [];
  return areas.find(a => pontoNaArea(destino, a.pontos) && (a.sempre || dentroDoHorario(a.inicio, a.fim, loja, data))) || null;
}
function adicionaisAgora(loja, data = new Date()) {
  const f = (loja && loja.frete) || {};
  let centavos = 0;
  const textos = [];
  if (f.adicionalAtivo && Number(f.adicionalCentavos) > 0) { centavos += Number(f.adicionalCentavos); textos.push(f.adicionalTexto || 'Adicional'); }
  if (f.noturnoAtivo && Number(f.noturnoCentavos) > 0 && dentroDoHorario(f.noturnoInicio, f.noturnoFim, loja, data)) { centavos += Number(f.noturnoCentavos); textos.push('Adicional noturno'); }
  return { centavos, texto: textos.length ? textos.join(' + ') : null };
}
// Nome do item no pedido: igual a nomeNoPedido() de js/cardapio.js
function nomeNoPedido(prod) {
  const sub = String(prod.subcategoriaNome || '').trim();
  const nome = String(prod.nome || '');
  return sub && !nome.toLowerCase().includes(sub.toLowerCase()) ? `${nome} (${sub})` : nome;
}

// MESMA conta de js/frete.js (se mudar lá, mude aqui)
// Valor da entrega para uma distância (sem adicionais). Modos:
//  'fixo'      = mesmo valor para qualquer endereço da área
//  'distancia' = taxa base com X km incluídos + R$ por km a mais (padrão das lojas antigas)
//  'faixas'    = tabela "até N km = R$ X"
//  'gratis'    = sem taxa
function valorFreteKm(f, km) {
  const modo = f.modo || 'distancia';
  if (modo === 'gratis') return 0;
  if (modo === 'fixo') return Number(f.fixoCentavos) || 0;
  if (modo === 'faixas') {
    const faixas = (Array.isArray(f.faixas) ? f.faixas : []).filter(x => Number(x.ateKm) > 0).sort((a, b) => Number(a.ateKm) - Number(b.ateKm));
    if (!faixas.length) return 0;
    const fx = faixas.find(x => km <= Number(x.ateKm)) || faixas[faixas.length - 1];
    return Number(fx.centavos) || 0;
  }
  const excedente = Math.max(0, km - (Number(f.kmInclusos) || 0));
  // arredonda o valor por km para cima, de 50 em 50 centavos
  return (Number(f.baseCentavos) || 0) + Math.ceil((excedente * (Number(f.porKmCentavos) || 0)) / 50) * 50;
}
function calcularFrete(loja, destino, data = new Date(), subtotalCentavos = 0) {
  const f = loja && loja.frete;
  const origem = loja && loja.localizacao;
  if (!f || !coordsValidas(origem)) return { configurado: false, freteCentavos: 0 };
  if (!coordsValidas(destino)) return { configurado: true, precisaLocal: true };
  const km = distanciaRetaKm(origem, destino) * FATOR_RUAS;
  const distanciaKm = Math.round(km * 10) / 10;
  if (Number(f.raioMaxKm) > 0 && km > Number(f.raioMaxKm)) return { configurado: true, fora: true, distanciaKm };
  const area = areaBloqueada(loja, destino, data);
  if (area) return { configurado: true, bloqueado: true, distanciaKm, area: { nome: area.nome || 'esta região', sempre: !!area.sempre, inicio: area.inicio, fim: area.fim } };
  const gratisAcima = Number(f.gratisAcimaCentavos) || 0;
  if (gratisAcima > 0 && Number(subtotalCentavos) >= gratisAcima) return { configurado: true, freteCentavos: 0, distanciaKm, adicional: null, gratisPorValor: true };
  let freteCentavos = valorFreteKm(f, km);
  const extra = adicionaisAgora(loja, data);
  freteCentavos += extra.centavos;
  return { configurado: true, freteCentavos, distanciaKm, adicional: extra.texto };
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
    // Soma valores em campos numéricos (atômico) e grava outros campos junto. Cria o documento se não existir.
    // Retorna os valores DEPOIS da soma: { campo: novoValor }.
    async incrementar(caminho, somas, dados = {}) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ writes: [{
          update: { name: `${base}/${caminho}`, fields: paraCampos(dados) },
          updateMask: { fieldPaths: Object.keys(dados) },
          updateTransforms: Object.entries(somas).map(([c, n]) => ({ fieldPath: c, increment: paraValor(n) }))
        }] })
      });
      if (!resp.ok) throw new Error(`Firestore increment ${caminho}: ${resp.status} ${await resp.text()}`);
      const r = await resp.json();
      const valores = ((r.writeResults && r.writeResults[0] && r.writeResults[0].transformResults) || []).map(deValor);
      return Object.fromEntries(Object.keys(somas).map((c, i) => [c, Number(valores[i]) || 0]));
    },
    // Atualiza campos de vários documentos existentes (até 400 por envio)
    async atualizarVarios(lista) {
      for (let i = 0; i < lista.length; i += 400) {
        const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
          method: 'POST',
          headers: await cabecalhos(),
          body: JSON.stringify({ writes: lista.slice(i, i + 400).map(it => ({ update: { name: `${base}/${it.caminho}`, fields: paraCampos(it.dados) }, updateMask: { fieldPaths: Object.keys(it.dados) }, currentDocument: { exists: true } })) })
        });
        if (!resp.ok) throw new Error(`Firestore commit: ${resp.status} ${await resp.text()}`);
      }
    },
    // Acrescenta itens numa lista do documento (como arrayUnion), sem reescrever o que já está lá
    async adicionarNaLista(caminho, campo, itens) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ writes: [{ transform: { document: `${base}/${caminho}`, fieldTransforms: [{ fieldPath: campo, appendMissingElements: { values: itens.map(paraValor) } }] }, currentDocument: { exists: true } }] })
      });
      if (!resp.ok) throw new Error(`Firestore lista ${caminho}: ${resp.status} ${await resp.text()}`);
    },
    // Lê com a "versão" do documento (para gravar só se ninguém mexeu antes)
    async lerComVersao(caminho) {
      const resp = await fetch(`${url}/${caminho}`, { headers: await cabecalhos() });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`Firestore GET ${caminho}: ${resp.status} ${await resp.text()}`);
      const d = await resp.json();
      return { dados: deCampos(d.fields || {}), versao: d.updateTime };
    },
    async atualizarSeVersao(caminho, dados, versao) {
      const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ writes: [{ update: { name: `${base}/${caminho}`, fields: paraCampos(dados) }, updateMask: { fieldPaths: Object.keys(dados) }, currentDocument: { updateTime: versao } }] })
      });
      if (resp.ok) return true;
      const texto = await resp.text();
      if (resp.status === 409 || /FAILED_PRECONDITION/.test(texto)) return false;
      throw new Error(`Firestore commit ${caminho}: ${resp.status} ${texto}`);
    },
    // Documentos de uma subcoleção com campo == valor (índice simples, automático)
    async consultarIgual(pai, colecao, campo, valor, limite = 20) {
      const resp = await fetch(`${url}/${pai}:runQuery`, {
        method: 'POST',
        headers: await cabecalhos(),
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: colecao }], where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: paraValor(valor) } }, limit: limite } })
      });
      if (!resp.ok) throw new Error(`Firestore query ${colecao}: ${resp.status} ${await resp.text()}`);
      return (await resp.json()).filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), ...deCampos(r.document.fields || {}) }));
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
const SLUGS_RESERVADOS = new Set(['api', 'master', 'admin', 'painel', 'motoboy', 'pedido', 'js', 'css', 'sw', 'www', 'app', 'login', 'entrar', 'cadastro', 'suporte', 'ajuda', 'termos', 'privacidade', 'manifest', 'fotos', 'publico', 'demo']);

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
    if (corpo.aceiteTermos !== VERSAO_TERMOS) throw new ErroPedido('Para criar a loja, aceite os Termos de Uso e a Política de Privacidade.');
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
          corPrimaria: '#ea1d2c', tempoEstimado: corpo.tipo === 'varejo' ? '1-2 dias' : '30-45 min',
          layoutVitrine: corpo.tipo === 'varejo' ? 'varejo' : 'gastronomia',
          plano: 'teste', trialAte, ativo: true, origemParceiro: String(corpo.parceiroRef || '').slice(0, 40) || null,
          termosVersao: VERSAO_TERMOS, termosAceitoEm: new Date(), termosAceitoPor: uid
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
          lojaId: String(s.lojaId),
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
    .replace(/<link rel="manifest"[^>]*>/, `<link rel="manifest" href="/${slug}/manifest.webmanifest${/^\/[^/]+\/pedido\/[A-Za-z0-9_]{8,100}$/.test(url.pathname) ? `?pedido=${url.pathname.split('/')[3]}` : ''}" id="pwa-manifest" />`)
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="/${slug}/icone.svg" type="image/svg+xml" id="pwa-icone" />${pub.logoUrl ? `\n  <link rel="apple-touch-icon" href="${escAttr(pub.logoUrl)}" />` : ''}`)
    .replace('</head>', `${pub.lojaId ? `  <meta name="loja-id" content="${escAttr(pub.lojaId)}" data-slug="${escAttr(slug)}" />\n` : ''}  <meta property="og:url" content="${escAttr(url.origin + '/' + slug)}" />
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
      const fsCfg = await firestore(env);
      const [c, mp] = await Promise.all([fsCfg.ler('config/saas'), fsCfg.ler('config/mercadopago')]);
      if (c) dados = {
        whatsappSuporte: c.whatsappSuporte || null,
        precoEssencialCentavos: Number(c.precoEssencialCentavos) || null,
        precoProCentavos: Number(c.precoProCentavos) || null,
        comissaoMarketplacePct: Number(c.comissaoMarketplacePct) || 20,
        responsavelNome: c.responsavelNome || null,
        responsavelDoc: c.responsavelDoc || null,
        emailContato: c.emailContato || null
      };
      dados.pagamentoOnline = Boolean(mp && mp.token && env.MP_CHAVE);
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
        id: l.id, nome: l.nome || l.id, slug: l.slug || null, plano: l.plano || null, demo: l.demo === true, ramo: l.ramo || null,
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

    if (corpo.acao === 'eu') return jsonResponse({ ok: true }); // usado pelo simulador de rota (/demo)

    // Fotos dos modelos (Unsplash, chave no secret UNSPLASH_ACCESS_KEY). Guardadas em config/fotosModelos.
    if (corpo.acao === 'lerFotos') {
      const doc = await fs.ler('config/fotosModelos');
      return jsonResponse({ temChave: Boolean(env.UNSPLASH_ACCESS_KEY), fotos: (doc && doc.fotos) || {} });
    }
    if (corpo.acao === 'buscarFotos') {
      if (!env.UNSPLASH_ACCESS_KEY) throw new ErroPedido('Falta a chave do Unsplash no Cloudflare (UNSPLASH_ACCESS_KEY).', 400);
      const termos = (Array.isArray(corpo.termos) ? corpo.termos : []).map(t => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 60)).filter(Boolean).slice(0, 40);
      const atual = (await fs.ler('config/fotosModelos')) || {};
      const fotos = atual.fotos || {};
      let feitas = 0, limite = false, erro = null;
      for (const termo of termos) {
        if (fotos[termo]) continue;
        const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(termo)}&per_page=3&orientation=squarish&content_filter=high`, {
          headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' }
        });
        if (r.status === 401) { erro = 'A chave do Unsplash foi recusada. Confira se colou a "Chave de acesso" (Access Key).'; break; }
        if (r.status === 403 || r.status === 429) { limite = true; break; }
        if (!r.ok) continue;
        const d = await r.json();
        const f = d.results && d.results[0];
        if (f && f.urls && f.urls.raw) {
          fotos[termo] = { raw: f.urls.raw, autor: (f.user && f.user.name) || '', link: (f.user && f.user.links && f.user.links.html) || '', download: (f.links && f.links.download_location) || '' };
          feitas++;
        } else fotos[termo] = { raw: '', vazio: true };
        if (r.headers.get('X-Ratelimit-Remaining') === '0') { limite = true; break; }
      }
      if (feitas || termos.length) await fs.gravarJuntos([{ caminho: 'config/fotosModelos', dados: { fotos, atualizadoEm: new Date() } }]);
      if (erro) throw new ErroPedido(erro, 400);
      return jsonResponse({ ok: true, feitas, limite, total: Object.values(fotos).filter(x => x.raw).length });
    }

    // "Vitrine pronta": o Master cria a loja do cliente ANTES da visita, com o visual do ramo.
    // O Master fica como dono provisório (pode montar cardápio, logo, cores) até transferir.
    if (corpo.acao === 'criarLojaDemo') {
      const nome = String(corpo.nome || '').trim().slice(0, 60);
      const slug = String(corpo.slug || '').toLowerCase();
      const whatsapp = String(corpo.whatsapp || '').replace(/\D/g, '').slice(0, 13);
      const cor = /^#[0-9a-f]{6}$/i.test(corpo.cor || '') ? corpo.cor : '#ea1d2c';
      const ramo = String(corpo.ramo || '').replace(/[^a-z]/g, '').slice(0, 20) || null;
      if (nome.length < 2) throw new ErroPedido('Informe o nome da loja.');
      if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug) || SLUGS_RESERVADOS.has(slug)) throw new ErroPedido('Endereço inválido ou reservado. Use letras, números e traço.');
      if (await fs.ler(`slugs/${slug}`)) throw new ErroPedido('Esse endereço já está em uso. Escolha outro.', 409);
      const lojaId = 'l_' + [...crypto.getRandomValues(new Uint8Array(10))].map(b => b.toString(16).padStart(2, '0')).join('');
      const ok = await fs.gravarJuntos([
        { caminho: `slugs/${slug}`, dados: { lojaId, ativo: true }, novo: true },
        { caminho: `lojas/${lojaId}`, novo: true, horaServidor: ['criadoEm'], dados: {
          nome, slug, donoUid: usuario.sub, whatsapp: whatsapp || null, corPrimaria: cor,
          tempoEstimado: String(corpo.tempo || '30-45 min').slice(0, 20),
          descricao: String(corpo.descricao || '').slice(0, 160) || null,
          layoutVitrine: corpo.layout === 'varejo' ? 'varejo' : 'gastronomia',
          ramo, demo: true, ativo: true, plano: 'teste', trialAte: new Date(Date.now() + 30 * DIA_MS), origemParceiro: 'master',
          bannerUrl: /^https:\/\/images\.unsplash\.com\/\S+$/.test(corpo.bannerUrl || '') ? corpo.bannerUrl : null,
          logoUrl: /^https:\/\/images\.unsplash\.com\/\S+$/.test(corpo.logoUrl || '') ? corpo.logoUrl : null
        } },
        { caminho: `lojas/${lojaId}/equipe/${usuario.sub}`, dados: { papel: 'dono', nome: 'Master (demonstração)', email: usuario.email || null } }
      ]);
      if (!ok) throw new ErroPedido('Esse endereço acabou de ser usado. Escolha outro.', 409);
      // Regra do Unsplash: avisar quando uma foto é usada (endpoint de "download")
      if (env.UNSPLASH_ACCESS_KEY && Array.isArray(corpo.downloads)) {
        const urls = [...new Set(corpo.downloads.map(String))].filter(u => /^https:\/\/api\.unsplash\.com\/photos\/[A-Za-z0-9_-]+\/download(\?\S*)?$/.test(u)).slice(0, 30);
        await Promise.all(urls.map(u => fetch(u, { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } }).catch(() => null)));
      }
      return jsonResponse({ ok: true, lojaId, slug });
    }

    // Coloca capa e logo (fotos do Unsplash) numa loja de demonstração que já existe
    if (corpo.acao === 'fotosLojaDemo') {
      const lojaId = String(corpo.lojaId || '');
      if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
      const loja = await fs.ler(`lojas/${lojaId}`);
      if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
      if (!loja.demo) throw new ErroPedido('Só dá para colocar as fotos de exemplo em lojas de demonstração.');
      const unsplash = (u) => /^https:\/\/images\.unsplash\.com\/\S+$/.test(u || '');
      const mudar = {};
      if (unsplash(corpo.bannerUrl) && (!loja.bannerUrl || unsplash(loja.bannerUrl))) mudar.bannerUrl = corpo.bannerUrl;
      if (unsplash(corpo.logoUrl) && (!loja.logoUrl || unsplash(loja.logoUrl))) mudar.logoUrl = corpo.logoUrl;
      if (Object.keys(mudar).length) await fs.atualizar(`lojas/${lojaId}`, mudar);
      if (env.UNSPLASH_ACCESS_KEY && Array.isArray(corpo.downloads)) {
        const urls = [...new Set(corpo.downloads.map(String))].filter(u => /^https:\/\/api\.unsplash\.com\/photos\/[A-Za-z0-9_-]+\/download(\?\S*)?$/.test(u)).slice(0, 30);
        await Promise.all(urls.map(u => fetch(u, { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } }).catch(() => null)));
      }
      cacheLojas.clear();
      return jsonResponse({ ok: true, capa: Boolean(mudar.bannerUrl), logo: Boolean(mudar.logoUrl) });
    }

    // Exclui uma loja de vez: cardápio, pedidos, equipe, endereço e fotos. Não tem volta.
    // Para confirmar, o Master digita o endereço (slug) da loja.
    if (corpo.acao === 'excluirLoja') {
      const lojaId = String(corpo.lojaId || '');
      if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
      const loja = await fs.ler(`lojas/${lojaId}`);
      if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
      let slug = loja.slug || null;
      if (!slug) { const s = (await fs.listar('slugs')).find(x => x.lojaId === lojaId); if (s) slug = s.id; }
      const confirmar = String(corpo.confirmar || '').trim().toLowerCase();
      if (confirmar !== String(slug || loja.nome || '').toLowerCase()) throw new ErroPedido('Confirmação não confere. Digite exatamente o endereço da loja.');
      const caminhos = [];
      const pessoas = new Set();
      for (const sub of ['equipe', 'entregadores', 'pedidos', 'publico', 'turnos', 'segredos', 'carrinhos', 'pushPedidos']) {
        const docs = await fs.listar(`lojas/${lojaId}/${sub}`);
        docs.forEach(d => { caminhos.push(`lojas/${lojaId}/${sub}/${d.id}`); if (sub === 'equipe' || sub === 'entregadores') pessoas.add(d.id); });
      }
      // Perfil de quem trabalhava só nesta loja deixa de apontar para ela
      for (const uid of pessoas) {
        if (uid === usuario.sub) continue;
        const perfil = await fs.ler(`usuarios/${uid}`);
        if (perfil && perfil.lojaId === lojaId) caminhos.push(`usuarios/${uid}`);
      }
      if (slug) caminhos.push(`slugs/${slug}`);
      caminhos.push(`lojas/${lojaId}`);
      for (let i = 0; i < caminhos.length; i += 400) await fs.apagar(caminhos.slice(i, i + 400));
      // Fotos enviadas pela loja (KV)
      if (env.FOTOS) {
        try {
          let cursor;
          for (let i = 0; i < 10; i++) {
            const lista = await env.FOTOS.list({ prefix: `${lojaId}/`, cursor });
            await Promise.all(lista.keys.map(k => env.FOTOS.delete(k.name)));
            if (lista.list_complete) break;
            cursor = lista.cursor;
          }
        } catch (_) {}
      }
      cacheLojas.clear();
      return jsonResponse({ ok: true, apagados: caminhos.length });
    }

    // Entrega a loja de demonstração ao cliente: cria (ou usa) o login dele, passa a ser o dono
    // e o teste grátis de 7 dias começa agora. O Master sai da equipe da loja.
    if (corpo.acao === 'transferirLoja') {
      const lojaId = String(corpo.lojaId || '');
      if (!/^[A-Za-z0-9_-]{2,60}$/.test(lojaId)) throw new ErroPedido('Loja inválida.');
      const email = String(corpo.email || '').trim().toLowerCase();
      const nomeDono = String(corpo.nomeDono || '').trim().slice(0, 60) || 'Dono';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroPedido('E-mail do cliente inválido.');
      const loja = await fs.ler(`lojas/${lojaId}`);
      if (!loja) throw new ErroPedido('Loja não encontrada.', 404);
      if (!loja.demo) throw new ErroPedido('Esta loja já pertence a um cliente.');
      let uid = await fs.buscarLoginPorEmail(email);
      let senhaProvisoria = null;
      if (!uid) {
        const letras = 'abcdefghjkmnpqrstuvwxyz23456789';
        senhaProvisoria = [...crypto.getRandomValues(new Uint8Array(8))].map(b => letras[b % letras.length]).join('');
        uid = await fs.criarLogin(email, senhaProvisoria, nomeDono);
        if (!uid) throw new ErroPedido('Não foi possível criar o login. Tente de novo.');
      }
      if (uid === usuario.sub) throw new ErroPedido('Use o e-mail do cliente, não o seu.');
      const perfil = await fs.ler(`usuarios/${uid}`);
      const itens = [
        { caminho: `lojas/${lojaId}/equipe/${uid}`, dados: { papel: 'dono', nome: nomeDono, email } }
      ];
      // Perfil do cliente aponta para esta loja (se ele ainda não tiver outra)
      if (!perfil || !perfil.lojaId) itens.push({ caminho: `usuarios/${uid}`, horaServidor: ['criadoEm'], dados: { nome: nomeDono, email, lojaId, slug: loja.slug || null, roles: ['balcao', 'cliente'] } });
      await fs.gravarJuntos(itens);
      await fs.atualizar(`lojas/${lojaId}`, { donoUid: uid, demo: false, plano: 'teste', trialAte: new Date(Date.now() + 7 * DIA_MS), transferidaEm: new Date() });
      if (usuario.sub !== uid) await fs.apagar([`lojas/${lojaId}/equipe/${usuario.sub}`]);
      cacheLojas.clear();
      return jsonResponse({ ok: true, email, senhaProvisoria, jaTinhaLogin: !senhaProvisoria, slug: loja.slug || null });
    }

    // Mercado Pago do DONO do SaaS (recebe as mensalidades das lojas)
    if (corpo.acao === 'mpStatus') {
      const seg = await fs.ler('config/mercadopago');
      return jsonResponse({ conectado: Boolean(seg && seg.token), conta: (seg && seg.conta) || null });
    }
    if (corpo.acao === 'mpDesligar') {
      await fs.apagar(['config/mercadopago']);
      configSaasCache = { dados: null, expira: 0 };
      return jsonResponse({ ok: true });
    }
    if (corpo.acao === 'mpSalvar') {
      if (!env.MP_CHAVE) throw new ErroPedido('Indisponível no momento.', 503);
      const { token, conta, mpUserId } = await validarTokenMP(corpo.token);
      await fs.gravarJuntos([{ caminho: 'config/mercadopago', dados: { token: await cifrarTexto(env, token), conta, mpUserId, atualizadoEm: new Date() } }]);
      configSaasCache = { dados: null, expira: 0 };
      return jsonResponse({ ok: true, conta });
    }
    if (corpo.acao === 'cobrancas') {
      const lista = (await fs.listar('cobrancasSaas')).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''))).slice(0, 50);
      return jsonResponse({ cobrancas: lista.map(c => ({ id: c.id, lojaId: c.lojaId, lojaNome: c.lojaNome || null, plano: c.plano, valorCentavos: c.valorCentavos, status: c.status, criadoEm: c.criadoEm || null, pagoEm: c.pagoEm || null })) });
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
        comissaoMarketplacePct: Math.min(50, Math.max(0, Number(c.comissaoMarketplacePct) || 0)),
        responsavelNome: String(c.responsavelNome || '').trim().slice(0, 100) || null,
        responsavelDoc: String(c.responsavelDoc || '').replace(/[^0-9./-]/g, '').slice(0, 20) || null,
        emailContato: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c.emailContato || '').trim()) ? String(c.emailContato).trim().slice(0, 100) : null
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
