import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { avisarCliente, carimbarPedido } from './notificar.js';
import { validarCercaEntrega, criarMapaRastreamento, criarMarcadorMoto, calcularDistanciaMetros, criarLinhaRota } from './geo.js';
import {
  collection, query, where, onSnapshot, doc, runTransaction, updateDoc, serverTimestamp
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
const MAX_ENTREGAS_ROTA = 4;
let mapaMotoboy = null;
let marcadorMoto = null;
let linhaRotaMoto = null;

const OFFLINE_QUEUE_KEY = 'motoboy_offline_actions_v1';

export function iniciarMotoboy() {
  const root = document.getElementById('app-root');
  const user = auth.currentUser;

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
        <span style="font-size:12px; color:var(--text-muted); display:block;">Fundo de Troco Ativo</span>
        <strong id="carteira-troco-valor" style="color:var(--primary); font-size:16px;">R$ 0,00</strong>
      </div>
    </div>

    <!-- Container da Entrega Ativa (Visível apenas quando há rota assumida) -->
    <div id="box-entrega-ativa" class="hidden"></div>

    <!-- Fila de Pedidos Prontos Disponíveis na Loja -->
    <div id="box-fila-disponivel">
      <h3 style="margin: 12px 0 8px;">📦 Entregas Disponíveis para Retirada</h3>
      <div id="lista-entregas-disponiveis"></div>
    </div>
  `;

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
  const idsAtuais = [...ordemRota].sort().join(',');
  if (ids !== idsAtuais) {
    const restantes = [...lista];
    const nova = [];
    let ponto = ultimaPosicao || AppState.lojaDados.localizacao || null;
    while (restantes.length) {
      let melhor = 0;
      if (ponto) {
        let menor = Infinity;
        restantes.forEach((p, i) => {
          const dist = p.destinoCoords ? calcularDistanciaMetros(ponto.lat, ponto.lng, p.destinoCoords.lat, p.destinoCoords.lng) : Infinity;
          if (dist < menor) { menor = dist; melhor = i; }
        });
      }
      const [escolhido] = restantes.splice(melhor, 1);
      nova.push(escolhido.id);
      if (escolhido.destinoCoords) ponto = escolhido.destinoCoords;
    }
    ordemRota = nova;
  }
  return ordemRota.map(id => lista.find(p => p.id === id)).filter(Boolean);
}

// 1. Telemetria GPS Adaptativa (8s em movimento / 30s parado) + WakeLock
async function iniciarTelemetriaGPS(motoboyUid) {
  if ('wakeLock' in navigator) {
    try { wakeLockMotoboy = await navigator.wakeLock.request('screen'); } catch (_) {}
  }

  if (!('geolocation' in navigator)) {
    showToast('GPS não suportado neste aparelho.');
    return;
  }

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
}

// 2. Escuta Entregas Prontas e Entrega Ativa do Próprio Motoboy (LGPD)
function escutarEntregas(motoboyUid) {
  const q = query(
    collection(db, 'lojas', AppState.lojaId, 'pedidos'),
    where('status', 'in', ['preparo', 'entrega'])
  );

  onSnapshot(q, (snapshot) => {
    const disponiveis = [];
    const minhas = [];
    let trocoTotalCentavos = 0;

    snapshot.forEach((docSnap) => {
      const p = { id: docSnap.id, ...docSnap.data() };
      if (p.status === 'entrega' && p.motoboyId === motoboyUid) {
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

    const trocoEl = document.getElementById('carteira-troco-valor');
    if (trocoEl) trocoEl.textContent = formatarCentavos(trocoTotalCentavos);

    // Só redesenha a tela se mudou algo além do GPS (senão o mapa piscaria a cada 8 s)
    const assinatura = JSON.stringify([minhasEntregas.map(p => [p.id, p.status, p.enderecoTexto, p.totalCentavos]), disponiveis.map(p => p.id)]);
    if (assinatura === assinaturaTela) return;
    assinaturaTela = assinatura;
    renderizarEntregaAtiva(pedidoEmRotaAtual, motoboyUid);
    renderizarFilaDisponivel(disponiveis, motoboyUid, minhasEntregas.length >= MAX_ENTREGAS_ROTA);
  }, (err) => {
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
  // Waze direto no ponto marcado pelo cliente (coordenadas, não o nome da rua)
  const wazeUrl = pedido.destinoCoords
    ? `https://waze.com/ul?ll=${destinoCoords.lat},${destinoCoords.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(pedido.enderecoTexto)}&navigate=yes`;
  const ep = pedido.enderecoPartes || null;
  const zapCliente = String(pedido.clienteWhatsapp || '').replace(/\D/g, '');

  box.innerHTML = `
    <div class="card" style="border: 2px solid var(--primary);">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="badge">EM ROTA AGORA</span>
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
        <p style="font-size:15px; margin:4px 0;"><strong>📍 ${esc(ep.rua)}${ep.numero ? `, ${esc(ep.numero)}` : ''}</strong></p>
        ${ep.compl ? `<p class="mb-referencia">🏠 <strong>${esc(ep.compl)}</strong></p>` : ''}
        ${ep.apelido ? `<p class="gc-dica" style="margin:2px 0;">Endereço salvo como: ${esc(ep.apelido)}</p>` : ''}`
        : `<p style="font-size:14px; color:var(--text-muted); margin:4px 0;"><strong>Endereço:</strong> ${esc(pedido.enderecoTexto)}</p>`}
      ${pedido.pinoManual ? `<div class="mb-alerta-pino">⚠ O cliente ajustou o pino no mapa à mão. Confira a referência${zapCliente ? ` ou <a href="https://wa.me/55${esc(zapCliente.replace(/^55/, ''))}" target="_blank" rel="noopener">chame no WhatsApp</a>` : ''} se não achar.</div>` : ''}
      ${!pedido.destinoCoords && pedido.tipoEntrega === 'entrega' ? '<div class="mb-alerta-pino">⚠ Sem pino no mapa: o GPS vai pelo nome da rua. Confira a referência.</div>' : ''}
      <p style="font-size:14px;"><strong>Cobrar:</strong> ${formatarCentavos(pedido.totalCentavos)} (${esc((pedido.formaPagamento || '').toUpperCase())})</p>

      <div style="margin:10px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
        <strong>Conferência de Itens:</strong>
        ${(pedido.itens || []).map(i => `<div>• ${esc(i.quantidade)}x ${esc(i.nome)}</div>`).join('')}
      </div>

      <!-- Mapa Leaflet ao Vivo -->
      <div id="mapa-motoboy" style="height:220px; border-radius:8px; margin:10px 0; z-index:1;"></div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:10px;">
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="btn-outline-sm" style="text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center;">
          🧭 Google Maps
        </a>
        <a href="${wazeUrl}" target="_blank" rel="noopener" class="btn-outline-sm" style="text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center;">
          🚗 Waze
        </a>
      </div>
      <button id="btn-concluir-entrega" class="btn-primary" style="margin-top:8px;">✅ Confirmar Entrega</button>

      <button id="btn-ocorrencia-entrega" class="btn-outline-sm" style="width:100%; margin-top:8px; color:var(--danger); border-color:var(--danger);">
        ⚠️ Reportar Problema / Cliente Ausente
      </button>
    </div>
    ${proximas.length ? `
      <div class="card rota-proximas">
        <strong>🗺 Próximas na rota (${proximas.length})</strong>
        <p class="gc-dica">Cada cliente vê só quantas entregas vêm antes da dele.</p>
        ${proximas.map((p, i) => `
          <div class="rota-item">
            <div><strong>${i + 2}º · #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong><small>${esc(p.enderecoTexto)}</small></div>
            <button class="btn-outline-sm" type="button" data-primeiro="${esc(p.id)}">Fazer agora</button>
          </div>`).join('')}
      </div>` : ''}
  `;
  box.querySelectorAll('[data-primeiro]').forEach(b => {
    b.onclick = () => {
      ordemRota = [b.dataset.primeiro, ...ordemRota.filter(id => id !== b.dataset.primeiro)];
      minhasEntregas = ordemRota.map(id => minhasEntregas.find(p => p.id === id)).filter(Boolean);
      pedidoEmRotaAtual = minhasEntregas[0];
      assinaturaTela = '';
      renderizarEntregaAtiva(pedidoEmRotaAtual, motoboyUid);
      if (ultimaPosicao) enviarPosicaoParaRota(ultimaPosicao);
    };
  });

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

  document.getElementById('btn-concluir-entrega').onclick = () => tentarFinalizarEntrega(pedido, 'concluido');
  document.getElementById('btn-ocorrencia-entrega').onclick = () => tentarFinalizarEntrega(pedido, 'ocorrencia');
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

  if (!navigator.onLine) {
    salvarAcaoOffline({ lojaId: AppState.lojaId, pedidoId: pedido.id, payload });
    showToast('Sem internet: entrega salva na fila e será sincronizada ao reconectar!');
    return;
  }

  try {
    await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', pedido.id), {
      ...payload,
      entregueEm: serverTimestamp()
    });
    avisarCliente(pedido.id);
    if (tipoAcao === 'concluido') carimbarPedido(pedido.id);
    showToast(tipoAcao === 'concluido' ? 'Entrega concluída com sucesso!' : 'Ocorrência registrada no balcão.');
  } catch (err) {
    salvarAcaoOffline({ lojaId: AppState.lojaId, pedidoId: pedido.id, payload });
    showToast('Oscilação de rede: baixa enfileirada para envio automático.');
  }
}

function renderizarFilaDisponivel(pedidos, motoboyUid, bloqueadoPorRotaAtiva) {
  const lista = document.getElementById('lista-entregas-disponiveis');
  if (!pedidos.length) {
    lista.innerHTML = `<div class="card"><p style="color:var(--text-muted);">Nenhuma entrega aguardando retirada no momento.</p></div>`;
    return;
  }

  lista.innerHTML = pedidos.map(p => `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div>
        <strong>Pedido #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
        <p style="font-size:13px; color:var(--text-muted);">${esc(p.enderecoTexto)}</p>
        <span style="font-size:13px; font-weight:600;">${formatarCentavos(p.totalCentavos)} • ${esc((p.formaPagamento || '').toUpperCase())}</span>
      </div>
      <button class="btn-primary" style="width:auto;" ${bloqueadoPorRotaAtiva ? 'disabled' : ''} data-assumir="${p.id}">
        ${bloqueadoPorRotaAtiva ? `Rota cheia (${MAX_ENTREGAS_ROTA})` : minhasEntregas.length ? '+ Levar também' : 'Pegar Entrega'}
      </button>
    </div>
  `).join('');

  lista.querySelectorAll('button[data-assumir]').forEach(btn => {
    btn.onclick = async () => {
      const texto = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ Reservando...';
      const ok = await assumirEntregaAtomica(btn.dataset.assumir, motoboyUid);
      if (!ok && document.body.contains(btn)) { btn.disabled = false; btn.textContent = texto; }
    };
  });
}

// 5. Persistência Local (Offline Queue)
function salvarAcaoOffline(item) {
  const fila = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  fila.push(item);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(fila));
}

async function sincronizarFilaOffline() {
  if (!navigator.onLine) return;
  const fila = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  if (!fila.length) return;

  const restantes = [];
  for (const item of fila) {
    try {
      await updateDoc(doc(db, 'lojas', item.lojaId, 'pedidos', item.pedidoId), item.payload);
      if (item.payload && item.payload.status === 'concluido') carimbarPedido(item.pedidoId, item.lojaId);
    } catch (_) {
      restantes.push(item);
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(restantes));
  if (restantes.length === 0) showToast('Entregas offline sincronizadas com o servidor!');
}
