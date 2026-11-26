import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { avisarCliente, carimbarPedido } from './notificar.js';
import { calcularRepasse } from './frete.js';
import { validarCercaEntrega, criarMapaRastreamento, criarMarcadorMoto, calcularDistanciaMetros, criarLinhaRota } from './geo.js';
import {
  collection, query, where, onSnapshot, doc, runTransaction, updateDoc, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let watchId = null;
let ultimaPosicao = null;
let ultimoEnvioTimestamp = 0;
let wakeLockMotoboy = null;
let pedidoEmRotaAtual = null;
let minhasEntregas = [];      // entregas deste motoboy, na ordem da rota (a primeira é a atual)
let ordemRota = [];           // ids na ordem escolhida (mantida enquanto o conjunto não muda)
const chegadaAvisada = new Set();
let assinaturaTela = '';
const MAX_ENTREGAS_ROTA = 3;
let mapaMotoboy = null;
let marcadorMoto = null;
let linhaRotaMoto = null;

const OFFLINE_QUEUE_KEY = 'motoboy_offline_actions_v1';
const CHAVE_ORDEM = () => `motoboy_ordem_${AppState.lojaId}`;
const CHAVE_VIAGEM = () => `motoboy_viagem_${AppState.lojaId}`;
const LIMITE_DESVIO_M = 2500;   // pedido extra que desvia mais que isso fica para outro entregador
const SLA_URGENTE_MS = 35 * 60 * 1000; // pedido esperando há 35+ min passa na frente se estiver quase no caminho
const FOLGA_URGENTE_M = 1500;
let ligarGps = null;            // liga o GPS (fica desligado quando não há entrega, para poupar bateria)
let ultimoAtualId = null;
let ultimoSnap = null;          // última leitura da fila (para redesenhar na hora após baixa sem sinal)
let qtdRotaAnterior = 0;
const baixasGuardadas = () => new Set(lerJson(OFFLINE_QUEUE_KEY, []).map(i => i.pedidoId));
const lerJson = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? padrao; } catch (_) { return padrao; } };
const gravarJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const pago = (p) => p.pagamentoStatus === 'aprovado';
const FORMA = { dinheiro: 'Dinheiro', cartao_entrega: 'Cartão (maquininha)', cartao: 'Cartão (maquininha)', pix: 'Pix' };

export function iniciarMotoboy() {
  const root = document.getElementById('app-root');
  const user = auth.currentUser;
  aplicarContrasteRua();
  setInterval(aplicarContrasteRua, 10 * 60000);

  if (!user) {
    root.innerHTML = `<div class="card"><h3>Acesso Restrito</h3><p>Faça login com sua conta de entregador para acessar a fila.</p></div>`;
    return;
  }

  root.innerHTML = `
    <!-- Resumo do Turno e Carteira de Troco -->
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div>
        <strong>🛵 Painel do Entregador — ${AppState.lojaDados.nome}</strong>
        <div id="gps-status-badge" style="font-size:13px; color:var(--warning);">📡 Aguardando ativação do GPS...</div>
      </div>
      <div style="text-align:right;">
        <span style="font-size:12px; color:var(--text-muted); display:block;">Troco para levar agora</span>
        <strong id="carteira-troco-valor" style="color:var(--primary); font-size:16px;">R$ 0,00</strong>
      </div>
    </div>

    <!-- Duas abas grandes: o que pegar / a rota que está fazendo -->
    <nav class="mb-abas" id="mb-abas">
      <button type="button" class="ativa" data-aba="fila">📦 Disponíveis <b id="mb-cont-fila">0</b></button>
      <button type="button" data-aba="rota">🛵 Minha rota <b id="mb-cont-rota">0</b></button>
    </nav>
    <div id="mb-sem-sinal" class="mb-sem-sinal hidden"></div>

    <div data-painel="fila">
      <!-- Placar de ganhos do turno -->
      <div id="mb-placar" class="card mb-placar"><p class="gc-dica">Carregando seus ganhos...</p></div>
      <!-- Fila de Pedidos Prontos Disponíveis na Loja -->
      <div id="box-fila-disponivel">
        <div id="lista-entregas-disponiveis"></div>
      </div>
    </div>

    <div data-painel="rota" class="hidden">
      <!-- Container da Entrega Ativa (Visível apenas quando há rota assumida) -->
      <div id="box-entrega-ativa" class="hidden"></div>
      <div id="mb-rota-vazia" class="card"><p style="color:var(--text-muted);">Nenhuma entrega na sua mão. Pegue uma na aba 📦 Disponíveis.</p></div>
    </div>
  `;
  document.querySelectorAll('#mb-abas [data-aba]').forEach(b => { b.onclick = () => mostrarAbaMotoboy(b.dataset.aba); });
  avisarBaixasGuardadas();
  setInterval(sincronizarFilaOffline, 30000); // o "online" do celular nem sempre avisa quando o sinal volta

  carregarExtrato();
  setInterval(carregarExtrato, 3 * 60 * 1000);
  sincronizarFilaOffline();
  window.addEventListener('online', sincronizarFilaOffline);

  iniciarTelemetriaGPS(user.uid);
  escutarEntregas(user.uid);
}

// Posição vai para TODAS as entregas da rota. Cada cliente recebe só quantas entregas vêm
// antes da dele ("antes"), nunca os endereços dos outros. A 50 m do destino, para de transmitir
// para aquele cliente e avisa "chegando" (privacidade).
async function enviarPosicaoParaRota(coords) {
  await Promise.all(minhasEntregas.map(async (p, indice) => {
    const d = p.destinoCoords;
    const chegou = d && calcularDistanciaMetros(d.lat, d.lng, coords.lat, coords.lng) <= 50;
    if (chegou && chegadaAvisada.has(p.id)) return;
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
        // Entregas depois da primeira: o cliente NÃO vê onde a moto está (ela pode estar na rua de outro
        // cliente); vê só "parada no caminho". O mapa dele liga quando a entrega dele vira a atual.
        motoboyCoords: chegou ? { chegou: true } : indice === 0 ? { ...coords, antes: 0 } : { antes: indice },
        gpsAtualizadoEm: serverTimestamp()
      });
      if (chegou) { chegadaAvisada.add(p.id); avisarCliente(p.id); }
    } catch (_) {}
  }));
}

// Ordem da rota: sempre a entrega mais próxima de onde a moto está (a partir da loja no começo)
function ordenarRota(lista) {
  const ids = lista.map(p => p.id).sort().join(',');
  if (!ordemRota.length) { const salva = lerJson(CHAVE_ORDEM(), []); if (Array.isArray(salva)) ordemRota = salva; } // ordem manual sobrevive a recarregar
  const idsAtuais = [...ordemRota].sort().join(',');
  if (ids !== idsAtuais) {
    const restantes = [...lista];
    const nova = [];
    let ponto = ultimaPosicao || AppState.lojaDados.localizacao || null;
    while (restantes.length) {
      let melhor = 0;
      if (ponto) {
        let menor = Infinity;
        const dists = restantes.map(p => (p.destinoCoords ? calcularDistanciaMetros(ponto.lat, ponto.lng, p.destinoCoords.lat, p.destinoCoords.lng) : Infinity));
        dists.forEach((d, i) => { if (d < menor) { menor = d; melhor = i; } });
        // Urgência: pedido esperando há 35+ min passa na frente se estiver até 1,5 km "fora" do mais perto
        let maisAntigo = -1, tempoAntigo = 0;
        restantes.forEach((p, i) => {
          const espera = Date.now() - (p.criadoEm && p.criadoEm.toMillis ? p.criadoEm.toMillis() : Date.now());
          if (espera >= SLA_URGENTE_MS && dists[i] - menor <= FOLGA_URGENTE_M && espera > tempoAntigo) { tempoAntigo = espera; maisAntigo = i; }
        });
        if (maisAntigo >= 0) melhor = maisAntigo;
      }
      const [escolhido] = restantes.splice(melhor, 1);
      nova.push(escolhido.id);
      if (escolhido.destinoCoords) ponto = escolhido.destinoCoords;
    }
    ordemRota = nova;
    gravarJson(CHAVE_ORDEM(), ordemRota);
  }
  return ordemRota.map(id => lista.find(p => p.id === id)).filter(Boolean);
}

// Distância (linha reta) de uma rota: loja → paradas na ordem. Serve para medir o desvio de um pedido extra.
function custoRota(paradas) {
  let ponto = AppState.lojaDados.localizacao || ultimaPosicao;
  if (!ponto) return 0;
  let total = 0;
  for (const p of paradas) {
    if (!p.destinoCoords) continue;
    total += calcularDistanciaMetros(ponto.lat, ponto.lng, p.destinoCoords.lat, p.destinoCoords.lng);
    ponto = p.destinoCoords;
  }
  return total;
}
// Melhor custo inserindo o pedido novo em qualquer posição da rota atual
function desvioDoPedido(novo) {
  if (!novo.destinoCoords || !minhasEntregas.length) return 0;
  const base = custoRota(minhasEntregas);
  let melhor = Infinity;
  for (let i = 0; i <= minhasEntregas.length; i++) {
    const r = [...minhasEntregas.slice(0, i), novo, ...minhasEntregas.slice(i)];
    melhor = Math.min(melhor, custoRota(r) - base);
  }
  return melhor;
}

function mudarOrdem(novaOrdem, motoboyUid) {
  ordemRota = novaOrdem;
  gravarJson(CHAVE_ORDEM(), ordemRota);
  minhasEntregas = ordemRota.map(id => minhasEntregas.find(p => p.id === id)).filter(Boolean);
  pedidoEmRotaAtual = minhasEntregas[0] || null;
  assinaturaTela = '';
  renderizarEntregaAtiva(pedidoEmRotaAtual, motoboyUid);
  if (ultimaPosicao) enviarPosicaoParaRota(ultimaPosicao); // os clientes veem a nova ordem na hora
}

// 1. Telemetria GPS Adaptativa (8s em movimento / 30s parado) + WakeLock
async function telaAcesa(ligar) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (ligar && (!wakeLockMotoboy || wakeLockMotoboy.released) && document.visibilityState === 'visible') wakeLockMotoboy = await navigator.wakeLock.request('screen');
    else if (!ligar && wakeLockMotoboy && !wakeLockMotoboy.released) { await wakeLockMotoboy.release(); wakeLockMotoboy = null; }
  } catch (_) {}
}

async function iniciarTelemetriaGPS(motoboyUid) {
  telaAcesa(minhasEntregas.length > 0);

  if (!('geolocation' in navigator)) {
    showToast('GPS não suportado neste aparelho.');
    return;
  }

  ligarGps = () => {
  if (watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, speed, accuracy } = pos.coords;
      const agora = Date.now();
      const coords = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy || 0) };

      // Frequência adaptativa: 8s se velocidade > 1 m/s (~3.6 km/h), senão 30s
      const emMovimento = (speed !== null && speed > 1.0) ||
        (ultimaPosicao && calcularDistanciaMetros(ultimaPosicao.lat, ultimaPosicao.lng, latitude, longitude) > 15);
      const intervaloMinimo = emMovimento ? 8000 : 30000;

      const statusEl = document.getElementById('gps-status-badge');
      if (statusEl) {
        statusEl.textContent = `🟢 GPS Ativo (Precisão: ${coords.accuracy}m • ${emMovimento ? '8s' : '30s'})`;
        statusEl.style.color = 'var(--success)';
      }

      if (mapaMotoboy && marcadorMoto && pedidoEmRotaAtual && pedidoEmRotaAtual.destinoCoords) {
        if (!linhaRotaMoto) linhaRotaMoto = criarLinhaRota(mapaMotoboy); // GPS chegou depois do mapa
        linhaRotaMoto.acompanhar(coords, pedidoEmRotaAtual.destinoCoords, marcadorMoto, 1500); // moto anda pela linha azul
      } else if (marcadorMoto) marcadorMoto.moverSuavemente(coords, 1500);

      if (agora - ultimoEnvioTimestamp >= intervaloMinimo) {
        ultimoEnvioTimestamp = agora;
        ultimaPosicao = coords;
        atualizarCerca();

        // Atualiza posição apenas no pedido ativo para privacidade e economia
        if (navigator.onLine) enviarPosicaoParaRota(coords);
      }
    },
    (err) => {
      const statusEl = document.getElementById('gps-status-badge');
      if (statusEl) {
        statusEl.textContent = '🔴 Erro ao obter GPS. Verifique as permissões de localização.';
        statusEl.style.color = 'var(--danger)';
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
  };
  if (minhasEntregas.length) ligarGps();
  else { const b = document.getElementById('gps-status-badge'); if (b) { b.textContent = '⏸ GPS em pausa (sem entrega na mão). Liga sozinho quando você pegar uma.'; b.style.color = 'var(--text-muted)'; } }
  // Ao voltar do Google Maps/Waze o navegador pode ter pausado o GPS: lê uma posição nova na hora
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !minhasEntregas.length) return;
    telaAcesa(true); // o celular solta a tela acesa ao sair do app: pede de novo
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) };
      ultimaPosicao = c; ultimoEnvioTimestamp = Date.now();
      if (navigator.onLine) enviarPosicaoParaRota(c);
      atualizarCerca();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  });
}

// Sem entrega na mão: desliga o GPS (bateria). Com entrega: liga.
function ajustarGps() {
  if (!('geolocation' in navigator)) return;
  const badge = document.getElementById('gps-status-badge');
  telaAcesa(minhasEntregas.length > 0);
  if (minhasEntregas.length) { if (watchId === null && ligarGps) ligarGps(); return; }
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (badge) { badge.textContent = '⏸ GPS em pausa (sem entrega na mão). Liga sozinho quando você pegar uma.'; badge.style.color = 'var(--text-muted)'; }
  }
}

// Mostra a distância até o cliente da vez e deixa o botão verde quando está dentro da cerca
function atualizarCerca() {
  const el = document.getElementById('mb-distancia');
  const btn = document.getElementById('btn-concluir-entrega');
  const p = pedidoEmRotaAtual;
  if (!el || !btn || !p || !p.destinoCoords || !ultimaPosicao) return;
  const raio = p.tipoLocal === 'condominio' || p.tipoLocal === 'rural' ? 150 : 100;
  const v = validarCercaEntrega(ultimaPosicao, p.destinoCoords, raio);
  el.textContent = v.permitido ? `📍 Você chegou (${v.distanciaMetros} m do pino).` : `📍 Faltam ${v.distanciaMetros >= 1000 ? (v.distanciaMetros / 1000).toFixed(1).replace('.', ',') + ' km' : v.distanciaMetros + ' m'} até o cliente.`;
  btn.classList.toggle('mb-na-cerca', v.permitido);
}

function mostrarAbaMotoboy(aba) {
  document.querySelectorAll('#mb-abas [data-aba]').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  document.querySelectorAll('[data-painel]').forEach(p => p.classList.toggle('hidden', p.dataset.painel !== aba));
  if (aba === 'rota' && mapaMotoboy) setTimeout(() => mapaMotoboy.invalidateSize(), 50);
}
function atualizarAbasMotoboy(qtdDisponiveis) {
  const cf = document.getElementById('mb-cont-fila'); if (cf) cf.textContent = qtdDisponiveis;
  const cr = document.getElementById('mb-cont-rota'); if (cr) cr.textContent = minhasEntregas.length;
  const vazia = document.getElementById('mb-rota-vazia'); if (vazia) vazia.classList.toggle('hidden', minhasEntregas.length > 0);
  // Pegou entrega: vai direto para a rota. Terminou tudo: volta para as disponíveis
  if (minhasEntregas.length > qtdRotaAnterior) mostrarAbaMotoboy('rota');
  else if (!minhasEntregas.length && qtdRotaAnterior) mostrarAbaMotoboy('fila');
  qtdRotaAnterior = minhasEntregas.length;
}
function avisarBaixasGuardadas() {
  const el = document.getElementById('mb-sem-sinal');
  if (!el) return;
  const n = lerJson(OFFLINE_QUEUE_KEY, []).length;
  el.classList.toggle('hidden', !n);
  el.textContent = n ? `📤 ${n} baixa(s) guardada(s) no celular. Envia sozinho quando o sinal voltar — pode seguir viagem.` : '';
}

// 2. Escuta Entregas Prontas e Entrega Ativa do Próprio Motoboy (LGPD)
function processarEntregas(motoboyUid) {
    if (!ultimoSnap) return;
    const guardadas = baixasGuardadas();
    const disponiveis = [];
    const minhas = [];
    let trocoTotalCentavos = 0;

    ultimoSnap.forEach((docSnap) => {
      const p = { id: docSnap.id, ...docSnap.data() };
      if (p.status === 'entrega' && p.motoboyId === motoboyUid) {
        if (guardadas.has(p.id)) return; // baixa feita sem sinal: já saiu da rota (sincroniza depois)
        minhas.push(p);
        if (p.formaPagamento === 'dinheiro' && p.trocoParaCentavos > p.totalCentavos) {
          trocoTotalCentavos += (p.trocoParaCentavos - p.totalCentavos);
        }
      } else if (!p.motoboyId && p.status === 'preparo' && p.tipoEntrega !== 'retirada') {
        disponiveis.push(p);
      }
    });

    minhasEntregas = ordenarRota(minhas);
    pedidoEmRotaAtual = minhasEntregas[0] || null;
    AppState.entregaAtiva = Boolean(pedidoEmRotaAtual);
    ajustarGps();
    // Parada anterior concluída: o próximo cliente já passa a ver a moto (sem esperar o próximo ciclo do GPS)
    const atualId = pedidoEmRotaAtual ? pedidoEmRotaAtual.id : null;
    if (atualId !== ultimoAtualId) { ultimoAtualId = atualId; if (atualId && ultimaPosicao && navigator.onLine) enviarPosicaoParaRota(ultimaPosicao); }

    const trocoEl = document.getElementById('carteira-troco-valor');
    if (trocoEl) trocoEl.textContent = formatarCentavos(trocoTotalCentavos);

    // Só redesenha a tela se mudou algo além do GPS (senão o mapa piscaria a cada 8 s)
    const assinatura = JSON.stringify([minhasEntregas.map(p => [p.id, p.status, p.enderecoTexto, p.totalCentavos]), disponiveis.map(p => p.id)]);
    atualizarAbasMotoboy(disponiveis.length);
    if (assinatura === assinaturaTela) return;
    assinaturaTela = assinatura;
    renderizarEntregaAtiva(pedidoEmRotaAtual, motoboyUid);
    renderizarFilaDisponivel(disponiveis, motoboyUid, minhasEntregas.length >= MAX_ENTREGAS_ROTA);
}

function escutarEntregas(motoboyUid) {
  const q = query(
    collection(db, 'lojas', AppState.lojaId, 'pedidos'),
    where('status', 'in', ['preparo', 'entrega'])
  );

  onSnapshot(q, (snapshot) => { ultimoSnap = snapshot; processarEntregas(motoboyUid); }, (err) => {
    console.error(err);
    document.getElementById('lista-entregas-disponiveis').innerHTML = err.code === 'permission-denied'
      ? '<div class="card">🔒 Sua conta não está cadastrada como entregador desta loja.</div>'
      : '<div class="card">Erro ao carregar entregas.</div>';
  });
}

// 3. Transação Atômica para Assumir Entrega sem Concorrência
// Reservar exige internet confirmada pelo servidor (nunca fica na fila offline): sem resposta em 8 s,
// o pedido continua disponível e o motoboy é avisado para não sair com a bag.
async function assumirEntregaAtomica(pedidoId, motoboyUid) {
  const pedidoRef = doc(db, 'lojas', AppState.lojaId, 'pedidos', pedidoId);
  if (!navigator.onLine) { showToast('📵 Sem internet para reservar a entrega. Conecte antes de sair com o pedido.', 6000); return false; }
  let tempoEsgotado = null;
  let tx = null;
  try {
    const limite = new Promise((_, rej) => { tempoEsgotado = setTimeout(() => rej(new Error('SEM_SINAL')), 8000); });
    tx = runTransaction(db, async (transaction) => {
      const snap = await transaction.get(pedidoRef);
      if (!snap.exists()) throw new Error('Pedido não encontrado.');
      const dados = snap.data();

      if (dados.motoboyId) {
        throw new Error('Outro entregador acabou de assumir este pedido!');
      }

      transaction.update(pedidoRef, {
        motoboyId: motoboyUid,
        status: 'entrega',
        saiuParaEntregaEm: serverTimestamp(),
        motoboyCoords: ultimaPosicao || null
      });
    });
    await Promise.race([limite, tx]);
    clearTimeout(tempoEsgotado);
    avisarCliente(pedidoId);
    showToast('Entrega assumida! Boa viagem 🛵');
    return true;
  } catch (err) {
    clearTimeout(tempoEsgotado);
    if (err && err.message === 'SEM_SINAL') {
      showToast('📵 Sinal fraco: a reserva não foi confirmada. NÃO saia com a bag; tente de novo ou peça ao balcão para atribuir a entrega a você.', 8000);
      // Se a internet voltar e a reserva passar, avisa (a entrega aparece em "Em rota")
      if (tx) tx.then(() => { avisarCliente(pedidoId); showToast('✅ Conexão voltou: a entrega foi reservada para você.', 6000); }).catch(() => {});
    }
    else if (err && /assumir este pedido/.test(err.message)) showToast('Ops! Outro entregador acabou de assumir este pedido.', 5000);
    else showToast((err && err.message) || 'Não foi possível assumir a entrega.');
    return false;
  }
}

function renderizarEntregaAtiva(pedido, motoboyUid) {
  const box = document.getElementById('box-entrega-ativa');
  if (!pedido) {
    box.classList.add('hidden');
    box.innerHTML = '';
    mapaMotoboy = null;
    marcadorMoto = null;
    linhaRotaMoto = null;
    return;
  }

  box.classList.remove('hidden');
  box.classList.toggle('mb-piloto', !lerJson('motoboy_detalhes', false)); // Modo Piloto: só o essencial
  mapaMotoboy = null; // o HTML é recriado abaixo, então o mapa também
  marcadorMoto = null;
  linhaRotaMoto = null;
  const proximas = minhasEntregas.slice(1);
  const trocoNecessario = (pedido.formaPagamento === 'dinheiro' && pedido.trocoParaCentavos > pedido.totalCentavos)
    ? pedido.trocoParaCentavos - pedido.totalCentavos
    : 0;

  const destinoCoords = pedido.destinoCoords || { lat: -23.325, lng: -46.721 }; // Fallback se sem pino
  const mapsUrl = pedido.destinoCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${destinoCoords.lat},${destinoCoords.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.enderecoTexto)}`;
  // Waze direto no ponto marcado pelo cliente (coordenadas, não o nome da rua), modo moto
  const wazeUrl = pedido.destinoCoords
    ? `https://waze.com/ul?ll=${destinoCoords.lat},${destinoCoords.lng}&navigate=yes&vehicle_type=motorcycle`
    : `https://waze.com/ul?q=${encodeURIComponent(pedido.enderecoTexto)}&navigate=yes`;
  // Rota completa (todas as paradas na ordem) no Google Maps, modo moto
  const comPino = minhasEntregas.filter(p => p.destinoCoords);
  const rotaCompletaUrl = comPino.length > 1
    ? `https://www.google.com/maps/dir/?api=1&travelmode=two-wheeler&destination=${comPino.at(-1).destinoCoords.lat},${comPino.at(-1).destinoCoords.lng}&waypoints=${encodeURIComponent(comPino.slice(0, -1).map(p => `${p.destinoCoords.lat},${p.destinoCoords.lng}`).join('|'))}`
    : null;
  // Resumo da bag: o que cobrar em cada parada e o que já está pago
  const aCobrar = minhasEntregas.filter(p => !pago(p) && p.formaPagamento !== 'pix');
  const totalCobrar = aCobrar.reduce((a, p) => a + (Number(p.totalCentavos) || 0), 0);
  const trocoBag = minhasEntregas.reduce((a, p) => a + (p.formaPagamento === 'dinheiro' && p.trocoParaCentavos > p.totalCentavos ? p.trocoParaCentavos - p.totalCentavos : 0), 0);
  const linhaCobranca = (p) => pago(p) ? '<span class="mb-pago">✅ Já pago</span>'
    : p.formaPagamento === 'pix' ? '<span class="mb-cobrar">Pix: confirme com a loja</span>'
    : `<span class="mb-cobrar">💵 Cobrar ${formatarCentavos(p.totalCentavos)} · ${esc(FORMA[p.formaPagamento] || p.formaPagamento || '')}</span>`;
  const ep = pedido.enderecoPartes || null;
  const zapCliente = String(pedido.clienteWhatsapp || '').replace(/\D/g, '');
  // Quem recebe (se for outra pessoa com telefone) é quem o entregador chama na porta
  const zapContato = String(pedido.recebedorWhats || pedido.clienteWhatsapp || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

  box.innerHTML = `
    ${minhasEntregas.length > 1 ? `
      <div class="card mb-bag mb-detalhe">
        <strong>🎒 Sua bag: ${minhasEntregas.length} entregas</strong>
        ${minhasEntregas.map((p, i) => `<div class="mb-bag-linha"><span>${i + 1}ª · #${esc(p.numeroPedido || p.id.slice(0, 4))} ${esc(String(p.clienteNome || '').split(/\s+/)[0])}${p.criadoEm && p.criadoEm.toMillis && Date.now() - p.criadoEm.toMillis() >= SLA_URGENTE_MS ? ` <span class="mb-cobrar">⏰ ${Math.round((Date.now() - p.criadoEm.toMillis()) / 60000)} min</span>` : ''}</span>${linhaCobranca(p)}</div>`).join('')}
        <div class="mb-bag-total"><span>Total a cobrar na rua</span><strong>${formatarCentavos(totalCobrar)}</strong></div>
        ${trocoBag ? `<div class="mb-bag-total"><span>Troco para levar</span><strong>${formatarCentavos(trocoBag)}</strong></div>` : ''}
        ${rotaCompletaUrl ? `<a class="btn-primary" style="text-decoration:none; text-align:center; display:block; margin-top:8px;" href="${rotaCompletaUrl}" target="_blank" rel="noopener">🧭 Abrir rota completa no Google Maps (${comPino.length} paradas)</a>` : ''}
      </div>` : ''}
    <div class="card mb-ativo" style="border: 2px solid var(--primary);">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="badge">${minhasEntregas.length > 1 ? `1ª PARADA DE ${minhasEntregas.length}` : 'EM ROTA AGORA'}</span>
        <strong>Pedido #${esc(pedido.numeroPedido || pedido.id.slice(0, 4))}</strong>
      </div>

      ${trocoNecessario > 0 ? `
        <div style="background:#fef3c7; color:#92400e; padding:10px; border-radius:8px; margin:10px 0; font-weight:700; text-align:center;">
          💵 LEVAR ${formatarCentavos(trocoNecessario)} DE TROCO
        </div>
      ` : ''}

      <p style="margin-top:8px;"><strong>Cliente:</strong> ${esc(pedido.clienteNome)}${pedido.clienteVip ? ' <span class="badge-vip">⭐ VIP</span>' : ''}</p>
      ${pedido.recebedorNome ? `<div class="mb-recebedor">👤 Quem recebe: <strong>${esc(pedido.recebedorNome)}</strong>${pedido.recebedorWhats ? ` · <a href="https://wa.me/55${esc(String(pedido.recebedorWhats).replace(/^55/, ''))}" target="_blank" rel="noopener">💬 chamar</a>` : ''}</div>` : ''}
      ${pedido.tipoLocal === 'condominio' ? '<div class="mb-alerta-pino">🏢 Condomínio: entregue na portaria se não puder subir.</div>' : pedido.tipoLocal === 'rural' ? '<div class="mb-alerta-pino">🌳 Sítio / área rural: siga o pino; a referência ajuda na entrada.</div>' : ''}
      ${ep && ep.rua ? `
        ${ep.bairro ? `<p class="mb-bairro">${esc(ep.bairro.toUpperCase())}</p>` : ''}
        <p class="mb-endereco"><strong>📍 ${esc(ep.rua)}${ep.numero ? `, ${esc(ep.numero)}` : ''}</strong></p>
        ${ep.compl ? `<p class="mb-referencia">🏠 <strong>${esc(ep.compl)}</strong></p>` : ''}
        ${ep.apelido ? `<p class="gc-dica" style="margin:2px 0;">Endereço salvo como: ${esc(ep.apelido)}</p>` : ''}`
        : `<p class="mb-endereco"><strong>📍 ${esc(pedido.enderecoTexto)}</strong></p>`}
      ${pedido.pinoManual ? `<div class="mb-alerta-pino">⚠ O cliente ajustou o pino no mapa à mão. Confira a referência${zapCliente ? ` ou <a href="https://wa.me/55${esc(zapCliente.replace(/^55/, ''))}" target="_blank" rel="noopener">chame no WhatsApp</a>` : ''} se não achar.</div>` : ''}
      ${!pedido.destinoCoords && pedido.tipoEntrega === 'entrega' ? '<div class="mb-alerta-pino">⚠ Sem pino no mapa: o GPS vai pelo nome da rua. Confira a referência.</div>' : ''}
      ${pago(pedido) ? '<div class="mb-selo-pago">✅ PAGO ONLINE <small>não cobrar nada</small></div>' : `<p class="mb-valor">${linhaCobranca(pedido)}</p>`}

      <div class="mb-detalhe" style="margin:10px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
        <strong>Conferência de Itens:</strong>
        ${(pedido.itens || []).map(i => `<div>• ${esc(i.quantidade)}x ${esc(i.nome)}</div>`).join('')}
      </div>

      <!-- Mapa Leaflet ao Vivo -->
      <div id="mapa-motoboy" class="mb-detalhe" style="height:220px; border-radius:8px; margin:10px 0; z-index:1;"></div>

      <p class="mb-distancia" id="mb-distancia">${pedido.destinoCoords ? '📍 Calculando a distância até o cliente...' : ''}</p>
      <div class="mb-atalhos">
        <a href="${wazeUrl}" target="_blank" rel="noopener">🗺️<span>Rota (Waze)</span></a>
        ${zapContato ? `<a href="https://wa.me/55${esc(zapContato)}?text=${encodeURIComponent(`Olá, sou o entregador da ${AppState.lojaDados.nome || 'loja'} e cheguei no seu endereço!`)}" target="_blank" rel="noopener">💬<span>WhatsApp</span></a>
        <a href="tel:+55${esc(zapContato)}">📞<span>Ligar</span></a>` : '<span class="mb-atalho-off">💬<span>Sem telefone</span></span><span class="mb-atalho-off">📞<span>Sem telefone</span></span>'}
      </div>
      <a class="mb-maps" href="${mapsUrl}" target="_blank" rel="noopener">ou abrir no Google Maps</a>
      <div id="btn-concluir-entrega" class="mb-deslizar" role="slider" aria-label="Deslize para confirmar a entrega" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
        <span class="mb-deslizar-texto">Deslize para confirmar entrega →</span>
        <span class="mb-deslizar-bola">✅</span>
      </div>
      <button id="btn-detalhes" class="btn-outline-sm mb-btn-detalhes" type="button">☰ Detalhes: mapa, itens, cliente não atende</button>
      ${proximas.length ? '<button id="btn-pular-entrega" class="btn-outline-sm mb-detalhe" type="button" style="width:100%; margin-top:8px;">⏭️ Cliente não atende — ir para a próxima e voltar depois</button>' : ''}

      <button id="btn-ocorrencia-entrega" class="btn-outline-sm mb-detalhe" style="width:100%; margin-top:8px; color:var(--danger); border-color:var(--danger);">
        ⚠️ Reportar Problema / Cliente Ausente
      </button>
    </div>
    ${proximas.length ? `
      <div class="card rota-proximas mb-detalhe">
        <strong>🗺 Próximas na rota (${proximas.length})</strong>
        <p class="gc-dica">Cada cliente vê só quantas entregas vêm antes da dele.</p>
        <p class="gc-dica">A ordem é a sugerida pelo app (mais perto primeiro). Conhece um caminho melhor? Use as setas.</p>
        ${proximas.map((p, i) => `
          <div class="rota-item">
            <div><strong>${i + 2}ª · #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong><small>${esc(p.enderecoPartes && p.enderecoPartes.bairro ? p.enderecoPartes.bairro + ' · ' : '')}${esc(p.enderecoTexto)}</small>${p.tentativaAusente ? '<small class="mb-cobrar">⏭️ cliente não atendeu antes</small>' : ''}</div>
            <div class="rota-setas">
              <button class="btn-outline-sm" type="button" data-subir="${esc(p.id)}" aria-label="Entregar antes">⬆️</button>
              ${i < proximas.length - 1 ? `<button class="btn-outline-sm" type="button" data-descer="${esc(p.id)}" aria-label="Entregar depois">⬇️</button>` : ''}
            </div>
          </div>`).join('')}
      </div>` : ''}
  `;
  const ids = minhasEntregas.map(p => p.id);
  const trocar = (i, j) => { const n = [...ids]; [n[i], n[j]] = [n[j], n[i]]; mudarOrdem(n, motoboyUid); };
  box.querySelectorAll('[data-subir]').forEach(b => { b.onclick = () => { const i = ids.indexOf(b.dataset.subir); if (i > 0) trocar(i, i - 1); }; });
  box.querySelectorAll('[data-descer]').forEach(b => { b.onclick = () => { const i = ids.indexOf(b.dataset.descer); if (i >= 0 && i < ids.length - 1) trocar(i, i + 1); }; });
  // Cliente não atende: registra a tentativa (com o GPS de agora) para o balcão ligar, e manda para o fim da fila
  const btnPular = document.getElementById('btn-pular-entrega');
  if (btnPular) btnPular.onclick = async () => {
    if (!confirm('O cliente não atendeu? O pedido vai para o fim da sua rota e a loja é avisada para ligar para ele.')) return;
    btnPular.disabled = true;
    try {
      const u = auth.currentUser;
      await fetch('/api/entrega/tentativa', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, pedidoId: pedido.id, coords: ultimaPosicao || null }) });
    } catch (_) {}
    mudarOrdem([...ids.filter(id => id !== pedido.id), pedido.id], motoboyUid);
    showToast('⏭️ Indo para a próxima. A loja vai ligar para o cliente.', 5000);
  };
  setTimeout(atualizarCerca, 150);

  setTimeout(() => {
    const mapContainer = document.getElementById('mapa-motoboy');
    if (mapContainer && !mapaMotoboy) {
      const inicio = ultimaPosicao || destinoCoords;
      mapaMotoboy = criarMapaRastreamento('mapa-motoboy', inicio, 15);
      L.marker([destinoCoords.lat, destinoCoords.lng]).addTo(mapaMotoboy).bindPopup('Destino do Cliente');
      marcadorMoto = criarMarcadorMoto(mapaMotoboy, inicio);
      if (pedido.destinoCoords && ultimaPosicao) {
        linhaRotaMoto = criarLinhaRota(mapaMotoboy); // caminho pelas ruas até o cliente
        linhaRotaMoto.acompanhar(ultimaPosicao, pedido.destinoCoords, marcadorMoto, 300);
        mapaMotoboy.fitBounds(L.latLngBounds([[ultimaPosicao.lat, ultimaPosicao.lng], [destinoCoords.lat, destinoCoords.lng]]).pad(0.3));
      }
    }
  }, 100);

  document.getElementById('btn-detalhes').onclick = () => {
    const piloto = box.classList.toggle('mb-piloto');
    gravarJson('motoboy_detalhes', !piloto);
    document.getElementById('btn-detalhes').textContent = piloto ? '☰ Detalhes: mapa, itens, cliente não atende' : '🛵 Voltar ao Modo Piloto';
    if (!piloto && mapaMotoboy) setTimeout(() => mapaMotoboy.invalidateSize(), 50);
  };
  if (!box.classList.contains('mb-piloto')) document.getElementById('btn-detalhes').textContent = '🛵 Voltar ao Modo Piloto';
  ligarDeslizar(document.getElementById('btn-concluir-entrega'), () => tentarFinalizarEntrega(pedido, 'concluido'));
  document.getElementById('btn-ocorrencia-entrega').onclick = () => tentarFinalizarEntrega(pedido, 'ocorrencia');
}

// Botão deslizante: só confirma arrastando a bolinha até o fim (não dá baixa sem querer no bolso/suporte)
function ligarDeslizar(trilho, acao) {
  if (!trilho) return;
  const bola = trilho.querySelector('.mb-deslizar-bola');
  let inicioX = null, max = 0, pos = 0;
  const mover = (x) => {
    pos = Math.max(0, Math.min(max, x));
    bola.style.transform = `translateX(${pos}px)`;
    trilho.style.setProperty('--progresso', `${Math.round((pos / (max || 1)) * 100)}%`);
    trilho.setAttribute('aria-valuenow', String(Math.round((pos / (max || 1)) * 100)));
  };
  const soltar = () => {
    if (inicioX === null) return;
    inicioX = null;
    bola.style.transition = 'transform .2s';
    if (max && pos >= max * 0.85) {
      mover(max);
      try { navigator.vibrate && navigator.vibrate(40); } catch (_) {}
      setTimeout(() => { mover(0); }, 600);
      acao();
    } else mover(0);
  };
  bola.addEventListener('pointerdown', (e) => {
    max = trilho.clientWidth - bola.offsetWidth - 8;
    inicioX = e.clientX - pos;
    bola.style.transition = 'none';
    bola.setPointerCapture(e.pointerId);
  });
  bola.addEventListener('pointermove', (e) => { if (inicioX !== null) mover(e.clientX - inicioX); });
  bola.addEventListener('pointerup', soltar);
  bola.addEventListener('pointercancel', () => { inicioX = null; bola.style.transition = 'transform .2s'; mover(0); });
  // Teclado (acessibilidade): seta para a direita ou Enter confirma
  trilho.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); acao(); } });
}

// Alto contraste: escuro à noite (18h às 6h ou celular no modo escuro), claro e forte de dia (sol)
function aplicarContrasteRua() {
  const h = new Date().getHours();
  const noite = h >= 18 || h < 6 || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('mb-noite', noite);
  document.documentElement.classList.toggle('mb-dia', !noite);
}

// 4. Validação de Cerca de 100m + Justificativa Auditável + Fila Offline
async function tentarFinalizarEntrega(pedido, tipoAcao) {
  let justificativa = '';

  if (pedido.destinoCoords && ultimaPosicao) {
    // Condomínio (portaria) e sítio/rural: tolerância maior para não travar a baixa
    const raio = pedido.tipoLocal === 'condominio' || pedido.tipoLocal === 'rural' ? 150 : 100;
    const validacao = validarCercaEntrega(ultimaPosicao, pedido.destinoCoords, raio);
    if (!validacao.permitido) {
      const motivo = prompt(
        `Você está a ${validacao.distanciaMetros}m do destino (limite: ${validacao.limiteEfetivo}m).\n` +
        `Informe o motivo para concluir à distância (ex: portaria de condomínio, sinal GPS instável):`
      );
      if (!motivo || motivo.trim().length < 5) {
        showToast('Baixa cancelada: informe uma justificativa válida.');
        return;
      }
      justificativa = motivo.trim();
    }
  }

  if (tipoAcao === 'ocorrencia' && !justificativa) {
    const motivoOcorrencia = prompt('Descreva a ocorrência (ex: cliente não atendeu após 10 min, endereço inexistente):');
    if (!motivoOcorrencia || motivoOcorrencia.trim().length < 5) return;
    justificativa = motivoOcorrencia.trim();
  }

  const payload = {
    status: tipoAcao === 'concluido' ? 'concluido' : 'ocorrencia',
    entregueEm: new Date().toISOString(),
    coordsBaixa: ultimaPosicao || null,
    justificativaBaixa: justificativa || null
  };

  // Sem sinal (elevador, zona rural): guarda no celular com hora e GPS, libera a próxima parada e envia depois
  const guardarSemSinal = () => {
    salvarAcaoOffline({ lojaId: AppState.lojaId, pedidoId: pedido.id, payload: { ...payload, coordsBaixa: ultimaPosicao ? { ...ultimaPosicao, semSinal: true, registradoEm: payload.entregueEm } : { semSinal: true, registradoEm: payload.entregueEm } } });
    registrarNaViagem(pedido, tipoAcao);
    avisarBaixasGuardadas();
    assinaturaTela = '';
    if (auth.currentUser) processarEntregas(auth.currentUser.uid);
    aposBaixa(pedido);
    showToast('📤 Sem sinal: baixa guardada no celular com hora e GPS. Siga para a próxima — envia sozinho quando o sinal voltar.', 6000);
  };
  if (!navigator.onLine) { guardarSemSinal(); return; }

  try {
    // Sinal fraco: o envio pode ficar "pendurado". Depois de 8 s, segue viagem e o envio continua por trás
    const gravacao = updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', pedido.id), {
      ...payload,
      entregueEm: serverTimestamp()
    });
    const resultado = await Promise.race([gravacao.then(() => 'ok'), new Promise(r => setTimeout(() => r('lento'), 8000))]);
    if (resultado === 'lento') { guardarSemSinal(); return; }
    avisarCliente(pedido.id);
    if (tipoAcao === 'concluido') carimbarPedido(pedido.id);
    showToast(tipoAcao === 'concluido' ? 'Entrega concluída com sucesso!' : 'Ocorrência registrada no balcão.');
    registrarNaViagem(pedido, tipoAcao);
    aposBaixa(pedido);
    setTimeout(carregarExtrato, 3000);
  } catch (err) {
    guardarSemSinal();
  }
}

function renderizarFilaDisponivel(pedidos, motoboyUid, bloqueadoPorRotaAtiva) {
  const lista = document.getElementById('lista-entregas-disponiveis');
  if (!pedidos.length) {
    lista.innerHTML = `<div class="card"><p style="color:var(--text-muted);">Nenhuma entrega aguardando retirada no momento.</p></div>`;
    return;
  }

  lista.innerHTML = pedidos.map(p => {
    // Pedido extra que desvia muito da rota já assumida fica para outro entregador (o balcão ainda pode forçar)
    const desvio = minhasEntregas.length ? desvioDoPedido(p) : 0;
    const foraDaRota = desvio > LIMITE_DESVIO_M;
    const travado = bloqueadoPorRotaAtiva || foraDaRota || turnoEncerrado;
    return `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div>
        <strong>Pedido #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
        <p style="font-size:13px; color:var(--text-muted);">${esc(p.enderecoPartes && p.enderecoPartes.bairro ? p.enderecoPartes.bairro + ' · ' : '')}${esc(p.enderecoTexto)}</p>
        <span style="font-size:13px; font-weight:600;">${formatarCentavos(p.totalCentavos)} • ${esc((p.formaPagamento || '').toUpperCase())}${pago(p) ? ' · ✅ pago' : ''}</span>
        ${AppState.lojaDados.repasse ? `<small class="mb-ganho">💰 Você ganha ${formatarCentavos(calcularRepasse(AppState.lojaDados.repasse, { ...p, adicionalChuva: p.adicionalChuva }))}${p.adicionalChuva ? ' (com 🌧 adicional)' : ''}</small>` : ''}
        ${minhasEntregas.length && p.destinoCoords ? `<small class="${foraDaRota ? 'mb-cobrar' : 'gc-dica'}" style="display:block;">${foraDaRota ? `Fora da sua rota (+${(desvio / 1000).toFixed(1).replace('.', ',')} km): deixe para outro entregador` : `Desvio de +${(desvio / 1000).toFixed(1).replace('.', ',')} km na sua rota`}</small>` : ''}
      </div>
      <button class="btn-primary" style="width:auto;" ${travado ? 'disabled' : ''} data-assumir="${p.id}">
        ${turnoEncerrado ? 'Turno encerrado' : bloqueadoPorRotaAtiva ? `Rota cheia (${MAX_ENTREGAS_ROTA})` : foraDaRota ? 'Fora da rota' : minhasEntregas.length ? '+ Levar também' : 'Pegar Entrega'}
      </button>
    </div>`;
  }).join('');

  lista.querySelectorAll('button[data-assumir]').forEach(btn => {
    btn.onclick = async () => {
      const texto = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ Reservando...';
      const ok = await assumirEntregaAtomica(btn.dataset.assumir, motoboyUid);
      if (ok) { try { navigator.vibrate && navigator.vibrate(40); } catch (_) {} }
      if (!ok && document.body.contains(btn)) { btn.disabled = false; btn.textContent = texto; }
    };
  });
}

// 5. Persistência Local (Offline Queue)
let sincronizando = false;
function salvarAcaoOffline(item) {
  const fila = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  fila.push(item);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(fila));
}

async function sincronizarFilaOffline() {
  if (!navigator.onLine) return;
  const fila = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  if (!fila.length) return;

  if (sincronizando) return;
  sincronizando = true;
  const restantes = [];
  for (const item of fila) {
    try {
      const dados = { ...item.payload };
      if (typeof dados.entregueEm === 'string') dados.entregueEm = Timestamp.fromDate(new Date(dados.entregueEm)); // hora real da entrega
      await Promise.race([
        updateDoc(doc(db, 'lojas', item.lojaId, 'pedidos', item.pedidoId), dados),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SEM_SINAL')), 15000))
      ]);
      if (item.payload && item.payload.status === 'concluido') carimbarPedido(item.pedidoId, item.lojaId);
      avisarCliente(item.pedidoId);
    } catch (err) {
      // Já baixado (pelo envio que ficou pendurado ou pelo balcão): não tenta de novo para sempre
      if (err && (err.code === 'permission-denied' || err.code === 'not-found')) continue;
      restantes.push(item);
    }
  }
  sincronizando = false;
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(restantes));
  avisarBaixasGuardadas();
  if (restantes.length === 0) { showToast('✅ Baixas guardadas enviadas para a loja!'); setTimeout(carregarExtrato, 2000); }
}


// ===================== Viagem: transição entre paradas e acerto com o caixa =====================
function registrarNaViagem(p, tipoAcao) {
  const v = lerJson(CHAVE_VIAGEM(), []);
  if (!v.some(x => x.id === p.id)) {
    v.push({ id: p.id, numero: p.numeroPedido || p.id.slice(0, 4), nome: String(p.clienteNome || '').split(/\s+/)[0], forma: p.formaPagamento || '', valor: Number(p.totalCentavos) || 0, pago: pago(p), resultado: tipoAcao });
    gravarJson(CHAVE_VIAGEM(), v);
  }
}

function bipe(vezes = 2) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < vezes; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880 + i * 220; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.12);
    }
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch (_) {}
}

function aposBaixa(feito) {
  const restantes = ordemRota.map(id => minhasEntregas.find(p => p.id === id)).filter(p => p && p.id !== feito.id);
  bipe(restantes.length ? 2 : 3);
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay mb-transicao';
  if (restantes.length) {
    const prox = restantes[0];
    const url = prox.destinoCoords
      ? `https://www.google.com/maps/dir/?api=1&travelmode=two-wheeler&destination=${prox.destinoCoords.lat},${prox.destinoCoords.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(prox.enderecoTexto || '')}`;
    overlay.innerHTML = `
      <div class="card mb-transicao-card">
        <p class="mb-transicao-ok">✅ Parada concluída!</p>
        <p>Próxima: <strong>#${esc(prox.numeroPedido || prox.id.slice(0, 4))} · ${esc(String(prox.clienteNome || '').split(/\s+/)[0])}</strong><br/><small>${esc(prox.enderecoPartes && prox.enderecoPartes.bairro ? prox.enderecoPartes.bairro : prox.enderecoTexto || '')}</small></p>
        <a class="btn-primary mb-botao-gigante" href="${url}" target="_blank" rel="noopener" data-ir>🧭 Ir para a próxima parada</a>
        <button class="btn-outline-sm" type="button" data-fechar style="width:100%; margin-top:8px;">Ver no painel</button>
      </div>`;
  } else {
    const v = lerJson(CHAVE_VIAGEM(), []);
    const soma = (f) => v.filter(f).reduce((a, x) => a + x.valor, 0);
    const dinheiro = soma(x => x.resultado === 'concluido' && !x.pago && x.forma === 'dinheiro');
    const cartao = soma(x => x.resultado === 'concluido' && !x.pago && /cartao/.test(x.forma));
    const pixOuPago = soma(x => x.resultado === 'concluido' && (x.pago || x.forma === 'pix'));
    const voltar = v.filter(x => x.resultado !== 'concluido');
    overlay.innerHTML = `
      <div class="card mb-transicao-card">
        <p class="mb-transicao-ok">🏁 Viagem encerrada!</p>
        <strong>Acerto com o caixa</strong>
        <div class="mb-bag-total"><span>💵 Dinheiro recebido</span><strong>${formatarCentavos(dinheiro)}</strong></div>
        <div class="mb-bag-total"><span>💳 Na maquininha</span><strong>${formatarCentavos(cartao)}</strong></div>
        <div class="mb-bag-total"><span>✅ Pix / já pago</span><strong>${formatarCentavos(pixOuPago)}</strong></div>
        ${voltar.length ? `<p class="mb-cobrar" style="margin-top:6px;">⚠ Volte com ${voltar.length} pedido(s) com problema: ${voltar.map(x => '#' + esc(x.numero)).join(', ')}</p>` : ''}
        <div class="gc-dica" style="margin-top:6px;">${v.map(x => `#${esc(x.numero)} ${esc(x.nome)} · ${x.resultado === 'concluido' ? formatarCentavos(x.valor) + ' ' + esc(FORMA[x.forma] || x.forma) + (x.pago ? ' (pago)' : '') : 'ocorrência'}`).join('<br/>')}</div>
        <button class="btn-primary mb-botao-gigante" type="button" data-acertado>👍 Acertado com o caixa</button>
      </div>`;
  }
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-ir]')?.addEventListener('click', () => setTimeout(() => overlay.remove(), 300));
  overlay.querySelector('[data-acertado]')?.addEventListener('click', () => { gravarJson(CHAVE_VIAGEM(), []); overlay.remove(); });
}


// ===================== Placar de ganhos e fechamento do turno =====================
let turnoEncerrado = false;
let extratoAtual = null;
const CHAVE_OLHO = 'motoboy_ocultar_valores';
const ocultar = () => { try { return localStorage.getItem(CHAVE_OLHO) === '1'; } catch (_) { return false; } };
const val = (c) => (ocultar() ? 'R$ •••••' : formatarCentavos(c));

async function chamarTurno(acao) {
  const u = auth.currentUser;
  const r = await fetch('/api/motoboy/turno', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, acao }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível carregar.');
  return d;
}

async function carregarExtrato() {
  if (!auth.currentUser || !navigator.onLine) return;
  try { extratoAtual = await chamarTurno('extrato'); desenharPlacar(); } catch (_) {}
}

function desenharPlacar() {
  const box = document.getElementById('mb-placar');
  const e = extratoAtual;
  if (!box || !e) return;
  const eraEncerrado = turnoEncerrado;
  turnoEncerrado = e.status === 'aguardando_acerto';
  if (eraEncerrado !== turnoEncerrado) assinaturaTela = ''; // redesenha a fila (trava/destrava "Pegar entrega")
  const pct = e.meta ? Math.min(100, Math.round((e.entregas / e.meta) * 100)) : 0;
  box.innerHTML = `
    <div class="mb-placar-topo">
      <div><small>Meu ganho no turno</small><strong>${val(e.receberCentavos)}</strong></div>
      <button class="btn-outline-sm" type="button" data-olho title="Esconder/mostrar valores">${ocultar() ? '👁 Mostrar' : '🙈 Esconder'}</button>
    </div>
    <div class="mb-placar-dados">
      <span>🛵 <strong>${e.entregas}</strong> entrega(s)</span>
      <span>💵 A devolver à loja: <strong>${val(e.devolverCentavos)}</strong></span>
      ${e.chuvaAtiva ? '<span>🌧 Adicional de chuva ligado</span>' : ''}
    </div>
    ${e.meta ? `<div class="mb-meta"><div class="mb-meta-barra"><div style="width:${pct}%"></div></div><small>${e.entregas >= e.meta ? `🎉 Meta batida! Bônus de ${val(e.bonusMetaCentavos)} garantido.` : `${e.entregas} / ${e.meta} entregas · faltam ${e.meta - e.entregas} para o bônus de ${val(e.bonusMetaCentavos)}`}</small></div>` : ''}
    <details class="mb-extrato"><summary>Ver extrato (${e.corridas.length})</summary>
      ${e.corridas.length ? e.corridas.map(c => `<div class="mb-bag-linha"><span>${c.em ? new Date(c.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} · #${esc(c.numero || '')} ${esc(c.bairro || '')}</span><span>${c.cancelado ? '⚠ Cancelado em rota ' : ''}${c.subsidio ? '🎁' : '💵'} +${val(c.repasseCentavos)}${c.chuva ? ' 🌧' : ''}</span></div>`).join('') : '<p class="gc-dica">Nenhuma corrida ainda neste turno.</p>'}
      <p class="gc-dica" style="margin-top:6px;">💵 = taxa de entrega · 🎁 = frete grátis pago pela loja · 🌧 = adicional</p>
    </details>
    ${turnoEncerrado
      ? `<div class="mb-encerrado">🧾 <strong>Turno encerrado.</strong> Aguardando o balcão conferir o acerto.${comprovanteHtml(e)}</div>`
      : '<button class="btn-outline-sm" type="button" data-encerrar style="width:100%; margin-top:8px;">🧾 Encerrar meu turno</button>'}`;
  box.querySelector('[data-olho]').onclick = () => { try { localStorage.setItem(CHAVE_OLHO, ocultar() ? '0' : '1'); } catch (_) {} desenharPlacar(); };
  const enc = box.querySelector('[data-encerrar]');
  if (enc) enc.onclick = async () => {
    if (minhasEntregas.length) { showToast('Conclua as entregas em rota antes de encerrar o turno.', 5000); return; }
    if (!confirm('Encerrar o turno? Você não pega mais entregas até o balcão conferir o acerto.')) return;
    enc.disabled = true;
    try { extratoAtual = await chamarTurno('encerrar'); desenharPlacar(); showToast('Turno encerrado. Passe no balcão para o acerto.', 6000); }
    catch (err) { showToast(err.message, 5000); enc.disabled = false; }
  };
}

function comprovanteHtml(e) {
  const saldo = e.saldoCentavos;
  return `
    <div class="mb-comprovante">
      <div class="mb-bag-total"><span>Diária</span><strong>${formatarCentavos(e.diariaCentavos)}</strong></div>
      <div class="mb-bag-total"><span>Corridas (${e.entregas})</span><strong>${formatarCentavos(e.somaCorridasCentavos)}</strong></div>
      ${e.bonusCentavos ? `<div class="mb-bag-total"><span>Bônus da meta</span><strong>${formatarCentavos(e.bonusCentavos)}</strong></div>` : ''}
      <div class="mb-bag-total"><span><strong>Total a receber</strong></span><strong>${formatarCentavos(e.receberCentavos)}</strong></div>
      <div class="mb-bag-total"><span>Dinheiro recebido dos clientes</span><strong>− ${formatarCentavos(e.dinheiroRecebidoCentavos)}</strong></div>
      ${e.fundoTrocoCentavos ? `<div class="mb-bag-total"><span>Troco inicial da loja</span><strong>− ${formatarCentavos(e.fundoTrocoCentavos)}</strong></div>` : ''}
      <div class="mb-saldo ${saldo >= 0 ? 'positivo' : 'negativo'}">${saldo >= 0 ? `A loja te paga <strong>${formatarCentavos(saldo)}</strong>` : `Você devolve à loja <strong>${formatarCentavos(-saldo)}</strong>`}</div>
    </div>`;
}
