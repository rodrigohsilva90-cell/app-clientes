import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { avisarCliente } from './notificar.js';
import { validarCercaEntrega, criarMapaRastreamento, criarMarcadorMoto, calcularDistanciaMetros } from './geo.js';
import {
  collection, query, where, onSnapshot, doc, runTransaction, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let watchId = null;
let ultimaPosicao = null;
let ultimoEnvioTimestamp = 0;
let wakeLockMotoboy = null;
let pedidoEmRotaAtual = null;
let mapaMotoboy = null;
let marcadorMoto = null;

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

      if (marcadorMoto) marcadorMoto.moverSuavemente(coords, 1500);

      if (agora - ultimoEnvioTimestamp >= intervaloMinimo) {
        ultimoEnvioTimestamp = agora;
        ultimaPosicao = coords;

        // Atualiza posição apenas no pedido ativo para privacidade e economia
        // Privacidade: a menos de 50 m do cliente, para de transmitir e avisa "chegando" (o mapa some na tela dele)
        const destinoAtual = pedidoEmRotaAtual && pedidoEmRotaAtual.destinoCoords;
        const chegou = destinoAtual && calcularDistanciaMetros(destinoAtual.lat, destinoAtual.lng, latitude, longitude) <= 50;
        if (pedidoEmRotaAtual && navigator.onLine && !(chegou && pedidoEmRotaAtual.avisouChegada)) {
          try {
            await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', pedidoEmRotaAtual.id), {
              motoboyCoords: chegou ? { chegou: true } : coords,
              gpsAtualizadoEm: serverTimestamp()
            });
            if (chegou) { pedidoEmRotaAtual.avisouChegada = true; avisarCliente(pedidoEmRotaAtual.id); }
          } catch (_) {}
        }
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
    let minhaEntrega = null;
    let trocoTotalCentavos = 0;

    snapshot.forEach((docSnap) => {
      const p = { id: docSnap.id, ...docSnap.data() };
      if (p.status === 'entrega' && p.motoboyId === motoboyUid) {
        minhaEntrega = p;
        if (p.formaPagamento === 'dinheiro' && p.trocoParaCentavos > p.totalCentavos) {
          trocoTotalCentavos += (p.trocoParaCentavos - p.totalCentavos);
        }
      } else if (!p.motoboyId && p.status === 'preparo' && p.tipoEntrega !== 'retirada') {
        disponiveis.push(p);
      }
    });

    pedidoEmRotaAtual = minhaEntrega;
    AppState.entregaAtiva = Boolean(minhaEntrega);

    const trocoEl = document.getElementById('carteira-troco-valor');
    if (trocoEl) trocoEl.textContent = formatarCentavos(trocoTotalCentavos);

    renderizarEntregaAtiva(minhaEntrega, motoboyUid);
    renderizarFilaDisponivel(disponiveis, motoboyUid, Boolean(minhaEntrega));
  }, (err) => {
    console.error(err);
    document.getElementById('lista-entregas-disponiveis').innerHTML = err.code === 'permission-denied'
      ? '<div class="card">🔒 Sua conta não está cadastrada como entregador desta loja.</div>'
      : '<div class="card">Erro ao carregar entregas.</div>';
  });
}

// 3. Transação Atômica para Assumir Entrega sem Concorrência
async function assumirEntregaAtomica(pedidoId, motoboyUid) {
  const pedidoRef = doc(db, 'lojas', AppState.lojaId, 'pedidos', pedidoId);
  try {
    await runTransaction(db, async (transaction) => {
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
    avisarCliente(pedidoId);
    showToast('Entrega assumida! Boa viagem 🛵');
  } catch (err) {
    showToast(err.message || 'Não foi possível assumir a entrega.');
  }
}

function renderizarEntregaAtiva(pedido, motoboyUid) {
  const box = document.getElementById('box-entrega-ativa');
  if (!pedido) {
    box.classList.add('hidden');
    box.innerHTML = '';
    mapaMotoboy = null;
    marcadorMoto = null;
    return;
  }

  box.classList.remove('hidden');
  const trocoNecessario = (pedido.formaPagamento === 'dinheiro' && pedido.trocoParaCentavos > pedido.totalCentavos)
    ? pedido.trocoParaCentavos - pedido.totalCentavos
    : 0;

  const destinoCoords = pedido.destinoCoords || { lat: -23.325, lng: -46.721 }; // Fallback se sem pino
  const mapsUrl = pedido.destinoCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${destinoCoords.lat},${destinoCoords.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pedido.enderecoTexto)}`;

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

      <p style="margin-top:8px;"><strong>Cliente:</strong> ${esc(pedido.clienteNome)}</p>
      <p style="font-size:14px; color:var(--text-muted); margin:4px 0;"><strong>Endereço:</strong> ${esc(pedido.enderecoTexto)}</p>
      <p style="font-size:14px;"><strong>Cobrar:</strong> ${formatarCentavos(pedido.totalCentavos)} (${esc((pedido.formaPagamento || '').toUpperCase())})</p>

      <div style="margin:10px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
        <strong>Conferência de Itens:</strong>
        ${(pedido.itens || []).map(i => `<div>• ${esc(i.quantidade)}x ${esc(i.nome)}</div>`).join('')}
      </div>

      <!-- Mapa Leaflet ao Vivo -->
      <div id="mapa-motoboy" style="height:220px; border-radius:8px; margin:10px 0; z-index:1;"></div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:10px;">
        <a href="${mapsUrl}" target="_blank" class="btn-outline-sm" style="text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center;">
          🧭 Abrir GPS / Waze
        </a>
        <button id="btn-concluir-entrega" class="btn-primary">✅ Confirmar Entrega</button>
      </div>

      <button id="btn-ocorrencia-entrega" class="btn-outline-sm" style="width:100%; margin-top:8px; color:var(--danger); border-color:var(--danger);">
        ⚠️ Reportar Problema / Cliente Ausente
      </button>
    </div>
  `;

  setTimeout(() => {
    const mapContainer = document.getElementById('mapa-motoboy');
    if (mapContainer && !mapaMotoboy) {
      const inicio = ultimaPosicao || destinoCoords;
      mapaMotoboy = criarMapaRastreamento('mapa-motoboy', inicio, 15);
      L.marker([destinoCoords.lat, destinoCoords.lng]).addTo(mapaMotoboy).bindPopup('Destino do Cliente');
      marcadorMoto = criarMarcadorMoto(mapaMotoboy, inicio);
    }
  }, 100);

  document.getElementById('btn-concluir-entrega').onclick = () => tentarFinalizarEntrega(pedido, 'concluido');
  document.getElementById('btn-ocorrencia-entrega').onclick = () => tentarFinalizarEntrega(pedido, 'ocorrencia');
}

// 4. Validação de Cerca de 100m + Justificativa Auditável + Fila Offline
async function tentarFinalizarEntrega(pedido, tipoAcao) {
  let justificativa = '';

  if (pedido.destinoCoords && ultimaPosicao) {
    const validacao = validarCercaEntrega(ultimaPosicao, pedido.destinoCoords, 100);
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
        ${bloqueadoPorRotaAtiva ? 'Em rota' : 'Pegar Entrega'}
      </button>
    </div>
  `).join('');

  lista.querySelectorAll('button[data-assumir]').forEach(btn => {
    btn.onclick = () => assumirEntregaAtomica(btn.dataset.assumir, motoboyUid);
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
    } catch (_) {
      restantes.push(item);
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(restantes));
  if (restantes.length === 0) showToast('Entregas offline sincronizadas com o servidor!');
}
