import { db, auth, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { montarItem, ofertaDoDia } from './cardapio.js';
import { abrirGestaoCardapio } from './gestao-cardapio.js';
import { abrirConfigEntrega } from './config-entrega.js';
import { escutarEstadoCaixa, abrirCaixa, fecharCaixa, pausarPedidos, lancarMovimento } from './turno.js';
import { iniciarKds } from './kds.js';
import { abrirEquipe } from './equipe.js';
import { situacaoLoja } from './horario.js';
import { abrirConfigHorarios } from './config-horarios.js';
import { abrirConfigAparencia } from './config-aparencia.js';
import { statusAssinatura } from './plano.js';
import { abrirAvaliacoes } from './avaliacoes.js';
import { abrirCarrinhos } from './carrinhos.js';
import { abrirConfigPix } from './config-pix.js';
import { abrirImportarCardapio } from './importar-cardapio.js';
import { pedirAceiteTermos } from './termos.js';
import { abrirRelatorios } from './relatorios.js';
import { abrirClientes, abrirConfigFidelidade } from './clientes.js';
import { avisarCliente, carimbarPedido } from './notificar.js';
import { bannerAssinatura, telaBloqueio } from './assinatura.js';
import { modoOperacaoAtual } from './frete.js';
import { qrSvg, abrirQrLoja } from './qr.js';
import { abrirConfigRepasse, abrirAcertos } from './repasse.js';
import { calcularRepasse, esgotadoAgora, estoqueAtual } from './frete.js';
import { baixarBackupLoja } from './backup.js';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, updateDoc, addDoc, setDoc, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let audioCtx = null;
let wakeLock = null;
let campainhaAtiva = false;
let pedidosConhecidos = new Set();
let ultimosPedidos = [];
let concluidosHoje = [];
let estadoCaixa = { caixaAberto: false };
let papel = null;

const MIN_ALERTA = 5;     // pedido novo sem aceite: alerta e campainha repetindo
const MIN_CANCELAR = 15;  // pedido novo sem aceite: cancelado automaticamente
// Pedido pago por Pix só chega ao balcão depois de pago: o relógio conta a partir do pagamento
const inicioDoPedido = (p) => (p.pagoEm?.toMillis ? p.pagoEm.toMillis() : p.criadoEm?.toMillis ? p.criadoEm.toMillis() : null);
const minutosDesde = (p) => (inicioDoPedido(p) ? (Date.now() - inicioDoPedido(p)) / 60000 : 0);

export async function iniciarBalcao() {
  const root = document.getElementById('app-root');

  // Nível de acesso: dono | balcao | cozinha (documento lojas/{id}/equipe/{uid})
  papel = null;
  if (auth.currentUser) {
    try {
      const snap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'equipe', auth.currentUser.uid));
      papel = snap.exists() ? (snap.data().papel || 'balcao') : null;
    } catch (_) { papel = null; }
  }
  const assinatura = statusAssinatura(AppState.lojaDados);
  if (!assinatura.ativa) return telaBloqueio(assinatura, papel === 'dono');
  if (papel === 'cozinha') return iniciarKds();
  const ehDono = papel === 'dono';

  root.innerHTML = `
    <div class="card painel-topo">
      <div>
        <strong>Painel Operacional — ${esc(AppState.lojaDados.nome)}</strong>
        <div id="status-loja" class="painel-status">⏳ Verificando loja...</div>
        <div id="status-caixa" class="painel-status">⏳ Verificando caixa...</div>
        <div id="status-som" class="painel-status" style="color:var(--warning);">🔇 Campainha desligada</div>
        <div id="status-rede" class="painel-status"></div>
      </div>
      ${ehDono ? '<div class="modo-op" id="modo-op"></div>' : ''}
      <div class="painel-botoes">
        <button id="btn-caixa" class="btn-primary" style="width:auto;" disabled>Caixa</button>
        <button id="btn-som" class="btn-outline-sm">🔊 Ativar campainha</button>
        <button id="btn-pausa" class="btn-outline-sm">⏸ Pausar pedidos</button>
        <button id="btn-pedido-manual" class="btn-outline-sm">+ Pedido Balcão / Tel</button>
        <button id="btn-estoque" class="btn-outline-sm">📦 Estoque</button>
        <button id="btn-despesa" class="btn-outline-sm" hidden>💸 Despesa / Sangria</button>
        ${ehDono ? '<button id="btn-config" class="btn-outline-sm btn-config-loja">⚙ Configurações</button>' : '<button id="btn-carrinhos" class="btn-outline-sm">🛒 Carrinhos abandonados</button>'}
      </div>
    </div>

    <!-- Pix gerado e ainda não confirmado (o pedido só entra na fila depois de pago) -->
    <div id="pix-pendentes" class="card pix-pendentes hidden"></div>

    <!-- Kanban de Pedidos (no celular vira abas com contador) -->
    <nav class="bc-abas" id="bc-abas">
      <button type="button" class="ativa" data-aba="novo">🔔 Novos <b data-cont="novo">0</b></button>
      <button type="button" data-aba="preparo">${AppState.lojaDados.layoutVitrine === 'varejo' ? '📦 Separação' : '🔥 Preparo'} <b data-cont="preparo">0</b></button>
      <button type="button" data-aba="entrega">🛵 Rota <b data-cont="entrega">0</b></button>
      <button type="button" data-aba="concluido">✅ Feitos <b data-cont="concluido">0</b></button>
    </nav>
    <div class="kanban" id="kanban">
      <div class="ativa" data-coluna="novo">
        <h3 style="margin-bottom:8px;">🔔 Novos Pedidos</h3>
        <div id="col-novo"></div>
      </div>
      <div data-coluna="preparo">
        <h3 style="margin-bottom:8px;">${AppState.lojaDados.layoutVitrine === 'varejo' ? '📦 Em Separação' : '🔥 Em Preparo'}</h3>
        <div id="col-preparo"></div>
      </div>
      <div data-coluna="entrega">
        <h3 style="margin-bottom:8px;">🛵 Saiu para Entrega</h3>
        <div id="col-entrega"></div>
      </div>
      <div data-coluna="concluido">
        <h3 style="margin-bottom:8px;">✅ Concluídos hoje</h3>
        <div id="col-concluido"></div>
      </div>
    </div>

    <!-- Barra fixa de baixo (só no celular), na zona do polegar -->
    <nav class="bc-nav" id="bc-nav">
      <button type="button" data-nav="pedidos">📋<span>Pedidos</span></button>
      <button type="button" data-nav="cardapio">${ehDono ? '🍕<span>Cardápio</span>' : '📦<span>Estoque</span>'}</button>
      <button type="button" data-nav="caixa">💰<span>Caixa</span></button>
      <button type="button" data-nav="ajustes">${ehDono ? '⚙<span>Ajustes</span>' : '➕<span>Pedido</span>'}</button>
    </nav>

    <!-- Área oculta exclusiva para Impressão Térmica (58mm/80mm) -->
    <div id="print-receipt"></div>
  `;

  document.getElementById('btn-som').onclick = ativarSomEWakeLock;
  if (AppState.lojaDados.pixOnline) escutarPixPendentes();
  // Abas do celular: mostra uma coluna por vez
  const mostrarAba = (aba) => {
    document.querySelectorAll('#bc-abas [data-aba]').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
    document.querySelectorAll('#kanban [data-coluna]').forEach(c => c.classList.toggle('ativa', c.dataset.coluna === aba));
  };
  document.querySelectorAll('#bc-abas [data-aba]').forEach(b => { b.onclick = () => { mostrarAba(b.dataset.aba); window.scrollTo({ top: document.getElementById('bc-abas').offsetTop - 60, behavior: 'smooth' }); }; });
  document.querySelector('#bc-nav [data-nav="pedidos"]').onclick = () => { mostrarAba('novo'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  document.querySelector('#bc-nav [data-nav="cardapio"]').onclick = () => (ehDono ? abrirGestaoCardapio() : abrirEstoqueRapido());
  document.querySelector('#bc-nav [data-nav="caixa"]').onclick = () => document.getElementById('btn-caixa').click();
  document.querySelector('#bc-nav [data-nav="ajustes"]').onclick = () => (ehDono ? abrirMenuConfig() : abrirPedidoManualRapido());
  if (ehDono) desenharModoOperacao();
  ligarIndicadorRede();
  document.getElementById('btn-pedido-manual').onclick = abrirPedidoManualRapido;
  document.getElementById('btn-estoque').onclick = abrirEstoqueRapido;
  document.getElementById('btn-despesa').onclick = () => lancarMovimento(estadoCaixa);
  if (ehDono) document.getElementById('btn-config').onclick = abrirMenuConfig;
  else document.getElementById('btn-carrinhos').onclick = abrirCarrinhos;

  document.getElementById('btn-pausa').onclick = () => pausarPedidos(!estadoCaixa.pausada);
  document.addEventListener('loja-atualizada', atualizarStatusLoja);

  // Caixa por turno
  escutarEstadoCaixa((estado) => {
    estadoCaixa = estado;
    atualizarStatusLoja();
    const status = document.getElementById('status-caixa');
    const btn = document.getElementById('btn-caixa');
    if (!status || !btn) return;
    btn.disabled = false;
    const btnDesp = document.getElementById('btn-despesa');
    if (btnDesp) btnDesp.hidden = !estado.caixaAberto;
    if (estado.caixaAberto) {
      const desde = estado.abertoEm?.toDate ? estado.abertoEm.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      status.innerHTML = `🟢 Caixa aberto${desde ? ` desde ${desde}` : ''} · fundo ${formatarCentavos(estado.fundoTrocoCentavos || 0)}`;
      status.style.color = 'var(--success)';
      btn.textContent = '🔒 Fechar caixa';
      btn.className = 'btn-outline-sm';
      btn.onclick = () => fecharCaixa(estadoCaixa, { dono: ehDono });
    } else {
      status.textContent = '🔴 Caixa fechado — abra o caixa para começar o turno';
      status.style.color = 'var(--danger)';
      btn.textContent = '🔓 Abrir caixa';
      btn.className = 'btn-primary';
      btn.style.width = 'auto';
      btn.onclick = async () => {
        if (await abrirCaixa() && !campainhaAtiva) ativarSomEWakeLock();
      };
    }
  });

  bannerAssinatura(assinatura).then(html => { if (html) root.insertAdjacentHTML('afterbegin', html); });
  if (ehDono && !AppState.lojaDados.demo) pedirAceiteTermos(); // loja de demonstração: o cliente aceita ao receber
  escutarPedidosEmTempoReal();
  iniciarCaoDeGuarda();
}

async function ativarSomEWakeLock() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    tocarBipeCampainha();
    campainhaAtiva = true;

    if ('wakeLock' in navigator) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }

    const statusEl = document.getElementById('status-som');
    statusEl.textContent = '🔊 Campainha ativa e tela mantida acordada';
    statusEl.style.color = 'var(--success)';
    document.getElementById('btn-som').classList.add('hidden');
  } catch (err) {
    showToast('Não foi possível ativar o áudio automático.');
  }
}

// Cão de guarda: alerta com 5 min sem aceite e cancela com 15 min
function iniciarCaoDeGuarda() {
  let tique = 0;
  setInterval(async () => {
    tique++;
    const novos = ultimosPedidos.filter(p => p.status === 'novo' && p.criadoEm?.toMillis);
    const atrasados = novos.filter(p => minutosDesde(p) >= MIN_ALERTA);
    if (atrasados.length && campainhaAtiva && tique % 2 === 0) tocarBipeCampainha(); // a cada ~30 s
    for (const p of novos.filter(p => minutosDesde(p) >= MIN_CANCELAR)) {
      try {
        await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
          status: 'cancelado',
          motivoCancelamento: `Sem aceite em ${MIN_CANCELAR} minutos (cancelado automaticamente)`,
          canceladoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp()
        });
        avisarCliente(p.id);
        showToast(`Pedido #${p.numeroPedido || ''} cancelado: ficou ${MIN_CANCELAR} min sem aceite.`, 6000);
      } catch (err) { console.error(err); }
    }
    renderizarColunas(); // atualiza os minutos nos cartões
    atualizarStatusLoja();
  }, 15000);
}

function tocarBipeCampainha() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

// Cliente diz que pagou, mas o pedido não chegou? O balcão confere direto no Mercado Pago
function escutarPixPendentes() {
  const q = query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('status', '==', 'aguardando_pagamento'));
  onSnapshot(q, (snap) => {
    const box = document.getElementById('pix-pendentes');
    if (!box) return;
    const limite = Date.now() - 40 * 60000;
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => (p.criadoEm?.toMillis ? p.criadoEm.toMillis() : 0) > limite)
      .sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    box.classList.toggle('hidden', !lista.length);
    if (!lista.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<strong>⏳ Pix aguardando pagamento (${lista.length})</strong>
      <p class="gc-dica">Entram na fila sozinhos quando o banco confirma. Se o cliente disser que já pagou, toque em verificar.</p>
      ${lista.map(p => `<div class="mb-bag-linha" style="align-items:center;">
        <span>#${esc(p.numeroPedido || p.id.slice(0, 4))} · ${esc(String(p.clienteNome || '').split(/\s+/)[0])} · ${formatarCentavos(p.totalCentavos)} <small>· há ${Math.max(0, Math.round((Date.now() - (p.criadoEm?.toMillis?.() || Date.now())) / 60000))} min</small></span>
        <button type="button" class="btn-outline-sm" data-verificar-pix="${esc(p.id)}">🔄 Verificar no banco</button>
      </div>`).join('')}`;
    box.querySelectorAll('[data-verificar-pix]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Conferindo...';
        try {
          const r = await fetch('/api/mp/verificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: AppState.lojaDados.slug || AppState.slug, pedidoId: b.dataset.verificarPix }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.erro || 'Não foi possível conferir.');
          showToast(d.pago || d.status === 'novo' ? '✅ Pago! O pedido entrou na fila.' : d.status === 'cancelado' ? 'O Pix expirou ou foi cancelado.' : 'Ainda não consta pagamento no banco.', 6000);
        } catch (err) { showToast(err.message); }
        b.disabled = false; b.textContent = '🔄 Verificar no banco';
      };
    });
  }, (err) => console.error('pix pendentes', err));
}

function escutarPedidosEmTempoReal() {
  const q = query(
    collection(db, 'lojas', AppState.lojaId, 'pedidos'),
    where('status', 'in', ['novo', 'preparo', 'entrega'])
  );

  // Concluídos de hoje (entregueEm a partir da meia-noite): consulta simples, sem índice composto
  const meiaNoite = new Date();
  meiaNoite.setHours(0, 0, 0, 0);
  onSnapshot(query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('entregueEm', '>=', meiaNoite)), (snap) => {
    const ms = (p) => (p.entregueEm?.toMillis ? p.entregueEm.toMillis() : 0);
    concluidosHoje = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status === 'concluido' || p.status === 'ocorrencia').sort((a, b) => ms(b) - ms(a));
    renderizarConcluidos();
  }, (err) => console.error('concluídos', err));

  onSnapshot(q, (snapshot) => {
    // Ordena por chegada aqui no navegador (dispensa índice composto no Firestore)
    const tempo = (p) => (p.criadoEm?.toMillis ? p.criadoEm.toMillis() : Date.now());
    ultimosPedidos = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tempo(a) - tempo(b));

    let temNovoPedido = false;
    ultimosPedidos.forEach((p) => {
      if (p.status === 'novo' && !pedidosConhecidos.has(p.id)) temNovoPedido = true;
      pedidosConhecidos.add(p.id);
    });
    renderizarColunas();
    if (temNovoPedido && campainhaAtiva) tocarBipeCampainha();
  }, (err) => {
    console.error(err);
    document.getElementById('col-novo').innerHTML = err.code === 'permission-denied'
      ? '<div class="card">🔒 Entre com uma conta da equipe desta loja (botão "Entrar" no topo).</div>'
      : '<div class="card">Erro ao carregar pedidos. Veja o console (F12).</div>';
  });
}

// Mostra se a loja está aceitando pedidos online agora (horário + pausa)
function atualizarStatusLoja() {
  const el = document.getElementById('status-loja');
  const btn = document.getElementById('btn-pausa');
  if (!el || !btn) return;
  const sit = situacaoLoja(AppState.lojaDados, estadoCaixa);
  if (sit.pausada) {
    el.innerHTML = '⏸ <strong>Pedidos online PAUSADOS</strong> — clientes não conseguem pedir';
    el.style.color = 'var(--danger)';
  } else if (sit.aberta) {
    el.textContent = sit.semHorario ? '🟢 Recebendo pedidos online (sem horário configurado — sempre aberto)' : `🟢 Recebendo pedidos online · ${sit.texto.replace('Aberto · ', '')}`;
    el.style.color = 'var(--success)';
  } else {
    el.textContent = `🌙 Loja fora do horário · ${sit.texto.replace('Fechado · ', '')}`;
    el.style.color = 'var(--text-muted)';
  }
  btn.textContent = estadoCaixa.pausada ? '▶ Retomar pedidos' : '⏸ Pausar pedidos';
  btn.className = estadoCaixa.pausada ? 'btn-primary' : 'btn-outline-sm';
  btn.style.width = 'auto';
}

function renderizarColunas() {
  const colunas = {
    novo: document.getElementById('col-novo'),
    preparo: document.getElementById('col-preparo'),
    entrega: document.getElementById('col-entrega')
  };
  if (!colunas.novo) return;
  Object.values(colunas).forEach(c => { c.innerHTML = ''; });
  ultimosPedidos.forEach((p) => {
    if (colunas[p.status]) colunas[p.status].appendChild(criarCardPedidoBalcao(p));
  });
  for (const st of ['novo', 'preparo', 'entrega']) {
    const b = document.querySelector(`#bc-abas [data-cont="${st}"]`);
    if (b) { const n = ultimosPedidos.filter(p => p.status === st).length; b.textContent = n; b.classList.toggle('tem', n > 0); }
  }
}

function renderizarConcluidos() {
  const col = document.getElementById('col-concluido');
  if (!col) return;
  const ok = concluidosHoje.filter(p => p.status === 'concluido');
  const total = ok.reduce((a, p) => a + (Number(p.totalCentavos) || 0), 0);
  const contConc = document.querySelector('#bc-abas [data-cont="concluido"]');
  if (contConc) contConc.textContent = concluidosHoje.length;
  col.innerHTML = `
    <div class="card conc-resumo"><span>${ok.length} pedido(s) hoje</span>${papel === 'dono' ? `<strong>${formatarCentavos(total)}</strong>` : ''}</div>
    ${concluidosHoje.slice(0, 30).map(p => `
      <div class="card conc-item${p.status === 'ocorrencia' ? ' ocorrencia' : ''}">
        <div><strong>#${esc(p.numeroPedido || p.id.slice(0, 4))}</strong> · ${esc(String(p.clienteNome || '').split(/\s+/)[0])}
          <small>${p.status === 'ocorrencia' ? '⚠ ocorrência' : p.tipoEntrega === 'retirada' ? '🏪 retirou' : `🛵 ${esc(p.motoboyNome || 'entregue')}`}${p.entregueEm?.toDate ? ` · ${p.entregueEm.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}${p.avaliacaoNota ? ` · ${'★'.repeat(p.avaliacaoNota)}` : ''}</small>
        </div>
        <span>${formatarCentavos(p.totalCentavos)}</span>
        ${p.status === 'ocorrencia' ? `
          <div class="conc-ocorrencia">
            ${p.justificativaBaixa ? `<small>Motoboy: "${esc(p.justificativaBaixa)}"</small>` : ''}
            ${p.ocorrenciaRevisada
              ? `<small>${p.ocorrenciaRevisada === 'cliente' ? '✔ Marcado como culpa do cliente' : '✔ Marcado como problema da loja/entrega'}</small>`
              : `<small>Foi culpa do cliente (ausente / endereço não existe)?</small>
                 <div class="conc-ocorrencia-botoes">
                   <button class="btn-outline-sm" type="button" data-ocorr="${esc(p.id)}" data-culpa="1">Sim, do cliente</button>
                   <button class="btn-outline-sm" type="button" data-ocorr="${esc(p.id)}" data-culpa="0">Não</button>
                 </div>`}
          </div>` : ''}
      </div>`).join('') || '<p class="gc-dica">Nenhum pedido concluído ainda hoje.</p>'}`;
  // Ocorrência só conta contra o cliente depois que o balcão confirma (evita punir por erro do motoboy/GPS).
  // Com 2 ausências seguidas confirmadas, o cliente passa a pagar pelo Pix antes (se a loja tiver Pix automático).
  col.querySelectorAll('[data-ocorr]').forEach(b => {
    b.onclick = async () => {
      const culpa = b.dataset.culpa === '1';
      if (culpa && !confirm('Confirmar que o cliente estava ausente ou o endereço não existe?\n\nCom 2 ocorrências seguidas confirmadas, os próximos pedidos desse WhatsApp só poderão ser pagos pelo Pix antecipado. Uma entrega concluída libera de novo.')) return;
      b.disabled = true;
      try {
        const u = auth.currentUser;
        const r = await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, acao: 'ocorrencia', pedidoId: b.dataset.ocorr, culpaCliente: culpa }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.erro || 'Não foi possível registrar.');
        const p = concluidosHoje.find(x => x.id === b.dataset.ocorr);
        if (p) p.ocorrenciaRevisada = culpa ? 'cliente' : 'loja';
        showToast(d.restrito ? '⚠ 2ª ausência seguida: os próximos pedidos desse cliente serão pagos pelo Pix antecipado.' : 'Registrado.', 6000);
        renderizarConcluidos();
      } catch (err) { showToast(err.message, 5000); b.disabled = false; }
    };
  });
}

function criarCardPedidoBalcao(p) {
  const div = document.createElement('div');
  const minutos = Math.floor(minutosDesde(p));
  const emAberto = ['novo', 'preparo', 'entrega'].includes(p.status);
  // Tempo desde o pedido: verde até 25 min, amarelo até 35, vermelho pulsante depois
  const sla = !emAberto || !p.criadoEm?.toMillis ? '' : minutos >= 35 ? ' sla-vermelho' : minutos >= 25 ? ' sla-amarelo' : ' sla-verde';
  const chegou = p.tipoEntrega === 'retirada' && p.clienteChegouEm && emAberto;
  div.className = `card${p.status === 'novo' && minutos >= MIN_ALERTA ? ' pedido-atrasado' : ''}${sla}${chegou ? ' cliente-chegou' : ''}`;
  if (chegou && !clientesChegaramAvisados.has(p.id)) { clientesChegaramAvisados.add(p.id); tocarAvisoChegada(); }
  div.style.borderLeft = p.status === 'novo' ? '4px solid var(--danger)' : '4px solid var(--primary)';

  const trocoTxt = (p.formaPagamento === 'dinheiro' && p.trocoParaCentavos > p.totalCentavos)
    ? `<div style="color:var(--warning); font-weight:700; font-size:13px;">💵 Levar troco: ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)}</div>`
    : '';

  let botaoAcao = '';
  if (p.status === 'novo') {
    botaoAcao = `<button class="btn-primary" data-next="preparo">Aceitar Pedido</button>
      <button class="btn-outline-sm gc-perigo" style="width:100%; margin-top:6px;" data-recusar="1">Recusar</button>`;
  } else if (p.status === 'preparo') {
    botaoAcao = p.tipoEntrega === 'retirada'
      ? `<button class="btn-primary" data-next="concluido">✅ Cliente retirou</button>`
      : `<button class="btn-primary" data-next="entrega">Despachar Motoboy</button>`;
  } else if (p.status === 'entrega') {
    botaoAcao = `<button class="btn-outline-sm" style="width:100%;" data-next="concluido">Marcar Entregue</button>`;
  }

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <strong>Pedido #${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
      <span style="display:flex; gap:6px; align-items:center;">
        ${p.criadoEm?.toMillis ? `<span class="pedido-idade${(p.status === 'novo' && minutos >= MIN_ALERTA) || (emAberto && minutos >= 35) ? ' alerta' : ''}">⏱ ${minutos} min</span>` : ''}
        <button class="btn-outline-sm" style="padding:2px 8px;" data-print="1" title="Imprimir Comanda">🖨️</button>
      </span>
    </div>
    <p style="font-size:14px; margin:4px 0;"><strong>${esc(p.clienteNome)}</strong> ${p.clienteWhatsapp ? `(${esc(p.clienteWhatsapp)})` : ''}${p.clienteVip ? ` <span class="badge-vip" title="${esc(p.clientePedidosAntes)} pedidos concluídos">⭐ VIP</span>` : ''}</p>
    ${p.clienteVip ? `<p class="gc-dica" style="margin:0 0 4px;">Cliente fiel (${esc(p.clientePedidosAntes)} pedidos): que tal um mimo ou prioridade no preparo?</p>` : ''}
    ${p.recebedorNome ? `<p style="font-size:13px; margin:2px 0;">👤 Quem recebe: <strong>${esc(p.recebedorNome)}</strong>${p.recebedorWhats ? ` (${esc(p.recebedorWhats)})` : ''}</p>` : ''}
    ${p.clienteRestrito ? '<p style="font-size:12px; color:#9a3412; margin:2px 0;">⚠ Cliente com 2 ausências seguidas</p>' : ''}
    ${chegou ? '<div class="pedido-chegou">🙋 <strong>O cliente chegou no balcão!</strong> Entregue o pedido.</div>' : ''}
    ${p.tipoEntrega === 'retirada' && p.status === 'preparo' && linkProntoWhats(p) ? `<a class="btn-outline-sm btn-whats" style="margin:4px 0 8px;" href="${esc(linkProntoWhats(p))}" target="_blank" rel="noopener">📲 Avisar: pronto para retirada</a>` : ''}
    ${p.status === 'entrega' && p.entregaPropria ? '<p style="font-size:13px; margin:2px 0;">🙋 Entrega própria da loja (sem app de motoboy)</p>' : ''}
    ${p.status === 'entrega' && p.tentativaAusente ? `<div class="pedido-aviso">📵 O motoboy chegou${p.tentativaAusente.em && p.tentativaAusente.em.toDate ? ` às ${p.tentativaAusente.em.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''} e o cliente não atendeu. Ele foi fazer outra entrega e volta depois. ${p.clienteWhatsapp ? `<a href="https://wa.me/55${esc(String(p.clienteWhatsapp).replace(/\D/g, '').replace(/^55/, ''))}" target="_blank" rel="noopener">📲 Chamar o cliente</a>` : 'Ligue para o cliente.'}</div>` : ''}
    <p style="font-size:13px; color:var(--text-muted);">${esc(p.enderecoTexto)}</p>
    ${p.pinoManual ? '<p style="font-size:12px; color:#92400e; margin:2px 0;">📍 Pino ajustado à mão pelo cliente</p>' : ''}
    ${p.descontoFidelidadeCentavos ? `<div class="pedido-premio">🎁 Prêmio fidelidade usado: −${formatarCentavos(p.descontoFidelidadeCentavos)} (já descontado do total)</div>` : ''}
    <div style="margin:8px 0; padding:8px; background:var(--bg); border-radius:8px; font-size:13px;">
      ${(p.itens || []).map(i => `<div>${esc(i.quantidade)}x ${esc(i.nome)} ${i.detalhes?.length ? `(${esc(i.detalhes.join(', '))})` : ''}</div>`).join('')}
    </div>
    ${p.freteCentavos ? `<div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted);"><span>🛵 Entrega${p.distanciaKm ? ` (${esc(p.distanciaKm)} km)` : ''}</span><span>${formatarCentavos(p.freteCentavos)}</span></div>` : ''}
    <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
      <span>${esc((p.formaPagamento || '').toUpperCase())}${p.pagamentoStatus === 'aprovado' ? ' <strong class="pago-ok">✅ PAGO</strong>' : ''}${p.tipoEntrega === 'retirada' ? ' · 🏪 RETIRADA' : ''}</span>
      <strong>${formatarCentavos(p.totalCentavos)}</strong>
    </div>
    ${trocoTxt}
    ${p.status === 'novo' && minutos >= MIN_ALERTA ? `<div class="pedido-aviso">⚠️ Aguardando aceite há ${minutos} min — cancela sozinho com ${MIN_CANCELAR} min</div>` : ''}
    ${p.status === 'preparo' && p.pronto ? '<div class="pedido-pronto">✅ Cozinha: pronto</div>' : ''}
    ${p.status === 'entrega' ? `<div style="font-size:13px; margin-bottom:8px;">🛵 Com: <strong>${esc(p.motoboyNome || (p.motoboyId ? 'entregador (app)' : 'sem entregador'))}</strong></div>` : ''}
    ${p.status === 'entrega' && linkAvisoWhats(p) ? `<a class="btn-outline-sm btn-whats" style="margin-bottom:8px;" data-avisar="1" href="${esc(linkAvisoWhats(p))}" target="_blank" rel="noopener">${p.avisoWhatsEm ? '✓ Cliente avisado · avisar de novo' : '📲 Avisar cliente no WhatsApp'}</a>` : ''}
    ${botaoAcao}
    ${p.tipoEntrega === 'entrega' && ['preparo', 'entrega'].includes(p.status) ? '<button class="btn-outline-sm" type="button" data-resumo style="width:100%; margin-top:6px;">📋 Copiar resumo para motoboy avulso</button>' : ''}
    ${p.status === 'preparo' ? '<button class="btn-outline-sm gc-perigo" type="button" data-cancelar-aceito style="width:100%; margin-top:6px;">✖ Cancelar pedido</button>' : ''}
    ${p.status === 'entrega' ? '<button class="btn-outline-sm gc-perigo" type="button" data-cancelar-rota style="width:100%; margin-top:6px;">✖ Cancelar entrega em rota</button>' : ''}
    ${p.tipoEntrega === 'entrega' && ['novo', 'preparo'].includes(p.status) ? '<button class="btn-outline-sm" type="button" data-converter style="width:100%; margin-top:6px;">🔄 Sem entregador? Converter para retirada</button>' : ''}
  `;

  div.querySelector('[data-print]')?.addEventListener('click', () => imprimirComandaTermica(p));
  div.querySelector('[data-resumo]')?.addEventListener('click', () => copiarResumoAvulso(p));
  div.querySelector('[data-converter]')?.addEventListener('click', () => converterParaRetirada(p));
  div.querySelector('[data-cancelar-rota]')?.addEventListener('click', () => cancelarEmRota(p));
  div.querySelector('[data-cancelar-aceito]')?.addEventListener('click', () => cancelarAceito(p));
  div.querySelector('[data-avisar]')?.addEventListener('click', () => marcarAvisado(p));
  div.querySelector('[data-recusar]')?.addEventListener('click', async () => {
    const motivo = prompt('Motivo da recusa (o cliente verá que o pedido foi cancelado):', 'Loja sem condições de atender agora');
    if (motivo === null) return;
    await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
      status: 'cancelado',
      motivoCancelamento: motivo.trim().slice(0, 120) || 'Recusado pela loja',
      canceladoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });
    avisarCliente(p.id);
    showToast(`Pedido #${p.numeroPedido || ''} recusado.`);
  });

  const btnNext = div.querySelector('[data-next]');
  if (btnNext) {
    btnNext.onclick = async () => {
      const novoStatus = btnNext.dataset.next;
      try { navigator.vibrate && navigator.vibrate(40); } catch (_) {}
      if (novoStatus === 'entrega') return despacharParaEntregador(p);
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
        status: novoStatus,
        atualizadoEm: serverTimestamp(),
        ...(novoStatus === 'concluido' ? { entregueEm: serverTimestamp() } : {})
      });
      avisarCliente(p.id);
      if (novoStatus === 'concluido') carimbarPedido(p.id);
      showToast(`Pedido #${esc(p.numeroPedido)} movido para ${novoStatus.toUpperCase()}`);
    };
  }

  return div;
}

// Aviso de "saiu para entrega" pelo WhatsApp do próprio atendente (grátis), com o link de acompanhamento
function linkAvisoWhats(p) {
  const numero = String(p.clienteWhatsapp || '').replace(/\D/g, '');
  if (numero.length < 10) return null;
  const primeiroNome = String(p.clienteNome || '').trim().split(/\s+/)[0] || '';
  const link = `${window.location.origin}/${AppState.slug}/pedido/${encodeURIComponent(p.id)}`;
  const texto = `Olá${primeiroNome ? `, ${primeiroNome}` : ''}! Seu pedido #${p.numeroPedido || ''} da ${AppState.lojaDados.nome} saiu para entrega 🛵\nAcompanhe a moto ao vivo: ${link}`;
  return `https://wa.me/${numero.startsWith('55') ? numero : '55' + numero}?text=${encodeURIComponent(texto)}`;
}
function marcarAvisado(p) {
  updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), { avisoWhatsEm: serverTimestamp() }).catch(() => {});
}

function imprimirComandaTermica(p) {
  const area = document.getElementById('print-receipt');
  area.innerHTML = `
    <div style="text-align:center; border-bottom:1px dashed #000; padding-bottom:6px;">
      <strong>${AppState.lojaDados.nome.toUpperCase()}</strong><br/>
      PEDIDO #${esc(p.numeroPedido || p.id.slice(0, 4))}<br/>
      ${new Date().toLocaleString('pt-BR')}
    </div>
    <div style="padding:6px 0; border-bottom:1px dashed #000;">
      Cliente: ${esc(p.clienteNome)}${p.clienteVip ? ' *VIP*' : ''}<br/>
      Tel: ${esc(p.clienteWhatsapp)}<br/>
      ${p.recebedorNome ? `Recebe: ${esc(p.recebedorNome)}${p.recebedorWhats ? ' ' + esc(p.recebedorWhats) : ''}<br/>` : ''}
      ${p.enderecoPartes && p.enderecoPartes.rua
        ? `${p.enderecoPartes.bairro ? `<strong style="font-size:15px;">${esc(p.enderecoPartes.bairro.toUpperCase())}</strong><br/>` : ''}${esc(p.enderecoPartes.rua)}${p.enderecoPartes.numero ? ', ' + esc(p.enderecoPartes.numero) : ''}<br/>${p.enderecoPartes.compl ? `<strong>REF: ${esc(p.enderecoPartes.compl)}</strong><br/>` : ''}${p.enderecoPartes.apelido ? `(${esc(p.enderecoPartes.apelido)})` : ''}${p.tipoLocal === 'condominio' ? ' [CONDOMINIO]' : p.tipoLocal === 'rural' ? ' [RURAL]' : ''}`
        : `End: ${esc(p.enderecoTexto)}`}
    </div>
    <div style="padding:6px 0; border-bottom:1px dashed #000;">
      ${(p.itens || []).map(i => `
        <div>${esc(i.quantidade)}x ${esc(i.nome)} - ${formatarCentavos(i.unitarioCentavos * i.quantidade)}</div>
        ${i.detalhes?.length ? `<div style="font-size:11px;">  * ${esc(i.detalhes.join(' | '))}</div>` : ''}
      `).join('')}
    </div>
    <div style="padding-top:6px;">
      ${p.freteCentavos ? `Subtotal: ${formatarCentavos(p.subtotalCentavos ?? (p.totalCentavos - p.freteCentavos))}<br/>Entrega: ${formatarCentavos(p.freteCentavos)}<br/>` : ''}
      ${p.tipoEntrega === 'retirada' ? '*** RETIRADA NA LOJA ***<br/>' : ''}
      ${p.descontoFidelidadeCentavos ? `Premio fidelidade: -${formatarCentavos(p.descontoFidelidadeCentavos)}<br/>` : ''}
      <strong>TOTAL: ${formatarCentavos(p.totalCentavos)}</strong><br/>
      Pagamento: ${esc((p.formaPagamento || '').toUpperCase())}
      ${p.trocoParaCentavos > p.totalCentavos ? `<br/>TROCO P/ ${formatarCentavos(p.trocoParaCentavos)}: ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)}` : ''}
    </div>
  `;
  window.print();
}

// Pedido de balcão/telefone: o atendente escolhe os itens do próprio cardápio
async function abrirPedidoManualRapido() {
  let produtos = [];
  let categorias = [];
  try {
    const snap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
    const dados = snap.exists() ? snap.data() : {};
    produtos = (dados.produtos || []).filter(p => !p.excluido);
    categorias = dados.categorias || [];
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar o cardápio.');
    return;
  }
  if (!produtos.length) {
    showToast('Cardápio vazio: cadastre produtos primeiro (botão "Cardápio de exemplo").');
    return;
  }

  const sacola = [];
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px;';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:12px;';
  overlay.innerHTML = `
    <div class="card" style="max-width:920px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>Pedido Balcão / Telefone</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div id="pm-cardapio"></div>
        <div>
          <h4 style="margin-bottom:6px;">🧾 Itens do pedido</h4>
          <div id="pm-sacola"></div>

          <label style="display:block; font-size:13px; font-weight:600; margin-top:10px;">Nome do cliente</label>
          <input id="pm-nome" type="text" placeholder="Ex: Maria" style="${campo}" />

          <label style="display:block; font-size:13px; font-weight:600;">WhatsApp do cliente (opcional)</label>
          <input id="pm-tel" type="tel" placeholder="(11) 99999-9999" style="${campo}" />
          <p class="gc-dica" style="margin:-6px 0 10px;">${AppState.lojaDados.fidelidade?.ativo ? '🎁 Com o WhatsApp, o cliente ganha o carimbo do cartão fidelidade.' : 'Com o WhatsApp, o pedido entra na ficha do cliente.'}</p>

          <label style="display:block; font-size:13px; font-weight:600;">Tipo</label>
          <select id="pm-tipo" style="${campo}">
            <option value="retirada">Retirada no balcão</option>
            <option value="entrega">Entrega (motoboy)</option>
          </select>

          <div id="pm-box-endereco" class="hidden">
            <label style="display:block; font-size:13px; font-weight:600;">Endereço e referência</label>
            <input id="pm-endereco" type="text" placeholder="Rua, número - bairro" style="${campo}" />
          </div>

          <label style="display:block; font-size:13px; font-weight:600;">Pagamento</label>
          <select id="pm-pag" style="${campo}">
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
            <option value="pix">Pix</option>
          </select>

          <div id="pm-box-troco">
            <label style="display:block; font-size:13px; font-weight:600;">Troco para quanto? (R$, opcional)</label>
            <input id="pm-troco" type="number" placeholder="Ex: 100" style="${campo}" />
          </div>

          <div style="display:flex; justify-content:space-between; font-size:17px; margin:8px 0 12px;">
            <span>Total:</span><strong id="pm-total">R$ 0,00</strong>
          </div>
          <button class="btn-primary" id="pm-lancar">Lançar pedido na cozinha</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  $('[data-fechar]').onclick = () => overlay.remove();
  $('#pm-tipo').onchange = () => $('#pm-box-endereco').classList.toggle('hidden', $('#pm-tipo').value !== 'entrega');
  $('#pm-pag').onchange = () => $('#pm-box-troco').classList.toggle('hidden', $('#pm-pag').value !== 'dinheiro');

  const totalSacola = () => sacola.reduce((acc, i) => acc + i.unitarioCentavos * i.quantidade, 0);

  function adicionar(item) {
    const chave = JSON.stringify([item.produtoId, item.detalhes, item.unitarioCentavos]);
    const igual = sacola.find(i => JSON.stringify([i.produtoId, i.detalhes, i.unitarioCentavos]) === chave);
    if (igual) igual.quantidade += 1;
    else sacola.push(item);
    renderSacola();
  }

  function renderSacola() {
    const box = $('#pm-sacola');
    if (!sacola.length) {
      box.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Toque nos produtos ao lado para adicionar.</p>';
    } else {
      box.innerHTML = sacola.map((i, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:14px;">
          <div style="flex:1;">
            <strong>${esc(i.nome)}</strong>
            ${i.detalhes.length ? `<div style="font-size:12px; color:var(--text-muted);">${esc(i.detalhes.join(' | '))}</div>` : ''}
            <div style="font-size:12px;">${formatarCentavos(i.unitarioCentavos)} cada</div>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <button class="btn-outline-sm" style="padding:2px 10px;" data-menos="${idx}">−</button>
            <strong style="min-width:22px; text-align:center;">${i.quantidade}</strong>
            <button class="btn-outline-sm" style="padding:2px 10px;" data-mais="${idx}">+</button>
          </div>
        </div>
      `).join('');
      box.querySelectorAll('[data-mais]').forEach(b => b.onclick = () => { sacola[Number(b.dataset.mais)].quantidade += 1; renderSacola(); });
      box.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => {
        const i = Number(b.dataset.menos);
        sacola[i].quantidade -= 1;
        if (sacola[i].quantidade <= 0) sacola.splice(i, 1);
        renderSacola();
      });
    }
    $('#pm-total').textContent = formatarCentavos(totalSacola());
  }

  function renderListaProdutos() {
    const idsCategorias = new Set(categorias.map(c => c.id));
    const grupos = [
      ...categorias.map(c => ({ nome: c.nome, itens: produtos.filter(p => p.categoriaId === c.id) })),
      { nome: 'Outros', itens: produtos.filter(p => !idsCategorias.has(p.categoriaId)) }
    ].filter(g => g.itens.length);

    $('#pm-cardapio').innerHTML = grupos.map(g => `
      <h4 style="margin:6px 0;">${esc(g.nome)}</h4>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:8px; margin-bottom:10px;">
        ${g.itens.map(p => {
          const esgotado = esgotadoAgora(p, AppState.lojaDados);
          return `
            <button class="btn-outline-sm" data-prod="${esc(p.id)}" ${esgotado ? 'disabled' : ''} style="text-align:left; padding:10px; min-height:64px; ${esgotado ? 'opacity:0.5;' : ''}">
              <div>${esc(p.nome)}${p.subcategoriaNome ? ` <small>(${esc(p.subcategoriaNome)})</small>` : ''}</div>
              <div style="color:var(--primary); font-size:13px;">${p.grupos?.length ? 'Escolher opções' : (ofertaDoDia(p, AppState.lojaDados) ? `🔥 ${formatarCentavos(ofertaDoDia(p, AppState.lojaDados).porCentavos)}` : formatarCentavos(p.precoCentavos))}</div>
              ${esgotado ? '<div style="font-size:12px;">Esgotado</div>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    `).join('');

    $('#pm-cardapio').querySelectorAll('[data-prod]').forEach(btn => {
      btn.onclick = () => {
        const prod = produtos.find(p => p.id === btn.dataset.prod);
        if (!prod) return;
        if (!prod.grupos || !prod.grupos.length) {
          const r = montarItem(prod, {}, AppState.lojaDados);
          adicionar(r.item);
          showToast(`${prod.nome} adicionado`);
        } else {
          renderOpcoes(prod);
        }
      };
    });
  }

  function renderOpcoes(prod) {
    const selecoes = {};
    $('#pm-cardapio').innerHTML = `
      <button class="btn-outline-sm" data-voltar style="margin-bottom:8px;">← Voltar ao cardápio</button>
      <h4>${esc(prod.nome)}</h4>
      ${prod.grupos.map((grp, gi) => `
        <div style="border-top:1px solid var(--border); padding:8px 0;">
          <strong>${esc(grp.titulo)}</strong>
          <small style="display:block; color:var(--text-muted);">Escolha de ${grp.minimo || 0} até ${grp.maximo || 1}</small>
          ${(grp.opcoes || []).map((op, oi) => `
            <label style="display:flex; justify-content:space-between; padding:6px 0; cursor:pointer;">
              <span><input type="checkbox" data-g="${gi}" data-o="${oi}" /> ${esc(op.nome)}</span>
              <span>+${formatarCentavos(op.precoCentavos)}</span>
            </label>
          `).join('')}
        </div>
      `).join('')}
      <button class="btn-primary" data-add-opcoes style="margin-top:8px;">Adicionar ao pedido</button>
    `;
    $('[data-voltar]').onclick = renderListaProdutos;
    $('#pm-cardapio').querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.onchange = () => {
        const gi = Number(chk.dataset.g);
        const grupo = prod.grupos[gi];
        const opcao = grupo.opcoes[Number(chk.dataset.o)];
        selecoes[gi] = selecoes[gi] || [];
        if (chk.checked) {
          if (selecoes[gi].length >= (grupo.maximo || 1)) {
            chk.checked = false;
            showToast(`Máximo de ${grupo.maximo || 1} em "${grupo.titulo}".`);
            return;
          }
          selecoes[gi].push(opcao);
        } else {
          selecoes[gi] = selecoes[gi].filter(o => o !== opcao);
        }
      };
    });
    $('[data-add-opcoes]').onclick = () => {
      const r = montarItem(prod, selecoes, AppState.lojaDados);
      if (r.erro) { showToast(r.erro); return; }
      adicionar(r.item);
      showToast(`${prod.nome} adicionado`);
      renderListaProdutos();
    };
  }

  $('#pm-lancar').onclick = async () => {
    const nome = $('#pm-nome').value.trim();
    const telefone = $('#pm-tel').value.replace(/\D/g, '');
    const tipo = $('#pm-tipo').value;
    const endereco = $('#pm-endereco').value.trim();
    const pagamento = $('#pm-pag').value;
    const totalCentavos = totalSacola();
    const trocoParaCentavos = pagamento === 'dinheiro' ? Math.round((Number($('#pm-troco').value) || 0) * 100) : 0;

    if (!sacola.length) { showToast('Adicione pelo menos um item.'); return; }
    if (!nome) { showToast('Informe o nome do cliente.'); return; }
    if (tipo === 'entrega' && !endereco) { showToast('Informe o endereço de entrega.'); return; }
    if (trocoParaCentavos && trocoParaCentavos < totalCentavos) { showToast('O valor do troco é menor que o total.'); return; }

    const btn = $('#pm-lancar');
    btn.disabled = true;
    btn.textContent = 'Lançando...';
    try {
      const novo = await addDoc(collection(db, 'lojas', AppState.lojaId, 'pedidos'), {
        numeroPedido: Math.floor(100 + Math.random() * 900),
        clienteNome: nome,
        clienteWhatsapp: telefone,
        enderecoTexto: tipo === 'entrega' ? endereco : 'Retirada no balcão',
        tipoEntrega: tipo,
        itens: sacola,
        totalCentavos,
        formaPagamento: pagamento,
        trocoParaCentavos,
        status: 'preparo',
        origem: 'balcao',
        canal: 'balcao',
        turnoId: estadoCaixa.caixaAberto ? estadoCaixa.turnoId : null,
        adicionalChuva: Boolean(AppState.lojaDados.repasse && AppState.lojaDados.repasse.chuvaAtiva),
        criadoEm: serverTimestamp()
      });
      overlay.remove();
      showToast('Pedido lançado direto na cozinha!');
      // Dá baixa no estoque dos produtos controlados (no servidor, sem brigar com vendas do site)
      if (sacola.some(i => produtos.find(x => x.id === i.produtoId)?.controlarEstoque)) {
        apiEstoque({ acao: 'venda', pedidoId: novo.id, itens: sacola.map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade })) })
          .catch(err => showToast('⚠️ Pedido lançado, mas o estoque não baixou: ' + err.message, 6000));
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao lançar o pedido.');
      btn.disabled = false;
      btn.textContent = 'Lançar pedido na cozinha';
    }
  };

  renderListaProdutos();
  renderSacola();
}

// Cria um cardápio de teste (pizza meio a meio + bebidas) no documento único da vitrine
// Despacha o pedido para um entregador escolhido da lista (ele passa a ver no app na hora)
async function despacharParaEntregador(p) {
  let entregadores = [];
  try {
    const snap = await getDocs(collection(db, 'lojas', AppState.lojaId, 'entregadores'));
    entregadores = snap.docs.map(d => ({ uid: d.id, nome: d.data().nome || 'Entregador' }));
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar a lista de entregadores.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;';
  overlay.innerHTML = `
    <div class="card" style="max-width:380px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3>Quem vai entregar o #${esc(p.numeroPedido || p.id.slice(0, 4))}?</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      ${entregadores.map(e => `
        <button class="btn-outline-sm" data-uid="${esc(e.uid)}" style="width:100%; text-align:left; padding:12px; margin-bottom:8px; font-size:15px;">🛵 ${esc(e.nome)}</button>
      `).join('')}
      <button class="btn-outline-sm" data-propria="1" style="width:100%; text-align:left; padding:12px; margin-bottom:8px; font-size:15px;">🙋 Eu mesmo / entregador sem o app</button>
      ${entregadores.length ? '' : '<p class="gc-dica">Nenhum motoboy cadastrado com o app. Cadastre em ⚙ Configurações → Equipe, ou faça a entrega você mesmo.</p>'}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelector('[data-propria]').onclick = async () => {
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
        status: 'entrega', motoboyId: null, motoboyNome: 'Entregador da loja', entregaPropria: true,
        saiuParaEntregaEm: serverTimestamp(), atualizadoEm: serverTimestamp()
      });
      avisarCliente(p.id);
      const rota = urlRota(p);
      let qr = '';
      try { qr = await qrSvg(rota, 5); } catch (_) {}
      const link = linkAvisoWhats(p);
      overlay.querySelector('.card').innerHTML = `
        <h3>🛵 Pedido #${esc(p.numeroPedido || '')} saiu com a loja</h3>
        <p class="gc-dica">Quem vai entregar aponta a câmera do celular para o QR Code e o mapa abre direto no endereço do cliente.</p>
        ${qr ? `<div class="qr-img" style="display:flex; justify-content:center; margin:8px 0;">${qr}</div>` : ''}
        <button class="btn-outline-sm" type="button" data-resumo style="width:100%;">📋 Copiar resumo (endereço, mapa, valor e telefone)</button>
        ${link ? `<a class="btn-primary btn-whats" style="margin-top:8px;" href="${esc(link)}" target="_blank" rel="noopener" data-avisar>📲 Avisar cliente no WhatsApp</a>` : ''}
        <button class="btn-outline-sm" data-fechar style="width:100%; margin-top:8px;">Fechar</button>`;
      overlay.querySelector('[data-resumo]').onclick = () => copiarResumoAvulso(p);
      overlay.querySelector('[data-avisar]')?.addEventListener('click', () => marcarAvisado(p));
      overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
    } catch (err) { console.error(err); showToast('Erro ao despachar o pedido.'); }
  };
  overlay.querySelectorAll('[data-uid]').forEach(btn => {
    btn.onclick = async () => {
      const escolhido = entregadores.find(e => e.uid === btn.dataset.uid);
      btn.disabled = true;
      try {
        await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
          status: 'entrega',
          motoboyId: escolhido.uid,
          motoboyNome: escolhido.nome,
          saiuParaEntregaEm: serverTimestamp(),
          atualizadoEm: serverTimestamp()
        });
        avisarCliente(p.id);
        const link = linkAvisoWhats(p);
        if (!link) { overlay.remove(); showToast(`Pedido #${p.numeroPedido || ''} enviado para ${escolhido.nome}`); return; }
        overlay.querySelector('.card').innerHTML = `
          <h3>✅ Pedido #${esc(p.numeroPedido || '')} com ${esc(escolhido.nome)}</h3>
          <p class="gc-dica" style="margin:8px 0 14px;">Avise o cliente que o pedido saiu — vai com o link para ele ver a moto no mapa.</p>
          <a class="btn-primary btn-whats" data-avisar="1" href="${esc(link)}" target="_blank" rel="noopener">📲 Avisar cliente no WhatsApp</a>
          <button class="btn-outline-sm" data-fechar style="width:100%; margin-top:8px;">Agora não</button>`;
        overlay.querySelector('[data-avisar]').onclick = () => { marcarAvisado(p); setTimeout(() => overlay.remove(), 300); };
        overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        showToast('Erro ao despachar o pedido.');
      }
    };
  });
}

// ===================== Estoque rápido (todos da equipe) =====================
async function apiEstoque(corpo) {
  const u = auth.currentUser;
  const r = await fetch('/api/estoque', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível mexer no estoque.');
  return d;
}

async function abrirEstoqueRapido() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form" style="max-width:520px; width:100%; max-height:92vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>📦 Estoque de hoje</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Caiu, estragou, deu de brinde? Toque em <strong>−1 perda</strong>. Chegou mais? <strong>+1</strong> ou <strong>Definir</strong>. As vendas já descontam sozinhas.</p>
      <div data-lista><p class="gc-dica">Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const lista = overlay.querySelector('[data-lista]');
  let produtos = [];
  async function carregar() {
    try {
      const snap = await getDoc(doc(db, 'lojas', AppState.lojaId, 'publico', 'cardapio_completo'));
      produtos = ((snap.exists() && snap.data().produtos) || []).filter(p => p.controlarEstoque);
    } catch (err) { lista.innerHTML = '<p class="gc-dica">Não foi possível carregar.</p>'; return; }
    if (!produtos.length) { lista.innerHTML = '<p class="gc-dica">Nenhum produto com controle de estoque. Ligue em ⚙ Configurações → Produtos e preços → produto → "Controlar estoque".</p>'; return; }
    lista.innerHTML = produtos.map(p => {
      const q = estoqueAtual(p, AppState.lojaDados);
      return `<div class="mb-bag-linha" style="align-items:center; gap:6px; flex-wrap:wrap;">
        <span style="flex:1; min-width:140px;"><strong>${esc(p.nome)}</strong><br/><small style="color:${q <= 0 ? 'var(--danger)' : q <= 3 ? 'var(--warning)' : 'inherit'};">${q <= 0 ? 'Esgotado' : q + ' un.'}${Number(p.estoqueDiario) > 0 ? ` · repõe ${Number(p.estoqueDiario)} todo dia` : ''}</small></span>
        <button type="button" class="btn-outline-sm" data-perda="${esc(p.id)}" ${q <= 0 ? 'disabled' : ''}>−1 perda</button>
        <button type="button" class="btn-outline-sm" data-mais="${esc(p.id)}">+1</button>
        <button type="button" class="btn-outline-sm" data-definir="${esc(p.id)}">Definir</button>
      </div>`;
    }).join('');
    lista.querySelectorAll('[data-perda]').forEach(b => b.onclick = () => escolherMotivo(b.dataset.perda));
    lista.querySelectorAll('[data-mais]').forEach(b => b.onclick = () => mexer({ produtoId: b.dataset.mais, delta: 1, motivo: 'reposicao' }, b));
    lista.querySelectorAll('[data-definir]').forEach(b => b.onclick = () => {
      const p = produtos.find(x => x.id === b.dataset.definir);
      const t = prompt(`Quantas unidades de "${p.nome}" tem agora?`, String(estoqueAtual(p, AppState.lojaDados)));
      if (t === null) return;
      const valor = Math.round(Number(String(t).replace(',', '.')));
      if (!Number.isFinite(valor) || valor < 0 || valor > 100000) { showToast('Número inválido.'); return; }
      mexer({ acao: 'definir', produtoId: p.id, valor }, b);
    });
  }
  function escolherMotivo(produtoId) {
    const p = produtos.find(x => x.id === produtoId);
    const caixa = document.createElement('div');
    caixa.className = 'gc-overlay';
    caixa.innerHTML = `<div class="card gc-form" style="max-width:340px; width:100%; margin:0;">
      <h3>−1 ${esc(p.nome)}</h3><p class="gc-dica">O que aconteceu?</p>
      <div style="display:grid; gap:6px;">
        <button type="button" class="btn-outline-sm" data-m="quebra">💥 Caiu / quebrou / estragou</button>
        <button type="button" class="btn-outline-sm" data-m="consumo">🍽 Consumo da equipe</button>
        <button type="button" class="btn-outline-sm" data-m="brinde">🎁 Brinde / cortesia</button>
        <button type="button" class="btn-outline-sm" data-m="acerto">🔢 Contagem errada</button>
        <button type="button" class="btn-outline-sm" data-cancelar>Cancelar</button>
      </div></div>`;
    document.body.appendChild(caixa);
    caixa.querySelector('[data-cancelar]').onclick = () => caixa.remove();
    caixa.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { caixa.remove(); mexer({ produtoId, delta: -1, motivo: b.dataset.m }); });
  }
  async function mexer(corpo, botao) {
    if (botao) botao.disabled = true;
    try {
      const d = await apiEstoque(corpo);
      showToast(d.estoque != null ? `Estoque agora: ${d.estoque} un.` : 'Estoque atualizado.');
    } catch (err) { showToast(err.message); }
    await carregar();
  }
  carregar();
}

// ===================== Menu único de configurações do dono =====================
// Tudo o que é ajuste da loja fica aqui, separado por assunto, para o painel ter poucos botões.
const MENU_CONFIG = [
  { titulo: '🍕 Cardápio', itens: [
    { icone: '🍕', nome: 'Produtos e preços', dica: 'Adicionar, editar, fotos, ofertas e estoque', abrir: () => abrirGestaoCardapio() },
    { icone: '📥', nome: 'Importar cardápio', dica: 'Modelo pronto do seu ramo ou planilha', abrir: () => abrirImportarCardapio() }
  ] },
  { titulo: '🏪 Página da loja', itens: [
    { icone: '🎨', nome: 'Aparência', dica: 'Logo, capa, cores e descrição', abrir: () => abrirConfigAparencia() },
    { icone: '🕒', nome: 'Horários', dica: 'Dias e horas de funcionamento', abrir: () => abrirConfigHorarios() },
    { icone: '🛵', nome: 'Entrega e frete', dica: 'Endereço da loja, taxas e áreas', abrir: () => abrirConfigEntrega() },
    { icone: '🔳', nome: 'QR Code para mesa', dica: 'Cartaz para imprimir: o cliente pede pelo celular', abrir: () => abrirQrLoja() },
    { icone: '💳', nome: 'Pix automático', dica: 'Receber pelo Mercado Pago', abrir: () => abrirConfigPix() }
  ] },
  { titulo: '👥 Equipe', itens: [
    { icone: '👥', nome: 'Equipe e entregadores', dica: 'Balcão, cozinha e motoboys', abrir: () => abrirEquipe() },
    { icone: '🛵', nome: 'Repasse dos motoboys', dica: 'Diária, valor por entrega, chuva e meta', abrir: () => abrirConfigRepasse() },
    { icone: '🔐', nome: 'PIN do dono', dica: 'Funcionário só cancela pedido com seu PIN', abrir: () => abrirConfigPin() },
    { icone: '💰', nome: 'Acerto dos motoboys', dica: 'Fechar o turno e ver quanto pagar', abrir: () => abrirAcertos() }
  ] },
  { titulo: '📈 Vendas e clientes', itens: [
    { icone: '📊', nome: 'Relatórios', dica: 'Faturamento, mais vendidos, horário de pico', abrir: () => abrirRelatorios() },
    { icone: '📇', nome: 'Clientes', dica: 'Quem compra, quanto gasta e quando voltou', abrir: () => abrirClientes() },
    { icone: '🎁', nome: 'Cartão fidelidade', dica: 'A cada X pedidos o cliente ganha desconto', abrir: () => abrirConfigFidelidade() },
    { icone: '⭐', nome: 'Avaliações', dica: 'O que os clientes acharam', abrir: () => abrirAvaliacoes() },
    { icone: '🛒', nome: 'Carrinhos abandonados', dica: 'Quem desistiu no meio do pedido', abrir: () => abrirCarrinhos() }
  ] },
  { titulo: '🔒 Segurança', itens: [
    { icone: '📦', nome: 'Baixar backup da loja', dica: 'Arquivo com cardápio, pedidos, clientes e acertos', abrir: () => baixarBackupLoja() }
  ] }
];

function abrirMenuConfig() {
  const slug = AppState.lojaDados.slug || AppState.slug || '';
  const linkLoja = `${window.location.origin}/${slug}`;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form cfg-menu" style="max-width:520px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>⚙ Configurações da loja</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div class="cfg-link">
        <span>🔗 Link da sua loja</span>
        <a href="${esc(linkLoja)}" target="_blank" rel="noopener">${esc(linkLoja.replace(/^https?:\/\//, ''))}</a>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-outline-sm" type="button" data-copiar>📋 Copiar link</button>
          <a class="btn-outline-sm" href="${esc(linkLoja)}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;">👀 Ver como o cliente vê</a>
        </div>
      </div>
      ${MENU_CONFIG.map((g, gi) => `
        <h4 class="gc-subtitulo">${g.titulo}</h4>
        <div class="cfg-grade">
          ${g.itens.map((it, ii) => `<button type="button" class="cfg-item" data-g="${gi}" data-i="${ii}"><span class="cfg-icone">${it.icone}</span><span><strong>${esc(it.nome)}</strong><small>${esc(it.dica)}</small></span></button>`).join('')}
        </div>`).join('')}
    </div>`;
  document.body.appendChild(overlay);
  const fechar = () => overlay.remove();
  overlay.querySelector('[data-fechar]').onclick = fechar;
  overlay.onclick = (e) => { if (e.target === overlay) fechar(); };
  overlay.querySelector('[data-copiar]').onclick = async () => {
    try { await navigator.clipboard.writeText(linkLoja); showToast('Link copiado!'); } catch (_) { showToast(linkLoja, 6000); }
  };
  overlay.querySelectorAll('.cfg-item').forEach(b => {
    b.onclick = () => { fechar(); MENU_CONFIG[b.dataset.g].itens[b.dataset.i].abrir(); };
  });
}


// ===================== Modos de operação, entrega própria e retirada =====================
const clientesChegaramAvisados = new Set();
function tocarAvisoChegada() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 660 + i * 330; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.3, ctx.currentTime + t); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18); });
  } catch (_) {}
}

function urlRota(p) {
  return p.destinoCoords
    ? `https://www.google.com/maps/dir/?api=1&travelmode=two-wheeler&destination=${p.destinoCoords.lat},${p.destinoCoords.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.enderecoTexto || '')}`;
}

function linkProntoWhats(p) {
  const numero = String(p.clienteWhatsapp || '').replace(/\D/g, '');
  if (numero.length < 10) return null;
  const primeiro = String(p.clienteNome || '').trim().split(/\s+/)[0] || '';
  const texto = `Olá${primeiro ? `, ${primeiro}` : ''}! Seu pedido #${p.numeroPedido || ''} da ${AppState.lojaDados.nome} está PRONTO para retirada 🛍️ É só falar o número ${p.numeroPedido || ''} no balcão.`;
  return `https://wa.me/${numero.startsWith('55') ? numero : '55' + numero}?text=${encodeURIComponent(texto)}`;
}

// Texto pronto para mandar no WhatsApp de um motoboy avulso (cooperativa, app de entregas, conhecido)
async function copiarResumoAvulso(p) {
  const ep = p.enderecoPartes || {};
  const cobrar = p.pagamentoStatus === 'aprovado' ? 'JÁ PAGO (não cobrar)'
    : p.formaPagamento === 'dinheiro' ? `Cobrar ${formatarCentavos(p.totalCentavos)} em DINHEIRO${p.trocoParaCentavos > p.totalCentavos ? ` (troco para ${formatarCentavos(p.trocoParaCentavos)}: levar ${formatarCentavos(p.trocoParaCentavos - p.totalCentavos)})` : ''}`
    : p.formaPagamento === 'pix' ? `Pix: confirmar com a loja (${formatarCentavos(p.totalCentavos)})`
    : `Cobrar ${formatarCentavos(p.totalCentavos)} na MAQUININHA`;
  const linhas = [
    `🛵 Entrega ${AppState.lojaDados.nome} · Pedido #${p.numeroPedido || ''}`,
    ep.bairro ? `📍 ${ep.bairro.toUpperCase()}` : null,
    `🏠 ${ep.rua ? `${ep.rua}${ep.numero ? ', ' + ep.numero : ''}` : (p.enderecoTexto || '')}`,
    ep.compl ? `Ref.: ${ep.compl}` : null,
    `🗺 Mapa: ${urlRota(p)}`,
    `👤 ${p.recebedorNome || p.clienteNome || ''}${p.recebedorWhats || p.clienteWhatsapp ? ` · 📞 ${p.recebedorWhats || p.clienteWhatsapp}` : ''}`,
    `💵 ${cobrar}`
  ].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(linhas); showToast('📋 Resumo copiado! Cole no WhatsApp do entregador.'); }
  catch (_) { prompt('Copie o resumo:', linhas); }
}

// Sem entregador: vira retirada, tira a taxa do total e abre o WhatsApp do cliente com a mensagem pronta
async function converterParaRetirada(p) {
  const frete = Number(p.freteCentavos) || 0;
  const pagoPix = p.pagamentoStatus === 'aprovado';
  if (!confirm(`Converter o pedido #${p.numeroPedido || ''} para RETIRADA no balcão?\n\nA taxa de entrega (${formatarCentavos(frete)}) sai do total.${pagoPix && frete ? ' Como já foi pago no Pix, devolva a taxa ao cliente pelo Pix.' : ''}`)) return;
  if (frete && !(await pedirPinDono('tirar a taxa de entrega do pedido'))) return;
  try {
    await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
      tipoEntrega: 'retirada', freteCentavos: 0, totalCentavos: Math.max(0, (Number(p.totalCentavos) || 0) - frete),
      convertidoRetirada: true, freteDevolverCentavos: pagoPix ? frete : 0, atualizadoEm: serverTimestamp()
    });
    const numero = String(p.clienteWhatsapp || '').replace(/\D/g, '');
    if (numero.length >= 10) {
      const primeiro = String(p.clienteNome || '').trim().split(/\s+/)[0] || '';
      const texto = `Olá${primeiro ? `, ${primeiro}` : ''}! Aqui é da ${AppState.lojaDados.nome}. Tivemos um imprevisto com o entregador agora 😕 Podemos deixar seu pedido #${p.numeroPedido || ''} pronto para retirada no balcão?${frete ? (pagoPix ? ` Devolvemos o valor da taxa de entrega (${formatarCentavos(frete)}) pelo Pix.` : ` A taxa de entrega (${formatarCentavos(frete)}) foi retirada do total.`) : ''}`;
      window.open(`https://wa.me/${numero.startsWith('55') ? numero : '55' + numero}?text=${encodeURIComponent(texto)}`, '_blank');
    }
    showToast('Pedido convertido para retirada.');
  } catch (err) { console.error(err); showToast('Não foi possível converter o pedido.'); }
}

// Modo de operação: 🟢 entrega + retirada · 🟡 só retirada · 🔵 entrega própria (sem app de motoboy)
const MODOS = [
  { id: 'completo', icone: '🟢', nome: 'Entrega + Retirada' },
  { id: 'retirada', icone: '🟡', nome: 'Só retirada' },
  { id: 'propria', icone: '🔵', nome: 'Entrega própria' }
];
function desenharModoOperacao() {
  const box = document.getElementById('modo-op');
  if (!box) return;
  const l = AppState.lojaDados;
  const atual = modoOperacaoAtual(l);
  const padrao = ['completo', 'retirada', 'propria'].includes(l.modoPadrao) ? l.modoPadrao : 'completo';
  box.innerHTML = `
    <div class="modo-op-botoes">${MODOS.map(m => `<button type="button" class="modo-op-btn${m.id === atual ? ' ativo' : ''}" data-modo="${m.id}">${m.icone} ${m.nome}</button>`).join('')}</div>
    ${atual !== padrao ? `<small class="modo-op-aviso">⏳ Modo temporário: volta sozinho para "${MODOS.find(m => m.id === padrao).nome}" amanhã de manhã.</small>` : ''}`;
  box.querySelectorAll('[data-modo]').forEach(b => {
    b.onclick = () => escolherModo(b.dataset.modo, padrao);
  });
}
function escolherModo(modo, padrao) {
  const nome = MODOS.find(m => m.id === modo).nome;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:380px; width:100%; margin:0;">
      <h3>${MODOS.find(m => m.id === modo).icone} ${nome}</h3>
      <p class="gc-dica" style="margin:6px 0 12px;">${modo === 'retirada' ? 'Novos clientes só conseguem pedir para retirar no balcão. Pedidos de entrega que já entraram continuam aqui para você despachar.' : modo === 'propria' ? 'Você mesmo (ou um entregador sem o app) faz as entregas: no pedido, toque em "Despachar" e escolha "Eu mesmo".' : 'Volta ao normal: entrega com motoboys + retirada.'}</p>
      ${modo === padrao ? '' : '<button class="btn-primary" type="button" data-quando="hoje">Só hoje (volta sozinho amanhã)</button>'}
      <button class="btn-outline-sm" type="button" data-quando="sempre" style="width:100%; margin-top:8px;">Deixar sempre assim</button>
      <button class="btn-outline-sm" type="button" data-fechar style="width:100%; margin-top:8px;">Cancelar</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelectorAll('[data-quando]').forEach(b => {
    b.onclick = async () => {
      // "Só hoje" vale até as 5h da manhã seguinte
      const ate = new Date(); ate.setDate(ate.getDate() + (ate.getHours() < 5 ? 0 : 1)); ate.setHours(5, 0, 0, 0);
      const dados = b.dataset.quando === 'hoje'
        ? { modoOperacao: { modo, ate: Timestamp.fromDate(ate) } }
        : { modoPadrao: modo, modoOperacao: null };
      try {
        await updateDoc(doc(db, 'lojas', AppState.lojaId), dados);
        Object.assign(AppState.lojaDados, dados);
        overlay.remove();
        desenharModoOperacao();
        showToast(`Modo: ${nome}${b.dataset.quando === 'hoje' ? ' (só hoje)' : ''}`);
      } catch (err) { console.error(err); showToast('Não foi possível mudar o modo.'); }
    };
  });
}

// 🟢 Online / 🟠 sem internet (os pedidos já recebidos continuam na tela e sincronizam ao voltar)
function ligarIndicadorRede() {
  const el = document.getElementById('status-rede');
  if (!el) return;
  const desenhar = () => {
    el.innerHTML = navigator.onLine ? '<span style="color:var(--success);">🟢 Online</span>' : '<span class="rede-offline">🟠 Sem internet: os pedidos na tela continuam valendo e tudo sincroniza quando a conexão voltar</span>';
  };
  window.addEventListener('online', desenhar);
  window.addEventListener('offline', desenhar);
  desenhar();
}


// Pedido já saiu com o motoboy e precisa ser cancelado: o balcão decide se o motoboy recebe a corrida
function cancelarEmRota(p) {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  const valor = calcularRepasse(AppState.lojaDados.repasse, p);
  overlay.innerHTML = `
    <div class="card" style="max-width:400px; width:100%; margin:0;">
      <h3>✖ Cancelar o pedido #${esc(p.numeroPedido || '')} em rota</h3>
      <p class="gc-dica" style="margin:6px 0 12px;">O entregador já saiu. Ele recebe pela viagem?</p>
      <button class="btn-primary" type="button" data-manter="1">Cancelar e PAGAR a corrida ao motoboy${valor ? ` (${formatarCentavos(valor)})` : ''}</button>
      <button class="btn-outline-sm" type="button" data-manter="0" style="width:100%; margin-top:8px;">Cancelar SEM pagar (ele nem chegou a sair)</button>
      <button class="btn-outline-sm" type="button" data-fechar style="width:100%; margin-top:8px;">Voltar</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelectorAll('[data-manter]').forEach(b => {
    b.onclick = async () => {
      const manter = b.dataset.manter === '1' && Boolean(p.motoboyId);
      if (!(await pedirPinDono('cancelar um pedido em rota'))) return;
      try {
        await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
          status: 'cancelado', canceladoEmRota: true, canceladoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
          manterRepasse: manter, ...(manter ? { repasseMotoboyCentavos: valor } : {})
        });
        avisarCliente(p.id);
        overlay.remove();
        showToast(manter ? 'Cancelado. A corrida entra no extrato do motoboy.' : 'Pedido cancelado.');
      } catch (err) { console.error(err); showToast('Não foi possível cancelar.'); }
    };
  });
}


// ===================== PIN do dono =====================
// Funcionário do balcão: cancelar pedido aceito ou mexer no valor exige o PIN de 4 dígitos do dono.
// O dono logado não precisa digitar. O PIN é conferido no servidor (o app nunca vê o PIN guardado).
async function apiPin(corpo) {
  const u = auth.currentUser;
  const r = await fetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível conferir o PIN.');
  return d;
}

function pedirPinDono(acao) {
  if (papel === 'dono') return Promise.resolve(true);
  return new Promise((resolver) => {
    const overlay = document.createElement('div');
    overlay.className = 'gc-overlay';
    overlay.innerHTML = `
      <form class="card" style="max-width:340px; width:100%; margin:0; text-align:center;" novalidate>
        <h3>🔐 PIN do dono</h3>
        <p class="gc-dica" style="margin:6px 0 10px;">Para ${esc(acao)}, peça ao dono digitar o PIN.</p>
        <input name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="pin-campo" placeholder="••••" />
        <p class="gc-dica" id="pin-erro" style="color:var(--danger); min-height:18px;"></p>
        <button class="btn-primary" type="submit">Confirmar</button>
        <button class="btn-outline-sm" type="button" data-fechar style="width:100%; margin-top:8px;">Cancelar</button>
      </form>`;
    document.body.appendChild(overlay);
    const f = overlay.querySelector('form');
    const fim = (ok) => { overlay.remove(); resolver(ok); };
    f.pin.focus();
    overlay.querySelector('[data-fechar]').onclick = () => fim(false);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try { await apiPin({ acao: 'verificar', pin: f.pin.value.trim() }); fim(true); }
      catch (err) { overlay.querySelector('#pin-erro').textContent = err.message; f.pin.value = ''; f.pin.focus(); btn.disabled = false; }
    };
  });
}

// Dono: criar ou trocar o PIN
async function abrirConfigPin() {
  let temPin = false;
  try { temPin = (await apiPin({ acao: 'status' })).temPin; } catch (_) {}
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:380px; width:100%; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;"><h3>🔐 PIN do dono</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button></div>
      <p class="gc-dica">${temPin ? '✅ Sua loja já tem PIN. Digite um novo para trocar.' : 'Crie um PIN de 4 números.'} O funcionário do balcão vai precisar dele para <strong>cancelar um pedido já aceito</strong> ou <strong>tirar a taxa de entrega</strong>. Você, logado como dono, não precisa digitar.</p>
      <label>Novo PIN (4 números)</label>
      <input name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" class="pin-campo" />
      <label>Repita o PIN</label>
      <input name="pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" class="pin-campo" />
      <p class="gc-dica">Não use datas fáceis como 1234 ou o ano de nascimento.</p>
      <button class="btn-primary" type="submit">💾 Salvar PIN</button>
    </form>`;
  document.body.appendChild(overlay);
  const f = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const pin = f.pin.value.trim();
    if (!/^\d{4}$/.test(pin)) return showToast('O PIN precisa ter 4 números.');
    if (pin !== f.pin2.value.trim()) return showToast('Os dois PINs estão diferentes.');
    if (['0000', '1111', '1234', '4321', '2222', '9999'].includes(pin)) return showToast('Esse PIN é fácil demais. Escolha outro.');
    try { await apiPin({ acao: 'definir', pin }); showToast('🔐 PIN salvo!'); overlay.remove(); }
    catch (err) { showToast(err.message, 5000); }
  };
}

// Cancelar pedido já aceito (em preparo): dono direto; funcionário com PIN. Guarda o motivo e quem cancelou.
async function cancelarAceito(p) {
  const motivo = prompt(`Cancelar o pedido #${p.numeroPedido || ''}? Escreva o motivo:`);
  if (motivo === null) return;
  if (motivo.trim().length < 3) { showToast('Escreva o motivo do cancelamento.'); return; }
  if (!(await pedirPinDono('cancelar um pedido aceito'))) return;
  try {
    await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', p.id), {
      status: 'cancelado', canceladoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
      motivoCancelamento: motivo.trim().slice(0, 200), canceladoPor: auth.currentUser ? auth.currentUser.uid : null, canceladoComPin: papel !== 'dono'
    });
    avisarCliente(p.id);
    showToast(`Pedido #${p.numeroPedido || ''} cancelado.`);
  } catch (err) { console.error(err); showToast('Não foi possível cancelar.'); }
}
