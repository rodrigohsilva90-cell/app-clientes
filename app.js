// ============================================================
// APP.JS - NAVEGAÇÃO, DARK MODE, FAB, OFFLINE & ATALHOS / APPS
// ============================================================

// ------------------------------------------------------------
// 1. TEMA ESCURO (DARK MODE) COM PERSISTÊNCIA
// ------------------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem('user_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);

  if (isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
  updateThemeButtonIcon();
}

window.toggleDarkMode = function() {
  const isDarkNow = document.body.classList.toggle('dark-mode');
  localStorage.setItem('user_theme', isDarkNow ? 'dark' : 'light');
  updateThemeButtonIcon();
};

function updateThemeButtonIcon() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = document.body.classList.contains('dark-mode');
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro';
}

// ------------------------------------------------------------
// 2. MONITORAMENTO DE REDE (ONLINE / OFFLINE)
// ------------------------------------------------------------
function initNetworkWatcher() {
  const banner = document.getElementById('offlineBanner');

  function updateStatus() {
    if (!banner) return;
    if (navigator.onLine) {
      banner.style.display = 'none';
    } else {
      banner.style.display = 'block';
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

// ------------------------------------------------------------
// 3. BOTÃO FLUTUANTE DE AÇÃO RÁPIDA (FAB)
// ------------------------------------------------------------
window.toggleFabMenu = function() {
  const menu = document.getElementById('fabMenu');
  const mainBtn = document.getElementById('fabMainBtn');
  if (!menu) return;

  const isOpen = menu.style.display === 'flex';
  if (isOpen) {
    menu.style.display = 'none';
    if (mainBtn) mainBtn.textContent = '⚡';
  } else {
    menu.style.display = 'flex';
    if (mainBtn) mainBtn.textContent = '✕';
  }
};

window.closeFabMenu = function() {
  const menu = document.getElementById('fabMenu');
  const mainBtn = document.getElementById('fabMainBtn');
  if (menu) menu.style.display = 'none';
  if (mainBtn) mainBtn.textContent = '⚡';
};

window.openQuickNewClient = function() {
  closeFabMenu();
  switchAppTab('clients');
  const form = document.getElementById('clientForm');
  if (form && (form.style.display === 'none' || form.style.display === '')) {
    if (typeof toggleClientForm === 'function') toggleClientForm();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ------------------------------------------------------------
// 5. NAVEGAÇÃO ENTRE ABAS PRINCIPAIS & ATALHOS DO FINANCEIRO
// ------------------------------------------------------------
const tabButtons = {
  clients: document.getElementById('tabNavClients'),
  apps: document.getElementById('tabNavApps'),
  finance: document.getElementById('tabNavFinance'),
  servers: document.getElementById('tabNavServers'),
  settings: document.getElementById('tabNavSettings')
};

const tabContents = {
  clients: document.getElementById('tabContentClients'),
  apps: document.getElementById('tabContentApps'),
  servers: document.getElementById('tabContentServers'),
  finance: document.getElementById('tabContentFinance'),
  settings: document.getElementById('tabContentSettings')
};

window.switchAppTab = function(tabKey) {
  Object.keys(tabButtons).forEach(key => {
    if (tabButtons[key]) {
      if (key === tabKey) tabButtons[key].classList.add('active');
      else tabButtons[key].classList.remove('active');
    }
  });

  Object.keys(tabContents).forEach(key => {
    if (tabContents[key]) {
      tabContents[key].style.display = key === tabKey ? 'block' : 'none';
    }
  });

  if (tabKey === 'clients' && typeof renderClients === 'function') {
    renderClients();
  } else if (tabKey === 'finance' && typeof updateDashboard === 'function') {
    updateDashboard();
  } else if (tabKey === 'servers' && typeof renderServersTab === 'function') {
    renderServersTab();
  }

  closeFabMenu();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};


// Navegação direta e imediata clicando nos cards do Financeiro (Próx 7 dias / Em Atraso)
window.navigateToFilteredClients = function(filterType) {
  if (typeof switchAppTab === 'function') {
    switchAppTab('clients');
  } else {
    const clientsBtn = document.getElementById('tabNavClients');
    if (clientsBtn) clientsBtn.click();
  }

  setTimeout(() => {
    const targetTab = document.querySelector(`.filter-tabs .tab[onclick*="'${filterType}'"]`);
    if (typeof setFilter === 'function') {
      setFilter(filterType, targetTab);
    }
    const searchSection = document.querySelector('.search-box') || document.querySelector('.filter-tabs');
    if (searchSection) {
      searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 60);
};

// ------------------------------------------------------------
// 6. BARRA DE COTA DO PLANO DO REVENDEDOR
// ------------------------------------------------------------
// Conta Master com a casa aberta (dona da carteira). Calculada na hora, para não depender da ordem das telas.
window.isAiMasterNow = function() {
  const u = window.currentUser;
  if (!u || !u.email || !window.MASTER_ADMIN_EMAIL) return false;
  return u.email.toLowerCase() === String(window.MASTER_ADMIN_EMAIL).toLowerCase() && window.activeOwnerId === u.uid;
};

window.updateResellerQuotaBar = function(activeClientsCount) {
  const box = document.getElementById('resellerQuotaBox');
  const numbers = document.getElementById('resellerQuotaNumbers');
  const barFill = document.getElementById('resellerQuotaBarFill');
  const upgradeBtn = document.getElementById('btnQuotaUpgrade');

  if (!box || !numbers || !barFill) return;

  const rData = window.currentResellerData || (typeof currentResellerData !== 'undefined' ? currentResellerData : null);
  const isMaster = window.currentUser && window.MASTER_ADMIN_EMAIL && window.currentUser.email.toLowerCase() === window.MASTER_ADMIN_EMAIL.toLowerCase();

  const ownMaster = !!(isMaster && window.activeOwnerId === window.currentUser.uid);
  const aiBtn = document.getElementById('btnAiReport'); if (aiBtn) aiBtn.style.display = ownMaster ? 'block' : 'none';
  const aiFab = document.getElementById('fabAiReport'); if (aiFab) aiFab.style.display = ownMaster ? '' : 'none';
  if (window.aiRenderHomeBox) window.aiRenderHomeBox();

  if (isMaster) {
    box.style.display = 'none';
    return;
  }

  const maxClients = (rData && rData.maxClients) ? parseInt(rData.maxClients, 10) : 15;
  const count = parseInt(activeClientsCount || 0, 10);
  const percentage = Math.min(100, Math.round((count / maxClients) * 100));

  box.style.display = 'block';
  numbers.textContent = `${count} / ${maxClients}`;
  barFill.style.width = `${percentage}%`;

  if (percentage >= 80) {
    barFill.style.background = percentage >= 100 ? 'var(--danger)' : 'var(--warning)';
    if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
  } else {
    barFill.style.background = 'var(--primary)';
    if (upgradeBtn) upgradeBtn.style.display = 'none';
  }
};

// ------------------------------------------------------------
// 7. GESTÃO E SINCRONIZAÇÃO DA ABA APPS (CUSTOM APPS)
// ------------------------------------------------------------
let unsubscribeCustomApps = null;

window.listenCustomApps = function(ownerId) {
  if (!ownerId) return;
  if (unsubscribeCustomApps) unsubscribeCustomApps();

  const container = document.getElementById('customAppsList');

  unsubscribeCustomApps = db.collection("custom_apps")
    .where("ownerId", "==", ownerId)
    .onSnapshot((snapshot) => {
      window.customAppsCache = snapshot.docs.map(d => d.data());
      if (!container) return;
      container.innerHTML = '';

      if (snapshot.empty) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.76rem; padding: 10px 0;">Nenhum atalho cadastrado.</p>';
        return;
      }

      snapshot.forEach(doc => {
        const app = doc.data();
        const safeUrl = safeHttpUrl(app.url);
        const card = document.createElement('div');
        card.className = 'app-card-btn';
        card.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 6px;';

        card.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
            <span style="font-size: 1.2rem;">⭐</span>
            <div style="overflow: hidden;">
              <strong style="font-size: 0.84rem; color: var(--text-main); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(app.name || 'App')}</strong>
              <small style="font-size: 0.7rem; color: var(--text-muted); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(app.url || '')}</small>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <a href="${esc(safeUrl || '#')}" ${safeUrl ? '' : 'aria-disabled="true" onclick="return false;" '}target="_blank" rel="noopener noreferrer" class="btn-tool" style="background: var(--primary); padding: 5px 8px; font-size: 0.7rem; text-decoration: none; color: #fff; font-weight: bold; border-radius: 4px;">Abrir ↗</a>
            <button type="button" class="btn-cancel" style="padding: 4px 6px; font-size: 0.7rem; color: var(--danger);" title="Excluir Atalho">✕</button>
          </div>
        `;

        card.querySelector('.btn-cancel').addEventListener('click', async () => {
          if (confirm(`Remover o atalho "${app.name}"?`)) {
            try {
              await db.collection("custom_apps").doc(doc.id).delete();
            } catch (err) {
              alert("Erro ao remover atalho: " + err.message);
            }
          }
        });

        container.appendChild(card);
      });
    }, (err) => {
      console.warn("Erro ao carregar atalhos de apps:", err);
    });
};

window.saveCustomApp = async function(event) {
  event.preventDefault();
  const nameInp = document.getElementById('customAppName');
  const urlInp = document.getElementById('customAppUrl');
  const btn = document.getElementById('btnSaveCustomApp');

  if (!nameInp || !urlInp) return;
  const name = nameInp.value.trim();
  const url = urlInp.value.trim();

  if (!name || !url) return alert("Preencha o nome e o link do aplicativo.");
  const cleanUrl = safeHttpUrl(url);
  if (!cleanUrl) return alert("O link precisa começar com http:// ou https://");

  const ownerId = window.activeOwnerId || (window.currentUser ? window.currentUser.uid : null);
  if (!ownerId) return alert("Sessão não identificada. Faça login novamente.");

  if (btn) btn.disabled = true;

  try {
    await db.collection("custom_apps").add({
      name,
      url: cleanUrl,
      ownerId,
      createdAt: getTodayLocal()
    });

    nameInp.value = '';
    urlInp.value = '';
    alert("✅ Atalho adicionado com sucesso!");
  } catch (err) {
    alert("Erro ao salvar atalho: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ------------------------------------------------------------
// 8. ABA SERVIDORES & DNS (IP numérico e/ou URL, por servidor)
// ------------------------------------------------------------
function srvList() { return (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : []; }
function srvClients(srv) { const n = v => String(v || '').trim().toLowerCase(); return clients.filter(c => (c.serverId && c.serverId === srv.id) || (!c.serverId && n(c.assignedServer) === n(srv.name))); }
function srvEsc(t) { return (typeof safeEsc === 'function') ? safeEsc(t) : String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

// Histórico em subcoleção: não cresce dentro do documento de configurações
function logServerChange(action, detail) {
  const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
  if (!activeOwnerId) return;
  fs.collection("settings").doc(activeOwnerId).collection("server_log").add({ at: new Date().toISOString(), action, detail: detail || '' }).catch(() => {});
}

// Altera a lista de servidores partindo da versão ATUAL do Firestore (transação).
// Antes o app regravava a lista que tinha em memória: com o app aberto em dois aparelhos,
// um apagava o que o outro tinha gravado (estoque de créditos, edição de servidor).
// `mutate` recebe uma cópia da lista e devolve a lista nova.
async function updateServers(mutate) {
  const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
  if (!activeOwnerId) throw new Error('Sessão não identificada. Faça login novamente.');
  const ref = fs.collection("settings").doc(activeOwnerId);
  const copy = (list) => (Array.isArray(list) ? list : []).map(s => ({ ...s }));
  let result = null;
  if (navigator.onLine === false) {
    // Sem internet não dá para ler a versão atual: grava a local e o Firestore envia quando voltar
    result = mutate(copy(srvList()));
    userServers = result;
    ref.set({ servers: result }, { merge: true }).catch(e => console.warn('Gravação de servidores pendente falhou:', e));
    return result;
  }
  await fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const remote = Array.isArray(data.servers) ? normalizeServersList(data.servers).list : srvList();
    result = mutate(copy(remote));
    tx.set(ref, { servers: result }, { merge: true });
  });
  userServers = result;
  return result;
}

// Estoque de créditos por servidor (null = não controlado)
function serverHasStock(srv) { return srv && srv.creditStock !== null && srv.creditStock !== undefined && srv.creditStock !== '' && !isNaN(Number(srv.creditStock)); }
// Créditos só para quem vence em até 7 dias (inclui vencidos): evita comprar o mês todo e travar o caixa
const CREDIT_WINDOW_DAYS = 7;
function serverCreditsNeeded(srv) {
  return srvClients(srv).filter(c => !c.isArchived && !c.isDeleted && !c.isTrial && c.dueDate && getStatus(c.dueDate).diffDays <= CREDIT_WINDOW_DAYS).length;
}

// Faixa na tela inicial: estoque de cada servidor com controle, num relance
window.updateCreditStrip = function() {
  const box = document.getElementById('creditStrip');
  if (!box) return;
  const list = srvList().filter(s => s.active !== false && serverHasStock(s));
  if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  const W = CREDIT_WINDOW_DAYS;
  box.innerHTML = `<div class="cs-head">📦 Créditos em estoque</div>` + list.map(s => {
    const stock = Number(s.creditStock), need = serverCreditsNeeded(s);
    let cls, msg;
    if (stock < need) { cls = 'bad'; msg = `Faltam <b>${need - stock}</b>: ${need} cliente${need > 1 ? 's vencem' : ' vence'} em até ${W} dias`; }
    else if (need === 0) { cls = stock <= 0 ? 'bad' : 'ok'; msg = stock <= 0 ? 'Sem estoque' : `Ninguém vence em ${W} dias`; }
    else { cls = (stock - need <= 1) ? 'warn' : 'ok'; msg = `Cobre os ${need} que vencem em ${W} dias${stock > need ? ` • sobram ${stock - need}` : ''}`; }
    return `<button type="button" class="cs-row ${cls}" data-credit-srv="${srvEsc(s.id)}" aria-label="Adicionar crédito em ${srvEsc(s.name)}">
      <span class="cs-name">${srvEsc(s.name)}<small>${msg}</small></span>
      <span class="cs-num"><b>${stock}</b><small>crédito${stock === 1 ? '' : 's'}</small></span>
      <span class="cs-add" aria-hidden="true">+</span>
    </button>`;
  }).join('');
};

// Faixa na tela inicial: suportes abertos que ainda não foram fechados (evita ficar pela metade)
window.updateOpenSupportStrip = function() {
  const box = document.getElementById('openSupportStrip');
  if (!box) return;
  const list = (typeof clients !== 'undefined' ? clients : []).filter(c => c && !c.isArchived && !c.isDeleted && c.supportOpenAt);
  if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  list.sort((a, b) => String(a.supportOpenAt).localeCompare(String(b.supportOpenAt)));
  box.style.display = '';
  box.innerHTML = `<div class="cs-head">🤝 Suportes em aberto (${list.length})</div>` + list.map(c => {
    const openedMs = Date.parse(c.supportOpenAt);
    const hrs = isFinite(openedMs) ? Math.max(0, Math.round((Date.now() - openedMs) / 3600000)) : null;
    const cls = (hrs == null) ? 'warn' : (hrs >= 24 ? 'bad' : (hrs >= 4 ? 'warn' : 'ok'));
    const when = hrs == null ? '' : (hrs < 1 ? 'aberto há poucos minutos' : hrs < 24 ? `aberto há ${hrs}h` : `aberto há ${Math.round(hrs / 24)}d`);
    return `<button type="button" class="cs-row ${cls}" data-open-support="${srvEsc(c.id)}" aria-label="Fechar suporte de ${srvEsc(c.name || c.username)}">
      <span class="cs-name">${srvEsc(c.name || c.username)}<small>${srvEsc(c.supportOpenReason || 'Suporte')} • ${when}</small></span>
      <span class="cs-add" aria-hidden="true">✓</span>
    </button>`;
  }).join('');
};
document.addEventListener('click', function(ev) {
  const b = ev.target.closest && ev.target.closest('[data-open-support]');
  if (b && typeof openSupportCloseModal === 'function') openSupportCloseModal(b.getAttribute('data-open-support'));
});
document.addEventListener('click', function(ev) {
  const b = ev.target.closest && ev.target.closest('[data-credit-srv]');
  if (b) openQuickCredits(b.getAttribute('data-credit-srv'));
});

// Modal rápido (botão ⚡ e faixa): adiciona créditos sem abrir a aba Servidores
window.openQuickCredits = function(preId) {
  if (typeof closeFabMenu === 'function') closeFabMenu();
  const old = document.getElementById('quickCreditsOverlay'); if (old) old.remove();
  const servers = srvList().filter(s => s.active !== false);
  if (!servers.length) return alert('Cadastre um servidor primeiro (aba Servidores).');
  const filter = (typeof currentGlobalServer !== 'undefined') ? currentGlobalServer : '';
  const pre = servers.find(s => s.id === preId) || servers.find(s => s.name === filter) || servers[0];
  const ov = document.createElement('div');
  ov.id = 'quickCreditsOverlay'; ov.className = 'modal-backdrop'; ov.style.zIndex = '10050';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `<div class="modal-card" style="max-width:380px; text-align:left;">
    <h3 style="margin:0 0 10px;">📦 Adicionar crédito</h3>
    <div class="field"><label for="qcServer">Servidor</label><select id="qcServer">${servers.map(s => `<option value="${srvEsc(s.id)}" ${s.id === pre.id ? 'selected' : ''}>${srvEsc(s.name)}</option>`).join('')}</select></div>
    <div id="qcInfo" style="font-size:0.78rem; margin:-2px 0 10px;"></div>
    <div class="field"><label for="qcQty">Quantos créditos você comprou?</label>
      <input type="number" id="qcQty" min="1" step="1" inputmode="numeric" placeholder="Ex: 5">
      <div style="display:flex; gap:6px; margin-top:6px;">${[1, 5, 10, 20].map(n => `<button type="button" class="btn-tool qc-chip" data-n="${n}" style="flex:1; padding:6px;">+${n}</button>`).join('')}</div></div>
    <div style="display:flex; gap:8px; margin-top:10px;"><button type="button" class="btn-cancel" id="qcCancel" style="flex:1;">Cancelar</button><button type="button" class="btn-pix-save" id="qcOk" style="flex:2; background:#059669;">Adicionar</button></div></div>`;
  document.body.appendChild(ov);
  const sel = ov.querySelector('#qcServer'), qty = ov.querySelector('#qcQty'), info = ov.querySelector('#qcInfo');
  const close = () => ov.remove();
  const paint = () => {
    const s = srvList().find(x => x.id === sel.value);
    const need = serverCreditsNeeded(s);
    info.innerHTML = serverHasStock(s)
      ? `Estoque atual: <b>${Number(s.creditStock)}</b> • vencem em até ${CREDIT_WINDOW_DAYS} dias: <b>${need}</b>${need > Number(s.creditStock) ? ` → <b style="color:#dc2626;">faltam ${need - Number(s.creditStock)}</b>` : ''}`
      : `Estoque ainda não controlado. Vencem em até ${CREDIT_WINDOW_DAYS} dias: <b>${need}</b>.`;
  };
  sel.addEventListener('change', paint); paint();
  ov.querySelectorAll('.qc-chip').forEach(b => b.addEventListener('click', () => { qty.value = (parseInt(qty.value, 10) || 0) + parseInt(b.dataset.n, 10); }));
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#qcCancel').addEventListener('click', close);
  ov.querySelector('#qcOk').addEventListener('click', async () => {
    const n = parseInt(qty.value, 10);
    if (!n || n < 1) return alert('Informe quantos créditos foram comprados.');
    const s = srvList().find(x => x.id === sel.value);
    const okBtn = ov.querySelector('#qcOk');
    okBtn.disabled = true;
    const left = await adjustServerStock(s, n, 'compra', { startAtZero: true });
    if (left === null) { okBtn.disabled = false; return alert('Não consegui gravar o estoque. Confira a internet e tente de novo.'); }
    close();
    showToast(`${s.name}: estoque agora é ${left}`);
  });
  setTimeout(() => qty.focus(), 50);
};
// Desliga o controle de estoque em todos os servidores de uma vez (creditStock -> null).
// A necessidade (quantos clientes vencem em até CREDIT_WINDOW_DAYS dias) continua calculada
// e exibida normalmente — só para de pedir que o estoque seja alimentado manualmente.
window.disableAllCreditStock = async function() {
  const tracked = srvList().filter(s => serverHasStock(s));
  if (!tracked.length) return showToast('Nenhum servidor está com estoque controlado.');
  if (!confirm(`Isso para de controlar o estoque de crédito em ${tracked.length} servidor(es). Os avisos de "faltam créditos" não aparecem mais, mas o número de clientes que vencem em breve continua aparecendo normalmente. Quer continuar?`)) return;
  try {
    await updateServers(list => list.map(s => ({ ...s, creditStock: null })));
    logServerChange('stock', 'Estoque de crédito deixou de ser controlado (todos os servidores).');
    if (typeof updateCreditStrip === 'function') updateCreditStrip();
    if (typeof renderServersTab === 'function') renderServersTab();
    showToast('Estoque de crédito desativado em todos os servidores.');
  } catch (e) {
    alert('Não consegui salvar: ' + (e && e.message ? e.message : e));
  }
};
// Soma (ou subtrai) créditos do estoque partindo do valor atual do Firestore.
// opts.startAtZero: servidor ainda sem controle de estoque passa a ter, começando em 0 (compra).
// Devolve o novo estoque, ou null se o servidor não controla estoque / a gravação falhou.
window.adjustServerStock = async function(srv, delta, why, opts) {
  opts = opts || {};
  if (!srv || !delta) return null;
  if (!serverHasStock(srv) && !opts.startAtZero) return null;
  let next = null;
  try {
    await updateServers(list => list.map(s => {
      if (s.id !== srv.id) return s;
      if (!serverHasStock(s) && !opts.startAtZero) return s;
      const base = serverHasStock(s) ? Number(s.creditStock) : 0;
      next = Math.max(0, base + delta);
      return { ...s, creditStock: next };
    }));
    if (next !== null) logServerChange('stock', `${srv.name}: ${delta > 0 ? '+' : ''}${delta} (${why || 'ajuste'}) → ${next}`);
  } catch (e) {
    console.warn('estoque', e);
    return null;
  }
  if (typeof renderServersTab === 'function') renderServersTab();
  updateCreditStrip();
  return next;
};
window.addServerCredits = function(id) { return openQuickCredits(id); };

function refreshServerDependents() {
  if (typeof populateClientServerOptions === 'function') populateClientServerOptions();
  if (typeof updateGlobalServerSelectOptions === 'function') updateGlobalServerSelectOptions();
  renderServersTab();
  updateCreditStrip();
  if (typeof renderClients === 'function') renderClients();
}

window.renderServersTab = function() {
  const box = document.getElementById('serversTabList');
  if (!box) return;
  const servers = srvList();
  if (servers.length === 0) {
    box.innerHTML = '<p style="font-size:0.78rem; color:var(--text-muted);">Nenhum servidor cadastrado. Toque em ➕ Novo servidor.</p>';
    return;
  }
  const line = (label, value) => value
    ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:0.74rem;"><span style="min-width:0; word-break:break-all;"><strong>${label}:</strong> ${srvEsc(value)}</span><button type="button" class="btn-tool" style="padding:2px 8px; font-size:0.68rem;" data-srv-copy="${srvEsc(value)}">Copiar</button></div>`
    : `<div style="font-size:0.72rem; color:var(--text-muted);"><strong>${label}:</strong> não cadastrado</div>`;

  box.innerHTML = servers.map(srv => {
    const linked = srvClients(srv);
    const activeCount = linked.filter(c => !c.isArchived).length;
    const on = srv.active !== false;
    return `
      <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:10px; ${on ? '' : 'opacity:.85;'}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:0.86rem;">🖥️ ${srvEsc(srv.name)}</strong>
          <span style="font-size:0.68rem; font-weight:700; padding:2px 8px; border-radius:99px; ${on ? 'background:#dcfce7; color:#166534;' : 'background:#fef3c7; color:#92400e;'}">${on ? 'Ativo' : '⚠️ Inativo'}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:6px;">
          ${(() => { const d = serverDnsLists(srv); return (d.ips.length ? d.ips.map((v, i) => line('DNS IP' + (d.ips.length > 1 ? ' ' + (i + 1) : ''), v)).join('') : line('DNS IP', '')) + (d.urls.length ? d.urls.map((v, i) => line('DNS URL' + (d.urls.length > 1 ? ' ' + (i + 1) : ''), v)).join('') : line('DNS URL', '')); })()}
          <div style="font-size:0.72rem;"><strong>💳 Crédito:</strong> ${(srv.costPerCredit === null || srv.costPerCredit === undefined || srv.costPerCredit === '') ? '<span style="color:var(--text-muted);">usa o custo padrão</span>' : 'R$ ' + Number(srv.costPerCredit).toFixed(2).replace('.', ',')}</div>
          ${(() => {
            if (!serverHasStock(srv)) return '<div style="font-size:0.72rem; color:var(--text-muted);"><strong>📦 Estoque:</strong> não controlado (use ✏️ Editar ou ➕ Créditos)</div>';
            const stock = Number(srv.creditStock), need = serverCreditsNeeded(srv), miss = Math.max(0, need - stock);
            const tone = stock <= 0 ? 'background:#fee2e2; color:#991b1b;' : (miss > 0 ? 'background:#fef3c7; color:#92400e;' : 'background:#dcfce7; color:#166534;');
            return `<div style="font-size:0.72rem; padding:6px 8px; border-radius:6px; ${tone}"><strong>📦 Estoque:</strong> ${stock} crédito(s) • Vencem em até ${CREDIT_WINDOW_DAYS} dias: ${need}${miss > 0 ? ` → <strong>comprar ${miss}</strong>` : ' ✓ cobre a semana'}</div>`;
          })()}
          ${srv.panelUrl ? `<div style="font-size:0.72rem; word-break:break-all;"><strong>Painel:</strong> ${srvEsc(srv.panelUrl)}</div>` : ''}
          ${srv.notes ? `<div style="font-size:0.72rem; color:var(--text-muted);">📝 ${srvEsc(srv.notes)}</div>` : ''}
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:8px;">👥 ${activeCount} cliente(s) ativo(s) • ${linked.length} no total</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn-act-sub" style="flex:1; padding:6px; font-size:0.72rem; border:1px solid var(--border); background:var(--surface); color:var(--text-main); border-radius:4px; cursor:pointer;" data-srv-act="edit" data-srv-id="${srvEsc(srv.id)}">✏️ Editar</button>
          <button type="button" class="btn-act-sub" style="flex:1; padding:6px; font-size:0.72rem; border:1px solid var(--border); background:var(--surface); color:var(--text-main); border-radius:4px; cursor:pointer;" data-srv-act="clients" data-srv-id="${srvEsc(srv.id)}">👥 Clientes</button>
          <button type="button" class="btn-act-sub" style="flex:1; padding:6px; font-size:0.72rem; border:1px solid var(--border); background:var(--surface); color:var(--text-main); border-radius:4px; cursor:pointer;" data-srv-act="credits" data-srv-id="${srvEsc(srv.id)}">➕ Créditos</button>
          <button type="button" class="btn-act-sub" style="flex:1; padding:6px; font-size:0.72rem; border:1px solid var(--border); background:var(--surface); color:var(--text-main); border-radius:4px; cursor:pointer;" data-srv-act="toggle" data-srv-id="${srvEsc(srv.id)}">${on ? '⏸ Desativar' : '▶ Ativar'}</button>
          <button type="button" class="btn-act-sub" style="padding:6px 10px; font-size:0.72rem; border:1px solid #fecaca; background:#fef2f2; color:#991b1b; border-radius:4px; cursor:pointer;" data-srv-act="delete" data-srv-id="${srvEsc(srv.id)}">✕</button>
        </div>
      </div>`;
  }).join('');
};

document.addEventListener('click', function(ev) {
  const t = ev.target.closest && ev.target.closest('[data-srv-copy],[data-srv-act]');
  if (!t) return;
  if (t.hasAttribute('data-srv-copy')) return window.copyServerValue(t, t.getAttribute('data-srv-copy'));
  const id = t.getAttribute('data-srv-id');
  const act = t.getAttribute('data-srv-act');
  if (act === 'edit') editServer(id);
  else if (act === 'clients') showServerClients(id);
  else if (act === 'credits') addServerCredits(id);
  else if (act === 'toggle') toggleServerActive(id);
  else if (act === 'delete') deleteServer(id);
});

window.copyServerValue = function(btn, value) {
  const done = () => { const t = btn.textContent; btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = t; }, 1200); };
  const text = String(value == null ? '' : value);
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => alert(text));
  else alert(text);
};

window.newServerForm = function() { fillServerForm({ id: '', name: '', costPerCredit: null, creditStock: null, dnsIps: [], dnsUrls: [], panelUrl: '', notes: '', active: true }, 'Novo servidor'); };
window.editServer = function(id) { const s = srvList().find(x => x.id === id); if (s) fillServerForm(s, 'Editar servidor'); };
window.closeServerForm = function() { const c = document.getElementById('serverFormCard'); if (c) c.style.display = 'none'; };

window.applyServerPaste = function() {
  const area = document.getElementById('srvPasteArea');
  const result = document.getElementById('srvPasteResult');
  if (!area) return;
  const r = parseServerPaste(area.value);

  // não perde o que já foi digitado: só acrescenta valores novos
  const existing = kind => [...document.querySelectorAll(kind === 'ip' ? '#srvFormIpList .srv-ip-inp' : '#srvFormUrlList .srv-url-inp')];
  const addUnique = (kind, values) => {
    let added = 0;
    values.forEach(v => {
      const rows = existing(kind);
      if (rows.some(i => i.value.trim() === v)) return;
      const empty = rows.find(i => !i.value.trim());
      if (empty) empty.value = v; else addServerDnsRow(kind, v);
      added++;
    });
    return added;
  };

  const nameEl = document.getElementById('srvFormName');
  const panelEl = document.getElementById('srvFormPanel');
  let nameSet = false, panelSet = false;
  if (r.name && nameEl && !nameEl.value.trim()) { nameEl.value = r.name; nameSet = true; }
  if (r.panelUrl && panelEl && !panelEl.value.trim()) { panelEl.value = r.panelUrl; panelSet = true; }
  const ips = addUnique('ip', r.ips);
  const urls = addUnique('url', r.urls);

  const parts = [];
  if (nameSet) parts.push('nome');
  if (ips) parts.push(`${ips} IP${ips > 1 ? 's' : ''}`);
  if (urls) parts.push(`${urls} URL${urls > 1 ? 's' : ''}`);
  if (panelSet) parts.push('painel');
  if (result) result.textContent = parts.length ? `✔ Preenchido: ${parts.join(', ')}. Confira e salve.` : '⚠️ Nada reconhecido no texto. Confira o conteúdo colado.';
  if (parts.length) area.value = '';
};

window.addServerDnsRow = function(kind, value) {
  const box = document.getElementById(kind === 'ip' ? 'srvFormIpList' : 'srvFormUrlList');
  if (!box) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:4px;';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = kind === 'ip' ? 'srv-ip-inp' : 'srv-url-inp';
  inp.inputMode = 'url'; inp.autocomplete = 'off';
  inp.placeholder = kind === 'ip' ? 'Ex: http://192.168.0.10:8080' : 'Ex: http://dns.link.tv:80';
  inp.style.cssText = 'flex:1; padding:8px; font-size:0.78rem;';
  inp.value = value || '';
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'btn-cancel'; del.textContent = '✕';
  del.style.cssText = 'padding:6px 10px; color:var(--danger);';
  del.onclick = () => row.remove();
  row.appendChild(inp); row.appendChild(del);
  box.appendChild(row);
};

function fillServerForm(s, title) {
  document.getElementById('serverFormTitle').textContent = title;
  document.getElementById('srvFormId').value = s.id || '';
  document.getElementById('srvFormName').value = s.name || '';
  const costEl = document.getElementById('srvFormCost');
  if (costEl) costEl.value = (s.costPerCredit === null || s.costPerCredit === undefined || s.costPerCredit === '') ? '' : s.costPerCredit;
  const d = serverDnsLists(s);
  const stockEl = document.getElementById('srvFormStock');
  if (stockEl) stockEl.value = (s.creditStock === null || s.creditStock === undefined || s.creditStock === '') ? '' : s.creditStock;
  document.getElementById('srvFormIpList').innerHTML = '';
  document.getElementById('srvFormUrlList').innerHTML = '';
  (d.ips.length ? d.ips : ['']).forEach(v => addServerDnsRow('ip', v));
  (d.urls.length ? d.urls : ['']).forEach(v => addServerDnsRow('url', v));
  document.getElementById('srvFormPanel').value = s.panelUrl || '';
  document.getElementById('srvFormNotes').value = s.notes || '';
  document.getElementById('srvFormActive').checked = s.active !== false;
  const pasteArea = document.getElementById('srvPasteArea'); if (pasteArea) pasteArea.value = '';
  const pasteRes = document.getElementById('srvPasteResult'); if (pasteRes) pasteRes.textContent = '';
  const card = document.getElementById('serverFormCard');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.saveServerForm = async function() {
  const id = document.getElementById('srvFormId').value;
  const name = document.getElementById('srvFormName').value.trim();
  const uniq = arr => [...new Set(arr)];
  const dnsIps = uniq([...document.querySelectorAll('#srvFormIpList .srv-ip-inp')].map(i => i.value.trim()).filter(Boolean));
  const dnsUrls = uniq([...document.querySelectorAll('#srvFormUrlList .srv-url-inp')].map(i => i.value.trim()).filter(Boolean));
  const panelUrl = document.getElementById('srvFormPanel').value.trim();
  const notes = document.getElementById('srvFormNotes').value.trim();
  const active = document.getElementById('srvFormActive').checked;
  const costRaw = (document.getElementById('srvFormCost') || { value: '' }).value.trim().replace(',', '.');
  const costPerCredit = costRaw === '' ? null : parseFloat(costRaw);
  if (costRaw !== '' && (isNaN(costPerCredit) || costPerCredit < 0)) return alert('Valor do crédito inválido. Use um número, por exemplo 10.00');
  const stockRaw = (document.getElementById('srvFormStock') || { value: '' }).value.trim();
  const creditStock = stockRaw === '' ? null : parseInt(stockRaw, 10);
  if (stockRaw !== '' && (isNaN(creditStock) || creditStock < 0)) return alert('Estoque de créditos inválido. Use um número inteiro, por exemplo 20');

  if (!name) return alert('Informe o nome do servidor.');
  if (srvList().some(s => s.id !== id && (s.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return alert('Já existe um servidor com esse nome. Use um nome diferente.');
  }
  const badIp = dnsIps.find(v => !isValidIpv4Dns(v));
  if (badIp) return alert(`DNS numérico inválido: ${badIp}\nExemplos: 192.168.0.10:8080 ou http://192.168.0.10:8080`);
  const badUrl = dnsUrls.find(v => !isValidUrlDns(v));
  if (badUrl) return alert(`DNS por URL inválido: ${badUrl}\nUse o formato http://dns.exemplo.com:80 (IP vai nos campos numéricos).`);
  if (panelUrl && !/^https?:\/\/\S+$/i.test(panelUrl)) return alert('URL do painel inválida. Comece com http:// ou https://');

  const rec = { id: id || generateServerId(), name, costPerCredit, creditStock, dnsIps, dnsUrls, dnsIp: dnsIps[0] || '', dnsUrl: dnsUrls[0] || '', panelUrl, notes, active };
  rec.dns = serverDnsForM3u(rec);

  const prev = srvList().find(s => s.id === id);
  const renamed = prev && prev.name !== name;
  // Estoque que o usuário não mexeu no formulário não é regravado: outro aparelho pode ter
  // renovado clientes (e descontado créditos) enquanto o formulário estava aberto.
  const prevStock = prev && serverHasStock(prev) ? Number(prev.creditStock) : null;
  const patch = { ...rec };
  if (prev && creditStock === prevStock) delete patch.creditStock;

  try {
    const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
    // 1) salva a lista de servidores; 2) só depois atualiza os clientes. Se o passo 2 falhar,
    // os clientes ainda resolvem o servidor pelo serverId e nada fica inconsistente.
    const affected = prev ? srvClients(prev) : [];
    await updateServers(list => {
      const i = list.findIndex(s => s.id === rec.id);
      if (i >= 0) { list[i] = { ...list[i], ...patch }; return list; }
      return list.concat([rec]);
    });
    logServerChange(prev ? 'edit' : 'create', `${prev ? prev.name + ' → ' : ''}${name}${renamed ? ' (renomeado)' : ''}`);
    for (let i = 0; i < affected.length; i += 400) {
      const batch = fs.batch();
      affected.slice(i, i + 400).forEach(c => batch.update(fs.collection('clients').doc(c.id), { assignedServer: name, serverId: rec.id }));
      await batch.commit();
    }
    closeServerForm();
    refreshServerDependents();
  } catch (e) {
    alert('Erro ao salvar servidor: ' + e.message);
  }
};

window.toggleServerActive = async function(id) {
  const srv = srvList().find(s => s.id === id);
  if (!srv) return;
  const turningOff = srv.active !== false;
  const affected = srvClients(srv).filter(c => !c.isArchived).length;
  if (turningOff && !confirm(`Desativar "${srv.name}"?\n\n${affected} cliente(s) ativo(s) ficarão sinalizados com ⚠️ e o portal avisará indisponibilidade.`)) return;
  try {
    await updateServers(list => list.map(s => s.id === id ? { ...s, active: !turningOff } : s));
    logServerChange(turningOff ? 'deactivate' : 'activate', srv.name);
    refreshServerDependents();
  } catch (e) { alert('Erro: ' + e.message); }
};

window.deleteServer = async function(id) {
  const srv = srvList().find(s => s.id === id);
  if (!srv) return;
  const linked = srvClients(srv).length;
  if (linked > 0) return alert(`"${srv.name}" possui ${linked} cliente(s) vinculado(s). Mova esses clientes para outro servidor antes de excluir (ou apenas desative o servidor).`);
  if (!confirm(`Excluir o servidor "${srv.name}"?`)) return;
  try {
    await updateServers(list => list.filter(s => s.id !== id));
    logServerChange('delete', srv.name);
    refreshServerDependents();
  } catch (e) { alert('Erro: ' + e.message); }
};

window.showServerClients = function(id) {
  const srv = srvList().find(s => s.id === id);
  if (!srv) return;
  switchAppTab('clients');
  const sel = document.getElementById('globalServerFilter');
  if (sel) sel.value = srv.name;
  changeGlobalServerFilter(srv.name);
};

window.savePixKey = async function() {
  const pixInput = document.getElementById('pixKeyInput');
  if (!pixInput) return;

  const keyVal = pixInput.value.trim();
  const typeEl = document.getElementById('pixKeyTypeInput');
  const typeVal = typeEl ? typeEl.value : 'auto';
  myPixKey = keyVal;
  window.myPixKeyType = typeVal;
  if (keyVal && typeof pixKeyForBrCode === 'function' && !pixKeyForBrCode(keyVal, typeVal)) {
    alert('Chave salva, mas o QR Code do Pix não será gerado: o tipo escolhido não combina com a chave. Confira o tipo (Celular, CPF, CNPJ, e-mail ou aleatória).');
  }

  if (activeOwnerId) {
    try {
      await db.collection("settings").doc(activeOwnerId).set({ pixKey: keyVal, pixKeyType: typeVal }, { merge: true });
    } catch (e) {
      console.warn("Erro ao salvar Pix:", e);
    }
  }

  alert("✅ Chave Pix salva com sucesso!");
  if (typeof renderClients === 'function') renderClients();
};

window.sendFeedback = async function() {
  const typeEl = document.getElementById('feedbackType');
  const msgEl = document.getElementById('feedbackMessage');
  const btn = document.getElementById('btnSubmitFeedback');

  if (!msgEl || !msgEl.value.trim()) {
    alert("Digite sua mensagem de sugestão ou erro.");
    return;
  }

  const type = typeEl ? typeEl.value : 'ideia';
  const message = msgEl.value.trim();
  const userEmail = currentUser ? (currentUser.email || currentUser.uid) : 'Anônimo';

  try {
    if (btn) btn.disabled = true;
    await db.collection("feedback").add({
      type,
      message,
      resellerEmail: userEmail,
      createdAt: getTodayLocal()
    });

    alert("✅ Feedback enviado com sucesso! Agradecemos sua colaboração.");
    msgEl.value = '';
    const charCount = document.getElementById('feedbackCharCount');
    if (charCount) charCount.textContent = '0';
  } catch (err) {
    alert("Erro ao enviar feedback: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};

const feedbackMsgEl = document.getElementById('feedbackMessage');
if (feedbackMsgEl) {
  feedbackMsgEl.addEventListener('input', function() {
    const charCount = document.getElementById('feedbackCharCount');
    if (charCount) charCount.textContent = this.value.length;
  });
}

// ------------------------------------------------------------
// 9. INICIALIZAÇÃO GERAL
// ------------------------------------------------------------
// O botão ⚡ acompanha a visibilidade do app (independe de qual tela o auth.js exibiu)
function initFabVisibility() {
  const appEl = document.getElementById('appContainer');
  const fab = document.getElementById('fabContainer');
  if (!appEl || !fab) return;

  const sync = () => {
    const visible = window.getComputedStyle(appEl).display !== 'none';
    fab.style.display = visible ? 'flex' : 'none';
  };

  new MutationObserver(sync).observe(appEl, { attributes: true, attributeFilter: ['style', 'class'] });
  sync();
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNetworkWatcher();
  initFabVisibility();

  document.addEventListener('click', (e) => {
    const fabContainer = document.getElementById('fabContainer');
    if (fabContainer && !fabContainer.contains(e.target)) {
      closeFabMenu();
    }
  });
});

// Atalhos do ícone do app (manifest): ?action=charge abre a fila de cobrança, ?action=new abre o cadastro
window.handleLaunchAction = function() {
  let act = '';
  try { act = new URLSearchParams(location.search).get('action') || ''; } catch (e) {}
  if (!act) return;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  setTimeout(() => {
    if (act === 'charge' && typeof startDailyQueueBilling === 'function') startDailyQueueBilling();
    else if (act === 'new' && typeof openQuickNewClient === 'function') openQuickNewClient();
  }, 1800);
};
