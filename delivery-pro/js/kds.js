// Tela da cozinha (KDS): só os itens, em letra grande, sem valores nem dados do cliente.
import { db, showToast, esc, saudacao } from './config.js';
import { AppState } from './router.js';
import { avisarCliente } from './notificar.js';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let audio = null;
const conhecidos = new Set();

function bipe() {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.setValueAtTime(880, audio.currentTime);
  osc.frequency.setValueAtTime(1100, audio.currentTime + 0.15);
  gain.gain.setValueAtTime(0.3, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.5);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.5);
}

const minutosDesde = (p) => { const t = p.pagoEm?.toMillis ? p.pagoEm.toMillis() : p.criadoEm?.toMillis ? p.criadoEm.toMillis() : null; return t ? Math.floor((Date.now() - t) / 60000) : 0; };

export function iniciarKds(nome = '') {
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
      <div style="flex-basis:100%;">${saudacao(nome, 'cozinha')}</div>
      <strong>${AppState.lojaDados.layoutVitrine === 'varejo' ? '📦 Separação' : '👨‍🍳 Cozinha'} — ${esc(AppState.lojaDados.nome)}</strong>
      <button id="kds-som" class="btn-primary" style="width:auto;">🔊 Ativar som</button>
    </div>
    <div class="kds-grade" id="kds-lista"><p style="color:var(--text-muted);">Carregando pedidos...</p></div>
  `;
  document.getElementById('kds-som').onclick = async (e) => {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') await audio.resume();
    bipe();
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (_) {}
    e.target.classList.add('hidden');
  };

  let ultimos = [];
  const render = () => {
    const lista = document.getElementById('kds-lista');
    if (!lista) return;
    const visiveis = ultimos.filter(p => !(p.status === 'preparo' && p.pronto));
    if (!visiveis.length) {
      lista.innerHTML = `<div class="card"><p style="color:var(--text-muted);">Nenhum pedido para preparar agora. 🎉</p><p class="gc-dica">🟢 Conectado à ${esc(AppState.lojaDados.nome)}. Pedido novo aparece aqui sozinho, com som (toque em 🔊 Ativar som).</p></div>`;
      return;
    }
    lista.innerHTML = visiveis.map(p => {
      const min = minutosDesde(p);
      return `
        <div class="kds-card ${p.status === 'novo' ? 'kds-novo' : ''} ${min >= 20 ? 'kds-demorado' : ''}">
          <div class="kds-topo">
            <strong>#${esc(p.numeroPedido || p.id.slice(0, 4))}</strong>
            <span>${p.tipoEntrega === 'retirada' ? '🏪 RETIRADA' : '🛵 ENTREGA'} · ⏱ ${min} min</span>
          </div>
          ${p.liberadoEm ? '<div class="kds-liberado">📤 Balcão já chamou o motoboy</div>' : ''}
          <ul class="kds-itens">
            ${(p.itens || []).map(i => `
              <li><strong>${esc(i.quantidade)}x</strong> ${esc(i.nome)}
                ${i.detalhes?.length ? `<div class="kds-det">${esc(i.detalhes.join(' • '))}</div>` : ''}
              </li>`).join('')}
          </ul>
          ${p.status === 'novo'
            ? `<button class="btn-primary" data-aceitar="${esc(p.id)}">Aceitar e começar</button>`
            : `<button class="btn-primary kds-pronto" data-pronto="${esc(p.id)}">✅ Pronto</button>`}
        </div>
      `;
    }).join('');
    lista.querySelectorAll('[data-aceitar]').forEach(b => b.onclick = () => atualizar(b.dataset.aceitar, { status: 'preparo', aceitoEm: serverTimestamp() }));
    lista.querySelectorAll('[data-pronto]').forEach(b => b.onclick = () => atualizar(b.dataset.pronto, { pronto: true, prontoEm: serverTimestamp() }));
  };

  const atualizar = async (id, dados) => {
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'pedidos', id), { ...dados, atualizadoEm: serverTimestamp() });
      if (dados.status) avisarCliente(id);
    } catch (err) {
      console.error(err);
      showToast('Erro ao atualizar o pedido.');
    }
  };

  onSnapshot(
    query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('status', 'in', ['novo', 'preparo'])),
    (snap) => {
      const tempo = (p) => (p.criadoEm?.toMillis ? p.criadoEm.toMillis() : Date.now());
      ultimos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => tempo(a) - tempo(b));
      const primeiraCarga = conhecidos.size === 0;
      let chegou = false;
      ultimos.forEach(p => { if (!conhecidos.has(p.id)) { if (!primeiraCarga) chegou = true; conhecidos.add(p.id); } });
      if (chegou) bipe();
      render();
    },
    (err) => {
      console.error(err);
      document.getElementById('kds-lista').innerHTML = err && err.code === 'permission-denied'
        ? '<div class="card">🔒 Esta conta não tem acesso aos pedidos desta loja. Peça ao dono para conferir o cadastro em ⚙ Configurações → Equipe (e entre de novo).</div>'
        : '<div class="card">📵 Não foi possível carregar os pedidos (internet?). A tela tenta de novo sozinha; se continuar, feche e abra o app.</div>';
    }
  );
  setInterval(render, 60000); // atualiza os minutos
}
