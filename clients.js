// ============================================================
// CLIENTS.JS - GESTÃO DA CARTEIRA, AÇÕES DO DIA & SINCRONIZAÇÃO
// ============================================================

let clients = [];
let currentFilter = 'all';
let currentGlobalServer = 'ALL';
let currentSort = localStorage.getItem('user_sort_order') || 'dueAsc';
const PAGE_SIZE = 20;
let currentPage = 1;
let totalPages = 1;
let unsubscribeFirestore = null;

let currentM3uClientId = null;
let pendingSupportClientId = null;
let pendingSupportCloseClientId = null;
let currentScriptClientId = null;

let currentRenewClientObj = null;
let currentRenewMonthsToAdd = 1;

let costPerCredit = parseFloat(localStorage.getItem('user_cost_per_credit') || '0');
let referralGoal = parseInt(localStorage.getItem('user_referral_goal') || '3', 10);
let referralDiscountVal = parseFloat(localStorage.getItem('user_referral_discount') || '5');
let referralFirstDiscount = parseFloat(localStorage.getItem('user_referral_first_discount') || '0') || 0;
let reactivationDiscountVal = parseFloat(localStorage.getItem('user_reactivation_discount') || '5.00');

let isDailyActionsCollapsed = localStorage.getItem('user_hide_daily_actions') === 'true';

const DEFAULT_REFERRAL_MSG = 
  `🎁 *PROGRAMA INDIQUE E GANHE!*\n\n` +
  `Olá! O seu amigo *{nome}* recomendou o melhor serviço de canais, filmes e séries para sua TV e celular!\n\n` +
  `🔥 *Vantagem Exclusiva:* Ao assinar por esta indicação, você ganha um super desconto na ativação!\n` +
  `⭐ A cada {meta} amigos indicados, você ganha *1 MÊS TOTALMENTE GRÁTIS* ou desconto na sua fatura!\n\n` +
  `👉 Peça seu teste ou tire dúvidas no suporte:\n{link}`;

let customReferralMessage = localStorage.getItem('user_referral_msg') || DEFAULT_REFERRAL_MSG;

const DEFAULT_REACTIVATION_MSG = 
  `Olá, *{nome}*, tudo bem? Aqui é do suporte.\n` +
  `Notei que seu acesso está pausado há alguns dias. Aconteceu algum problema com o sinal ou com o aplicativo na época? 🤔\n\n` +
  `Estamos com o servidor totalmente otimizado e atualizado.\n\n` +
  `Para você voltar sem compromisso, liberei uma *Condição Especial de Reativação* válida apenas esta semana: você ganha *{desconto} de desconto* na volta!\n\n` +
  `Quer que eu libere um acesso rápido hoje para você testar como ficou a estabilidade? 🚀`;

let customReactivationMessage = localStorage.getItem('user_reactivation_msg') || DEFAULT_REACTIVATION_MSG;

const clientFormEl = document.getElementById('clientForm');
const formTitleEl = document.getElementById('formTitle');
const clientIdInputEl = document.getElementById('clientId');
const serverPasswordInputEl = document.getElementById('serverPassword');
const serverPlanInputEl = document.getElementById('serverPlan');
const clientAssignedServerEl = document.getElementById('clientAssignedServer');
const clientMacAddressEl = document.getElementById('clientMacAddress');
const clientMacAppEl = document.getElementById('clientMacApp');
const referredByInputEl = document.getElementById('referredBy');
// Checkbox "desconto de boas-vindas": aparece quando há valor configurado, "Indicado por" preenchido e o cliente ainda não recebeu
// Campos de teste: só para cliente novo ou que ainda está em teste
window.updateTrialFields = function() {
  const tf = document.getElementById('trialField'), hf = document.getElementById('trialHoursField');
  const chk = document.getElementById('isTrial'), due = document.getElementById('dueDate');
  if (!tf || !chk) return;
  const id = (document.getElementById('clientId') || {}).value || '';
  const cur = id ? (clients.find(c => c.id === id) || null) : null;
  const can = !cur || cur.isTrial === true;
  tf.style.display = can ? '' : 'none';
  if (!can) chk.checked = false;
  const on = can && chk.checked;
  if (hf) hf.style.display = on ? '' : 'none';
  if (due) due.required = !on;
};
{ const tc = document.getElementById('isTrial'); if (tc) tc.addEventListener('change', () => { updateTrialFields(); updateFirstDiscountField(); }); }

window.updateFirstDiscountField = function() {
  updateTrialFields();
  const box = document.getElementById('firstDiscountField');
  if (!box) return;
  const id = (document.getElementById('clientId') || {}).value || '';
  const cur = id ? (clients.find(c => c.id === id) || null) : null;
  const trialOn = !!(document.getElementById('isTrial') && document.getElementById('isTrial').checked);
  const show = !trialOn && referralFirstDiscount > 0 && !!(referredByInputEl && referredByInputEl.value.trim()) && !(cur && cur.firstDiscountGiven);
  box.style.display = show ? '' : 'none';
  const lb = document.getElementById('firstDiscountLabel');
  if (lb) lb.textContent = `🎁 Dar desconto de boas-vindas de ${safeFormatCurrency(referralFirstDiscount, false)} na 1ª mensalidade`;
};
if (referredByInputEl) referredByInputEl.addEventListener('input', () => window.updateFirstDiscountField());
const saveBtnEl = document.getElementById('saveBtn');
const cancelEditBtnEl = document.getElementById('cancelEditBtn');
const btnToggleClientFormEl = document.getElementById('btnToggleClientForm');

const clientListEl = document.getElementById('clientList');
const searchInputEl = document.getElementById('search');
const sortOrderSelectEl = document.getElementById('sortOrder');
const globalServerFilterEl = document.getElementById('globalServerFilter');

const paginationControlsEl = document.getElementById('paginationControls');
const prevPageBtnEl = document.getElementById('prevPageBtn');
const nextPageBtnEl = document.getElementById('nextPageBtn');
const pageInfoEl = document.getElementById('pageInfo');

const countAllEl = document.getElementById('countAll');
const countOkEl = document.getElementById('countOk');
const countWarningEl = document.getElementById('countWarning');
const countExpiredEl = document.getElementById('countExpired');
const countArchivedEl = document.getElementById('countArchived');

if (sortOrderSelectEl) sortOrderSelectEl.value = currentSort;

// Volta tudo ao padrão antes de carregar a conta: evita misturar Pix, servidores e custos
// de outro usuário (ou da conta que o Master estava vendo) quando falta algum campo.
// Sem internet o Firestore guarda a gravação e envia depois; não deixa o botão travado esperando o servidor
window.offlineSafe = function(promise) {
  if (navigator.onLine === false) { Promise.resolve(promise).catch(e => console.warn('Gravação pendente falhou:', e)); return Promise.resolve({}); }
  return promise;
};

// Indicações cadastradas antes da atualização só tinham o nome/usuário de quem indicou. Grava o id (uma vez),
// para que o app e o portal contem exatamente as mesmas indicações.
window.migrateLegacyReferrals = async function() {
  if (window._legacyRefDone || !activeOwnerId) return;
  window._legacyRefDone = true;
  try {
    const pending = [];
    clients.forEach(c => {
      if (c.referredBy && !c.referredById) {
        const r = findReferrerClient(c.referredBy, c.id);
        if (r) pending.push({ id: c.id, rid: r.id });
      }
    });
    if (!pending.length) return;
    const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
    for (let i = 0; i < pending.length; i += 400) {
      const batch = fs.batch();
      pending.slice(i, i + 400).forEach(p => batch.update(fs.collection('clients').doc(p.id), { referredById: p.rid }));
      await batch.commit();
    }
  } catch (e) { console.warn('Migração de indicações:', e); }
};

window.resetUserSettingsState = function() {
  myPixKey = '';
  window.myPixKeyType = 'auto';
  costPerCredit = 0;
  referralGoal = 3;
  referralDiscountVal = 5;
  referralFirstDiscount = 0;
  reactivationDiscountVal = 5;
  customReferralMessage = DEFAULT_REFERRAL_MSG;
  customReactivationMessage = DEFAULT_REACTIVATION_MSG;
  userServers = [];
  window.portalSettings = { showUser: true, showPassword: true, showMac: true, showDnsIp: true, showDnsUrl: true,
    showM3u: true, showFinance: true, showTutorials: true, showWhatsapp: true, brandName: '' };
  window.portalSupportWhatsapp = '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('pixKeyInput', ''); set('costPerCreditInput', ''); set('referralGoalInput', 3); set('referralDiscountInput', 5); set('referralFirstDiscountInput', '');
  set('reactivationDiscountInput', 5); set('referralMessageTemplate', DEFAULT_REFERRAL_MSG);
  ['user_pix_key', 'user_cost_per_credit', 'user_referral_goal', 'user_referral_discount', 'user_referral_first_discount',
   'user_referral_msg', 'user_reactivation_discount', 'user_reactivation_msg'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
};

window.loadUserSettings = async function(userId) {
  if (!userId) return;
  resetUserSettingsState();
  try {
    const doc = await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("settings").doc(userId).get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (data.pixKey) {
        myPixKey = data.pixKey;
        localStorage.setItem('user_pix_key', myPixKey);
        const pixInp = document.getElementById('pixKeyInput');
        if (pixInp) pixInp.value = myPixKey;
      }
      window.myPixKeyType = data.pixKeyType || 'auto';
      const pixTypeInp = document.getElementById('pixKeyTypeInput');
      if (pixTypeInp) pixTypeInp.value = window.myPixKeyType;
      if (data.costPerCredit !== undefined) {
        costPerCredit = parseFloat(data.costPerCredit) || 0;
        localStorage.setItem('user_cost_per_credit', String(costPerCredit));
        const costInp = document.getElementById('costPerCreditInput');
        if (costInp) costInp.value = costPerCredit;
      }
      if (data.referralGoal) {
        referralGoal = parseInt(data.referralGoal, 10);
        localStorage.setItem('user_referral_goal', String(referralGoal));
        const goalInp = document.getElementById('referralGoalInput');
        if (goalInp) goalInp.value = referralGoal;
      }
      if (data.referralDiscount) {
        referralDiscountVal = parseFloat(data.referralDiscount);
        localStorage.setItem('user_referral_discount', String(referralDiscountVal));
        const discInp = document.getElementById('referralDiscountInput');
        if (discInp) discInp.value = referralDiscountVal;
      }
      referralFirstDiscount = parseFloat(data.referralFirstDiscount) || 0;
      localStorage.setItem('user_referral_first_discount', String(referralFirstDiscount));
      { const fdInp = document.getElementById('referralFirstDiscountInput'); if (fdInp) fdInp.value = referralFirstDiscount || ''; }
      if (typeof updateFirstDiscountField === 'function') updateFirstDiscountField();
      if (data.referralMessage) {
        customReferralMessage = data.referralMessage;
        localStorage.setItem('user_referral_msg', customReferralMessage);
        const msgInp = document.getElementById('referralMessageTemplate');
        if (msgInp) msgInp.value = customReferralMessage;
      }
      if (data.reactivationDiscount !== undefined) {
        reactivationDiscountVal = parseFloat(data.reactivationDiscount);
        localStorage.setItem('user_reactivation_discount', String(reactivationDiscountVal));
        const reactDiscInp = document.getElementById('reactivationDiscountInput');
        if (reactDiscInp) reactDiscInp.value = reactivationDiscountVal;
      }
      if (data.portalSettings && typeof data.portalSettings === 'object') {
        window.portalSettings = { ...window.portalSettings, ...data.portalSettings };
      }
      if (data.supportWhatsapp !== undefined) window.portalSupportWhatsapp = String(data.supportWhatsapp || '');
      if (typeof fillPortalSettingsForm === 'function') fillPortalSettingsForm();
      if (data.servers && Array.isArray(data.servers)) {
        const norm = normalizeServersList(data.servers);
        userServers = norm.list;
        if (norm.changed) {
          // migração: servidores antigos ganham id/DNS IP/URL sem perder dados
          (typeof db !== 'undefined' ? db : firebase.firestore()).collection("settings").doc(userId).set({ servers: userServers }, { merge: true })
            .catch(e => console.warn('Migração de servidores falhou:', e));
        }
        if (typeof renderServersTab === 'function') renderServersTab();
        populateClientServerOptions();
        updateGlobalServerSelectOptions();
      }
    }
  } catch (err) {
    console.warn("Aviso ao carregar definições:", err);
  }
};

// ============================================================
// AUTOCOMPLETE DE INDICAÇÕES POR NOME DE USUÁRIO
// ============================================================
window.updateReferralDatalist = function() {
  const dl = document.getElementById('clientsDatalist');
  if (!dl) return;
  dl.innerHTML = '';

  const sortedClients = [...clients].sort((a, b) => 
    (a.username || '').localeCompare(b.username || '')
  );

  sortedClients.forEach(c => {
    if (!c.username) return;
    const opt = document.createElement('option');
    opt.value = c.username;
    opt.textContent = c.name || '';
    opt.label = `${c.name || 'Cliente'} (@${c.username})`;
    dl.appendChild(opt);
  });
};

// ============================================================
// AÇÕES DO DIA (COMPATIBILIZADO COM O INDEX.HTML)
// ============================================================
window.toggleDailyActionsVisibility = function() {
  const container = document.getElementById('dailyActionsCollapsibleContent');
  const btn = document.getElementById('btnToggleDailyCollapse');
  if (!container) return;

  isDailyActionsCollapsed = !isDailyActionsCollapsed;
  localStorage.setItem('user_hide_daily_actions', isDailyActionsCollapsed ? 'true' : 'false');

  container.style.display = isDailyActionsCollapsed ? 'none' : 'block';
  if (btn) btn.textContent = isDailyActionsCollapsed ? '▶ Mostrar' : '▼ Ocultar';
};

// Quem entra nas Ações do Dia: vence em até 2 dias, vence hoje ou está atrasado há até 7 dias
function getDailyActionClients() {
  return clients.filter(c => {
    if (c.isArchived || c.isTrial) return false;
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return false;
    const d = getStatus(c.dueDate).diffDays;
    return d >= -7 && d <= 2;
  }).sort((a, b) => getStatus(a.dueDate).diffDays - getStatus(b.dueDate).diffDays);
}

// Atrasados há mais de 7 dias: saem das pendências normais; aqui você decide (última cobrança ou arquivar)
function getStaleOverdueClients() {
  return clients.filter(c => {
    if (c.isArchived || c.isTrial || !c.dueDate) return false;
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return false;
    return getStatus(c.dueDate).diffDays < -7;
  }).sort((a, b) => getStatus(a.dueDate).diffDays - getStatus(b.dueDate).diffDays);
}

window.archiveStaleClient = async function(id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Arquivar ${c.name}?\n\nEle sai da carteira ativa e libera uma vaga no plano. Continua na aba Arquivados e dá para reativar depois.`)) return;
  await toggleArchiveClient(id, true);
  showUndoToast(`${c.name} arquivado.`, () => toggleArchiveClient(id, false));
};

window.updateDailyActions = function() {
  const box = document.getElementById('dailyActionsSection');
  const list = document.getElementById('dailyActionsList');
  const badge = document.getElementById('dailyTotalBadge');
  const summary = document.getElementById('dailyActionsSummary');
  const content = document.getElementById('dailyActionsCollapsibleContent');
  const toggleBtn = document.getElementById('btnToggleDailyCollapse');

  if (!box || !list) return;

  const urgentClients = getDailyActionClients();
  try { if (navigator.setAppBadge) { if (urgentClients.length) navigator.setAppBadge(urgentClients.length); else navigator.clearAppBadge(); } } catch (e) {}

  const stale = getStaleOverdueClients();
  if (urgentClients.length === 0 && stale.length === 0) {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  if (badge) badge.textContent = `${urgentClients.length} pendência${urgentClients.length === 1 ? '' : 's'}${stale.length ? ` + ${stale.length} antigas` : ''}`;
  if (summary) {
    const late = urgentClients.filter(c => getStatus(c.dueDate).diffDays < 0).length;
    const today = urgentClients.filter(c => getStatus(c.dueDate).diffDays === 0).length;
    const soon = urgentClients.length - late - today;
    const parts = [];
    if (late) parts.push(`${late} em atraso (até 7 dias)`);
    if (today) parts.push(`${today} vencendo hoje`);
    if (soon) parts.push(`${soon} vencendo em até 2 dias`);
    if (stale.length) parts.push(`${stale.length} atrasado(s) há mais de 7 dias`);
    summary.textContent = parts.join(' • ');
  }

  if (content) content.style.display = isDailyActionsCollapsed ? 'none' : 'block';
  if (toggleBtn) toggleBtn.textContent = isDailyActionsCollapsed ? '▶ Mostrar' : '▼ Ocultar';

  list.innerHTML = '';
  urgentClients.forEach(c => {
    const st = getStatus(c.dueDate);
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border); padding:8px 10px; border-radius:6px; margin-bottom:6px;';

    item.innerHTML = `
      <div style="overflow:hidden; max-width:65%;">
        <strong style="font-size:0.85rem; color:var(--text-main); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${safeEsc(c.name || c.username)}
        </strong>
        <span style="font-size:0.7rem; color:${st.diffDays < 0 ? '#dc2626' : '#ea580c'}; font-weight:700;">
          ${st.label} • ${safeFormatCurrency(c.price, false)}${c.lastChargedAt === safeGetTodayLocal() ? ' • ✓ cobrado hoje' : ''}
        </span>
      </div>
      <div style="display:flex; gap:5px;">
        <button type="button" class="btn-copy-user" style="background:var(--surface-alt); border:1px solid var(--border); padding:5px 8px; border-radius:4px; cursor:pointer;" title="Copiar Usuário">📋</button>
        <button type="button" class="btn-charge" style="background:#15803d; color:#fff; border:none; padding:6px 10px; border-radius:4px; font-weight:700; font-size:0.72rem; cursor:pointer;">💬 Cobrar</button>
      </div>
    `;

    item.querySelector('.btn-copy-user').addEventListener('click', () => {
      if (navigator.clipboard) navigator.clipboard.writeText(c.username || '');
      showToast('Usuário copiado');
    });

    item.querySelector('.btn-charge').addEventListener('click', () => chargeClientNow(c));

    list.appendChild(item);
  });

  if (stale.length) {
    const head = document.createElement('div');
    head.style.cssText = 'margin:10px 0 6px; font-size:0.74rem; font-weight:700; color:var(--text-muted);';
    head.textContent = `🗂 Atrasados há mais de 7 dias (${stale.length}): cobrar uma última vez ou arquivar`;
    list.appendChild(head);
    stale.forEach(c => {
      const st = getStatus(c.dueDate);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px; background:var(--surface); border:1px dashed var(--border); padding:8px 10px; border-radius:6px; margin-bottom:6px;';
      row.innerHTML = `
        <div style="overflow:hidden; min-width:0;">
          <strong style="font-size:0.85rem; color:var(--text-main); display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeEsc(c.name || c.username)}</strong>
          <span style="font-size:0.7rem; color:#dc2626; font-weight:700;">${Math.abs(st.diffDays)} dias de atraso • ${safeFormatCurrency(c.price, false)}${c.lastChargedAt === safeGetTodayLocal() ? ' • ✓ cobrado hoje' : ''}</span>
        </div>
        <div style="display:flex; gap:5px; flex:0 0 auto;">
          <button type="button" class="btn-final" style="background:#b45309; color:#fff; border:none; padding:6px 9px; border-radius:4px; font-weight:700; font-size:0.7rem; cursor:pointer;">💬 Último aviso</button>
          <button type="button" class="btn-stale-archive" style="background:var(--surface-alt); color:var(--text-main); border:1px solid var(--border); padding:6px 9px; border-radius:4px; font-weight:700; font-size:0.7rem; cursor:pointer;">📦 Arquivar</button>
        </div>`;
      row.querySelector('.btn-final').addEventListener('click', () => chargeClientNow(c, { final: true }));
      row.querySelector('.btn-stale-archive').addEventListener('click', () => archiveStaleClient(c.id));
      list.appendChild(row);
    });
  }
};

// Abre o WhatsApp com a cobrança e marca o cliente como "cobrado hoje"
// Troca o servidor do cliente sem abrir a edição. O passado fica no servidor antigo:
// lançamentos sem servidor gravado são carimbados com o servidor de antes da troca.
window.openSwitchServer = function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  const servers = (window.userServers || []).filter(sv => sv.active !== false);
  const cur = findServerForClient(client, window.userServers);
  const ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.style.cssText = 'display:flex; z-index:10040;';
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.style.cssText = 'max-width:380px; text-align:left;';
  const h = document.createElement('h3'); h.style.cssText = 'margin:0 0 4px; font-size:1.05rem;'; h.textContent = '🔄 Trocar servidor';
  const p = document.createElement('p'); p.style.cssText = 'font-size:0.76rem; color:var(--text-muted); margin:0 0 10px;';
  p.textContent = `${client.name} está em ${client.assignedServer || 'nenhum servidor'}. O histórico de pagamentos antigo continua no servidor de antes.`;
  card.appendChild(h); card.appendChild(p);
  const close = () => ov.remove();
  servers.forEach(sv => {
    const isCur = cur && cur.id === sv.id;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = (isCur ? '✓ ' : '') + sv.name;
    b.disabled = !!isCur;
    b.style.cssText = 'display:block; width:100%; text-align:left; padding:11px 12px; margin-bottom:6px; border-radius:8px; border:1px solid var(--border); background:' + (isCur ? 'var(--surface-alt)' : 'var(--surface)') + '; color:var(--text-main); font-size:0.88rem; font-weight:700; cursor:' + (isCur ? 'default' : 'pointer') + ';';
    b.onclick = async () => {
      b.disabled = true;
      try {
        const oldName = client.assignedServer || '';
        const oldId = (cur && cur.id) || client.serverId || '';
        const hist = (Array.isArray(client.paymentHistory) ? client.paymentHistory : [])
          .map(x => (x && !x.serverName && oldName) ? { ...x, serverName: oldName, serverId: oldId } : x);
        const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
        await offlineSafe(fs.collection('clients').doc(client.id).update({ assignedServer: sv.name, serverId: sv.id, paymentHistory: hist }));
        close();
        showUndoToast(`${client.name} agora está em ${sv.name}.`, async () => {
          await fs.collection('clients').doc(client.id).update({ assignedServer: oldName, serverId: oldId });
        });
      } catch (e) { alert('Erro ao trocar: ' + e.message); b.disabled = false; }
    };
    card.appendChild(b);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn-cancel'; cancel.style.cssText = 'width:100%; padding:9px; margin-top:4px;'; cancel.textContent = 'Cancelar';
  cancel.onclick = close;
  card.appendChild(cancel);
  ov.appendChild(card);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
};

window.chargeClientNow = function(c, opts) {
  const formattedDate = formatDateYY(c.dueDate);
  const st = getStatus(c.dueDate);
  const refProgress = getClientReferralProgress(c);
  const finalTail = (opts && opts.final) ? `\n\n⚠️ *Último aviso:* se não tivermos retorno, vamos encerrar o seu acesso. Se quiser continuar, é só pagar e me avisar por aqui.` : '';
  const markSent = () => {
    try {
      const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
      offlineSafe(fs.collection("clients").doc(c.id).update({ lastChargedAt: safeGetTodayLocal() })).catch(() => {});
    } catch (e) {}
  };
  // Master: a IA escreve a abertura e a mensagem passa por revisão antes do envio (openChargeReview, ai-report.js).
  // opts.semIA pula a IA (usado pela fila "Cobrar em sequência", que é um toque por cliente).
  if (!(opts && opts.semIA) && typeof window.openChargeReview === 'function' && typeof window.isAiMasterNow === 'function' && window.isAiMasterNow()) {
    window.openChargeReview(c, formattedDate, st, myPixKey, refProgress, { finalTail, onSent: markSent });
    return;
  }
  let rawMsg = typeof buildChargeMessage === 'function'
    ? buildChargeMessage(c, formattedDate, st, myPixKey, refProgress)
    : `Olá ${c.name}, sua assinatura vence em ${formattedDate}.`;
  rawMsg += finalTail;
  openWhatsAppDirect(c.phone, rawMsg);
  markSent();
};

// Cobrança rápida em sequência: uma tela só, um botão grande no mesmo lugar.
// Toque em "Cobrar" -> abre o WhatsApp com a mensagem pronta; ao voltar para o app já está o próximo.
// (O WhatsApp só abre com um toque seu por conversa: o navegador bloqueia abrir várias sozinho.)
window.startDailyQueueBilling = function(opts) {
  opts = opts || {};
  const today = safeGetTodayLocal();
  const all = opts.list || getDailyActionClients();
  const queue = all.filter(c => !(opts.isDone ? opts.isDone(c) : c.lastChargedAt === today) && c.phone);
  const skipped = all.length - queue.length;
  if (all.length === 0) return alert(opts.emptyMsg || "Nenhuma cobrança prioritária no momento.");
  if (queue.length === 0) return alert(`Todos os ${all.length} já foram chamados hoje ou estão sem telefone.`);

  let i = 0, done = 0;
  const ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.style.cssText = 'display:flex; z-index:10040;';
  const card = document.createElement('div');
  card.className = 'modal-card';
  card.style.cssText = 'max-width:400px; text-align:center;';
  ov.appendChild(card);
  document.body.appendChild(ov);
  wakeLockOn();
  const close = () => { wakeLockOff(); ov.remove(); };

  const draw = () => {
    card.innerHTML = '';
    const mk = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
    if (i >= queue.length) {
      card.appendChild(mk('div', 'font-size:2.4rem;', '✅'));
      card.appendChild(mk('h3', 'margin:6px 0;', opts.doneTitle || 'Cobranças concluídas'));
      card.appendChild(mk('p', 'font-size:0.82rem; color:var(--text-muted); margin:0 0 12px;', `${done} enviado(s)` + (skipped ? ` • ${skipped} já enviado(s) hoje ou sem telefone` : '')));
      const ok = mk('button', 'width:100%; padding:11px;', 'Fechar'); ok.type = 'button'; ok.className = 'btn-auth'; ok.onclick = close;
      card.appendChild(ok); return;
    }
    const c = queue[i];
    const st = getStatus(c.dueDate);
    card.appendChild(mk('div', 'font-size:0.72rem; font-weight:700; color:var(--text-muted); margin-bottom:6px;', `Cobrança ${i + 1} de ${queue.length}`));
    const bar = mk('div', 'height:6px; background:var(--border); border-radius:99px; overflow:hidden; margin-bottom:12px;');
    bar.appendChild(mk('div', `height:100%; width:${Math.round((i / queue.length) * 100)}%; background:#16a34a;`));
    card.appendChild(bar);
    card.appendChild(mk('h3', 'margin:0 0 2px; font-size:1.15rem;', c.name || c.username));
    card.appendChild(mk('div', 'font-size:0.8rem; color:var(--text-muted); margin-bottom:2px;', opts.sub ? opts.sub(c) : `${st.label} • ${safeFormatCurrency(c.price, false)}`));
    card.appendChild(mk('div', 'font-size:0.74rem; color:var(--text-muted); margin-bottom:14px;', c.assignedServer || ''));
    const go = mk('button', 'width:100%; padding:15px; font-size:1rem; font-weight:800; background:#16a34a; margin-bottom:8px;', '💬 ' + (opts.verb || 'Cobrar') + ' ' + String(c.name || c.username).split(' ')[0]);
    go.type = 'button'; go.className = 'btn-auth'; go.style.background = '#16a34a';
    go.onclick = () => { (opts.send || ((x) => chargeClientNow(x, { semIA: true })))(c); done++; i++; draw(); };
    const row = mk('div', 'display:flex; gap:6px;');
    const skip = mk('button', 'flex:1; padding:9px;', 'Pular'); skip.type = 'button'; skip.className = 'btn-cancel'; skip.onclick = () => { i++; draw(); };
    const stop = mk('button', 'flex:1; padding:9px;', 'Parar'); stop.type = 'button'; stop.className = 'btn-cancel'; stop.onclick = close;
    row.appendChild(skip); row.appendChild(stop);
    card.appendChild(go); card.appendChild(row);
  };
  draw();
};

// ============================================================
// SISTEMA INDIQUE E GANHE
// ============================================================
window.sendReferralLink = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (client.referralOptOut) return alert('Este cliente saiu do programa de indicação. Use "Voltar ao programa" na ficha dele para reativar.');

  const myResellerPhone = (typeof currentResellerData !== 'undefined' && currentResellerData && currentResellerData.phone)
    ? currentResellerData.phone.replace(/\D/g, '')
    : (typeof MASTER_ADMIN_PHONE !== 'undefined' ? MASTER_ADMIN_PHONE : '');

  const textPreFilled = encodeURIComponent(`Olá! Vim indicado pelo amigo(a) ${client.name} e gostaria de testar o serviço!`);
  const referralWaLink = myResellerPhone ? `https://wa.me/${myResellerPhone}?text=${textPreFilled}` : '';

  const template = customReferralMessage || DEFAULT_REFERRAL_MSG;
  const messageFormatted = template
    .replace(/\{nome\}/gi, client.name || client.username)
    .replace(/\{meta\}/gi, String(referralGoal))
    .replace(/\{link\}/gi, referralWaLink);

  openWhatsAppDirect(client.phone, messageFormatted);
};

window.confirmRenewalReward = async function(clientId) {
  if (window._rewardBusy) return; // evita dar o mês grátis duas vezes com toque duplo
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  const refProgress = getClientReferralProgress(client);
  if (!refProgress.isGoalReached) {
    alert(`O cliente ainda não atingiu a meta de ${referralGoal} amigos ativos.`);
    return;
  }

  if (!confirm(`🎉 Confirmar resgate de +1 MÊS GRÁTIS para ${client.name} pela meta de indicações?`)) {
    return;
  }

  window._rewardBusy = true;
  try {
    const seenDue = client.dueDate || '';
    const st = getStatus(client.dueDate);
    const expired = st.diffDays < 0 || !client.dueDate;
    const baseDate = expired ? safeGetTodayLocal() : client.dueDate;
    // mesmo dia fixo de cobrança da renovação normal (31/jan -> 28/fev -> 31/mar)
    const billingDay = expired ? Number(baseDate.slice(8, 10)) : (parseInt(client.billingDay, 10) || Number(baseDate.slice(8, 10)));
    const nextDueDate = addMonthsToDate(baseDate, 1, billingDay);
    const newDateFmt = formatDateYY(nextDueDate);
    const goalUsed = referralGoal;

    const historyEntry = {
      date: safeGetTodayLocal(),
      amount: 0,
      months: 1,
      prevDueDate: seenDue,
      newDueDate: nextDueDate,
      discountApplied: parseFloat(client.price) || 0,
      cost: creditCostFor(client),
      serverName: client.assignedServer || '',
      serverId: client.serverId || '',
      paid: true,
      note: "Resgate de Recompensa: Indique e Ganhe"
    };

    const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
    const ref = fs.collection("clients").doc(client.id);
    try {
      await fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Cliente não encontrado.');
        const cur = snap.data() || {};
        if ((cur.dueDate || '') !== seenDue) throw new Error('JA_RENOVADO');
        const redeemed = parseInt(cur.referralsRedeemed || 0, 10) || 0;
        tx.update(ref, {
          dueDate: nextDueDate,
          billingDay,
          isArchived: false,
          referralsRedeemed: redeemed + goalUsed,
          paymentHistory: [...(Array.isArray(cur.paymentHistory) ? cur.paymentHistory : []), historyEntry],
          // permite "Desfazer" igual à renovação normal
          lastRenewal: {
            entry: historyEntry,
            prevDueDate: seenDue,
            prevArchived: !!cur.isArchived,
            prevBillingDay: cur.billingDay || null,
            prevTrial: false,
            discount: 0,
            owed: 0,
            redeemed: goalUsed
          }
        });
      });
    } catch (e) {
      if (e && e.message === 'JA_RENOVADO') return alert('O vencimento deste cliente mudou agora há pouco (outra renovação). Confira o card antes de dar o mês grátis.');
      throw e;
    }

    // o mês grátis também gasta 1 crédito no servidor
    let stockNote = '';
    try {
      const srvRec = findServerForClient(client, (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : []);
      if (srvRec && typeof serverHasStock === 'function' && serverHasStock(srvRec)) {
        const left = await adjustServerStock(srvRec, -1, 'mês grátis ' + (client.name || ''));
        if (left !== null) stockNote = left <= 0 ? ` ⚠️ Estoque de ${srvRec.name} acabou.` : ` Estoque ${srvRec.name}: ${left}.`;
      }
    } catch (e) { console.warn(e); }

    const rewardPortalLink = await ensurePortalLink(client);
    const rewardMessage =
      `🎉 *PARABÉNS! VOCÊ GANHOU 1 MÊS GRÁTIS!*\n\n` +
      `Olá, *${client.name}*! A sua meta no programa *Indique e Ganhe* foi batida com sucesso!\n\n` +
      `🎁 Sua assinatura referente ao usuário *${client.username}* foi estendida gratuitamente.\n` +
      `📅 *Novo Vencimento:* ${newDateFmt}\n\n` +
      portalLinkBlock(rewardPortalLink) +
      `Continue indicando amigos para ganhar mais mensalidades grátis!`;

    showUndoToast(`Mês grátis aplicado até ${newDateFmt}.${stockNote}`, () => undoLastRenewal(client.id, true));
    if (confirm("Resgate registrado com sucesso! Deseja enviar a notificação no WhatsApp do cliente?")) {
      openWhatsAppDirect(client.phone, rewardMessage);
    }
  } catch (err) {
    alert("Erro ao aplicar mês grátis: " + err.message);
  } finally {
    window._rewardBusy = false;
  }
};

// ============================================================
// MODAL DE ESCOLHA DE SERVIDOR M3U
// ============================================================
window.openM3uSelectorModal = function(clientId, btnEl, onlyServerName) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  currentM3uClientId = clientId;
  const modal = document.getElementById('m3uServerModal');
  const nameEl = document.getElementById('m3uModalClientName');
  const listEl = document.getElementById('m3uServerButtonsList');

  if (!modal || !listEl) return;
  nameEl.textContent = `Cliente: ${client.name} (${client.username})`;
  listEl.innerHTML = '';

  let servers = (typeof userServers !== 'undefined' && userServers.length > 0) ? userServers : [];
  if (onlyServerName) servers = servers.filter(s => s.name === onlyServerName);

  const entries = [];
  servers.forEach(srv => {
    buildM3uLinks(client, srv).forEach(l => entries.push({ srv, link: l }));
  });

  if (servers.length === 0) {
    listEl.innerHTML = '<p style="font-size:0.75rem; color:var(--text-muted); text-align:center;">Nenhum servidor cadastrado na aba Servidores.</p>';
  } else if (entries.length === 0) {
    listEl.innerHTML = '<p style="font-size:0.75rem; color:var(--text-muted); text-align:center;">Nenhum DNS cadastrado para este servidor. Adicione na aba Servidores.</p>';
  } else {
    entries.forEach(({ srv, link }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-tool';
      btn.style.cssText = 'background: ' + (link.kind === 'IP' ? '#0f766e' : '#2563eb') + '; padding: 9px; font-size: 0.76rem; text-align: left; font-weight: 600; word-break: break-all;';
      btn.textContent = `${link.kind === 'IP' ? '🔢 IP' : '🌐 URL'} • ${srv.name} • ${link.base.replace(/^https?:\/\//i, '')}`;
      btn.onclick = () => {
        if (typeof copyTextSafe === 'function') {
          copyTextSafe(link.url, btnEl, "M3U Copiado! ✓");
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(link.url);
          showToast("Link M3U copiado");
        }
        closeM3uModal();
      };
      listEl.appendChild(btn);
    });
  }

  modal.style.display = 'flex';
};

window.closeM3uModal = function() {
  currentM3uClientId = null;
  const modal = document.getElementById('m3uServerModal');
  if (modal) modal.style.display = 'none';
};

// ============================================================
// CENTRAL DE SCRIPTS RÁPIDOS DE SUPORTE
// ============================================================
window.openSupportScriptsModal = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  currentScriptClientId = clientId;
  const modal = document.getElementById('supportScriptsModal');
  const nameEl = document.getElementById('supportScriptsClientName');
  if (nameEl) nameEl.textContent = `Cliente: ${client.name} (${client.username})`;
  if (modal) modal.style.display = 'flex';
};

window.closeSupportScriptsModal = function() {
  currentScriptClientId = null;
  const modal = document.getElementById('supportScriptsModal');
  if (modal) modal.style.display = 'none';
};

window.sendQuickSupportScript = function(type) {
  if (!currentScriptClientId) return;
  const client = clients.find(c => c.id === currentScriptClientId);
  if (!client) return;

  let msg = '';
  if (type === 'dns') {
    msg = `🔧 *TUTORIAL: TROCA DE DNS NA SMART TV*\n\nOlá, *${client.name}*!\nPara resolver instabilidades na conexão, siga o passo a passo:\n1. Acesse *Configurações > Rede > Status da Rede*;\n2. Escolha *Configurações de IP* e altere a *Config. de DNS* para *Manual*;\n3. Insira o DNS: *1.1.1.1* (ou *8.8.8.8*);\n4. Salve e reinicie a TV.\n\nQualquer dúvida me avise!`;
  } else if (type === 'cache') {
    msg = `🧹 *TUTORIAL: LIMPEZA DE CACHE E REINICIALIZAÇÃO*\n\nOlá, *${client.name}*!\n1. Desligue sua TV ou aparelho da tomada por 1 minuto;\n2. Reinicie o seu modem de internet tirando da tomada por 30 segundos;\n3. Abra o aplicativo novamente e teste.\n\nIsso desobstrui o tráfego da rede.`;
  } else if (type === 'app') {
    msg = `📱 *INSTALAÇÃO VIA DOWNLOADER*\n\nOlá, *${client.name}*!\n1. Abra o app Downloader no aparelho;\n2. Digite o código do aplicativo recomendado e faça o download;\n3. Abra e acesse com seu login: *${client.username}* e senha: *${client.serverPassword || '(não cadastrada)'}*.`;
  } else if (type === 'maintenance') {
    msg = `⚠️ *AVISO DE MANUTENÇÃO TÉCNICA*\n\nOlá, *${client.name}*! Informamos que nossos servidores estão passando por uma atualização programada para aprimorar a estabilidade dos canais. A previsão de normalização é breve. Agradecemos sua compreensão!`;
  }

  closeSupportScriptsModal();
  openWhatsAppDirect(client.phone, msg);
};

// ============================================================
// AJUSTES: SALVAR INDICAÇÕES E CAMPANHAS
// ============================================================
window.saveReferralCampaign = async function() {
  const goalInp = document.getElementById('referralGoalInput');
  const discInp = document.getElementById('referralDiscountInput');
  const msgInp = document.getElementById('referralMessageTemplate');

  if (goalInp) referralGoal = parseInt(goalInp.value, 10) || 3;
  if (discInp) referralDiscountVal = parseFloat(discInp.value) || 5;
  { const fdInp = document.getElementById('referralFirstDiscountInput'); referralFirstDiscount = fdInp ? Math.max(0, parseFloat(fdInp.value) || 0) : 0; }
  if (msgInp) customReferralMessage = msgInp.value.trim() || DEFAULT_REFERRAL_MSG;

  localStorage.setItem('user_referral_goal', String(referralGoal));
  localStorage.setItem('user_referral_discount', String(referralDiscountVal));
  localStorage.setItem('user_referral_first_discount', String(referralFirstDiscount));
  localStorage.setItem('user_referral_msg', customReferralMessage);

  if (activeOwnerId) {
    try {
      await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("settings").doc(activeOwnerId).set({
        referralGoal,
        referralDiscount: referralDiscountVal,
        referralFirstDiscount,
        referralMessage: customReferralMessage
      }, { merge: true });
      alert("✅ Configurações de indicação salvas!");
      renderClients();
    } catch (err) {
      alert("Erro ao salvar indicações: " + err.message);
    }
  } else {
    alert("✅ Salvo localmente!");
    renderClients();
  }
};

window.saveReactivationCampaign = async function() {
  const discInp = document.getElementById('reactivationDiscountInput');
  if (discInp && discInp.value !== '') {
    reactivationDiscountVal = parseFloat(discInp.value) || 0;
    localStorage.setItem('user_reactivation_discount', String(reactivationDiscountVal));
  }

  if (activeOwnerId) {
    try {
      await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("settings").doc(activeOwnerId).set({
        reactivationDiscount: reactivationDiscountVal
      }, { merge: true });
      alert("✅ Desconto de reativação salvo!");
      renderClients();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  } else {
    alert("✅ Salvo localmente!");
    renderClients();
  }
};

window.saveCostPerCredit = async function() {
  const input = document.getElementById('costPerCreditInput');
  if (!input) return;

  costPerCredit = parseFloat(input.value) || 0;
  localStorage.setItem('user_cost_per_credit', String(costPerCredit));

  if (activeOwnerId) {
    try {
      await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("settings").doc(activeOwnerId).set({ costPerCredit }, { merge: true });
      alert("✅ Custo por crédito salvo!");
      updateDashboard();
    } catch (err) {
      alert("Erro ao salvar custo: " + err.message);
    }
  } else {
    alert("✅ Custo salvo localmente!");
    updateDashboard();
  }
};

// Célula de CSV segura: aspas escapadas e sem fórmulas (= + - @) que o Excel executaria
// Valor realmente recebido de um lançamento (renovação marcada como "a receber" ainda não conta)
window.updateBackupReminder = function() {
  const el = document.getElementById('backupReminder');
  if (!el) return;
  let last = '';
  try { last = localStorage.getItem('last_backup_' + (activeOwnerId || '')) || ''; } catch (e) {}
  if (!last) { el.textContent = '⚠️ Você ainda não salvou nenhum backup neste aparelho. Toque em 💾 Salvar.'; el.style.color = '#f59e0b'; return; }
  const days = Math.max(0, Math.round((new Date(safeGetTodayLocal() + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000));
  el.textContent = days === 0 ? '✅ Backup salvo hoje.' : `Último backup há ${days} dia(s).` + (days >= 15 ? ' Vale salvar um novo.' : '');
  el.style.color = days >= 15 ? '#f59e0b' : 'var(--text-muted)';
};

window.paidAmt = function(h) { return (h && h.paid === false) ? 0 : (parseFloat(h && h.amount) || 0); };
// Custo do crédito GRAVADO na renovação; só calcula pelo valor atual quando o lançamento é antigo
window.entryCost = function(h, c) { return (h && typeof h.cost === 'number') ? h.cost : (Number(h && h.months) || 1) * creditCostFor(c); };
// Carteira + clientes excluídos (o histórico deles continua valendo no financeiro)
window.deletedClients = window.deletedClients || [];
window.isTrialClient = function(c) { return !!c && c.isTrial === true; };
// Financeiro/indicações ignoram quem ainda está em teste (só vale depois da 1ª renovação)
window.financeClients = function() { return clients.filter(c => !isTrialClient(c)).concat(window.deletedClients || []); };

window.csvCell = function(v) {
  let t = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
};

window.exportToExcel = async function() {
  if (!clients || clients.length === 0) return alert("Nenhum cliente para exportar.");
  const head = ['Nome', 'Usuário', 'Telefone', 'Valor (R$)', 'Vencimento', 'Servidor', 'MAC', 'Suportes', 'Observações'];
  const rows = [head].concat(clients.map(c => [c.name || '', c.username || '', c.phone || '', Number(c.price) || 0, c.dueDate ? formatDateYY(c.dueDate) : '', c.assignedServer || '', c.macAddress || '', Number(c.supportCount) || 0, String(c.notes || '').replace(/\r?\n/g, ' ')]));
  try {
    await saveFileSmart(`clientes_${safeGetTodayLocal()}.xlsx`, buildXlsxBlob(rows, 'Clientes'));
  } catch (e) { alert('Não consegui gerar a planilha: ' + e.message); }
};

window.exportBackup = async function() {
  if (!clients || clients.length === 0) return alert("Nenhum cliente para gerar backup.");
  // links do portal não vão no backup: o token é guardado só como hash e um novo link é gerado depois
  const strip = c => { const o = { ...c }; ['portalToken', 'portalTokenHash', 'portalEnabled', 'portalLastAccess', 'portalAccessCount'].forEach(k => delete o[k]); return o; };
  const backupData = { date: safeGetTodayLocal(), clients: clients.concat(window.deletedClients || []).map(strip) };
  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
  try {
    const r = await saveFileSmart(`backup_clientes_${safeGetTodayLocal()}.json`, blob);
    if (r === 'cancel') return;
    try { localStorage.setItem('last_backup_' + (activeOwnerId || ''), safeGetTodayLocal()); } catch (e) {}
    if (typeof updateBackupReminder === 'function') updateBackupReminder();
  } catch (e) {
    alert('Não consegui salvar o arquivo (' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : 'erro') + ').\n\nUse o botão 📋 Copiar ao lado: ele copia o backup e você cola em um app de notas ou e-mail.');
  }
};

// Plano B do backup quando o aparelho bloqueia o download/compartilhamento: copia o conteúdo
window.copyBackupText = async function() {
  if (!clients || clients.length === 0) return alert('Nenhum cliente para copiar.');
  const strip = c => { const o = { ...c }; ['portalToken', 'portalTokenHash', 'portalEnabled', 'portalLastAccess', 'portalAccessCount'].forEach(k => delete o[k]); return o; };
  const text = JSON.stringify({ date: safeGetTodayLocal(), clients: clients.concat(window.deletedClients || []).map(strip) });
  try {
    await navigator.clipboard.writeText(text);
    try { localStorage.setItem('last_backup_' + (activeOwnerId || ''), safeGetTodayLocal()); } catch (e) {}
    if (typeof updateBackupReminder === 'function') updateBackupReminder();
    alert('✅ Backup copiado. Cole em um app de notas ou e-mail e guarde. Para restaurar, salve o texto como arquivo .json e use 📥 Restaurar.');
  } catch (e) {
    window.prompt('Copie o backup abaixo (selecione tudo e copie):', text);
  }
};

window.importBackup = function(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      const importedClients = Array.isArray(data) ? data : data.clients;
      if (!Array.isArray(importedClients)) return alert("Arquivo de backup inválido.");

      const norm = v => String(v || '').trim().toLowerCase();
      const keyOf = c => norm(c.username) + '|' + norm(c.assignedServer);
      const haveIds = new Set(clients.map(c => c.id));
      const haveKeys = new Set(clients.map(keyOf));
      const seen = new Set();
      const toAdd = [];
      let dup = 0;
      importedClients.forEach(c => {
        if (!c || typeof c !== 'object') return;
        const k = keyOf(c);
        if ((c.id && haveIds.has(c.id)) || (c.username && haveKeys.has(k)) || seen.has(k)) { dup++; return; }
        seen.add(k);
        toAdd.push(c);
      });

      if (!toAdd.length) return alert(`Nada a restaurar: os ${dup} clientes do arquivo já existem na carteira.`);

      const max = parseInt((currentResellerData || {}).maxClients || 15, 10);
      const active = clients.filter(c => !c.isArchived && !c.isTrial).length;
      const newActive = toAdd.filter(c => !c.isArchived).length;
      if (active + newActive > max) {
        return alert(`O backup tem ${newActive} clientes ativos novos, mas seu plano comporta mais ${Math.max(0, max - active)} (limite ${max}). Faça um upgrade ou arquive clientes antes de restaurar.`);
      }

      if (!confirm(`Restaurar ${toAdd.length} clientes novos?` + (dup ? `\n${dup} já existem e serão ignorados.` : ''))) return;

      const BATCH_SIZE = 400;
      const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = fs.batch();
        toAdd.slice(i, i + BATCH_SIZE).forEach(c => {
          const newDoc = fs.collection("clients").doc();
          const cleanItem = { ...c, ownerId: activeOwnerId };
          ['id', 'portalToken', 'portalTokenHash', 'portalEnabled', 'portalLastAccess', 'portalAccessCount'].forEach(k => delete cleanItem[k]);
          batch.set(newDoc, cleanItem);
        });
        await batch.commit();
      }

      alert(`✅ ${toAdd.length} clientes restaurados.` + (dup ? ` ${dup} ignorados por já existirem.` : '') + `\nOs links do portal precisam ser gerados de novo.`);
    } catch (err) {
      alert("Erro ao restaurar backup: " + err.message);
    } finally {
      try { input.value = ''; } catch (e2) {}
    }
  };
  reader.readAsText(file);
};

// ============================================================
// CADASTRO / EDIÇÃO DE CLIENTES
// ============================================================
window.toggleClientForm = function() {
  const form = document.getElementById('clientForm');
  const btn = document.getElementById('btnToggleClientForm');
  if (!form) return;

  const isHidden = window.getComputedStyle(form).display === 'none' || form.style.display === 'none' || form.style.display === '';

  if (isHidden) {
    if (typeof populateClientServerOptions === 'function') {
      populateClientServerOptions();
    }
    if (typeof updateReferralDatalist === 'function') {
      updateReferralDatalist();
    }
    form.style.display = 'block';
    if (btn) btn.textContent = '✕ Fechar Formulário';
    
    const nameField = document.getElementById('name');
    if (nameField) {
      setTimeout(() => nameField.focus(), 50);
    }
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    form.style.display = 'none';
    if (btn) btn.textContent = '➕ Cadastrar Novo Cliente';
  }
};

window.populateClientServerOptions = function(selectedServerName) {
  const select = document.getElementById('clientAssignedServer');
  if (!select) return;
  select.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '⚠️ Selecione o Servidor (Obrigatório)...';
  defaultOpt.disabled = true;
  if (!selectedServerName) defaultOpt.selected = true;
  select.appendChild(defaultOpt);

  const servers = (typeof userServers !== 'undefined' && userServers.length > 0) ? userServers : [];
  servers.forEach(srv => {
    const opt = document.createElement('option');
    opt.value = srv.name;
    const inactive = srv.active === false;
    opt.textContent = `🖥️ ${srv.name}${inactive ? ' (inativo)' : ''}`;
    if (inactive && srv.name !== selectedServerName) opt.disabled = true;
    if (selectedServerName && srv.name === selectedServerName) opt.selected = true;
    select.appendChild(opt);
  });
};

function formatDateYY(dueDateString) {
  if (!dueDateString || typeof dueDateString !== 'string') return 'Sem data';
  const parts = dueDateString.split('-');
  if (parts.length === 3) {
    const d = parts[2];
    const m = parts[1];
    const y = parts[0].slice(-2);
    return `${d}/${m}/${y}`;
  }
  return dueDateString;
}

function safeEsc(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeGetTodayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function safeFormatCurrency(val, privacy) {
  if (privacy) return 'R$ ••••';
  return 'R$ ' + Number(val || 0).toFixed(2).replace('.', ',');
}

function safeMaskPhone(phone, privacy) {
  if (!phone) return 'Não informado';
  if (privacy) return '(••) •••••-••••';
  return phone;
}

function normalizeText(text) {
  return String(text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function getClientFinancialMetrics(client) {
  let ltv = 0;
  let renewCount = 0;

  if (Array.isArray(client.paymentHistory) && client.paymentHistory.length > 0) {
    renewCount = client.paymentHistory.length;
    client.paymentHistory.forEach(h => {
      ltv += paidAmt(h);
    });
  } else {
    ltv = parseFloat(client.price) || 0;
    renewCount = 0;
  }

  return { ltv, renewCount };
}

function getClientHealthStatus(client) {
  const st = getStatus(client.dueDate);
  const history = Array.isArray(client.supportHistory) ? client.supportHistory : [];
  const renewCount = Array.isArray(client.paymentHistory) ? client.paymentHistory.length : 0;

  if (client.isArchived) {
    if (st.diffDays < 0) {
      return { 
        level: 'danger', 
        label: `Atrasado há ${Math.abs(st.diffDays)}d`, 
        color: '#b91c1c', 
        reason: `Cliente arquivado com ${Math.abs(st.diffDays)} dias de atraso` 
      };
    }
    return { 
      level: 'archived', 
      label: 'Inativo', 
      color: '#64748b', 
      reason: 'Cliente pausado/arquivado' 
    };
  }

  const [todayY, todayM, todayD] = safeGetTodayLocal().split('-').map(Number);
  const nowMs = new Date(todayY, todayM - 1, todayD).getTime();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const recentSupports = history.filter(h => {
    if (!h.date) return false;
    const [hy, hm, hd] = h.date.split('-').map(Number);
    return (nowMs - new Date(hy, hm - 1, hd).getTime()) <= ninetyDaysMs;
  });

  const recentCount = recentSupports.length;
  const isLate = st.diffDays < 0;
  const daysLate = Math.abs(st.diffDays);

  if (recentCount >= 5 || (isLate && daysLate >= 3 && recentCount >= 2)) {
    return { level: 'danger', label: 'Crítico', color: '#b91c1c', reason: recentCount >= 5 ? `${recentCount} suportes em 90d` : `${daysLate}d atrasado c/ ${recentCount} suportes` };
  }
  if (recentCount >= 2 || (isLate && daysLate <= 3) || (renewCount === 0 && recentCount >= 1)) {
    return { level: 'warning', label: 'Atenção', color: '#c2410c', reason: recentCount >= 2 ? `${recentCount} suportes em 90d` : (isLate ? `${daysLate}d atrasado` : 'Cliente novo c/ suporte') };
  }
  return { level: 'ok', label: 'Saudável', color: '#15803d', reason: 'Estável e pontual' };
}

window.updateGlobalServerSelectOptions = function() {
  if (!globalServerFilterEl) return;
  const previousVal = globalServerFilterEl.value || 'ALL';
  globalServerFilterEl.innerHTML = '<option value="ALL">🌐 Todos os Servidores</option>';

  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
  servers.forEach(srv => {
    if (srv && srv.name) {
      const opt = document.createElement('option');
      opt.value = srv.name;
      opt.textContent = `🖥️ ${srv.name}`;
      globalServerFilterEl.appendChild(opt);
    }
  });

  globalServerFilterEl.value = previousVal;
  currentGlobalServer = globalServerFilterEl.value;
};

window.changeGlobalServerFilter = function(serverName) {
  currentGlobalServer = serverName || 'ALL';
  currentPage = 1;
  renderClients();
  updateDailyActions();
};

window.getClientReferralProgress = function(client) {
  const myId = client.id;
  const myName = normalizeText(client.name);
  const myUser = normalizeText(client.username);

  const friendsReferred = clients.filter(c => {
    if (c.isArchived || c.isTrial || c.id === myId) return false; // em teste não conta: só depois da 1ª renovação
    // indicação gravada por id é exata; só cadastros antigos (sem id) comparam o texto, e só se for igual
    if (c.referredById) return c.referredById === myId;
    if (!c.referredBy) return false;
    const ref = normalizeText(c.referredBy);
    return ref === myUser || ref === myName;
  });

  const totalActive = friendsReferred.length;
  const redeemedCount = parseInt(client.referralsRedeemed || 0, 10);
  const availableCount = Math.max(0, totalActive - redeemedCount);
  const isGoalReached = availableCount >= referralGoal && referralGoal > 0;
  const totalDiscountAcc = availableCount * referralDiscountVal;

  return { count: availableCount, total: totalActive, goal: referralGoal, isGoalReached, friends: friendsReferred, discountVal: totalDiscountAcc };
};

// Benefício de indicações aplicado numa renovação:
// - meta atingida  -> 1 mês grátis (consome `referralGoal` indicações)
// - meta não atingida -> desconto (valor por indicação, configurado em Ajustes) x indicações disponíveis
window.computeReferralBenefit = function(client, months) {
  const fresh = clients.find(c => c.id === client.id) || client;
  const price = parseFloat(fresh.price) || 0;
  const gross = price * (months || 1);
  const ref = getClientReferralProgress(fresh);

  // O desconto só abate quando o cliente ESCOLHE usá-lo (botão "Aplicar desconto"),
  // que transforma as indicações em crédito (`pendingDiscount`). Aqui só consumimos o crédito.
  const credit = Math.max(0, parseFloat(fresh.pendingDiscount) || 0);
  const discount = Math.min(gross, credit);

  return { gross, discount, total: Math.max(0, gross - discount), freeMonth: false, consumed: 0, ref };
};

// Cliente escolheu DESCONTO em dinheiro: converte as indicações disponíveis em crédito
// e zera o contador de indicações (para o indicador não mostrar informação errada).
window.applyReferralDiscount = async function(clientId) {
  if (window._discountBusy) return; // toque duplo daria o desconto em dobro
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  const ref = getClientReferralProgress(client);
  const price = parseFloat(client.price) || 0;
  const raw = ref.count * referralDiscountVal;

  if (ref.count <= 0 || referralDiscountVal <= 0 || raw <= 0) {
    alert('Este cliente não tem indicações disponíveis para desconto (ou o valor do desconto não está configurado em Ajustes).');
    return;
  }

  const already = Math.max(0, parseFloat(client.pendingDiscount) || 0);
  const discount = raw;
  const newPrice = Math.max(0, price - Math.min(price, already + discount));

  if (!confirm(
    `🏷️ Aplicar desconto de ${safeFormatCurrency(discount, false)} para ${client.name}?\n\n` +
    `• ${ref.count} indicação(ões) serão usadas e o contador zera.\n` +
    `• Próxima cobrança: ${safeFormatCurrency(price, false)} → ${safeFormatCurrency(newPrice, false)}\n\n` +
    `(Se o cliente preferir o mês grátis, cancele e use o botão 🎁.)`
  )) return;

  window._discountBusy = true;
  try {
    await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients").doc(client.id).update({
      pendingDiscount: firebase.firestore.FieldValue.increment(discount),
      referralsRedeemed: firebase.firestore.FieldValue.increment(ref.count)
    });
    // atualiza a cópia local na hora, para um segundo toque já ver o contador zerado
    client.pendingDiscount = already + discount;
    client.referralsRedeemed = (parseInt(client.referralsRedeemed || 0, 10) || 0) + ref.count;
    window._discountBusy = false;

    if (confirm('Desconto aplicado! Deseja avisar o cliente no WhatsApp?')) {
      openWhatsAppDirect(client.phone,
        `🏷️ *DESCONTO DE INDICAÇÃO APLICADO!*\n\n` +
        `Olá, *${client.name}*! Seu desconto de *${safeFormatCurrency(discount, false)}* do programa Indique e Ganhe foi aplicado.\n\n` +
        `💵 *Sua próxima mensalidade:* ${safeFormatCurrency(newPrice, false)}\n\nObrigado pelas indicações! 🙏`);
    }
  } catch (err) {
    window._discountBusy = false;
    alert('Erro ao aplicar desconto: ' + err.message);
  }
};

window.copyClientDirectM3u = function(clientId, btnEl) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
  const assignedSrv = findServerForClient(client, servers);
  const links = assignedSrv ? buildM3uLinks(client, assignedSrv) : [];

  if (links.length === 1) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(links[0].url);
      showToast("Link M3U copiado");
    }
  } else if (links.length > 1) {
    // servidor com vários DNS (URL e/ou IP): escolher qual copiar
    openM3uSelectorModal(clientId, btnEl, assignedSrv.name);
  } else {
    openM3uSelectorModal(clientId, btnEl);
  }
};

window.sendClientAccessCredentials = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  const servers = (typeof userServers !== 'undefined') ? userServers : [];
  const assignedSrv = findServerForClient(client, servers);
  const dnsLists = assignedSrv ? serverDnsLists(assignedSrv) : { ips: [], urls: [] };
  const srvDns = (assignedSrv && assignedSrv.dns) ? assignedSrv.dns : 'Não informado';

  let msg = `📺 *SEUS DADOS DE ACESSO*\n\n`;
  msg += `Olá, *${client.name}*! Seguem os dados para sua conexão:\n\n`;
  msg += `👤 *Usuário:* ${client.username}\n`;
  msg += `🔑 *Senha:* ${client.serverPassword || '123456'}\n`;
  msg += `🖥️ *Servidor:* ${client.assignedServer || 'Principal'}\n`;
  if (dnsLists.urls.length || dnsLists.ips.length) {
    dnsLists.urls.forEach((v, i) => { msg += `🌐 *DNS URL${dnsLists.urls.length > 1 ? ' ' + (i + 1) : ''}:* ${v}\n`; });
    dnsLists.ips.forEach((v, i) => { msg += `🔢 *DNS numérico${dnsLists.ips.length > 1 ? ' ' + (i + 1) : ''}:* ${v}\n`; });
  } else if (srvDns !== 'Não informado') {
    msg += `🌐 *DNS / Servidor:* ${srvDns}\n`;
  }
  if (client.macAddress) msg += `📟 *MAC:* ${client.macAddress} ${client.macApp ? `(${client.macApp})` : ''}\n`;
  if (client.dueDate) msg += `📅 *Vencimento:* ${formatDateYY(client.dueDate)}\n`;
  msg += `\nQualquer dúvida durante a instalação ou reprodução, basta chamar por aqui!`;

  openWhatsAppDirect(client.phone, msg);
};

// Suporte agora tem dois passos: abrir (quando o atendimento começa) e fechar (quando termina).
// Enquanto não for fechado, o suporte aparece na faixa "Suportes em aberto" na tela inicial,
// pra não ficar um atendimento pela metade sem resposta.
window.openSupportReasonModal = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (client.supportOpenAt) return openSupportCloseModal(clientId); // já tem um aberto: vai direto pra fechar

  pendingSupportClientId = clientId;
  const nameEl = document.getElementById('supportModalClientName');
  const reasonSelect = document.getElementById('supportReasonSelect');
  const customReason = document.getElementById('supportCustomReason');

  if (nameEl) nameEl.textContent = `Cliente: ${client.name} (${client.username})`;
  if (reasonSelect) reasonSelect.value = 'Travamentos / Canais';
  if (customReason) customReason.value = '';
  const triageSel = document.getElementById('triageProblem');
  const triageOut = document.getElementById('triageResult');
  if (triageSel) triageSel.value = '';
  if (triageOut) { triageOut.style.display = 'none'; triageOut.innerHTML = ''; }

  const modal = document.getElementById('supportReasonModal');
  if (modal) modal.style.display = 'flex';
};

window.closeSupportReasonModal = function() {
  pendingSupportClientId = null;
  const modal = document.getElementById('supportReasonModal');
  if (modal) modal.style.display = 'none';
};

// Ajuda da IA no atendimento. Envia só o aplicativo, o servidor e o problema (nunca o nome do cliente).
window.runSupportTriage = async function() {
  const sel = document.getElementById('triageProblem');
  const out = document.getElementById('triageResult');
  const client = clients.find(c => c.id === pendingSupportClientId);
  if (!out || !client) return;
  const problema = sel ? sel.value : '';
  if (!problema) { alert('Escolha o problema antes de pedir os passos.'); return; }
  out.style.display = 'block';
  out.innerHTML = '<div style="font-size:0.78rem; color:var(--text-muted);">⏳ Pensando nos passos… leva alguns segundos.</div>';
  try {
    if (typeof window.aiTriage !== 'function') throw new Error('A ajuda da IA não está disponível agora.');
    const passos = await window.aiTriage(client.macApp || '', client.assignedServer || '', problema);
    if (!passos.length) { out.innerHTML = '<div style="font-size:0.78rem;">A IA não sugeriu passos. Tente de novo.</div>'; return; }
    out.innerHTML = '<div style="font-weight:700; font-size:0.8rem; margin-bottom:6px;">Passos sugeridos (confira antes de passar ao cliente):</div>' +
      '<ol style="margin:0; padding-left:18px; font-size:0.8rem; line-height:1.5;">' + passos.map(p => `<li>${safeEsc(p)}</li>`).join('') + '</ol>';
  } catch (e) {
    out.innerHTML = `<div style="font-size:0.78rem; color:#991b1b;">${safeEsc(e.message)}</div>`;
  }
};

window.confirmSupportOpen = async function() {
  if (!pendingSupportClientId) return;
  const client = clients.find(c => c.id === pendingSupportClientId);
  if (!client) return;

  const reasonSelect = document.getElementById('supportReasonSelect');
  const customReason = document.getElementById('supportCustomReason');
  const selectedReason = reasonSelect ? reasonSelect.value : 'Atendimento Geral';
  const obs = customReason ? customReason.value.trim() : '';
  const nowIso = new Date().toISOString();

  closeSupportReasonModal();
  try {
    await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients").doc(client.id).update({
      supportOpenAt: nowIso,
      supportOpenReason: selectedReason,
      supportOpenNotes: obs || ''
    });
    if (typeof showToast === 'function') showToast(`Suporte aberto para ${client.name || client.username}.`);
  } catch (err) {
    alert("Erro ao abrir atendimento: " + err.message);
  }
};

window.openSupportCloseModal = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  if (!client.supportOpenAt) return openSupportReasonModal(clientId); // não tem aberto: vai pra abrir

  pendingSupportCloseClientId = clientId;
  const nameEl = document.getElementById('supportCloseClientName');
  const infoEl = document.getElementById('supportCloseOpenInfo');
  const notesEl = document.getElementById('supportCloseNotes');
  const openedMs = Date.parse(client.supportOpenAt);
  const hrs = isFinite(openedMs) ? Math.max(0, Math.round((Date.now() - openedMs) / 3600000)) : null;

  if (nameEl) nameEl.textContent = `Cliente: ${client.name} (${client.username})`;
  if (infoEl) infoEl.textContent = `Aberto ${hrs == null ? '' : (hrs < 1 ? 'há poucos minutos' : hrs < 24 ? `há ${hrs}h` : `há ${Math.round(hrs / 24)}d`)} • Motivo: ${client.supportOpenReason || 'Atendimento Geral'}${client.supportOpenNotes ? ' — ' + client.supportOpenNotes : ''}`;
  if (notesEl) notesEl.value = '';

  const modal = document.getElementById('supportCloseModal');
  if (modal) modal.style.display = 'flex';
};

window.closeSupportCloseModal = function() {
  pendingSupportCloseClientId = null;
  const modal = document.getElementById('supportCloseModal');
  if (modal) modal.style.display = 'none';
};

window.confirmSupportClose = async function() {
  if (!pendingSupportCloseClientId) return;
  const client = clients.find(c => c.id === pendingSupportCloseClientId);
  if (!client) return;

  const notesEl = document.getElementById('supportCloseNotes');
  const closingNotes = notesEl ? notesEl.value.trim() : '';
  const now = new Date();
  const nowIso = now.toISOString();
  const today = safeGetTodayLocal();
  const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const openedMs = Date.parse(client.supportOpenAt);
  const durationHours = isFinite(openedMs) ? Math.max(0, Math.round((Date.now() - openedMs) / 360000) / 10) : null;

  const historyEntry = {
    date: today,
    time: timeFormatted,
    reason: client.supportOpenReason || 'Atendimento Geral',
    notes: [client.supportOpenNotes, closingNotes].filter(Boolean).join(' — '),
    openedAt: client.supportOpenAt || null,
    closedAt: nowIso,
    durationHours
  };

  const currentCount = parseInt(client.supportCount || 0, 10);
  closeSupportCloseModal();

  try {
    await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients").doc(client.id).update({
      supportCount: currentCount + 1,
      supportHistory: firebase.firestore.FieldValue.arrayUnion(historyEntry),
      supportOpenAt: firebase.firestore.FieldValue.delete(),
      supportOpenReason: firebase.firestore.FieldValue.delete(),
      supportOpenNotes: firebase.firestore.FieldValue.delete()
    });

    const myResellerPhone = (currentResellerData && currentResellerData.phone)
      ? currentResellerData.phone.replace(/\D/g, '')
      : (typeof MASTER_ADMIN_PHONE !== 'undefined' ? MASTER_ADMIN_PHONE : '');
    const supportLink = myResellerPhone ? `https://wa.me/${myResellerPhone}` : '';

    const refProgress = getClientReferralProgress(client);
    const remaining = Math.max(1, referralGoal - refProgress.count);

    const supportMsg =
      `✅ *ATENDIMENTO CONCLUÍDO COM SUCESSO!*\n\n` +
      `Olá, *${client.name}*! Foi um prazer atender você. Espero que esteja tudo funcionando perfeitamente por aí!\n\n` +
      ((refProgress.isGoalReached || refProgress.count > 0)
        ? (`🎁 *STATUS DO INDIQUE E GANHE:*\n` + (refProgress.isGoalReached
          ? `Parabéns! Você completou a meta de *${referralGoal}* indicações e tem *1 MÊS GRÁTIS* disponível na sua próxima renovação! 🎉\n\n`
          : `Você já possui *${refProgress.count}* indicação(ões) ativa(s). Faltam apenas *${referralGoal === 1 ? '1 amigo' : `${remaining} amigo(s)`}* para garantir *1 MÊS INTEIRAMENTE GRÁTIS* na sua mensalidade!\n\n`)) : '') +
      (supportLink ? `👉 Contato direto do suporte:\n${supportLink}\n\n` : '') +
      `Qualquer outra dúvida, estamos sempre à sua disposição!`;

    openWhatsAppDirect(client.phone, supportMsg);
  } catch (err) {
    alert("Erro ao fechar atendimento: " + err.message);
  }
};

window.openSupportHistoryModal = function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;

  const modal = document.getElementById('supportHistoryModal');
  const nameEl = document.getElementById('supportHistoryClientName');
  const listEl = document.getElementById('supportHistoryList');
  const alertBox = document.getElementById('supportHistoryCriticalAlert');

  if (!modal || !listEl) return;

  nameEl.textContent = `Atendimentos: ${client.name} (${client.username})`;
  listEl.innerHTML = '';

  const history = Array.isArray(client.supportHistory) ? client.supportHistory : [];

  if (alertBox) {
    alertBox.style.display = history.length >= 5 ? 'block' : 'none';
    if (history.length >= 5) {
      alertBox.innerHTML = `⚠️ <strong>ALERTA:</strong> Este cliente já registrou <strong>${history.length} atendimentos</strong>!`;
    }
  }

  if (history.length === 0) {
    listEl.innerHTML = '<p style="font-size:0.75rem; color:var(--text-muted); padding: 12px 0; text-align:center;">Nenhum atendimento registrado até o momento.</p>';
  } else {
    const sorted = [...history].reverse();
    sorted.forEach((h) => {
      const dateFmt = formatDateYY(h.date);
      const timeFmt = h.time ? ` às ${h.time}` : '';

      const item = document.createElement('div');
      item.className = 'support-history-item';
      item.style.cssText = 'background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:10px; margin-bottom:6px; cursor:pointer; text-align:left;';
      
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-main);">🛠️ ${safeEsc(h.reason || 'Atendimento')}</span>
          <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">${dateFmt}${timeFmt} ▾</span>
        </div>
        <div class="support-detail-box" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 0.74rem; color: var(--text-muted); word-break: break-word;">
          <p style="margin-bottom: 3px;"><strong>📅 Data & Hora:</strong> ${dateFmt}${timeFmt}</p>
          <p style="margin-bottom: 3px;"><strong>🎯 Motivo:</strong> ${safeEsc(h.reason || 'Atendimento Geral')}</p>
          ${(h.durationHours != null) ? `<p style="margin-bottom: 3px;"><strong>⏱️ Tempo até fechar:</strong> ${h.durationHours < 1 ? 'menos de 1h' : h.durationHours + 'h'}</p>` : ''}
          <p><strong>📝 Observação:</strong> ${h.notes ? safeEsc(h.notes) : '<em>Nenhuma observação registrada.</em>'}</p>
        </div>
      `;

      item.addEventListener('click', () => {
        const detailBox = item.querySelector('.support-detail-box');
        if (detailBox) {
          const isHidden = detailBox.style.display === 'none' || detailBox.style.display === '';
          detailBox.style.display = isHidden ? 'block' : 'none';
        }
      });

      listEl.appendChild(item);
    });
  }

  modal.style.display = 'flex';
};

window.closeSupportHistoryModal = function() {
  const modal = document.getElementById('supportHistoryModal');
  if (modal) modal.style.display = 'none';
};

function getStatus(dueDateString) {
  if (!dueDateString || typeof dueDateString !== 'string') {
    return { class: 'expired', label: 'Sem data', diffDays: -999 };
  }

  const [todayY, todayM, todayD] = safeGetTodayLocal().split('-').map(Number);
  const today = new Date(todayY, todayM - 1, todayD);

  const [dueY, dueM, dueD] = dueDateString.split('-').map(Number);
  const due = new Date(dueY, dueM - 1, dueD);

  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { class: 'expired', label: `Vencido há ${Math.abs(diffDays)}d`, diffDays };
  } else if (diffDays <= 3) {
    return { 
      class: 'warning', 
      label: diffDays === 0 ? 'Vence hoje' : (diffDays === 1 ? 'Vence amanhã' : `Vence em ${diffDays}d`), 
      diffDays 
    };
  }
  return { class: 'ok', label: 'Em dia', diffDays };
}

// ------------------------------------------------------------
// CUSTO DO CRÉDITO (por servidor; sem valor próprio usa o padrão da aba Financeiro)
// ------------------------------------------------------------
function creditCostFor(client) {
  const list = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
  const srv = findServerForClient(client, list);
  if (srv && srv.costPerCredit !== null && srv.costPerCredit !== undefined && srv.costPerCredit !== '') {
    const v = parseFloat(srv.costPerCredit);
    if (!isNaN(v)) return v;
  }
  return costPerCredit || 0;
}

// Período do financeiro: '' = mês atual (muda sozinho a cada mês), 'AAAA-MM' = mês escolhido, 'ALL' = tudo
let financeMonth = '';
function financeMonthKey() {
  if (financeMonth === 'ALL') return 'ALL';
  if (financeMonth) return financeMonth;
  return safeGetTodayLocal().slice(0, 7);
}
function financePeriodLabel() {
  const k = financeMonthKey();
  if (k === 'ALL') return 'todo o período';
  return k.slice(5, 7) + '/' + k.slice(0, 4);
}
function fillFinanceSelectors() {
  const [y, m] = safeGetTodayLocal().split('-').map(Number);
  let html = `<option value="">Mês atual (${String(m).padStart(2, '0')}/${y})</option>`;
  for (let i = 1; i < 12; i++) {
    const d = new Date(y, m - 1 - i, 1);
    html += `<option value="${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}">${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}</option>`;
  }
  html += '<option value="ALL">Todo o período</option>';
  ['financeMonthSelect', 'financeMonthTop'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.dataset.ready) { el.innerHTML = html; el.dataset.ready = '1'; }
    el.value = financeMonth;
  });
}
window.changeFinanceMonth = function(v) {
  financeMonth = v || '';
  fillFinanceSelectors();
  updateDashboard();
};

function updateDashboard() {
  let mrr = 0;
  let activeCount = 0;
  let lateTotal = 0;
  let lateCount = 0;
  let next7DaysTotal = 0;
  let totalHistoricalRevenue = 0;

  financeClients().forEach(c => {
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return;

    const val = parseFloat(c.price) || 0;
    const st = getStatus(c.dueDate);

    if (Array.isArray(c.paymentHistory) && c.paymentHistory.length > 0) {
      c.paymentHistory.forEach(h => {
        totalHistoricalRevenue += paidAmt(h);
      });
    } else {
      totalHistoricalRevenue += val;
    }

    if (c.isArchived) return;

    mrr += val;
    activeCount++;

    if (st.class === 'expired') {
      lateTotal += val;
      lateCount++;
    }

    if (st.diffDays >= 0 && st.diffDays <= 7) {
      next7DaysTotal += val;
    }
  });

  const totalClientsEver = clients.filter(c => !c.isTrial && (currentGlobalServer === 'ALL' || c.assignedServer === currentGlobalServer)).length;
  const ltvAverage = totalClientsEver > 0 ? (totalHistoricalRevenue / totalClientsEver) : 0;
  const arpu = activeCount > 0 ? (mrr / activeCount) : 0;

  // Resultado do PERÍODO escolhido (padrão: mês atual — zera sozinho a cada mês)
  const periodKey = financeMonthKey();
  let receivedPeriod = 0, totalCostCredits = 0, renewalsPeriod = 0;
  financeClients().forEach(c => {
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return;
    (Array.isArray(c.paymentHistory) ? c.paymentHistory : []).forEach(h => {
      if (periodKey !== 'ALL' && !(h.date || '').startsWith(periodKey)) return;
      receivedPeriod += paidAmt(h);
      totalCostCredits += entryCost(h, c);
      renewalsPeriod++;
    });
  });
  const netProfit = receivedPeriod - totalCostCredits;
  const netMargin = receivedPeriod > 0 ? Math.round((netProfit / receivedPeriod) * 100) : 0;
  const defaultRate = activeCount > 0 ? Math.round((lateCount / activeCount) * 100) : 0;

  const mrrEl = document.getElementById('mrrDisplay');
  const mrrScopeSubtitleEl = document.getElementById('mrrScopeSubtitle');
  const netEl = document.getElementById('netProfitDisplay');
  const netMarginEl = document.getElementById('netMarginSubtitle');
  const next7El = document.getElementById('next7DaysDisplay');
  const lateEl = document.getElementById('lateTotalDisplay');
  const lossEl = document.getElementById('lossRateDisplay');
  const arpuEl = document.getElementById('arpuDisplay');
  const ltvEl = document.getElementById('ltvDisplay');
  const ltvSubtitleEl = document.getElementById('ltvSubtitle');

  const priv = typeof isPrivacyMode !== 'undefined' ? isPrivacyMode : false;

  if (mrrEl) mrrEl.textContent = safeFormatCurrency(mrr, priv);
  if (mrrScopeSubtitleEl) {
    mrrScopeSubtitleEl.textContent = currentGlobalServer === 'ALL' ? 'Mensalidade total prevista' : `Previsão: ${currentGlobalServer}`;
  }

  if (netEl) {
    netEl.textContent = safeFormatCurrency(netProfit, priv);
    netEl.style.color = netProfit >= 0 ? '#4ade80' : '#f87171';
  }
  if (netMarginEl) {
    netMarginEl.textContent = `${financePeriodLabel()} • margem ${priv ? '••' : netMargin + '%'} • custo ${safeFormatCurrency(totalCostCredits, priv)}`;
  }
  if (next7El) next7El.textContent = safeFormatCurrency(next7DaysTotal, priv);
  if (lateEl) lateEl.textContent = safeFormatCurrency(lateTotal, priv);
  if (arpuEl) arpuEl.textContent = safeFormatCurrency(arpu, priv);
  const recvEl = document.getElementById('receivedMonthDisplay');
  const recvSubEl = document.getElementById('receivedMonthSubtitle');
  if (recvEl) recvEl.textContent = safeFormatCurrency(receivedPeriod, priv);
  if (recvSubEl) recvSubEl.textContent = `${financePeriodLabel()} • ${priv ? '••' : renewalsPeriod} renovação(ões)`;
  fillFinanceSelectors();
  if (lossEl) lossEl.textContent = priv ? '••••' : `${defaultRate}%`;

  const totalFilteredNonArchived = clients.filter(c => !c.isArchived && !c.isTrial && (currentGlobalServer === 'ALL' || c.assignedServer === currentGlobalServer));
  if (countAllEl) countAllEl.textContent = totalFilteredNonArchived.length;
  if (countOkEl) countOkEl.textContent = totalFilteredNonArchived.filter(c => getStatus(c.dueDate).class === 'ok').length;
  const countNext7El = document.getElementById('countNext7');
  if (countNext7El) countNext7El.textContent = totalFilteredNonArchived.filter(c => { const d = getStatus(c.dueDate).diffDays; return c.dueDate && d >= 0 && d <= 7; }).length;
  if (countWarningEl) countWarningEl.textContent = totalFilteredNonArchived.filter(c => getStatus(c.dueDate).class === 'warning').length;
  if (countExpiredEl) countExpiredEl.textContent = totalFilteredNonArchived.filter(c => getStatus(c.dueDate).class === 'expired').length;
  { const ct = document.getElementById('countTrial'); if (ct) ct.textContent = clients.filter(c => c.isTrial && !c.isArchived && (currentGlobalServer === 'ALL' || c.assignedServer === currentGlobalServer)).length; }
  if (countArchivedEl) countArchivedEl.textContent = clients.filter(c => c.isArchived && !c.isTrial && (currentGlobalServer === 'ALL' || c.assignedServer === currentGlobalServer)).length;

  // Gráficos e tabelas pesadas só quando a aba Financeiro está aberta (digitar na busca não deve redesenhá-los)
  const finTab = document.getElementById('tabContentFinance');
  if (finTab && finTab.style.display !== 'none') {
    if (typeof renderReceiptCalendar === 'function') renderReceiptCalendar();
    if (typeof renderRevenueChart === 'function') renderRevenueChart();
    if (typeof renderServerFinance === 'function') renderServerFinance();
  }

  if (typeof updateBackupReminder === 'function') updateBackupReminder();
  if (typeof updateCreditStrip === 'function') updateCreditStrip();
  if (typeof updateOpenSupportStrip === 'function') updateOpenSupportStrip();
  if (typeof updateResellerQuotaBar === 'function') {
    updateResellerQuotaBar(clients.filter(c => !c.isArchived && !c.isTrial).length); // cota é da conta toda, não do filtro de servidor
  }
}

// ------------------------------------------------------------
// GRÁFICO DE FATURAMENTO DOS ÚLTIMOS 6 MESES
// ------------------------------------------------------------
window.renderRevenueChart = function() {
  const box = document.getElementById('mrrChartContainer');
  if (!box) return;

  const months = [];
  const [y, m] = safeGetTodayLocal().split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(-2),
      total: 0
    });
  }

  financeClients().forEach(c => {
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return;
    (Array.isArray(c.paymentHistory) ? c.paymentHistory : []).forEach(h => {
      const slot = months.find(mm => (h.date || '').startsWith(mm.key));
      if (slot) slot.total += paidAmt(h);
    });
  });

  const max = Math.max(...months.map(x => x.total), 1);
  const priv = typeof isPrivacyMode !== 'undefined' ? isPrivacyMode : false;

  box.innerHTML = months.map(x => `
    <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;">
      <small style="font-size:0.58rem; color:#94a3b8;">${priv ? '••' : (Number.isInteger(Math.round(x.total * 100) / 100) ? String(x.total) : (Math.round(x.total * 100) / 100).toFixed(2).replace('.', ','))}</small>
      <div style="width:70%; height:${Math.max(4, (x.total / max) * 85)}%; background:#10b981; border-radius:4px 4px 0 0;"></div>
      <small style="font-size:0.6rem; color:#64748b; margin-top:2px;">${x.label}</small>
    </div>`).join('');
};

// ------------------------------------------------------------
// FINANCEIRO POR MÊS E POR SERVIDOR
// ------------------------------------------------------------
window.renderServerFinance = function() {
  const barsEl = document.getElementById('serverFinanceBars');
  const tableEl = document.getElementById('serverFinanceTable');
  const monthlyEl = document.getElementById('serverMonthlyTable');
  if (!barsEl || !tableEl || !monthlyEl) return;

  const priv = typeof isPrivacyMode !== 'undefined' ? isPrivacyMode : false;
  const money = v => safeFormatCurrency(v, priv);
  const NONE = 'Sem servidor';
  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
  const norm = v => String(v || '').trim().toLowerCase();
  // nome iguais (Alpha, ALPHA, " alpha ") contam como o mesmo servidor
  const srvOf = c => { const srv = findServerForClient(c, servers); return srv ? srv.name.trim() : ((c.assignedServer || '').trim() || NONE); };

  fillFinanceSelectors();
  const periodKey = financeMonthKey();

  const [y, m] = safeGetTodayLocal().split('-').map(Number);
  const monthOpts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, m - 1 - i, 1);
    monthOpts.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() });
  }

  // Agrega por servidor (chave sem diferença de maiúsculas/minúsculas)
  const stats = {};
  const get = name => { const k = norm(name); return stats[k] || (stats[k] = { name: name.trim(), revenue: 0, cost: 0, renewals: 0, discounts: 0, active: 0, mrr: 0, late: 0, clients: 0, monthly: {} }); };

  servers.forEach(s => get(s.name));

  const last6 = monthOpts.slice(0, 6); // mais recente primeiro

  financeClients().forEach(c => {
    const st = get(srvOf(c));
    if (!c.isDeleted) st.clients++;
    if (!c.isArchived) {
      const val = parseFloat(c.price) || 0;
      st.active++;
      st.mrr += val;
      if (getStatus(c.dueDate).class === 'expired') st.late += val;
    }
    (Array.isArray(c.paymentHistory) ? c.paymentHistory : []).forEach(h => {
      // o servidor do lançamento fica gravado: trocar o cliente de servidor não move a receita antiga
      // servidor do lançamento: pelo id (se o servidor foi renomeado, segue o nome novo); senão pelo nome gravado
      const recSrv = h.serverId ? (userServers || []).find(sv => sv.id === h.serverId) : null;
      const histName = recSrv ? recSrv.name : (h.serverName || '');
      const sst = histName ? get(String(histName)) : st;
      const date = h.date || '';
      const amount = paidAmt(h);
      if (periodKey === 'ALL' || date.startsWith(periodKey)) {
        sst.revenue += amount;
        sst.cost += entryCost(h, c);
        sst.renewals++;
        sst.discounts += parseFloat(h.discountApplied) || 0;
      }
      const k = date.slice(0, 7);
      sst.monthly[k] = (sst.monthly[k] || 0) + amount;
    });
  });

  const list = Object.values(stats).filter(s => s.clients > 0 || s.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = list.reduce((a, s) => a + s.revenue, 0);
  const maxRevenue = Math.max(...list.map(s => s.revenue), 1);

  if (list.length === 0) {
    barsEl.innerHTML = '<p style="font-size:0.74rem; color:#94a3b8;">Nenhum dado financeiro ainda.</p>';
    tableEl.innerHTML = '';
    monthlyEl.innerHTML = '';
    return;
  }

  const palette = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  barsEl.innerHTML = list.map((s, i) => {
    const pct = totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 100) : 0;
    return `
      <div style="margin-bottom:6px;">
        <div style="display:flex; justify-content:space-between; font-size:0.72rem; margin-bottom:2px;">
          <strong>${safeEsc(s.name)}</strong><span>${money(s.revenue)} • ${priv ? '••' : pct + '%'}</span>
        </div>
        <div style="height:8px; background:var(--border); border-radius:99px; overflow:hidden;">
          <div style="height:100%; width:${Math.max(2, (s.revenue / maxRevenue) * 100)}%; background:${palette[i % palette.length]};"></div>
        </div>
      </div>`;
  }).join('');

  const th = 'text-align:right; padding:5px 6px; border-bottom:1px solid var(--border); white-space:nowrap;';
  const td = 'text-align:right; padding:5px 6px; border-bottom:1px solid var(--border); white-space:nowrap;';
  const tdName = 'text-align:left; padding:5px 6px; border-bottom:1px solid var(--border); font-weight:700; white-space:nowrap;';

  tableEl.innerHTML = `
    <thead><tr>
      <th style="${th} text-align:left;">Servidor</th><th style="${th}">Recebido</th><th style="${th}">Renov.</th>
      <th style="${th}">Descontos</th><th style="${th}">Custo</th><th style="${th}">Lucro</th>
      <th style="${th}">Ativos</th><th style="${th}">MRR</th><th style="${th}">Atraso</th>
    </tr></thead>
    <tbody>${list.map(s => {
      const cost = s.cost;
      const profit = s.revenue - cost;
      return `<tr>
        <td style="${tdName}">${safeEsc(s.name)}</td>
        <td style="${td}">${money(s.revenue)}</td>
        <td style="${td}">${priv ? '••' : s.renewals}</td>
        <td style="${td}">${money(s.discounts)}</td>
        <td style="${td}">${money(cost)}</td>
        <td style="${td} color:${profit >= 0 ? '#15803d' : '#b91c1c'}; font-weight:700;">${money(profit)}</td>
        <td style="${td}">${priv ? '••' : s.active}</td>
        <td style="${td}">${money(s.mrr)}</td>
        <td style="${td} color:${s.late > 0 ? '#b91c1c' : 'inherit'};">${money(s.late)}</td>
      </tr>`;
    }).join('')}
    <tr style="font-weight:800;">
      <td style="${tdName}">Total</td>
      <td style="${td}">${money(totalRevenue)}</td>
      <td style="${td}">${priv ? '••' : list.reduce((a, s) => a + s.renewals, 0)}</td>
      <td style="${td}">${money(list.reduce((a, s) => a + s.discounts, 0))}</td>
      <td style="${td}">${money(list.reduce((a, s) => a + s.cost, 0))}</td>
      <td style="${td}">${money(list.reduce((a, s) => a + s.revenue - s.cost, 0))}</td>
      <td style="${td}">${priv ? '••' : list.reduce((a, s) => a + s.active, 0)}</td>
      <td style="${td}">${money(list.reduce((a, s) => a + s.mrr, 0))}</td>
      <td style="${td}">${money(list.reduce((a, s) => a + s.late, 0))}</td>
    </tr></tbody>`;

  monthlyEl.innerHTML = `
    <thead><tr><th style="${th} text-align:left;">Servidor</th>${last6.map(o => `<th style="${th}">${o.label.slice(0, 3)}${o.label.slice(-2)}</th>`).join('')}</tr></thead>
    <tbody>${list.map(s => `<tr>
      <td style="${tdName}">${safeEsc(s.name)}</td>
      ${last6.map(o => `<td style="${td}">${money(s.monthly[o.key] || 0)}</td>`).join('')}
    </tr>`).join('')}
    <tr style="font-weight:800;"><td style="${tdName}">Total</td>${last6.map(o => `<td style="${td}">${money(list.reduce((a, s) => a + (s.monthly[o.key] || 0), 0))}</td>`).join('')}</tr></tbody>`;
};

// ------------------------------------------------------------
// RENDERIZAÇÃO DOS CARTÕES
// ------------------------------------------------------------
function renderClients() {
  try {
    updateDashboard();
    if (typeof updatePortalStats === 'function') updatePortalStats();
    if (!clientListEl) return;
    clientListEl.innerHTML = '';
    if (typeof updateTrialSummary === 'function') updateTrialSummary();

    if (typeof updateReferralDatalist === 'function') updateReferralDatalist();

    const searchText = (searchInputEl ? searchInputEl.value || '' : '').toLowerCase().trim();

    let filtered = clients.filter(c => {
      if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return false;

      const status = getStatus(c.dueDate);
      const notesText = (c.notes || '').toLowerCase();
      const serverName = (c.assignedServer || '').toLowerCase();
      const macText = (c.macAddress || '').toLowerCase();
      const appText = (c.macApp || '').toLowerCase();
      const refText = (c.referredBy || '').toLowerCase();

      const matchesSearch = !searchText || 
                            (c.name || '').toLowerCase().includes(searchText) || 
                            (c.username || '').toLowerCase().includes(searchText) || 
                            serverName.includes(searchText) ||
                            macText.includes(searchText) ||
                            appText.includes(searchText) ||
                            refText.includes(searchText) ||
                            notesText.includes(searchText);

      if (!matchesSearch) return false;
      if (currentFilter === 'trial') return Boolean(c.isTrial) && !c.isArchived;
      if (c.isTrial) return false; // testes só aparecem na aba 🧪 Testes
      if (currentFilter === 'archived') return Boolean(c.isArchived);
      if (c.isArchived) return false;

      if (currentFilter === 'all') return true;
      if (currentFilter === 'ok') return status.class === 'ok';
      if (currentFilter === 'warning') return status.class === 'warning';
      if (currentFilter === 'next7') return status.diffDays >= 0 && status.diffDays <= 7;
      if (currentFilter === 'expired') return status.class === 'expired';
      return true;
    });

    filtered.sort((a, b) => {
      if (currentFilter === 'trial') return (Date.parse(a.trialEndsAt || '') || 0) - (Date.parse(b.trialEndsAt || '') || 0); // já terminados primeiro
      const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      if (currentSort === 'dueAsc') return dateA - dateB;
      if (currentSort === 'dueDesc') return dateB - dateA;
      if (currentSort === 'nameAsc') return (a.name || '').localeCompare(b.name || '');
      if (currentSort === 'priceDesc') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
      return 0;
    });

    const totalItems = filtered.length;
    totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    if (paginationControlsEl) {
      paginationControlsEl.style.display = totalItems > PAGE_SIZE ? 'flex' : 'none';
      if (pageInfoEl) pageInfoEl.textContent = `Página ${currentPage} de ${totalPages} (${totalItems} clientes)`;
      if (prevPageBtnEl) prevPageBtnEl.disabled = currentPage === 1;
      if (nextPageBtnEl) nextPageBtnEl.disabled = currentPage === totalPages;
    }

    if (totalItems === 0) {
      clientListEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding: 24px 0;">Nenhum cliente encontrado.</p>';
      return;
    }

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pageClients = filtered.slice(startIndex, startIndex + PAGE_SIZE);
    const priv = typeof isPrivacyMode !== 'undefined' ? isPrivacyMode : false;

    pageClients.forEach(client => {
      const status = getStatus(client.dueDate);
      const health = client.isTrial ? { label: 'Em teste', color: '#0ea5e9' } : getClientHealthStatus(client);
      const refProgress = getClientReferralProgress(client);
      const metrics = getClientFinancialMetrics(client);
      const supportCount = Array.isArray(client.supportHistory) ? client.supportHistory.length : (parseInt(client.supportCount, 10) || 0);

      const card = document.createElement('div');
      const isArchived = Boolean(client.isArchived);
      card.className = `card ${isArchived ? 'archived' : status.class}`;

      const formattedDueDateYY = formatDateYY(client.dueDate);
      const referralPercent = refProgress.goal > 0 ? Math.min(100, (refProgress.count / refProgress.goal) * 100) : 0;

      let dueTextDisplay = `${formattedDueDateYY}`;
      if (client.isTrial) {
        dueTextDisplay = '🧪 em teste';
      } else if (isArchived) {
        dueTextDisplay += status.diffDays < 0 ? ` (${Math.abs(status.diffDays)}d atrasado • Arq)` : ` (Arq)`;
      } else {
        dueTextDisplay += ` (${status.label})`;
      }

      card.innerHTML = `
        <div class="card-bit-header" style="padding: 11px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 6px;">
          
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; flex-wrap: wrap;">
              <strong style="font-size: 0.95rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${safeEsc(client.name || client.username || 'Cliente')}
              </strong>
              
              <span style="display: inline-flex; align-items: center; gap: 4px; background: ${health.color}14; color: ${health.color}; border: 1px solid ${health.color}33; font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 99px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${health.color};"></span>
                ${health.label}
              </span>

              ${client.supportOpenAt ? `<span style="display: inline-flex; align-items: center; gap: 4px; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 99px;" title="${safeEsc(client.supportOpenReason || 'Atendimento')}${client.supportOpenNotes ? ' — ' + safeEsc(client.supportOpenNotes) : ''}">⏳ Suporte em aberto</span>` : ''}
              ${(refProgress.isGoalReached && !client.referralOptOut) ? `<button type="button" class="btn-gift-badge" title="Meta de indicações atingida! Toque para resgatar 1 mês grátis">🎁</button>` : ''}
              ${(parseFloat(client.pendingDiscount) || 0) > 0 ? `<span style="font-size: 0.68rem; font-weight: 700; color: #92400e; background: #fef3c7; border: 1px solid #fde68a; padding: 2px 6px; border-radius: 4px;" title="Crédito de desconto que será abatido na próxima renovação">🏷️ Crédito -${safeFormatCurrency(parseFloat(client.pendingDiscount) || 0, priv)}</span>` : ''}

              <span style="font-size: 0.68rem; font-weight: 700; color: #4338ca; background: #e0e7ff; border: 1px solid #c7d2fe; padding: 2px 6px; border-radius: 4px;" title="Total de renovações realizadas">
                🔄 ${metrics.renewCount}x
              </span>
            </div>

            <div style="text-align: right; flex-shrink: 0; display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 1.05rem; font-weight: 800; color: var(--text-main);">
                ${safeFormatCurrency(client.price, priv)}
              </span>
              ${isArchived ? '' : `<button type="button" class="btn-hdr-charge" aria-label="${client.isTrial ? 'Perguntar sobre o teste' : 'Cobrar no WhatsApp'}" title="${client.isTrial ? 'Perguntar sobre o teste' : 'Cobrar no WhatsApp'}" style="width:34px; height:34px; border-radius:50%; border:1px solid var(--border); background:#dcfce7; font-size:0.95rem; cursor:pointer; padding:0;">💬</button><button type="button" class="btn-hdr-renew" aria-label="${client.isTrial ? 'Efetivar teste' : 'Renovar'}" title="${client.isTrial ? 'Efetivar teste' : 'Renovar'}" style="width:34px; height:34px; border-radius:50%; border:1px solid var(--border); background:#dbeafe; font-size:0.95rem; cursor:pointer; padding:0;">🔄</button>`}
            </div>
          </div>

          ${client.isTrial ? (() => { const ti = trialInfo(client); return `<div style="display:flex; flex-direction:column; gap:7px; font-size:0.74rem; margin-bottom:8px; padding:8px; border:1px solid ${ti.over ? '#f87171' : '#38bdf8'}; border-radius:6px; background:${ti.over ? 'rgba(248,113,113,.12)' : 'rgba(56,189,248,.12)'};"><span>🧪 <strong>Teste de ${Number(client.trialHours) || 1}h</strong> — ${ti.text}${client.trialFollowUpDate === safeGetTodayLocal() ? ' • 💬 chamado hoje' : ''}${client.referredBy ? `<br><small>Indicado por ${safeEsc(client.referredBy)}: só conta depois da renovação</small>` : ''}</span><span style="display:flex; gap:6px;"><button type="button" class="btn-trial-call" style="flex:1; background:#16a34a; color:#fff; border:none; padding:7px 9px; border-radius:4px; font-weight:700; font-size:0.72rem; cursor:pointer;">💬 Perguntar</button><button type="button" class="btn-trial-convert" style="flex:1; background:#059669; color:#fff; border:none; padding:5px 9px; border-radius:4px; font-weight:700; font-size:0.72rem; cursor:pointer;">✅ Efetivar</button><button type="button" class="btn-trial-drop" title="Não renovou: excluir" style="background:var(--surface); color:var(--text-muted); border:1px solid var(--border); padding:5px 8px; border-radius:4px; font-size:0.72rem; cursor:pointer;">🗑</button></span></div>`; })() : ''}

          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem;">
            <div style="display: flex; gap: 6px; align-items: center;">
              <button type="button" class="btn-open-history" style="background: var(--surface-alt); border: 1px solid var(--border); color: var(--text-muted); font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; cursor: pointer;" title="Clique para ver o histórico detalhado">
                🛠️ ${supportCount} suportes
              </button>

              <span style="font-weight: 700; color: var(--primary);" title="LTV Total">
                💎 ${safeFormatCurrency(metrics.ltv, priv)}
              </span>
            </div>

            <div style="font-size: 0.8rem; font-weight: 800; color: ${status.diffDays < 0 ? '#dc2626' : (status.diffDays <= 3 ? '#ea580c' : '#16a34a')};">
              📅 ${dueTextDisplay}
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; background: var(--surface-alt); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>👤 <strong>${safeEsc(client.username || '')}</strong></span>
              <button type="button" class="btn-copy-user-quick" style="background: none; border: none; cursor: pointer; padding: 2px;" title="Copiar Usuário">📋</button>
              <span style="color: var(--border);">|</span>
              <span>🔑 <strong>${safeEsc(client.serverPassword || '—')}</strong></span>
              <button type="button" class="btn-copy-pass-quick" style="background: none; border: none; cursor: pointer; padding: 2px;" title="Copiar Senha">📋</button>
            </div>

            <button type="button" class="btn-copy-m3u-quick" style="background: #f1f5f9; color: #1e3a8a; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer;" title="Copiar Link M3U">
              🌐 M3U
            </button>
          </div>

        </div>

        <div class="card-collapsible-body" style="display: none; padding: 12px; border-top: 1px solid var(--border); background: var(--surface-alt);">
          
          <div class="card-details-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.74rem; margin-bottom: 10px; color: var(--text-muted);">
            <div>🖥️ <strong>Servidor:</strong> ${safeEsc(client.assignedServer || 'Não definido')}${(() => { const s = findServerForClient(client, window.userServers); return (s && s.active === false) ? ' <span title="Servidor inativo" style="color:#b45309; opacity:.85;">⚠️ inativo</span>' : ''; })()}</div>
            <div>📱 <strong>WhatsApp:</strong> ${safeMaskPhone(client.phone, priv)}</div>
            ${client.macAddress ? `<div style="grid-column: 1 / -1; display:flex; align-items:center; gap:6px;">📟 <strong>MAC:</strong> <span style="font-family:monospace;">${safeEsc(client.macAddress)}</span> <button type="button" class="btn-copy-mac" aria-label="Copiar MAC" style="margin-left:auto; padding:5px 11px; font-size:0.72rem; font-weight:700; border:1px solid var(--border); background:var(--surface); color:var(--text-main); border-radius:6px; cursor:pointer;">📋 Copiar MAC</button></div>` : ''}
            ${client.macApp ? `<div>📱 <strong>App:</strong> ${safeEsc(client.macApp)}</div>` : ''}
            ${client.isBlocked ? `<div style="grid-column: 1 / -1; font-size: 0.7rem; color: #b45309; opacity: .9;">⚠️ <strong>Bloqueado</strong> <span style="opacity:.8;">— acesso suspenso (portal indisponível)</span></div>` : ''}
          </div>

          ${client.notes ? `<p style="font-size: 0.74rem; color: var(--text-muted); margin-bottom: 8px;">📝 <strong>Obs:</strong> ${safeEsc(client.notes)}</p>` : ''}

          ${client.referralOptOut ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:0.72rem; padding:6px 8px; border:1px dashed var(--border); border-radius:6px; margin-bottom:10px; color:var(--text-muted);"><span>🚫 Fora do programa de indicação</span><button type="button" class="btn-ref-optin" style="background:var(--surface); color:var(--text-main); border:1px solid var(--border); padding:3px 9px; border-radius:4px; font-weight:700; font-size:0.68rem; cursor:pointer;">Voltar ao programa</button></div>` : `
          <div class="referral-box" style="background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin-bottom: 10px;">
            <div class="referral-header" style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem;">
              <span>🎁 <strong>Indicações:</strong> ${refProgress.count}/${refProgress.goal} ${refProgress.isGoalReached ? '• <strong style="color:#166534;">Meta batida: mês grátis ou desconto</strong>' : ''}${refProgress.count > 0 && referralDiscountVal > 0 ? ` • disponível ${safeFormatCurrency(refProgress.discountVal, priv)}` : ''}</span>
              <div style="display: flex; gap: 4px;">
                ${(refProgress.count > 0 && referralDiscountVal > 0) ? `<button type="button" class="btn-apply-discount" style="background:#b45309; color:#fff; border:none; padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.68rem; cursor:pointer;">🏷️ Aplicar desconto</button>` : ''}
                ${refProgress.isGoalReached ? `<button type="button" class="btn-reward-month" style="background:#166534; color:#fff; border:none; padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.68rem; cursor:pointer;">🎁 +1 Mês Grátis</button>` : ''}
                <button type="button" class="btn-send-ref-link" style="background:#1e3a8a; color:#fff; border:none; padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.68rem; cursor:pointer;">📤 Link</button>
                <button type="button" class="btn-ref-optout" title="Tirar este cliente do programa Indique e Ganhe" style="background:var(--surface); color:var(--text-muted); border:1px solid var(--border); padding:2px 7px; border-radius:4px; font-weight:700; font-size:0.68rem; cursor:pointer;">🚫 Sair</button>
              </div>
            </div>
            <div class="referral-mini-bar-bg" style="width: 100%; height: 4px; background: var(--border); border-radius: 99px; overflow: hidden; margin-top: 5px;">
              <div class="referral-mini-bar-fill" style="height: 100%; background: #1e3a8a; width: ${referralPercent}%;"></div>
            </div>
            ${refProgress.friends.length > 0 ? `<div style="font-size:0.68rem; color:var(--text-muted); margin-top:6px; word-break:break-word;">👥 <strong>Histórico de Indicados:</strong> ${refProgress.friends.map(f => safeEsc(f.name || f.username)).join(', ')}</div>` : ''}
          </div>
          `}

          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            ${isArchived ? `
              <button type="button" class="btn-act btn-reactivate-client" style="flex: 1; padding: 9px; font-size: 0.78rem; border: none; border-radius: 6px; font-weight: 700; background: #c2410c; color: #fff; cursor: pointer;">🎯 Reativar</button>
            ` : `
              <button type="button" class="btn-act btn-wa-charge" style="flex: 1; padding: 9px; font-size: 0.78rem; border: none; border-radius: 6px; font-weight: 700; background: #15803d; color: #fff; cursor: pointer;">💬 Cobrar</button>
            `}
${window.isAiMasterNow() ? '<button type="button" class="btn-act btn-ai-msg" style="flex: 1; padding: 9px; font-size: 0.78rem; border: none; border-radius: 6px; font-weight: 700; color: #fff; background: #7c3aed; cursor: pointer;">✨ IA</button>' : ''}
            <button type="button" class="btn-act btn-renew-quick" style="flex: 1; padding: 9px; font-size: 0.78rem; border: none; border-radius: 6px; font-weight: 700; background: #1e40af; color: #fff; cursor: pointer;">🔄 Renovar</button>
            <button type="button" class="btn-act btn-support-register" style="flex: 1; padding: 9px; font-size: 0.78rem; border: none; border-radius: 6px; font-weight: 700; color: #fff; cursor: pointer; ${client.supportOpenAt ? 'background:#dc2626;' : 'background:#0f766e;'}">${client.supportOpenAt ? '⏳ Fechar suporte' : '🤝 Suporte'}</button>
          </div>

          ${(!client.isTrial && referralFirstDiscount > 0 && (client.referredBy || client.referredById) && !client.firstDiscountGiven && !(Array.isArray(client.paymentHistory) && client.paymentHistory.length)) ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:0.74rem; margin-bottom:8px; padding:6px 8px; border:1px solid #a78bfa; border-radius:6px;"><span>🎁 <strong>Indicado por ${safeEsc(client.referredBy || 'amigo')}</strong> — ainda sem desconto de boas-vindas</span><button type="button" class="btn-first-discount" style="background:#7c3aed; color:#fff; border:none; padding:3px 9px; border-radius:4px; font-weight:700; font-size:0.7rem; cursor:pointer;">Dar ${safeFormatCurrency(referralFirstDiscount, false)}</button></div>` : ''}
          ${(parseFloat(client.owedAmount) > 0) ? `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; font-size:0.74rem; margin-bottom:8px; padding:6px 8px; border:1px solid #f59e0b; border-radius:6px;"><span>💳 <strong>A receber:</strong> ${safeFormatCurrency(parseFloat(client.owedAmount), priv)}</span><button type="button" class="btn-mark-paid" style="background:#16a34a; color:#fff; border:none; padding:3px 9px; border-radius:4px; font-weight:700; font-size:0.7rem; cursor:pointer;">✓ Marcar pago</button></div>` : ''}
          ${portalAccessLine(client) ? `<div style="font-size:0.72rem; margin-bottom:8px;">${portalAccessLine(client)}</div>` : ''}
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-act-sub btn-toggle-block" title="${client.isBlocked ? 'Desbloquear acesso' : 'Bloquear acesso'}" style="flex: 1 1 100%; padding: 6px; font-size: 0.72rem; border: 1px solid ${client.isBlocked ? '#fde68a' : 'var(--border)'}; background: ${client.isBlocked ? '#fffbeb' : 'var(--surface)'}; color: ${client.isBlocked ? '#92400e' : 'var(--text-muted)'}; border-radius: 4px; cursor: pointer;">${client.isBlocked ? '🔓 Desbloquear acesso' : '🔒 Bloquear acesso'}</button>
            <button type="button" class="btn-act-sub btn-portal" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; border-radius: 4px; cursor: pointer;">🔗 Portal</button>
            ${(client.macAddress || client.macApp) ? '<button type="button" class="btn-act-sub btn-activate-app" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid #c7d2fe; background: #eef2ff; color: #3730a3; border-radius: 4px; cursor: pointer;">📲 Ativar</button>' : ''}
            <button type="button" class="btn-act-sub btn-send-credentials" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); border-radius: 4px; cursor: pointer;">📋 Acesso</button>
            <button type="button" class="btn-act-sub btn-edit-quick" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); border-radius: 4px; cursor: pointer;">✏️ Editar</button>
            <button type="button" class="btn-act-sub btn-toggle-archive" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); border-radius: 4px; cursor: pointer;">${isArchived ? '📥 Desarquivar' : '📦 Arquivar'}</button>
            ${((window.userServers || []).filter(sv => sv.active !== false).length > 1) ? '<button type="button" class="btn-act-sub btn-switch-server" style="flex: 1 1 100%; padding: 7px; font-size: 0.74rem; border: 1px solid var(--border); background: var(--surface); color: var(--text-main); border-radius: 4px; cursor: pointer; font-weight:700;">🔄 Trocar servidor</button>' : ''}
            ${client.lastRenewal ? '<button type="button" class="btn-act-sub btn-undo-renew" style="flex: 1 1 100%; padding: 6px; font-size: 0.72rem; border: 1px dashed var(--border); background: var(--surface); color: var(--text-muted); border-radius: 4px; cursor: pointer;">↩️ Desfazer última renovação</button>' : ''}
            <button type="button" class="btn-act-sub btn-delete-quick" style="flex: 1; padding: 6px; font-size: 0.72rem; border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 4px; cursor: pointer;">✕ Excluir</button>
          </div>

        </div>
      `;

      card.querySelector('.card-bit-header').addEventListener('click', () => {
        const body = card.querySelector('.card-collapsible-body');
        if (body) {
          const isHidden = body.style.display === 'none' || body.style.display === '';
          body.style.display = isHidden ? 'block' : 'none';
          card.classList.toggle('expanded', isHidden);
        }
      });

      card.querySelector('.btn-open-history').addEventListener('click', (e) => {
        e.stopPropagation();
        openSupportHistoryModal(client.id);
      });

      card.querySelector('.btn-copy-user-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof copyUsernameToClipboard === 'function') {
          copyUsernameToClipboard(client.username, e.target);
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(client.username || '');
        }
      });

      card.querySelector('.btn-copy-pass-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.clipboard) {
          if (!client.serverPassword) { alert('Este cliente não tem senha cadastrada.'); return; }
          navigator.clipboard.writeText(client.serverPassword);
          showToast("Senha copiada");
        }
      });

      card.querySelector('.btn-copy-m3u-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        copyClientDirectM3u(client.id, e.target);
      });

      const btnWa = card.querySelector('.btn-wa-charge');
      if (btnWa) {
        btnWa.addEventListener('click', (e) => {
          e.stopPropagation();
          // Mesmo caminho do "Cobrar agora": marca "cobrado hoje" e usa a IA na conta Master
          chargeClientNow(client);
        });
      }

      const btnReact = card.querySelector('.btn-reactivate-client');
      if (btnReact) {
        btnReact.addEventListener('click', (e) => {
          e.stopPropagation();
          const discountFmt = safeFormatCurrency(reactivationDiscountVal, false);
          const msg = (customReactivationMessage || DEFAULT_REACTIVATION_MSG)
            .replace(/\{nome\}/gi, client.name || client.username)
            .replace(/\{desconto\}/gi, discountFmt);
          openWhatsAppDirect(client.phone, msg);
        });
      }

      { const ba = card.querySelector('.btn-ai-msg'); if (ba) ba.addEventListener('click', (e) => { e.stopPropagation(); openClientAiMessage(client.id); }); }
      card.querySelector('.btn-renew-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        openRenewModal(client.id);
      });

      card.querySelector('.btn-support-register').addEventListener('click', (e) => {
        e.stopPropagation();
        openSupportReasonModal(client.id);
      });

      const btnActivate = card.querySelector('.btn-activate-app');
      if (btnActivate) btnActivate.addEventListener('click', (e) => { e.stopPropagation(); openActivateModal(client.id); });

      card.querySelector('.btn-send-credentials').addEventListener('click', (e) => {
        e.stopPropagation();
        sendClientAccessCredentials(client.id);
      });

      { const bo = card.querySelector('.btn-ref-optout'); if (bo) bo.addEventListener('click', (e) => { e.stopPropagation(); toggleReferralOptOut(client.id); }); const bi = card.querySelector('.btn-ref-optin'); if (bi) bi.addEventListener('click', (e) => { e.stopPropagation(); toggleReferralOptOut(client.id); }); }
      const btnSendRef = card.querySelector('.btn-send-ref-link');
      if (btnSendRef) btnSendRef.addEventListener('click', (e) => {
        e.stopPropagation();
        sendReferralLink(client.id);
      });

      const btnGift = card.querySelector('.btn-gift-badge');
      if (btnGift) {
        btnGift.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmRenewalReward(client.id);
        });
      }

      const btnDiscount = card.querySelector('.btn-apply-discount');
      if (btnDiscount) {
        btnDiscount.addEventListener('click', (e) => {
          e.stopPropagation();
          applyReferralDiscount(client.id);
        });
      }

      const btnReward = card.querySelector('.btn-reward-month');
      if (btnReward) {
        btnReward.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmRenewalReward(client.id);
        });
      }

      const btnPortal = card.querySelector('.btn-portal');
      if (btnPortal) btnPortal.addEventListener('click', (e) => { e.stopPropagation(); openPortalModal(client.id); });

      const btnBlock = card.querySelector('.btn-toggle-block');
      if (btnBlock) btnBlock.addEventListener('click', (e) => { e.stopPropagation(); toggleClientBlock(client.id); });

      card.querySelector('.btn-edit-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        startEdit(client.id);
      });

      card.querySelector('.btn-toggle-archive').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleArchiveClient(client.id, !isArchived);
      });

      const btnCopyMac = card.querySelector('.btn-copy-mac');
      if (btnCopyMac) btnCopyMac.addEventListener('click', (e) => { e.stopPropagation(); copyTextSafe(client.macAddress, btnCopyMac, '✓ Copiado'); });
      const btnSwitchSrv = card.querySelector('.btn-switch-server');
      if (btnSwitchSrv) btnSwitchSrv.addEventListener('click', (e) => { e.stopPropagation(); openSwitchServer(client.id); });
      { const hc = card.querySelector('.btn-hdr-charge'); if (hc) hc.addEventListener('click', (e) => { e.stopPropagation(); if (client.isTrial) sendTrialFollowUp(client.id); else chargeClientNow(client); }); const hr = card.querySelector('.btn-hdr-renew'); if (hr) hr.addEventListener('click', (e) => { e.stopPropagation(); openRenewModal(client.id); }); }
      { const bc = card.querySelector('.btn-trial-convert'); if (bc) bc.addEventListener('click', (e) => { e.stopPropagation(); convertTrial(client.id); }); const bk = card.querySelector('.btn-trial-call'); if (bk) bk.addEventListener('click', (e) => { e.stopPropagation(); sendTrialFollowUp(client.id); }); const bd = card.querySelector('.btn-trial-drop'); if (bd) bd.addEventListener('click', (e) => { e.stopPropagation(); removeClient(client.id); }); }
      const btnFirstDisc = card.querySelector('.btn-first-discount');
      if (btnFirstDisc) btnFirstDisc.addEventListener('click', (e) => { e.stopPropagation(); giveFirstDiscount(client.id); });
      const btnMarkPaid = card.querySelector('.btn-mark-paid');
      if (btnMarkPaid) btnMarkPaid.addEventListener('click', (e) => { e.stopPropagation(); markOwedPaid(client.id); });
      const btnUndoRenew = card.querySelector('.btn-undo-renew');
      if (btnUndoRenew) btnUndoRenew.addEventListener('click', async (e) => { e.stopPropagation(); try { await undoLastRenewal(client.id); } catch (err) { alert('Erro: ' + err.message); } });
      card.querySelector('.btn-delete-quick').addEventListener('click', (e) => {
        e.stopPropagation();
        removeClient(client.id);
      });

      clientListEl.appendChild(card);
    });
  } catch (err) {
    console.error("Erro crítico ao renderizar clientes:", err);
    if (clientListEl) {
      clientListEl.innerHTML = '<p style="text-align:center; color:var(--danger); font-size:0.8rem; padding: 20px 0;">⚠️ Ocorreu um erro ao carregar os clientes. Verifique o console.</p>';
    }
  }
}

// ------------------------------------------------------------
// SINCRONIZAÇÃO NUVEM (FILTRADA POR ownerId)
// ------------------------------------------------------------
window.startFirestoreSync = function(targetOwnerId) {
  const resolvedUid = targetOwnerId 
    || (typeof activeOwnerId !== 'undefined' ? activeOwnerId : null)
    || (typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : null)
    || (typeof auth !== 'undefined' && auth.currentUser ? auth.currentUser.uid : null);

  const serverIndicator = document.getElementById('serverStatusIndicator');

  if (!resolvedUid) {
    if (serverIndicator) serverIndicator.style.color = '#ef4444';
    return;
  }

  activeOwnerId = resolvedUid;
  if (unsubscribeFirestore) unsubscribeFirestore();
  if (serverIndicator) serverIndicator.style.color = '#f59e0b';

  const dbRef = (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients");

  // Consulta filtrada: compatível com regras do Firestore que limitam a leitura ao dono do registro.
  unsubscribeFirestore = dbRef.where("ownerId", "==", resolvedUid).onSnapshot((snapshot) => {
    clients = [];
    window.deletedClients = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data && (data.name || data.username)) {
        // excluído = some da carteira, mas o histórico de pagamentos continua no financeiro
        if (data.isDeleted === true) window.deletedClients.push({ id: doc.id, ...data, isArchived: true });
        else clients.push({ id: doc.id, ...data });
      }
    });

    if (serverIndicator) serverIndicator.style.color = '#22c55e';
    updateDailyActions();
    renderClients();
    if (window.currentUser && activeOwnerId === window.currentUser.uid && !window._legacyRefDone) setTimeout(migrateLegacyReferrals, 1500);
  }, (err) => {
    console.error("ERRO NO FIRESTORE:", err);
    if (serverIndicator) serverIndicator.style.color = '#ef4444';
    if (clientListEl) {
      clientListEl.innerHTML = `<p style="text-align:center; color:var(--danger); font-size:0.8rem; padding: 20px 0;">⚠️ Erro ao carregar clientes: ${safeEsc(err.message)}</p>`;
    }
  });
};

window.setFilter = function(filterType, element) {
  currentFilter = filterType;
  currentPage = 1;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  if (element) element.classList.add('active');
  renderClients();
};

window.changeSortOrder = function(sortValue) {
  currentSort = sortValue;
  currentPage = 1;
  localStorage.setItem('user_sort_order', currentSort);
  renderClients();
};

window.prevPage = function() { if (currentPage > 1) { currentPage--; renderClients(); } };
window.nextPage = function() { if (currentPage < totalPages) { currentPage++; renderClients(); } };

if (searchInputEl) {
  let searchDebounceTimer = null;
  searchInputEl.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { currentPage = 1; renderClients(); }, 180);
  });
}

window.startEdit = function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;

  clientIdInputEl.value = client.id;
  document.getElementById('name').value = client.name || '';
  document.getElementById('username').value = client.username || '';
  if (serverPasswordInputEl) serverPasswordInputEl.value = client.serverPassword || '';
  populateClientServerOptions(client.assignedServer || '');
  if (clientMacAddressEl) clientMacAddressEl.value = client.macAddress || '';
  if (clientMacAppEl) clientMacAppEl.value = client.macApp || '';
  if (referredByInputEl) referredByInputEl.value = client.referredBy || '';
  { const tc = document.getElementById('isTrial'), th = document.getElementById('trialHours'); if (tc) tc.checked = client.isTrial === true; if (th) th.value = String(client.trialHours || 1); }
  window.updateFirstDiscountField();
  document.getElementById('price').value = client.price || '';
  document.getElementById('phone').value = client.phone || '';
  document.getElementById('dueDate').value = client.dueDate || '';
  document.getElementById('notes').value = client.notes || '';
  document.getElementById('hasPending').checked = Boolean(client.hasPending);
  { const ro = document.getElementById('referralOptOut'); if (ro) ro.checked = Boolean(client.referralOptOut); }
  const blockedChk = document.getElementById('isBlocked');
  if (blockedChk) blockedChk.checked = Boolean(client.isBlocked);
  if (serverPlanInputEl) serverPlanInputEl.value = client.serverPlan || '';

  formTitleEl.textContent = 'Editar Cliente';
  saveBtnEl.textContent = 'Salvar Alterações';
  if (clientFormEl) clientFormEl.style.display = 'block';
  if (btnToggleClientFormEl) btnToggleClientFormEl.textContent = '✕ Fechar Formulário';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ------------------------------------------------------------
// PORTAL DO ASSINANTE: configurações, link individual e modal
// ------------------------------------------------------------
window.portalSettings = Object.assign({
  showUser: true, showPassword: true, showMac: true, showDnsIp: true, showDnsUrl: true,
  showM3u: true, showFinance: true, showTutorials: true, showWhatsapp: true, brandName: ''
}, window.portalSettings || {});
window.portalSupportWhatsapp = window.portalSupportWhatsapp || '';

const PORTAL_FLAGS = ['showUser','showPassword','showMac','showDnsIp','showDnsUrl','showM3u','showFinance','showTutorials','showWhatsapp','showReferral'];

window.fillPortalSettingsForm = function() {
  PORTAL_FLAGS.forEach(f => { const el = document.getElementById('portal_' + f); if (el) el.checked = window.portalSettings[f] !== false; });
  const pinEl = document.getElementById('portal_requirePin'); if (pinEl) pinEl.checked = window.portalSettings.requirePin === true;
  const b = document.getElementById('portal_brandName'); if (b) b.value = window.portalSettings.brandName || '';
  const w = document.getElementById('portal_supportWhatsapp'); if (w) w.value = formatBrPhoneLocal(window.portalSupportWhatsapp || '');
};

window.savePortalSettings = async function() {
  const ps = {};
  PORTAL_FLAGS.forEach(f => { const el = document.getElementById('portal_' + f); ps[f] = el ? el.checked : true; });
  const pinChk = document.getElementById('portal_requirePin'); ps.requirePin = pinChk ? pinChk.checked : false;
  ps.brandName = (document.getElementById('portal_brandName') || {}).value ? document.getElementById('portal_brandName').value.trim() : '';
  const waRaw = ((document.getElementById('portal_supportWhatsapp') || {}).value || '').trim();
  let wa = '';
  if (waRaw) {
    const n = normalizeBrPhone(waRaw);
    if (!n.ok) return alert('Número de WhatsApp inválido.\n\nDigite DDD + número, por exemplo: (11) 91234-5678');
    wa = n.full; // salvo com 55 na frente, pronto para o link do WhatsApp
  }
  window.portalSettings = ps;
  window.portalSupportWhatsapp = wa;
  try {
    await (typeof db !== 'undefined' ? db : firebase.firestore()).collection('settings').doc(activeOwnerId).set({ portalSettings: ps, supportWhatsapp: wa }, { merge: true });
    alert('✅ Configurações do portal salvas!');
  } catch (e) { alert('Erro ao salvar: ' + e.message); }
};

async function portalSha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function portalNewToken() {
  const a = new Uint8Array(32); crypto.getRandomValues(a);
  let s = ''; a.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
window.portalLinkFor = function(client) {
  return client && client.portalToken ? `${location.origin}/portal.html?id=${client.portalToken}` : '';
};
window.buildPortalMessage = function(client) {
  const link = portalLinkFor(client);
  return `🔗 *SEU PORTAL DO ASSINANTE*\n\nOlá, *${client.name}*! Acesse seus dados, DNS e informações de renovação:\n\n${link}\n\n💡 Salve este link para consultar quando precisar.`;
};

let portalModalClientId = null;
const portalFs = () => (typeof db !== 'undefined' ? db : firebase.firestore());

// ============================================================
// SIMULADOR DE CRESCIMENTO E LUCRO (novos clientes)
// ============================================================
window.openGrowthSimulator = function() {
  if (typeof closeFabMenu === 'function') closeFabMenu();
  const old = document.getElementById('growthSimOverlay'); if (old) old.remove();

  // Ponto de partida: números reais da sua carteira
  const active = clients.filter(c => !c.isArchived && !c.isTrial);
  const baseCount = active.length;
  const baseArpu = baseCount ? active.reduce((a, c) => a + (parseFloat(c.price) || 0), 0) / baseCount : 30;
  const baseCost = baseCount ? active.reduce((a, c) => a + creditCostFor(c), 0) / baseCount : (costPerCredit || 0);
  const r2 = v => Math.round(v * 100) / 100;

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('growth_sim_inputs') || '{}'); } catch (e) {}
  const val = (k, d) => (saved[k] !== undefined && saved[k] !== '' ? saved[k] : d);
  const DEF = { newPerMonth: 5, churn: 5, months: 12, price: r2(baseArpu), cost: r2(baseCost), fixed: 0, goal: 1000 };

  const overlay = document.createElement('div');
  overlay.id = 'growthSimOverlay';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'z-index:10050; align-items:flex-start; padding-top:max(16px, env(safe-area-inset-top));';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  const fld = (id, label, step, v, hint) => `<div class="field" style="margin-bottom:6px;"><label for="${id}" style="font-size:0.7rem;">${label}</label><input type="number" id="${id}" step="${step}" min="0" inputmode="decimal" value="${v}" style="padding:8px; font-size:0.84rem;">${hint ? `<small style="font-size:0.62rem; color:var(--text-muted);">${hint}</small>` : ''}</div>`;
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:440px; max-height:94vh; display:flex; flex-direction:column; text-align:left;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <h3 style="margin:0; font-size:1.05rem;">📈 Simulador de crescimento</h3>
        <button type="button" id="gsClose" class="btn-cancel" style="padding:4px 10px;" aria-label="Fechar">✕</button>
      </div>
      <p style="font-size:0.72rem; color:var(--text-muted); margin:0 0 8px;">Hoje você tem <strong>${baseCount}</strong> cliente(s) ativo(s), mensalidade média <strong>${safeFormatCurrency(baseArpu, false)}</strong> e custo médio por crédito <strong>${safeFormatCurrency(baseCost, false)}</strong>. Mude os números e veja o resultado.</p>
      <div style="overflow-y:auto; padding-right:2px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 8px;">
          ${fld('gsNew', 'Novos clientes por mês', '1', val('newPerMonth', DEF.newPerMonth))}
          ${fld('gsChurn', 'Cancelamentos por mês (%)', '0.5', val('churn', DEF.churn), 'Quantos % saem todo mês')}
          ${fld('gsPrice', 'Mensalidade dos novos (R$)', '0.5', val('price', DEF.price))}
          ${fld('gsCost', 'Custo do crédito (R$)', '0.5', val('cost', DEF.cost))}
          ${fld('gsFixed', 'Outros custos por mês (R$)', '1', val('fixed', DEF.fixed), 'Ex: anúncios, ferramentas')}
          <div class="field" style="margin-bottom:6px;"><label for="gsMonths" style="font-size:0.7rem;">Período</label>
            <select id="gsMonths" style="padding:8px; font-size:0.84rem;">${[6, 12, 24, 36].map(m => `<option value="${m}" ${Number(val('months', DEF.months)) === m ? 'selected' : ''}>${m} meses</option>`).join('')}</select></div>
        </div>
        <div id="gsResult" style="margin-top:6px;"></div>
        <div style="border-top:1px solid var(--border); margin-top:10px; padding-top:10px;">
          <strong style="font-size:0.82rem;">🎯 Quantos clientes para a minha meta?</strong>
          <div style="display:flex; gap:8px; align-items:flex-end; margin-top:6px;">
            <div style="flex:1;">${fld('gsGoal', 'Lucro mensal que eu quero (R$)', '50', val('goal', DEF.goal))}</div>
          </div>
          <div id="gsGoalResult" style="font-size:0.8rem; line-height:1.5;"></div>
        </div>
      </div>
      <p style="font-size:0.62rem; color:var(--text-muted); margin:8px 0 0;">É uma estimativa: considera que cada cliente ativo usa 1 crédito por mês e que a taxa de cancelamento se mantém igual.</p>
    </div>`;
  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector('#' + id);
  const num = id => Math.max(0, parseFloat(String($(id).value).replace(',', '.')) || 0);
  const money = v => safeFormatCurrency(v, false);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('gsClose').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const calc = () => {
    const inp = { newPerMonth: num('gsNew'), churn: Math.min(100, num('gsChurn')), months: Number($('gsMonths').value) || 12, price: num('gsPrice'), cost: num('gsCost'), fixed: num('gsFixed'), goal: num('gsGoal') };
    try { localStorage.setItem('growth_sim_inputs', JSON.stringify(inp)); } catch (e) {}
    const keep = 1 - inp.churn / 100;
    let existing = baseCount, added = 0, cumulative = 0;
    const rows = [];
    for (let m = 1; m <= inp.months; m++) {
      existing = existing * keep;
      added = added * keep + inp.newPerMonth;
      const total = existing + added;
      const revenue = existing * baseArpu + added * inp.price;
      const cost = existing * baseCost + added * inp.cost + inp.fixed;
      const profit = revenue - cost;
      cumulative += profit;
      rows.push({ m, total, revenue, cost, profit });
    }
    const last = rows[rows.length - 1];
    const maxP = Math.max(...rows.map(r => Math.abs(r.profit)), 1);
    const card = (t, v, c) => `<div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:8px;"><div style="font-size:0.64rem; color:var(--text-muted);">${t}</div><div style="font-size:0.98rem; font-weight:800; color:${c || 'var(--text-main)'};">${v}</div></div>`;
    const good = '#15803d', bad = '#b91c1c';
    $('gsResult').innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
        ${card(`Clientes em ${inp.months} meses`, `${Math.round(last.total)} <small style="font-size:0.66rem; font-weight:600; color:var(--text-muted);">(hoje ${baseCount})</small>`)}
        ${card('Receita mensal no final', money(last.revenue))}
        ${card('Lucro mensal no final', money(last.profit), last.profit >= 0 ? good : bad)}
        ${card(`Lucro acumulado em ${inp.months} meses`, money(cumulative), cumulative >= 0 ? good : bad)}
      </div>
      <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:3px;">Lucro por mês</div>
      <div style="display:flex; align-items:flex-end; gap:2px; height:70px; border-bottom:1px solid var(--border);">
        ${rows.map(r => `<div title="Mês ${r.m}: ${money(r.profit)}" style="flex:1; height:${Math.max(3, Math.abs(r.profit) / maxP * 100)}%; background:${r.profit >= 0 ? '#10b981' : '#ef4444'}; border-radius:2px 2px 0 0;"></div>`).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.6rem; color:var(--text-muted);"><span>mês 1</span><span>mês ${inp.months}</span></div>
      <details style="margin-top:8px;"><summary style="font-size:0.74rem; cursor:pointer; color:var(--primary); font-weight:700;">Ver mês a mês</summary>
        <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.68rem; margin-top:4px;">
          <thead><tr><th style="text-align:left; padding:3px;">Mês</th><th style="text-align:right; padding:3px;">Clientes</th><th style="text-align:right; padding:3px;">Receita</th><th style="text-align:right; padding:3px;">Lucro</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td style="padding:3px; border-top:1px solid var(--border);">${r.m}</td><td style="text-align:right; padding:3px; border-top:1px solid var(--border);">${Math.round(r.total)}</td><td style="text-align:right; padding:3px; border-top:1px solid var(--border);">${money(r.revenue)}</td><td style="text-align:right; padding:3px; border-top:1px solid var(--border); color:${r.profit >= 0 ? good : bad}; font-weight:700;">${money(r.profit)}</td></tr>`).join('')}</tbody>
        </table></div></details>`;

    // Meta: clientes necessários com a margem de um cliente novo
    const margin = inp.price - inp.cost;
    if (margin <= 0) {
      $('gsGoalResult').innerHTML = `<span style="color:${bad};">Com mensalidade de ${money(inp.price)} e custo de ${money(inp.cost)} cada cliente não dá lucro. Ajuste os valores.</span>`;
    } else {
      const need = Math.ceil((inp.goal + inp.fixed) / margin);
      const more = Math.max(0, need - baseCount);
      $('gsGoalResult').innerHTML = `Cada cliente deixa <strong>${money(margin)}</strong> por mês. Para lucrar <strong>${money(inp.goal)}</strong>${inp.fixed ? ` (mais ${money(inp.fixed)} de outros custos)` : ''} você precisa de cerca de <strong>${need} clientes ativos</strong>${more > 0 ? `, ou seja, <strong>${more} a mais</strong> do que tem hoje.` : '. Você já passou dessa meta! 🎉'}`;
    }
  };
  overlay.querySelectorAll('input, select').forEach(el => el.addEventListener('input', calc));
  calc();
};

// ============================================================
// CALENDÁRIO DE RECEBIMENTOS (quanto entra em cada dia)
// ============================================================
let calMonth = '';       // 'AAAA-MM' ('' = mês atual)
let calDay = '';         // 'AAAA-MM-DD' selecionado
let calProject = true;   // projeta renovações mensais nos meses seguintes

function calMonthKey() { return calMonth || safeGetTodayLocal().slice(0, 7); }

window.calShiftMonth = function(delta) {
  const [y, m] = calMonthKey().split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (calMonth === safeGetTodayLocal().slice(0, 7)) calMonth = '';
  calDay = '';
  renderReceiptCalendar();
};
window.calSelectDay = function(day) { calDay = (calDay === day) ? '' : day; renderReceiptCalendar(); };
window.calToggleProject = function(on) { calProject = !!on; renderReceiptCalendar(); };
window.calCharge = function(clientId) {
  const c = clients.find(x => x.id === clientId); if (!c) return;
  // Mesmo caminho do "Cobrar agora": marca "cobrado hoje" e usa a IA na conta Master
  chargeClientNow(c);
};

function calCollect(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = safeGetTodayLocal();
  const isCurrent = monthKey === today.slice(0, 7);
  const days = {};
  const slot = k => days[k] || (days[k] = { expected: [], received: [], paidDue: [] });
  // vencimento que originou a renovação (registros novos guardam; antigos são deduzidos)
  const dueOfEntry = h => {
    if (h.prevDueDate) return h.prevDueDate;
    if (!h.newDueDate) return '';
    const [yy, mm, dd] = h.newDueDate.split('-').map(Number);
    const n = Number(h.months) || 1;
    const t = new Date(yy, mm - 1 - n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
  };
  const overdue = [];

  financeClients().forEach(c => {
    if (currentGlobalServer !== 'ALL' && c.assignedServer !== currentGlobalServer) return;
    const price = parseFloat(c.price) || 0;

    (Array.isArray(c.paymentHistory) ? c.paymentHistory : []).forEach(h => {
      if ((h.date || '').startsWith(monthKey)) slot(h.date).received.push({ client: c, amount: paidAmt(h) });
      const dk = dueOfEntry(h);
      if (dk && dk.startsWith(monthKey)) slot(dk).paidDue.push({ client: c, amount: paidAmt(h) });
    });

    if (c.isArchived || !c.dueDate) return;
    const dueKey = c.dueDate.slice(0, 7);
    if (dueKey === monthKey) {
      slot(c.dueDate).expected.push({ client: c, amount: price, projected: false });
    } else if (dueKey < monthKey) {
      if (c.dueDate < today) {
        if (isCurrent) overdue.push({ client: c, amount: price });
      } else if (calProject) {
        const anchor = Number(c.dueDate.slice(8, 10)) || 1;
        const day = Math.min(anchor, daysInMonth);
        slot(`${monthKey}-${String(day).padStart(2, '0')}`).expected.push({ client: c, amount: price, projected: true });
      }
    }
  });
  return { days, overdue, daysInMonth, y, m, today };
}

window.renderReceiptCalendar = function() {
  const box = document.getElementById('receiptCalendar');
  if (!box) return;
  const priv = typeof isPrivacyMode !== 'undefined' ? isPrivacyMode : false;
  const money = v => safeFormatCurrency(v, priv);
  const monthKey = calMonthKey();
  const { days, overdue, daysInMonth, y, m, today } = calCollect(monthKey);
  const sum = (arr) => arr.reduce((a, x) => a + x.amount, 0);
  const all = Object.values(days);
  const received = all.reduce((a, d) => a + sum(d.received), 0);
  const expected = all.reduce((a, d) => a + sum(d.expected), 0);
  const overdueTotal = sum(overdue);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // valor compacto para caber na célula (nunca arredonda centavos abaixo de 1.000)
  const compact = v => {
    if (priv) return '••';
    if (v >= 1000) return (Math.round(v / 10) / 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  };

  const firstWeekday = new Date(y, m - 1, 1).getDay();
  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthKey}-${String(d).padStart(2, '0')}`;
    const info = days[key];
    const pend = info ? info.expected.filter(x => !x.projected) : [];
    const paid = info ? info.paidDue : [];
    const dayTotal = info ? sum(info.expected) + sum(paid) : 0;
    const isToday = key === today;
    const isFuture = key > today;
    const projectedOnly = info && info.expected.length && info.expected.every(x => x.projected) && !paid.length;
    // bolinha: só quando o dia já chegou
    let dot = '', dotTitle = '';
    if (!isFuture && (paid.length || pend.length)) {
      if (!pend.length) { dot = '#16a34a'; dotTitle = 'Todos recebidos'; }
      else if (paid.length) { dot = '#eab308'; dotTitle = 'Falta receber de alguém'; }
      else { dot = '#dc2626'; dotTitle = 'Nenhum recebido'; }
    }
    cells += `<button type="button" onclick="calSelectDay('${key}')" aria-label="Dia ${d}${dotTitle ? ', ' + dotTitle : ''}" style="min-height:54px; padding:3px 2px; border-radius:7px; cursor:pointer; text-align:center; line-height:1.2; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:2px;
      border:${key === calDay ? '2px solid #7c3aed' : (isToday ? '2px solid #f59e0b' : '1px solid var(--border)')};
      background:${key === calDay ? 'rgba(124,58,237,0.10)' : 'var(--surface-alt)'}; color:var(--text-main);">
      <div style="font-size:0.66rem; font-weight:700; opacity:.8;">${d}</div>
      ${dayTotal ? `<div style="font-size:0.58rem; font-weight:800; ${projectedOnly ? 'opacity:.6; font-style:italic;' : ''}">${compact(dayTotal)}</div>` : ''}
      ${dot ? `<span title="${dotTitle}" style="width:9px; height:9px; border-radius:50%; background:${dot}; display:block;"></span>` : ''}
    </button>`;
  }

  // detalhe do dia selecionado
  let detail = '';
  if (calDay && calDay.startsWith(monthKey)) {
    const info = days[calDay] || { expected: [], received: [], paidDue: [] };
    const dayLabel = calDay.split('-').reverse().join('/');
    const rowCss = 'display:flex; justify-content:space-between; align-items:center; gap:6px; padding:6px 0; border-top:1px solid var(--border); font-size:0.76rem;';
    const title = (txt, color, total) => `<div style="font-size:0.7rem; font-weight:700; color:${color}; margin-top:8px;">${txt}: ${money(total)}</div>`;
    const late = calDay < today;
    detail = `<div style="margin-top:10px; border:1px solid var(--border); border-radius:10px; padding:8px 10px; background:var(--surface-alt);">
      <strong style="font-size:0.82rem;">📆 ${dayLabel}</strong>
      ${info.paidDue.length ? title('🟢 Venceram e já pagaram', '#15803d', sum(info.paidDue)) + info.paidDue.map(x => `<div style="${rowCss}"><span>${safeEsc(x.client.name || x.client.username)}</span><strong style="color:#15803d;">${money(x.amount)}</strong></div>`).join('') : ''}
      ${info.expected.length ? title(late ? '🔴 Venceram e não renovaram' : (calDay === today ? '🟡 Vencem hoje' : '⏳ A receber'), late ? '#dc2626' : '#2563eb', sum(info.expected)) + info.expected.map(x => `<div style="${rowCss}"><span>${safeEsc(x.client.name || x.client.username)}${x.projected ? ' <small style="color:var(--text-muted);">(previsão)</small>' : ''}</span><span style="display:flex; align-items:center; gap:6px;"><strong>${money(x.amount)}</strong>${x.projected ? '' : `<button type="button" onclick="calCharge('${x.client.id}')" style="background:#15803d; color:#fff; border:none; border-radius:5px; padding:4px 8px; font-size:0.68rem; font-weight:700; cursor:pointer;">💬 Cobrar</button>`}</span></div>`).join('') : ''}
      ${info.received.length ? title('💰 Pagamentos recebidos neste dia', '#15803d', sum(info.received)) + info.received.map(x => `<div style="${rowCss}"><span>${safeEsc(x.client.name || x.client.username)}</span><strong style="color:#15803d;">${money(x.amount)}</strong></div>`).join('') : ''}
      ${(!info.received.length && !info.expected.length && !info.paidDue.length) ? '<div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">Nada previsto nem recebido neste dia.</div>' : ''}
    </div>`;
  }

  const wd = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  box.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
      <button type="button" class="btn-page" onclick="calShiftMonth(-1)" aria-label="Mês anterior">‹</button>
      <strong style="font-size:0.9rem; text-transform:capitalize;">${monthName}</strong>
      <button type="button" class="btn-page" onclick="calShiftMonth(1)" aria-label="Próximo mês">›</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:8px; text-align:center;">
      <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:6px;"><div style="font-size:0.6rem; color:var(--text-muted);">Já recebido</div><div style="font-size:0.84rem; font-weight:800; color:#15803d;">${money(received)}</div></div>
      <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:6px;"><div style="font-size:0.6rem; color:var(--text-muted);">Ainda a receber</div><div style="font-size:0.84rem; font-weight:800; color:#2563eb;">${money(expected)}</div></div>
      <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:6px;"><div style="font-size:0.6rem; color:var(--text-muted);">Total do mês</div><div style="font-size:0.84rem; font-weight:800;">${money(received + expected)}</div></div>
    </div>
    ${overdue.length ? `<div style="font-size:0.72rem; color:#b91c1c; margin-bottom:8px;">⚠️ ${overdue.length} cliente(s) com vencimento de meses anteriores seguem em atraso: ${money(overdueTotal)}</div>` : ''}
    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-bottom:3px; text-align:center; font-size:0.6rem; font-weight:700; color:var(--text-muted);">${wd.map(x => `<span>${x}</span>`).join('')}</div>
    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px;">${cells}</div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:0.64rem; color:var(--text-muted); margin-top:6px; align-items:center;">
      <span><i style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#16a34a; vertical-align:middle;"></i> recebeu todos</span>
      <span><i style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#eab308; vertical-align:middle;"></i> falta alguém</span>
      <span><i style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#dc2626; vertical-align:middle;"></i> não recebeu</span>
      <span style="border:2px solid #f59e0b; border-radius:4px; padding:0 4px;">hoje</span>
    </div>
    <div style="font-size:0.62rem; color:var(--text-muted); margin-top:3px;">O valor em cada dia é o que vence naquele dia.</div>
    <label style="display:flex; align-items:center; gap:6px; font-size:0.72rem; margin-top:8px;"><input type="checkbox" ${calProject ? 'checked' : ''} onchange="calToggleProject(this.checked)"> Projetar renovações mensais nos meses seguintes <small style="color:var(--text-muted);">(valores em itálico)</small></label>
    ${detail}`;
};

// ============================================================
// BUSCA RÁPIDA (botão ⚡): achar o cliente e agir sem rolar a carteira
// ============================================================
window.openQuickSearch = function() {
  if (typeof closeFabMenu === 'function') closeFabMenu();
  const old = document.getElementById('quickSearchOverlay'); if (old) old.remove();

  const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const overlay = document.createElement('div');
  overlay.id = 'quickSearchOverlay';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'z-index:10050; align-items:flex-start; padding-top:max(24px, env(safe-area-inset-top));';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:420px; max-height:88vh; display:flex; flex-direction:column; text-align:left;">
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <input type="search" id="quickSearchInput" placeholder="Nome, usuário, telefone ou MAC" autocomplete="off" style="flex:1; padding:10px; font-size:0.9rem; border:1px solid var(--border); border-radius:8px;">
        <button type="button" id="quickSearchClose" class="btn-cancel" style="padding:0 12px;" aria-label="Fechar">✕</button>
      </div>
      <div id="quickSearchInfo" style="font-size:0.7rem; color:var(--text-muted); margin-bottom:6px;"></div>
      <div id="quickSearchList" style="overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#quickSearchInput');
  const list = overlay.querySelector('#quickSearchList');
  const info = overlay.querySelector('#quickSearchInfo');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#quickSearchClose').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const mkBtn = (label, bg, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = `flex:1 1 45%; padding:8px 4px; font-size:0.74rem; font-weight:700; border:none; border-radius:6px; color:#fff; background:${bg}; cursor:pointer;`;
    b.addEventListener('click', fn); return b;
  };

  const draw = () => {
    const q = norm(input.value).trim();
    const qDigits = q.replace(/\D/g, '');
    let found, title;
    if (!q) {
      found = (typeof getDailyActionClients === 'function' ? getDailyActionClients() : []).slice(0, 12);
      title = found.length ? 'Para cobrar agora (vence em até 2 dias ou atrasado):' : 'Digite para buscar entre seus clientes.';
    } else {
      found = clients.filter(c => {
        const hay = norm([c.name, c.username, c.macAddress, c.notes].join(' '));
        return hay.includes(q) || (qDigits.length >= 4 && String(c.phone || '').replace(/\D/g, '').includes(qDigits));
      }).slice(0, 15);
      title = found.length ? `${found.length} resultado(s)` : 'Nenhum cliente encontrado.';
    }
    info.textContent = title;
    list.innerHTML = '';
    found.forEach(c => {
      const st = getStatus(c.dueDate);
      const color = st.class === 'expired' ? '#dc2626' : (st.class === 'warning' ? '#ea580c' : '#16a34a');
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--border); border-left:4px solid ' + color + '; border-radius:8px; padding:8px 10px; background:var(--surface-alt);';
      const head = document.createElement('div');
      head.innerHTML = `<strong style="font-size:0.86rem;">${safeEsc(c.name || c.username)}${c.isBlocked ? ' ⚠️' : ''}${c.isArchived ? ' (arquivado)' : ''}</strong>
        <div style="font-size:0.72rem; color:var(--text-muted);">@${safeEsc(c.username || '')} • ${safeEsc(c.assignedServer || 'sem servidor')}</div>
        <div style="font-size:0.74rem; font-weight:700; color:${color}; margin-bottom:6px;">${safeEsc(st.label)} • ${safeFormatCurrency(c.price, false)}</div>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; flex-wrap:wrap; gap:5px;';
      row.appendChild(mkBtn('💬 Cobrar', '#15803d', () => {
        const msg = typeof buildChargeMessage === 'function'
          ? buildChargeMessage(c, formatDateYY(c.dueDate), st, myPixKey, getClientReferralProgress(c))
          : `Olá ${c.name}, sua assinatura vence em ${formatDateYY(c.dueDate)}.`;
        openWhatsAppDirect(c.phone, msg);
      }));
      row.appendChild(mkBtn('🔄 Renovar', '#1e40af', () => { close(); openRenewModal(c.id); }));
      if (c.macAddress || c.macApp) row.appendChild(mkBtn('📲 Ativar', '#4338ca', () => { close(); openActivateModal(c.id); }));
      row.appendChild(mkBtn('🔗 Portal', '#0f766e', () => { close(); openPortalModal(c.id); }));
      card.appendChild(head); card.appendChild(row); list.appendChild(card);
    });
  };
  input.addEventListener('input', draw);
  draw();
  input.focus();
};

// ============================================================
// ATIVAR CLIENTE NO APLICATIVO (MAC + site do app + M3U numa tela só)
// ============================================================
const KNOWN_APP_PORTALS = [
  { re: /quick/i, name: 'Quick Player', url: 'https://quickplayer.app/#/upload-playlist' },
  { re: /ibo/i, name: 'IBO Player', url: 'https://iboplayer.com/device/login' },
  { re: /smart\s*-?one|smartone/i, name: 'SmartOne IPTV', url: 'https://smartone-iptv.com/plugin/smart_one/main_generate' },
  { re: /clou?ddy/i, name: 'Clouddy', url: 'https://console.clouddy.online/user/auth/login' }
];

function appPortalsList() {
  const custom = (window.customAppsCache || []).filter(a => a && a.name && a.url).map(a => ({ name: a.name, url: a.url, custom: true }));
  const known = KNOWN_APP_PORTALS.filter(k => !custom.some(c => c.name.toLowerCase() === k.name.toLowerCase())).map(k => ({ name: k.name, url: k.url, re: k.re }));
  return [...custom, ...known];
}

function findAppPortal(client) {
  const app = String(client.macApp || '').trim().toLowerCase();
  if (!app) return null;
  const list = appPortalsList();
  return list.find(p => p.name.toLowerCase() === app)
    || list.find(p => p.custom && (app.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(app)))
    || list.find(p => p.re && p.re.test(app))
    || null;
}

let activateModalClientId = null;

window.openActivateModal = function(clientId) {
  activateModalClientId = clientId;
  renderActivateModal();
  wakeLockOn();
  const m = document.getElementById('activateModal'); if (m) m.style.display = 'flex';
};
window.closeActivateModal = function() {
  wakeLockOff();
  const m = document.getElementById('activateModal'); if (m) m.style.display = 'none';
  activateModalClientId = null;
};

function renderActivateModal() {
  const client = clients.find(c => c.id === activateModalClientId);
  const body = document.getElementById('activateModalBody');
  if (!client || !body) return;
  document.getElementById('activateModalClientName').textContent = `${client.name || ''}${client.macApp ? ' • ' + client.macApp : ''}`;
  body.innerHTML = '';

  const mk = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; };
  const step = (num, title) => {
    const box = mk('div', 'border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom:8px; background:var(--surface-alt);');
    const h = mk('div', 'font-size:0.78rem; font-weight:800; margin-bottom:6px;', `${num}. ${title}`);
    box.appendChild(h); body.appendChild(box); return box;
  };
  const copyRowEl = (label, value) => {
    const row = mk('div', 'display:flex; gap:6px; align-items:center; margin-bottom:6px;');
    const info = mk('div', 'flex:1; min-width:0;');
    info.appendChild(mk('div', 'font-size:0.66rem; color:var(--text-muted);', label));
    info.appendChild(mk('div', 'font-size:0.76rem; font-family:monospace; word-break:break-all; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;', value));
    const b = mk('button', 'padding:8px 12px; font-size:0.74rem; background:#2563eb; flex-shrink:0;', '📋 Copiar');
    b.type = 'button'; b.className = 'btn-tool';
    b.addEventListener('click', () => copyTextSafe(value, b, '✓ Copiado'));
    row.appendChild(info); row.appendChild(b); return row;
  };

  // 1. MAC
  const s1 = step(1, 'Copie o MAC do aparelho');
  if (client.macAddress) s1.appendChild(copyRowEl(client.macApp ? `MAC (${client.macApp})` : 'MAC', client.macAddress));
  else s1.appendChild(mk('div', 'font-size:0.74rem; color:var(--danger);', '⚠️ Este cliente não tem MAC cadastrado. Edite o cliente para incluir (ou use usuário e senha, no passo 3).'));

  // 2. Site do app
  const s2 = step(2, 'Abra o site do aplicativo');
  const portal = findAppPortal(client);
  const openBtn = (p, label) => {
    const b = mk('button', 'width:100%; padding:10px; font-size:0.78rem; background:#0f766e; margin-bottom:6px;', label);
    b.type = 'button'; b.className = 'btn-tool';
    b.addEventListener('click', () => openExternalUrl(p.url));
    return b;
  };
  if (portal) {
    s2.appendChild(openBtn(portal, `🌐 Abrir ${portal.name}`));
    s2.appendChild(mk('div', 'font-size:0.68rem; color:var(--text-muted);', 'Cole o MAC lá, volte para esta tela e siga para o passo 3.'));
  } else {
    s2.appendChild(mk('div', 'font-size:0.74rem; color:var(--text-muted); margin-bottom:6px;', client.macApp ? `Não achei o site de “${client.macApp}”. Escolha abaixo ou cadastre em Ajustes → Sites dos aplicativos.` : 'Este cliente não tem aplicativo cadastrado. Escolha o site abaixo:'));
    appPortalsList().forEach(p => s2.appendChild(openBtn(p, `🌐 ${p.name}`)));
  }

  // 3. M3U / login
  const s3 = step(3, 'Copie a lista M3U');
  const srv = findServerForClient(client, (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : []);
  const links = buildM3uLinks(client, srv);
  if (srv && srv.active === false) s3.appendChild(mk('div', 'font-size:0.72rem; color:#92400e; margin-bottom:6px;', `⚠️ O servidor “${srv.name}” está inativo.`));
  if (links.length) {
    links.forEach((l, i) => s3.appendChild(copyRowEl(`${l.kind === 'IP' ? 'DNS numérico' : 'DNS por URL'} • ${l.base.replace(/^https?:\/\//i, '')}`, l.url)));
    if (links.length > 1) s3.appendChild(mk('div', 'font-size:0.68rem; color:var(--text-muted);', 'Use um só. Se não carregar canais, tente o outro.'));
  } else {
    s3.appendChild(mk('div', 'font-size:0.74rem; color:var(--danger);', '⚠️ Não foi possível montar o link: confira usuário e DNS do servidor deste cliente.'));
  }

  // Apps com login em vez de playlist
  if (client.username) {
    const alt = mk('details', 'margin-top:6px;');
    alt.appendChild(mk('summary', 'font-size:0.72rem; cursor:pointer; color:var(--text-muted);', 'App com usuário e senha (sem M3U)'));
    alt.appendChild(copyRowEl('Usuário', client.username));
    if (client.serverPassword) alt.appendChild(copyRowEl('Senha', client.serverPassword));
    s3.appendChild(alt);
  }
}

window.openPortalModal = function(clientId) {
  portalModalClientId = clientId;
  const m = document.getElementById('portalModal');
  if (!m) return;
  m.style.display = 'flex';
  renderPortalModal();
};
window.closePortalModal = function() {
  const m = document.getElementById('portalModal'); if (m) m.style.display = 'none';
  portalModalClientId = null;
};

// ------------------------------------------------------------
// ACESSOS AO PORTAL (gravados pelo Worker: portalLastAccess / portalAccessCount)
// ------------------------------------------------------------
function portalAgo(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 2) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
function portalAccessLine(client) {
  if (!client.portalToken || client.portalEnabled === false) return '';
  if (!client.portalLastAccess) return '<span style="color:var(--text-muted);">👁 Portal: ainda não acessou</span>';
  const n = Number(client.portalAccessCount) || 1;
  return `<span style="color:#15803d; font-weight:600;">👁 Portal: acessou ${portalAgo(client.portalLastAccess)}</span> <span style="color:var(--text-muted);">• ${n} visita${n > 1 ? 's' : ''}</span>`;
}
window.updatePortalStats = function() {
  const el = document.getElementById('portalStats');
  if (!el || typeof clients === 'undefined') return;
  const withLink = clients.filter(c => !c.isArchived && c.portalToken && c.portalEnabled !== false);
  const seen = withLink.filter(c => c.portalLastAccess);
  const week = seen.filter(c => Date.now() - Date.parse(c.portalLastAccess) < 7 * 86400000).length;
  el.innerHTML = withLink.length
    ? `Portal: <strong>${seen.length} de ${withLink.length}</strong> já abriram o link • <strong>${week}</strong> abriram nos últimos 7 dias`
    : 'Nenhum cliente com link do portal ainda.';
};

function renderPortalModal() {
  const client = clients.find(c => c.id === portalModalClientId);
  const body = document.getElementById('portalModalBody');
  if (!client || !body) return;
  document.getElementById('portalModalClientName').textContent = client.name || '';
  const link = portalLinkFor(client);
  const btn = (label, fn, style) => `<button type="button" class="btn-tool" style="padding:9px; ${style || ''}" onclick="${fn}">${label}</button>`;

  if (!link) {
    body.innerHTML = `
      <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:12px;">Este cliente ainda não tem link do portal.</p>
      ${btn('🔗 Gerar link do portal', 'portalGenerate(false)', 'width:100%; background:#2563eb;')}`;
    return;
  }
  const on = client.portalEnabled !== false;
  body.innerHTML = `
    <div style="text-align:left; margin-bottom:6px; font-size:0.74rem;">${portalAccessLine(client)}${client.portalLastAccess ? `<div style="color:var(--text-muted); font-size:0.68rem;">Último acesso: ${new Date(client.portalLastAccess).toLocaleString('pt-BR')}</div>` : ''}</div>
    <div style="text-align:left; margin-bottom:6px; font-size:0.72rem; color:var(--text-muted);">Link individual ${on ? '' : '<strong style="color:#92400e;">(desativado)</strong>'}</div>
    <input type="text" readonly value="${safeEsc(link)}" onclick="this.select()" style="width:100%; padding:8px; font-size:0.72rem; border:1px solid var(--border); border-radius:6px; margin-bottom:8px;">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
      ${btn('📋 Copiar', 'portalCopy(this)', 'background:#2563eb;')}
      ${btn('💬 Enviar WhatsApp', 'portalSendWhatsApp()', 'background:#15803d;')}
      ${btn('👁 Abrir', 'portalOpen()', 'background:#0f766e;')}
      ${btn('📤 Outros apps', 'portalShare()', 'background:#475569;')}
      ${btn(on ? '⏸ Desativar' : '▶ Ativar', `portalSetActive(${on ? 'false' : 'true'})`, 'background:#b45309;')}
      ${btn('🔄 Novo link', 'portalGenerate(true)', 'background:#7c3aed;')}
      ${btn('🗑 Revogar', 'portalRevoke()', 'background:#b91c1c;')}
    </div>
    <p style="font-size:0.7rem; color:var(--text-muted); text-align:left;">Novo link e Revogar invalidam o link atual na hora. Desativar mantém o link, mas ele deixa de funcionar até você ativar de novo.</p>`;
}

window.portalCopy = function(btnEl) {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  const link = portalLinkFor(client);
  const done = () => { const t = btnEl.textContent; btnEl.textContent = '✓ Copiado'; setTimeout(() => { btnEl.textContent = t; }, 1300); };
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(done).catch(() => window.prompt('Copie o link:', link));
  else window.prompt('Copie o link:', link);
};
window.portalOpen = function() {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  const url = portalLinkFor(client) + '&a=1';
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
};
window.portalShare = async function() {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  const text = buildPortalMessage(client);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  openWhatsAppDirect(client.phone, text);
};
window.portalSendWhatsApp = function() {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  openWhatsAppDirect(client.phone, buildPortalMessage(client));
};

// Garante o link do portal do cliente (cria na hora se ainda não existe).
// Respeita quem foi desativado/revogado de propósito (portalEnabled === false).
window.ensurePortalLink = async function(client) {
  const live = clients.find(c => c.id === client.id) || client;
  if (live.portalEnabled === false) return '';
  if (live.portalToken) return portalLinkFor(live);
  try {
    const fs = portalFs();
    const token = portalNewToken();
    const hash = await portalSha256Hex(token);
    const batch = fs.batch();
    batch.set(fs.collection('portal_tokens').doc(hash), { ownerId: live.ownerId || activeOwnerId, clientId: live.id, active: true, createdAt: new Date().toISOString() });
    batch.update(fs.collection('clients').doc(live.id), { portalToken: token, portalTokenHash: hash, portalEnabled: true });
    await batch.commit();
    [live, client].forEach(o => Object.assign(o, { portalToken: token, portalTokenHash: hash, portalEnabled: true }));
    return portalLinkFor(live);
  } catch (e) {
    console.warn('Não foi possível criar o link do portal:', e);
    return '';
  }
};

window.portalLinkBlock = function(link) {
  return link
    ? `🔗 *ACESSE SEU PORTAL:*\n${link}\n\n📱 No portal você encontra seus dados de acesso, DNS, link M3U, renovação e suporte.\n💡 Salve seu link para consultar quando precisar!\n\n`
    : '';
};

window.portalGenerate = async function(rotate) {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  if (rotate && !confirm('Gerar um novo link? O link atual deixará de funcionar imediatamente.')) return;
  try {
    const fs = portalFs();
    const token = portalNewToken();
    const hash = await portalSha256Hex(token);
    const batch = fs.batch();
    if (client.portalTokenHash) batch.delete(fs.collection('portal_tokens').doc(client.portalTokenHash));
    batch.set(fs.collection('portal_tokens').doc(hash), { ownerId: client.ownerId || activeOwnerId, clientId: client.id, active: true, createdAt: new Date().toISOString() });
    batch.update(fs.collection('clients').doc(client.id), { portalToken: token, portalTokenHash: hash, portalEnabled: true });
    await batch.commit();
    Object.assign(client, { portalToken: token, portalTokenHash: hash, portalEnabled: true });
    renderPortalModal();
  } catch (e) { alert('Erro ao gerar link: ' + e.message + '\n\nConfira se as regras do Firestore para portal_tokens foram publicadas.'); }
};

window.portalSetActive = async function(active) {
  const client = clients.find(c => c.id === portalModalClientId); if (!client || !client.portalTokenHash) return;
  try {
    const fs = portalFs();
    const batch = fs.batch();
    batch.update(fs.collection('portal_tokens').doc(client.portalTokenHash), { active });
    batch.update(fs.collection('clients').doc(client.id), { portalEnabled: active });
    await batch.commit();
    client.portalEnabled = active;
    renderPortalModal();
  } catch (e) { alert('Erro: ' + e.message); }
};

window.portalRevoke = async function() {
  const client = clients.find(c => c.id === portalModalClientId); if (!client) return;
  if (!confirm('Revogar o link? Ele deixará de funcionar e não poderá ser recuperado (você pode gerar outro).')) return;
  try {
    const fs = portalFs();
    const batch = fs.batch();
    if (client.portalTokenHash) batch.delete(fs.collection('portal_tokens').doc(client.portalTokenHash));
    const del = firebase.firestore.FieldValue.delete();
    batch.update(fs.collection('clients').doc(client.id), { portalToken: del, portalTokenHash: del, portalEnabled: false });
    await batch.commit();
    delete client.portalToken; delete client.portalTokenHash; client.portalEnabled = false;
    renderPortalModal();
  } catch (e) { alert('Erro: ' + e.message); }
};

window.toggleClientBlock = async function(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return;
  const blocking = !client.isBlocked;
  if (!confirm(blocking
    ? `🔒 Bloquear o acesso de ${client.name}?\n\nO portal do assinante ficará indisponível e o card será sinalizado.`
    : `🔓 Desbloquear o acesso de ${client.name}?`)) return;
  try {
    await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients").doc(client.id).update({
      isBlocked: blocking,
      blockedAt: blocking ? safeGetTodayLocal() : ''
    });
  } catch (err) {
    alert('Erro ao alterar bloqueio: ' + err.message);
  }
};

window.cancelEdit = function() {
  if (clientFormEl) { clientFormEl.reset(); clientFormEl.style.display = 'none'; }
  clientIdInputEl.value = '';
  populateClientServerOptions('');
  window.updateFirstDiscountField();
  formTitleEl.textContent = 'Novo Cliente';
  saveBtnEl.textContent = 'Salvar Cliente';
  if (btnToggleClientFormEl) btnToggleClientFormEl.textContent = '➕ Cadastrar Novo Cliente';
};

window.removeClient = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  if (!confirm(`Excluir o cliente "${client.name}"?\n\nEle sai da carteira, mas os pagamentos dele continuam no financeiro. Dá para desfazer logo depois.`)) return;
  // Motivo do cancelamento (opcional): alimenta a análise da IA sobre por que clientes saem
  const typed = prompt(`Motivo do cancelamento de "${client.name}"? (opcional)\n\nEx.: preço, canais travando, mudou de aplicativo, sem dinheiro.`, '');
  const cancelReason = String(typed || '').trim().slice(0, 60);
  const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
  try {
    await offlineSafe(fs.collection("clients").doc(id).update({ isDeleted: true, isArchived: true, deletedAt: safeGetTodayLocal(), cancelReason: cancelReason || firebase.firestore.FieldValue.delete() }));
    showUndoToast(`"${client.name}" excluído.`, async () => {
      await fs.collection("clients").doc(id).update({ isDeleted: false, isArchived: !!client.isArchived, deletedAt: firebase.firestore.FieldValue.delete(), cancelReason: firebase.firestore.FieldValue.delete() });
    });
  } catch (err) { alert("Erro: " + err.message); }
};

// Aviso temporário com botão Desfazer (7 segundos)
window.showUndoToast = function(text, onUndo) {
  const old = document.getElementById('undoToast'); if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'undoToast';
  t.style.cssText = 'position:fixed; left:12px; right:12px; bottom:calc(84px + env(safe-area-inset-bottom, 0px)); z-index:10060; max-width:420px; margin:0 auto; background:#1e293b; color:#f8fafc; border:1px solid #475569; border-radius:10px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:0.8rem; box-shadow:0 8px 24px rgba(0,0,0,.35);';
  const span = document.createElement('span'); span.textContent = text;
  const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Desfazer';
  btn.style.cssText = 'background:#2563eb; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-weight:700; cursor:pointer;';
  btn.onclick = async () => { btn.disabled = true; try { await onUndo(); t.remove(); } catch (e) { alert('Não foi possível desfazer: ' + e.message); } };
  t.appendChild(span); t.appendChild(btn); document.body.appendChild(t);
  setTimeout(() => { if (t.isConnected) t.remove(); }, 7000);
};


window.toggleArchiveClient = async function(id, shouldArchive) {
  if (!shouldArchive) {
    const max = parseInt((currentResellerData || {}).maxClients || 15, 10);
    const active = clients.filter(c => !c.isArchived && !c.isTrial).length;
    if (active >= max) return alert(`Limite do plano atingido (${max} clientes). Arquive outro cliente ou faça upgrade para reativar este.`);
  }
  try { await (typeof db !== 'undefined' ? db : firebase.firestore()).collection("clients").doc(id).update({ isArchived: shouldArchive }); } catch (err) { alert("Erro: " + err.message); }
};

// ============================================================
// SALVAR / EDITAR CLIENTE (SUBMIT DO FORMULÁRIO)
// ============================================================
if (clientFormEl) {
  clientFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = clientIdInputEl.value;
    const ownerId = activeOwnerId || (currentUser && currentUser.uid);
    if (!ownerId) return alert("Sessão não identificada. Faça login novamente.");

    if (!clientAssignedServerEl.value) {
      return alert("Selecione o servidor do cliente.");
    }

    if (!id) {
      const rData = currentResellerData || {};
      const max = parseInt(rData.maxClients || 15, 10);
      const active = clients.filter(c => !c.isArchived && !c.isTrial).length;
      if (active >= max) {
        return alert(`Limite do plano atingido (${max} clientes). Solicite um upgrade na aba Ajustes.`);
      }
    }

    // --- validações ---
    const phoneRaw = document.getElementById('phone').value.trim();
    const phoneCheck = phoneRaw ? normalizeBrPhone(phoneRaw) : { ok: true, local: '' };
    if (phoneRaw && !phoneCheck.ok) {
      return alert('Telefone inválido. Use DDD + número, por exemplo (11) 91234-5678.');
    }
    const usernameVal = document.getElementById('username').value.trim();
    const serverVal = clientAssignedServerEl.value;
    const dupUser = clients.find(c => c.id !== id && normalizeText(c.username) === normalizeText(usernameVal)
      && normalizeText(c.assignedServer) === normalizeText(serverVal));
    if (usernameVal && dupUser && !confirm(`Já existe o usuário "${usernameVal}" no servidor ${serverVal} (${dupUser.name}). Cadastrar mesmo assim?`)) return;
    if (phoneCheck.ok && phoneCheck.local) {
      const dupPhone = clients.find(c => c.id !== id && c.phone && normalizeBrPhone(c.phone).local === phoneCheck.local);
      if (dupPhone && !confirm(`Este telefone já está no cadastro de ${dupPhone.name}. Cadastrar mesmo assim?`)) return;
    }
    // vencimento de cliente novo: se vier vazio, usa hoje + 1 mês
    const dueInput = document.getElementById('dueDate');
    if (!id && dueInput && !dueInput.value) {
      dueInput.value = addMonthsToDate(safeGetTodayLocal(), 1); // 31/01 vira 28/02, e não 03/03
    }

    // Teste: o vencimento vira o fim do teste; indicação e desconto só valem depois da 1ª renovação
    const trialChk = document.getElementById('isTrial');
    const asTrial = !!(trialChk && trialChk.checked && document.getElementById('trialField').style.display !== 'none');
    const curC = id ? (clients.find(c => c.id === id) || null) : null;
    let trialExtra = {};
    if (asTrial) {
      const hours = parseInt(document.getElementById('trialHours').value, 10) || 1;
      const endsAt = (curC && curC.isTrial && Number(curC.trialHours) === hours && curC.trialEndsAt) ? curC.trialEndsAt : new Date(Date.now() + hours * 3600000).toISOString();
      const e = new Date(endsAt);
      dueInput.value = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
      trialExtra = { isTrial: true, trialHours: hours, trialEndsAt: endsAt };
    } else if (curC && curC.isTrial) {
      trialExtra = { isTrial: false };
    }

    const data = {
      ...trialExtra,
      name: document.getElementById('name').value.trim(),
      username: document.getElementById('username').value.trim(),
      serverPassword: serverPasswordInputEl.value.trim(),
      assignedServer: clientAssignedServerEl.value,
      serverId: ((typeof userServers !== 'undefined' && Array.isArray(userServers) ? userServers : []).find(s => s.name === clientAssignedServerEl.value) || {}).id || '',
      isBlocked: Boolean(document.getElementById('isBlocked') && document.getElementById('isBlocked').checked),
      macAddress: clientMacAddressEl ? (() => { const raw = clientMacAddressEl.value.trim(); const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, ''); return (hex.length === 12 && /^[0-9A-Fa-f:.\-\s]+$/.test(raw)) ? hex.replace(/(.{2})(?=.)/g, '$1:') : raw; })() : '',
      macApp: clientMacAppEl ? clientMacAppEl.value.trim() : '',
      referredBy: referredByInputEl ? referredByInputEl.value.trim() : '',
      referredById: (() => { const t = referredByInputEl ? referredByInputEl.value.trim() : ''; const r = t ? findReferrerClient(t, id) : null; return r ? r.id : ''; })(),
      price: parseFloat(document.getElementById('price').value) || 0,
      phone: phoneCheck.ok && phoneCheck.local ? formatBrPhoneLocal(phoneCheck.local) : phoneRaw,
      dueDate: document.getElementById('dueDate').value,
      notes: document.getElementById('notes').value.trim(),
      hasPending: document.getElementById('hasPending').checked,
      referralOptOut: Boolean(document.getElementById('referralOptOut') && document.getElementById('referralOptOut').checked),
      ownerId
    };

    saveBtnEl.disabled = true;
    try {
      const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
      let newClientId = id;
      const prevRef = id ? ((clients.find(c => c.id === id) || {}).referredBy || '') : '';
      const fdBox = document.getElementById('firstDiscountField');
      const giveFirst = !!(fdBox && fdBox.style.display !== 'none' && document.getElementById('firstDiscountCheck').checked && data.referredBy && referralFirstDiscount > 0 && !asTrial);
      if (id) {
        const upd = { ...data };
        if (giveFirst) { upd.pendingDiscount = firebase.firestore.FieldValue.increment(referralFirstDiscount); upd.firstDiscountGiven = true; }
        await offlineSafe(fs.collection("clients").doc(id).update(upd));
      } else {
        // doc() gera o id na hora, mesmo sem internet (o add() só devolve o id depois que o servidor confirma)
        const newRef = fs.collection("clients").doc();
        newClientId = newRef.id;
        await offlineSafe(newRef.set({
          ...data,
          isArchived: false,
          supportCount: 0,
          supportHistory: [],
          paymentHistory: [],
          createdAt: safeGetTodayLocal(),
          ...(giveFirst ? { pendingDiscount: referralFirstDiscount, firstDiscountGiven: true } : {})
        }));
      }
      cancelEdit();
      // Indicação nova: oferece avisar quem indicou
      if (!asTrial && data.referredBy && normalizeText(data.referredBy) !== normalizeText(prevRef)) {
        try { offerReferrerNotice(data.name, data.referredBy, newClientId); } catch (e) { console.warn(e); }
      }
    } catch (err) {
      alert("Erro ao salvar cliente: " + err.message);
    } finally {
      saveBtnEl.disabled = false;
    }
  });
}

// ============================================================
// AVISAR QUEM INDICOU: "seu amigo assinou, falta pouco para o mês grátis"
// ============================================================
window.findReferrerClient = function(refText, excludeId) {
  const r = normalizeText(refText || '');
  if (!r) return null;
  const list = clients.filter(c => !c.isArchived && !c.isTrial && c.id !== excludeId);
  const byUser = list.filter(c => normalizeText(c.username) === r);
  if (byUser.length === 1) return byUser[0];
  const byName = list.filter(c => normalizeText(c.name) === r);
  return byName.length === 1 ? byName[0] : null; // nomes repetidos não são adivinhados
};

window.buildReferrerNotice = function(referrer, friendName, newClientId) {
  const prog = getClientReferralProgress(referrer);
  const counted = prog.friends.some(f => f.id === newClientId);
  const count = prog.count + (counted ? 0 : 1);
  const goal = prog.goal || 0;
  const first = String(referrer.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  const friend = String(friendName || '').trim().split(/\s+/)[0] || 'Seu amigo(a)';
  let msg = `Olá, ${first}! 🎉\n\nBoa notícia: *${friend}* acabou de assinar pela sua indicação. Obrigado por indicar!\n\n`;
  if (goal > 0 && count >= goal) {
    msg += `🏆 Você completou *${goal} indicações* e ganhou *1 MÊS GRÁTIS*! Me avise na próxima renovação para eu aplicar.`;
  } else if (goal > 0) {
    const left = goal - count;
    msg += `⭐ Você já tem *${count} de ${goal}* indicações. ${left === 1 ? 'Falta só *1 amigo*' : `Faltam só *${left} amigos*`} para ganhar *1 MÊS GRÁTIS*!`;
  }
  return { msg, count, goal };
};

window.offerReferrerNotice = function(friendName, refText, newClientId) {
  const referrer = findReferrerClient(refText, newClientId);
  if (!referrer) return;
  const { msg, count, goal } = buildReferrerNotice(referrer, friendName, newClientId);
  const hasPhone = !!(referrer.phone && normalizeBrPhone(referrer.phone).ok);
  const ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.style.cssText = 'display:flex; z-index:10040;';
  const esc2 = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  ov.innerHTML = `<div class="modal-card" style="max-width:400px; text-align:left;">
    <div style="text-align:center; font-size:2.2rem;">🎉</div>
    <h3 style="margin:4px 0 6px; font-size:1.05rem; text-align:center;">Avisar ${esc2(referrer.name)}?</h3>
    <p style="font-size:0.8rem; color:var(--text-muted); margin:0 0 8px; text-align:center;">${esc2(friendName)} foi indicado(a) por ${esc2(referrer.name)}${goal ? ` — agora são ${count} de ${goal} indicações` : ''}.</p>
    <textarea id="refNoticeText" rows="7" style="width:100%; font-size:0.8rem; padding:8px; border:1px solid var(--border); border-radius:8px; margin-bottom:8px;">${esc2(msg)}</textarea>
    ${hasPhone ? '' : '<p style="font-size:0.74rem; color:#f59e0b; margin:0 0 8px;">⚠️ Este cliente não tem WhatsApp cadastrado. Copie a mensagem e envie por outro meio.</p>'}
    <div style="display:flex; gap:6px;">
      <button type="button" id="refNoticeClose" class="btn-cancel" style="flex:1; padding:9px;">Agora não</button>
      <button type="button" id="refNoticeCopy" class="btn-cancel" style="flex:1; padding:9px;">Copiar</button>
      ${hasPhone ? '<button type="button" id="refNoticeSend" class="btn-auth" style="flex:1.4; padding:9px; background:#16a34a;">💬 Enviar</button>' : ''}
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#refNoticeClose').onclick = close;
  ov.querySelector('#refNoticeCopy').onclick = (e) => copyTextSafe(ov.querySelector('#refNoticeText').value, e.currentTarget);
  const send = ov.querySelector('#refNoticeSend');
  if (send) send.onclick = () => { openWhatsAppDirect(referrer.phone, ov.querySelector('#refNoticeText').value); close(); };
};

// ============================================================
// RENOVAÇÃO EM 2 ETAPAS
// ============================================================
let currentRenewPanelUrl = '';

window.reopenRenewPanel = function() {
  if (currentRenewPanelUrl) openExternalUrl(currentRenewPanelUrl);
};

window.openRenewModal = function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  if (client.isTrial && window._trialConfirmed !== id) return convertTrial(id); // renovar um teste = efetivar
  window._trialConfirmed = null;

  currentRenewClientObj = client;
  currentRenewMonthsToAdd = 1;

  const modalName = document.getElementById('renewModalClientName');
  if (modalName) modalName.textContent = `${client.name} (${client.username})`;

  document.getElementById('renewStepSelectPeriod').style.display = 'block';
  document.getElementById('renewStepConfirmExecution').style.display = 'none';

  const modal = document.getElementById('renewModal');
  if (modal) modal.style.display = 'flex';
};

window.closeRenewModal = function() {
  currentRenewClientObj = null;
  currentRenewMonthsToAdd = 1;
  const modal = document.getElementById('renewModal');
  if (modal) modal.style.display = 'none';
};

window.startRenewalWithExternalPanel = function(months) {
  const client = currentRenewClientObj;
  if (!client) return;

  if (client.hasPending) {
    return alert("Cliente com pendência financeira. Resolva a pendência antes de renovar.");
  }

  currentRenewMonthsToAdd = months;

  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
  const srv = findServerForClient(client, servers);

  // Copia o login para colar no painel do servidor
  copyTextSafe(client.username, null);

  // Abre o painel já neste clique (navegadores só permitem abrir aba por gesto do usuário)
  const panelUrl = srv && srv.panelUrl ? normalizePanelUrl(srv.panelUrl) : '';
  currentRenewPanelUrl = panelUrl;
  const opened = panelUrl ? openExternalUrl(panelUrl) : false;

  const statusEl = document.getElementById('renewPanelStatus');
  const reopenBtn = document.getElementById('renewReopenPanelBtn');
  if (statusEl) {
    if (!panelUrl) {
      statusEl.innerHTML = `⚠️ O servidor <strong>${esc(client.assignedServer || 'do cliente')}</strong> não tem a <strong>URL do painel</strong> cadastrada. Abra o painel por conta própria ou cadastre em 🌐 Servidores → Editar → URL do painel.`;
      statusEl.style.color = 'var(--danger)';
    } else {
      statusEl.innerHTML = opened
        ? `🌐 Abrindo o painel: <strong>${esc(panelUrl)}</strong><br>Se nada abriu, toque em “Abrir painel”.`
        : `Toque em “Abrir painel” para acessar: <strong>${esc(panelUrl)}</strong>`;
      statusEl.style.color = 'var(--text-main)';
    }
  }
  if (reopenBtn) reopenBtn.style.display = panelUrl ? 'block' : 'none';

  const targetName = document.getElementById('renewTargetServerName');
  const summary = document.getElementById('renewSelectedPeriodSummary');
  if (targetName) targetName.textContent = client.assignedServer || 'Não definido';
  if (summary) {
    const b = computeReferralBenefit(client, months);
    let txt = `Período: +${months} mês(es) • Login copiado: ${client.username}`;
    if (b.discount > 0) {
      txt += ` • 🏷️ Desconto de indicações: ${safeFormatCurrency(b.gross, false)} − ${safeFormatCurrency(b.discount, false)} = ${safeFormatCurrency(b.total, false)}`;
    }
    summary.textContent = txt;
    const amtInp = document.getElementById('renewAmountInput');
    if (amtInp) amtInp.value = String(Number(b.total.toFixed(2)));
    const paidChk = document.getElementById('renewPaidCheck');
    if (paidChk) paidChk.checked = true;
  }

  document.getElementById('renewStepSelectPeriod').style.display = 'none';
  document.getElementById('renewStepConfirmExecution').style.display = 'block';
};

window.finalizeRenewalAndNotify = async function() {
  if (window._renewBusy) return; // evita renovar duas vezes com toque duplo
  const client = currentRenewClientObj;
  if (!client) return;

  window._renewBusy = true;
  const confirmBtn = document.querySelector('#renewStepConfirmExecution .btn-auth');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const months = currentRenewMonthsToAdd || 1;
    const seenDue = client.dueDate || '';
    const st = getStatus(client.dueDate);
    const wasTrial = client.isTrial === true;
    const expired = st.diffDays < 0 || !client.dueDate || wasTrial;
    const baseDate = expired ? safeGetTodayLocal() : client.dueDate;
    const [year, month, day] = baseDate.split('-').map(Number);

    // Dia de cobrança fixo: 31/jan -> 28/fev -> 31/mar (não "escorrega" para o dia 28 para sempre)
    const billingDay = expired ? day : (parseInt(client.billingDay, 10) || day);
    const totalMonths = (month - 1) + months;
    const newYear = year + Math.floor(totalMonths / 12);
    const newMonth = (totalMonths % 12) + 1;
    const adjustedDay = Math.min(billingDay, new Date(newYear, newMonth, 0).getDate());
    const nextDueDate = `${newYear}-${String(newMonth).padStart(2, '0')}-${String(adjustedDay).padStart(2, '0')}`;

    const benefit = computeReferralBenefit(client, months);
    const typedRaw = (document.getElementById('renewAmountInput') || {}).value;
    const typed = parseFloat(String(typedRaw == null ? '' : typedRaw).replace(',', '.'));
    const amount = (isFinite(typed) && typed >= 0) ? typed : benefit.total;
    const paidChk = document.getElementById('renewPaidCheck');
    const paid = paidChk ? paidChk.checked : true;

    const historyEntry = {
      date: safeGetTodayLocal(),
      amount,
      months,
      prevDueDate: seenDue,
      newDueDate: nextDueDate,
      discountApplied: benefit.discount,
      cost: months * creditCostFor(client),          // custo do crédito no momento da renovação
      serverName: client.assignedServer || '',        // servidor no momento da renovação
      serverId: client.serverId || '',
      paid,
      note: benefit.discount > 0 ? "Renovação com desconto de indicações" : "Renovação"
    };

    const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
    const ref = fs.collection("clients").doc(client.id);
    try {
      await fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Cliente não encontrado.');
        const cur = snap.data() || {};
        if ((cur.dueDate || '') !== seenDue) throw new Error('JA_RENOVADO');
        const payload = {
          dueDate: nextDueDate,
          isArchived: false,
          billingDay,
          paymentHistory: [...(Array.isArray(cur.paymentHistory) ? cur.paymentHistory : []), historyEntry],
          lastRenewal: {
            entry: historyEntry,
            prevDueDate: seenDue,
            prevArchived: !!cur.isArchived,
            prevBillingDay: cur.billingDay || null,
            prevTrial: cur.isTrial === true,
            discount: benefit.discount,
            owed: paid ? 0 : amount
          }
        };
        // Crédito de desconto usado nesta renovação sai do saldo do cliente
        if (cur.isTrial === true) { payload.isTrial = false; payload.trialConvertedAt = safeGetTodayLocal(); }
        if (benefit.discount > 0) payload.pendingDiscount = Math.max(0, (parseFloat(cur.pendingDiscount) || 0) - benefit.discount);
        if (!paid) payload.owedAmount = (parseFloat(cur.owedAmount) || 0) + amount;
        tx.update(ref, payload);
      });
    } catch (e) {
      if (e && e.message === 'JA_RENOVADO') {
        closeRenewModal();
        return alert('Este cliente já foi renovado (o vencimento mudou). Confira a data no card antes de renovar de novo.');
      }
      throw e;
    }

    // Estoque de créditos do servidor: desconta 1 por mês renovado
    let stockNote = '';
    try {
      const srvList0 = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
      const srvRec = findServerForClient(client, srvList0);
      if (srvRec && typeof serverHasStock === 'function' && serverHasStock(srvRec)) {
        const left = await adjustServerStock(srvRec, -months, 'renovação ' + (client.name || ''));
        if (left !== null) stockNote = left <= 0 ? `\n⚠️ Estoque de ${srvRec.name} acabou: compre créditos.` : ` Estoque ${srvRec.name}: ${left}.`;
      }
    } catch (e) { console.warn(e); }

    let benefitLine = '';
    if (benefit.discount > 0) {
      benefitLine = `🏷️ *Desconto por indicações:* -${safeFormatCurrency(benefit.discount, false)}\n`;
    }

    const portalLink = await ensurePortalLink(client);

    const msg =
      `✅ *RENOVAÇÃO CONFIRMADA!*\n\n` +
      `Olá, *${client.name}*! Seu acesso (*${client.username}*) foi renovado por ${months} mês(es).\n\n` +
      `📅 *Novo vencimento:* ${formatDateYY(nextDueDate)}\n` +
      benefitLine +
      `💵 *Valor:* ${safeFormatCurrency(amount, false)}${paid ? '' : ' (a combinar)'}\n\n` +
      portalLinkBlock(portalLink) +
      `Obrigado pela confiança! 🙏`;

    const phone = client.phone;
    closeRenewModal();
    openWhatsAppDirect(phone, msg);
    if (wasTrial && client.referredBy) setTimeout(() => { try { offerReferrerNotice(client.name, client.referredBy, client.id); } catch (e) { console.warn(e); } }, 900);
    buzz(40);
    showUndoToast(`${wasTrial ? 'Teste efetivado! ' : ''}Renovado até ${formatDateYY(nextDueDate)}.${stockNote}`, () => undoLastRenewal(client.id, true));
  } catch (err) {
    alert("Erro ao renovar: " + err.message + (navigator.onLine === false ? "\n\nRenovar precisa de internet." : ""));
  } finally {
    window._renewBusy = false;
    if (confirmBtn) confirmBtn.disabled = false;
  }
};

// Desfaz a última renovação: volta o vencimento, tira o lançamento e devolve o desconto usado
window.undoLastRenewal = async function(id, skipConfirm) {
  const client = clients.find(c => c.id === id);
  if (!skipConfirm) {
    if (!client || !client.lastRenewal) return alert('Não há renovação para desfazer.');
    if (!confirm(`Desfazer a última renovação de ${client.name}?\nO vencimento volta para ${formatDateYY(client.lastRenewal.prevDueDate)} e o lançamento é removido do financeiro.`)) return;
  }
  const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
  const ref = fs.collection("clients").doc(id);
  const FV = firebase.firestore.FieldValue;
  let undoneEntry = null;
  await fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Cliente não encontrado.');
    const cur = snap.data() || {};
    const lr = cur.lastRenewal;
    if (!lr || !lr.entry) throw new Error('Não há renovação para desfazer.');
    undoneEntry = lr.entry;
    const hist = Array.isArray(cur.paymentHistory) ? cur.paymentHistory.slice() : [];
    const same = (h) => h && h.date === lr.entry.date && h.newDueDate === lr.entry.newDueDate && Number(h.amount) === Number(lr.entry.amount) && Number(h.months) === Number(lr.entry.months);
    let idx = -1;
    hist.forEach((h, n) => { if (same(h)) idx = n; });
    if (idx >= 0) hist.splice(idx, 1);
    const payload = {
      dueDate: lr.prevDueDate || '',
      isArchived: !!lr.prevArchived,
      paymentHistory: hist,
      lastRenewal: FV.delete(),
      billingDay: lr.prevBillingDay ? lr.prevBillingDay : FV.delete()
    };
    if (lr.prevTrial) payload.isTrial = true;
    if (lr.discount > 0) payload.pendingDiscount = (parseFloat(cur.pendingDiscount) || 0) + lr.discount;
    if (lr.owed > 0) payload.owedAmount = Math.max(0, (parseFloat(cur.owedAmount) || 0) - lr.owed);
    if (lr.redeemed > 0) payload.referralsRedeemed = Math.max(0, (parseInt(cur.referralsRedeemed || 0, 10) || 0) - lr.redeemed); // mês grátis desfeito devolve as indicações
    tx.update(ref, payload);
  });
  // devolve os créditos ao estoque do servidor
  try {
    if (undoneEntry && typeof adjustServerStock === 'function') {
      const list = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];
      const srv = list.find(s => undoneEntry.serverId && s.id === undoneEntry.serverId) || list.find(s => undoneEntry.serverName && s.name === undoneEntry.serverName);
      if (srv) await adjustServerStock(srv, Number(undoneEntry.months) || 1, 'renovação desfeita');
    }
  } catch (e) { console.warn(e); }
};

// Cliente que não quer participar do Indique e Ganhe (some do portal e das ofertas; o histórico fica guardado)
window.toggleReferralOptOut = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  const out = !client.referralOptOut;
  if (!confirm(out
    ? `Tirar ${client.name} do programa Indique e Ganhe?\n\nO bloco de indicações some da ficha e do portal dele. As indicações já feitas ficam guardadas e ele pode voltar quando quiser.`
    : `Voltar ${client.name} para o programa Indique e Ganhe?`)) return;
  try {
    await offlineSafe((typeof db !== 'undefined' ? db : firebase.firestore()).collection('clients').doc(id).update({ referralOptOut: out }));
  } catch (err) { alert('Erro: ' + err.message); }
};

// Pergunta se o teste agradou e manda valor + Pix
window.sendTrialFollowUp = function(c) {
  if (typeof c === 'string') c = clients.find(x => x.id === c);
  if (!c) return;
  openWhatsAppDirect(c.phone, buildTrialMessage(c, myPixKey, referralFirstDiscount));
  try {
    const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
    offlineSafe(fs.collection('clients').doc(c.id).update({ trialFollowUpDate: safeGetTodayLocal() })).catch(() => {});
  } catch (e) {}
};

// Resumo da aba Testes: conversão dos últimos 30 dias + testes que já terminaram
window.updateTrialSummary = function() {
  const box = document.getElementById('trialSummary');
  if (!box) return;
  if (currentFilter !== 'trial') { box.style.display = 'none'; return; }
  const since = Date.now() - 30 * 86400000;
  const pool = clients.concat(window.deletedClients || []).filter(c => (c.isTrial || c.trialConvertedAt) && Date.parse(c.trialEndsAt || '') >= since);
  const total = pool.length;
  const conv = pool.filter(c => c.trialConvertedAt && !c.isTrial).length;
  const pct = total ? Math.round((conv / total) * 100) : 0;
  const today = safeGetTodayLocal();
  const over = clients.filter(c => c.isTrial && !c.isArchived && Date.parse(c.trialEndsAt || '') <= Date.now() && (currentGlobalServer === 'ALL' || c.assignedServer === currentGlobalServer));
  const toCall = over.filter(c => c.phone && c.trialFollowUpDate !== today);
  box.style.display = '';
  box.innerHTML = `<div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
      <div style="font-size:0.78rem;"><strong>Últimos 30 dias:</strong> ${total} teste${total === 1 ? '' : 's'} • <strong>${conv}</strong> ${conv === 1 ? 'virou' : 'viraram'} cliente <strong>(${pct}%)</strong></div>
      <div style="font-size:0.74rem; color:var(--text-muted);">⏳ ${over.length} ${over.length === 1 ? 'terminou e ainda não renovou' : 'terminaram e ainda não renovaram'}</div>
    </div>
    ${toCall.length ? `<button type="button" id="btnTrialQueue" style="margin-top:8px; width:100%; padding:9px; border:none; border-radius:8px; background:#16a34a; color:#fff; font-weight:700; cursor:pointer;">📣 ${toCall.length === 1 ? 'Chamar 1 que terminou' : `Chamar os ${toCall.length} que terminaram (um por vez)`}</button>` : ''}`;
  const b = document.getElementById('btnTrialQueue');
  if (b) b.addEventListener('click', () => startDailyQueueBilling({
    list: over,
    isDone: c => c.trialFollowUpDate === today,
    send: sendTrialFollowUp,
    verb: 'Chamar',
    sub: c => `${trialInfo(c).text} • ${safeFormatCurrency(c.price, false)}`,
    emptyMsg: 'Nenhum teste terminado para chamar agora.'
  }));
};

// Texto do teste: quando termina / terminou
window.trialInfo = function(c) {
  const end = Date.parse(c.trialEndsAt || '');
  if (!end) return { text: 'sem horário de término', over: false };
  const diff = end - Date.now();
  const d = new Date(end), pad = n => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === new Date().toDateString();
  const when = sameDay ? `às ${hm}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${hm}`;
  const fmt = (ms) => { const m = Math.round(Math.abs(ms) / 60000); return m < 60 ? `${m} min` : (m < 1440 ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}` : `${Math.round(m / 1440)} dia(s)`); };
  return diff > 0 ? { text: `termina ${when} (faltam ${fmt(diff)})`, over: false } : { text: `terminou ${when} (há ${fmt(diff)}) — renovou?`, over: true };
};

// Teste virou cliente: aplica o desconto de boas-vindas (se indicado) e abre a renovação
window.convertTrial = async function(id) {
  const c = clients.find(x => x.id === id);
  if (!c || !c.isTrial) return;
  const first = referralFirstDiscount;
  const withDisc = !!(c.referredBy && first > 0 && !c.firstDiscountGiven);
  if (!confirm(`Efetivar ${c.name}?\n\nO próximo passo é a renovação (1ª mensalidade). Só depois dela ele sai de Testes e a indicação passa a contar.` + (withDisc ? `\n\n🎁 Indicado por ${c.referredBy}: desconto de boas-vindas de ${safeFormatCurrency(first, false)} entra nessa mensalidade.` : ''))) return;
  if (withDisc) {
    try {
      await offlineSafe((typeof db !== 'undefined' ? db : firebase.firestore()).collection('clients').doc(id).update({ pendingDiscount: firebase.firestore.FieldValue.increment(first), firstDiscountGiven: true }));
      c.pendingDiscount = (parseFloat(c.pendingDiscount) || 0) + first; c.firstDiscountGiven = true;
    } catch (err) { return alert('Erro: ' + err.message); }
  }
  window._trialConfirmed = id;
  openRenewModal(id);
};

// Desconto de boas-vindas do cliente que chegou por indicação (vale na 1ª renovação)
window.giveFirstDiscount = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client || client.firstDiscountGiven || !(referralFirstDiscount > 0)) return;
  const price = parseFloat(client.price) || 0;
  const already = Math.max(0, parseFloat(client.pendingDiscount) || 0);
  const newPrice = Math.max(0, price - Math.min(price, already + referralFirstDiscount));
  if (!confirm(`Dar ${safeFormatCurrency(referralFirstDiscount, false)} de desconto de boas-vindas para ${client.name}?\n\nPróxima cobrança: ${safeFormatCurrency(price, false)} → ${safeFormatCurrency(newPrice, false)}`)) return;
  try {
    await offlineSafe((typeof db !== 'undefined' ? db : firebase.firestore()).collection('clients').doc(id).update({
      pendingDiscount: firebase.firestore.FieldValue.increment(referralFirstDiscount),
      firstDiscountGiven: true
    }));
    showUndoToast(`Desconto de boas-vindas aplicado para ${client.name}.`, async () => {
      await (typeof db !== 'undefined' ? db : firebase.firestore()).collection('clients').doc(id).update({
        pendingDiscount: firebase.firestore.FieldValue.increment(-referralFirstDiscount),
        firstDiscountGiven: firebase.firestore.FieldValue.delete()
      });
    });
  } catch (err) { alert('Erro: ' + err.message); }
};

// Marca como pagas as renovações que ficaram "a receber"
window.markOwedPaid = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;
  if (!confirm(`Confirmar que ${client.name} pagou o que estava a receber (${safeFormatCurrency(client.owedAmount || 0, false)})?`)) return;
  const fs = (typeof db !== 'undefined' ? db : firebase.firestore());
  const ref = fs.collection("clients").doc(id);
  try {
    await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.data() || {};
      const hist = (Array.isArray(cur.paymentHistory) ? cur.paymentHistory : []).map(h => h && h.paid === false ? { ...h, paid: true, paidDate: safeGetTodayLocal() } : h);
      const payload = { paymentHistory: hist, owedAmount: 0 };
      if (cur.lastRenewal && cur.lastRenewal.owed) payload.lastRenewal = { ...cur.lastRenewal, owed: 0, entry: { ...cur.lastRenewal.entry, paid: true, paidDate: safeGetTodayLocal() } };
      tx.update(ref, payload);
    });
  } catch (err) { alert('Erro: ' + err.message); }
};