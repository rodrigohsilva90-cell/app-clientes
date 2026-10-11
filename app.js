// ==========================================
// CONFIGURAÇÃO DO FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyCJa_EL7sljAIgf1dO3hWIxiWI8-hjHcZY",
  authDomain: "gestao-clientes-2355c.firebaseapp.com",
  projectId: "gestao-clientes-2355c",
  storageBucket: "gestao-clientes-2355c.firebasestorage.app",
  messagingSenderId: "979751049541",
  appId: "1:979751049541:web:1900c445eaee6d442d862c"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// CONFIGURAÇÕES MASTER DA PLATAFORMA
const MASTER_ADMIN_EMAIL = "rodrigo.h.silva90@gmail.com";
const MASTER_ADMIN_PHONE = "5511999999999";

// ==========================================
// ELEMENTOS DO DOM (DECLARADOS NO TOPO)
// ==========================================
const syncStatus = document.getElementById('syncStatus');
const privacyBtn = document.getElementById('privacyBtn');
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const subscriptionBlockScreen = document.getElementById('subscriptionBlockScreen');
const paywallPixDisplay = document.getElementById('paywallPixDisplay');
const paywallWhatsAppBtn = document.getElementById('paywallWhatsAppBtn');

const authError = document.getElementById('authError');
const authSuccess = document.getElementById('authSuccess');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const userBadge = document.getElementById('userBadge');
const resellerTrialBadge = document.getElementById('resellerTrialBadge');
const masterNav = document.getElementById('masterNav');
const impersonationBanner = document.getElementById('impersonationBanner');
const impersonatedEmail = document.getElementById('impersonatedEmail');

// Formulários de Autenticação
const authFormLogin = document.getElementById('authFormLogin');
const authFormRegister = document.getElementById('authFormRegister');
const authFormReset = document.getElementById('authFormReset');
const authSubtitle = document.getElementById('authSubtitle');

// Seções Master
const viewClientsSection = document.getElementById('viewClientsSection');
const viewResellersSection = document.getElementById('viewResellersSection');
const tabClientsBtn = document.getElementById('tabClientsBtn');
const tabResellersBtn = document.getElementById('tabResellersBtn');

// Ações do Dia
const dailyActionsSection = document.getElementById('dailyActionsSection');
const dailyTotalBadge = document.getElementById('dailyTotalBadge');
const dailyActionsSummary = document.getElementById('dailyActionsSummary');
const dailyActionsList = document.getElementById('dailyActionsList');

// Paginação
const paginationControls = document.getElementById('paginationControls');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');

// Elementos de Clientes e Configuração Pix
const pixKeyInput = document.getElementById('pixKeyInput');
const form = document.getElementById('clientForm');
const formTitle = document.getElementById('formTitle');
const clientIdInput = document.getElementById('clientId');
const saveBtn = document.getElementById('saveBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const sortOrderSelect = document.getElementById('sortOrder');
const clientList = document.getElementById('clientList');
const searchInput = document.getElementById('search');

// Indicadores e Contadores
const countActiveTotal = document.getElementById('countActiveTotal');
const countInactiveTotal = document.getElementById('countInactiveTotal');
const dashTotal = document.getElementById('dashTotal');
const dashOk = document.getElementById('dashOk');
const dashExpired = document.getElementById('dashExpired');
const countAll = document.getElementById('countAll');
const countOk = document.getElementById('countOk');
const countWarning = document.getElementById('countWarning');
const countExpired = document.getElementById('countExpired');

// Variáveis de Estado
let currentUser = null;
let activeOwnerId = null;
let unsubscribeFirestore = null;
let unsubscribeResellers = null;
let unsubscribeAllClients = null;
let isPrivacyMode = localStorage.getItem('user_privacy_mode') === 'true';
let myPixKey = '';
let masterPixKey = '';

const PAGE_SIZE = 20;
let currentPage = 1;
let totalPages = 1;

let clients = [];
let allSystemClients = [];
let globalResellersList = [];
let currentFilter = 'all';
let currentSort = localStorage.getItem('user_sort_order') || 'dueAsc';

if (sortOrderSelect) sortOrderSelect.value = currentSort;

// ==========================================
// FUNÇÕES UTILITÁRIAS
// ==========================================
function getTodayLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setDate(target.getDate() + days);
  const ry = target.getFullYear();
  const rm = String(target.getMonth() + 1).padStart(2, '0');
  const rd = String(target.getDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

window.applyPhoneMask = function(input) {
  let v = input.value.replace(/\D/g, "");
  if (v.length > 11) v = v.slice(0, 11);

  if (v.length > 10) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
  } else if (v.length > 6) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  } else if (v.length > 2) {
    input.value = `(${v.slice(0, 2)})${v.slice(2)}`;
  } else if (v.length > 0) {
    input.value = `(${v}`;
  } else {
    input.value = "";
  }
};

window.togglePasswordVisibility = function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁️";
  }
};

window.copyMasterPixKey = function(btn) {
  const pix = masterPixKey || myPixKey;
  if (!pix) {
    alert("Nenhuma chave Pix configurada no momento.");
    return;
  }
  navigator.clipboard.writeText(pix).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Chave Copiada! ✓";
    setTimeout(() => btn.textContent = orig, 1800);
  });
};

// ==========================================
// CONTROLE DE NAVEGAÇÃO DE AUTENTICAÇÃO
// ==========================================
window.switchAuthMode = function(mode) {
  authError.textContent = '';
  authSuccess.textContent = '';

  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));

  if (mode === 'login') {
    authFormLogin.style.display = 'block';
    authFormRegister.style.display = 'none';
    authFormReset.style.display = 'none';
    document.getElementById('tabAuthLogin').classList.add('active');
    authSubtitle.textContent = 'Entre com seus dados para continuar:';
  } else if (mode === 'register') {
    authFormLogin.style.display = 'none';
    authFormRegister.style.display = 'block';
    authFormReset.style.display = 'none';
    document.getElementById('tabAuthRegister').classList.add('active');
    authSubtitle.textContent = 'Crie sua conta e comece 7 dias de teste grátis:';
  } else if (mode === 'reset') {
    authFormLogin.style.display = 'none';
    authFormRegister.style.display = 'none';
    authFormReset.style.display = 'block';
    document.getElementById('tabAuthReset').classList.add('active');
    authSubtitle.textContent = 'Receba um link para redefinir sua senha:';
  }
};

// ==========================================
// CONTROLE DE SESSÃO E VERIFICAÇÃO DE ASSINATURA
// ==========================================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    activeOwnerId = user.uid;

    const isMaster = user.email && user.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();

    await loadMasterPixKey();

    if (!isMaster) {
      try {
        const resDoc = await db.collection("resellers").doc(user.uid).get();
        if (resDoc.exists) {
          const resData = resDoc.data();
          const today = getTodayLocal();

          if (resData.blocked === true) {
            alert("⚠️ Seu acesso está suspenso. Contate o administrador.");
            auth.signOut();
            return;
          }

          if (resData.expiresAt && resData.expiresAt < today) {
            showSubscriptionBlock(resData);
            return;
          }

          if (resellerTrialBadge && resData.expiresAt) {
            const [ey, em, ed] = resData.expiresAt.split('-');
            resellerTrialBadge.style.display = 'block';
            resellerTrialBadge.textContent = `⭐ Assinatura/Trial ativo até: ${ed}/${em}/${ey}`;
          }

          await db.collection("resellers").doc(user.uid).update({
            lastAccess: getTodayLocal() + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          });
        }
      } catch (err) {
        console.log("Validação de conta:", err);
      }
    } else {
      if (resellerTrialBadge) resellerTrialBadge.style.display = 'none';
    }

    subscriptionBlockScreen.style.display = 'none';
    loginScreen.style.display = 'none';
    appContainer.style.display = 'block';

    userBadge.innerHTML = `Conectado: <strong>${user.email}</strong>${isMaster ? '⭐ (Administrador)' : '👤 (Revendedor)'}`;
    
    if (masterNav) {
      masterNav.style.display = isMaster ? 'grid' : 'none';
    }

    if (isMaster) {
      listenAllClientsGlobal();
      listenResellersList();
    }

    await loadUserPixKey(activeOwnerId);
    startFirestoreSync(activeOwnerId);
  } else {
    currentUser = null;
    activeOwnerId = null;
    if (unsubscribeFirestore) unsubscribeFirestore();
    if (unsubscribeResellers) unsubscribeResellers();
    if (unsubscribeAllClients) unsubscribeAllClients();
    subscriptionBlockScreen.style.display = 'none';
    loginScreen.style.display = 'flex';
    appContainer.style.display = 'none';
  }
});

function showSubscriptionBlock(resellerData) {
  loginScreen.style.display = 'none';
  appContainer.style.display = 'none';
  subscriptionBlockScreen.style.display = 'flex';

  paywallPixDisplay.textContent = masterPixKey || "Chave Pix disponível via WhatsApp";

  const msg = encodeURIComponent(`Olá Rodrigo! Meu período de teste no Gestão de Clientes expirou. Segue o comprovante de renovação da minha conta: ${resellerData.email}`);
  paywallWhatsAppBtn.href = buildWhatsAppUrl(MASTER_ADMIN_PHONE, msg);
}

async function loadMasterPixKey() {
  try {
    const snap = await db.collection("settings").get();
    snap.forEach(doc => {
      if (doc.data().pixKey && !masterPixKey) {
        masterPixKey = doc.data().pixKey;
      }
    });
  } catch (e) {
    console.log("Pix master:", e);
  }
}

// Login
window.handleAuthLogin = async function(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;

  authError.textContent = '';
  authSuccess.textContent = '';
  authSubmitBtn.textContent = 'Autenticando...';
  authSubmitBtn.disabled = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      authError.textContent = 'E-mail ou senha incorretos.';
    } else if (err.code === 'auth/invalid-email') {
      authError.textContent = 'Formato de e-mail inválido.';
    } else {
      authError.textContent = 'Erro ao autenticar: ' + err.message;
    }
  } finally {
    authSubmitBtn.textContent = 'Entrar no Sistema';
    authSubmitBtn.disabled = false;
  }
};

// Auto-Cadastro Direto com 7 Dias Grátis
window.handleAuthRegister = async function(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const regSubmitBtn = document.getElementById('regSubmitBtn');

  authError.textContent = '';
  authSuccess.textContent = '';

  if (password.length < 6) {
    authError.textContent = 'A senha precisa ter pelo menos 6 dígitos.';
    return;
  }

  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 10) {
    authError.textContent = 'Por favor, informe um WhatsApp válido com DDD.';
    return;
  }

  regSubmitBtn.textContent = 'Verificando dados...';
  regSubmitBtn.disabled = true;

  try {
    const phoneCheck = await db.collection("resellers").where("cleanPhone", "==", cleanPhone).get();
    if (!phoneCheck.empty) {
      authError.textContent = 'Este número de WhatsApp já possui uma conta cadastrada no sistema!';
      regSubmitBtn.textContent = 'Criar Conta e Iniciar 7 Dias Grátis';
      regSubmitBtn.disabled = false;
      return;
    }

    regSubmitBtn.textContent = 'Criando sua conta...';

    const userCred = await auth.createUserWithEmailAndPassword(email, password);
    const newUid = userCred.user.uid;

    const trialExpirationDate = addDaysToDate(getTodayLocal(), 7);

    await db.collection("resellers").doc(newUid).set({
      name: name,
      email: email,
      phone: phone,
      cleanPhone: cleanPhone,
      createdAt: getTodayLocal(),
      expiresAt: trialExpirationDate,
      lastAccess: getTodayLocal(),
      blocked: false,
      activated: true,
      status: 'active'
    });

    alert(`🎉 Bem-vindo(a) ${name}!\n\nSua conta foi criada com 7 dias de teste grátis (ativo até ${trialExpirationDate.split('-').reverse().join('/')}).`);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      authError.textContent = 'Este e-mail já está em uso na plataforma.';
    } else {
      authError.textContent = 'Erro ao criar conta: ' + err.message;
    }
  } finally {
    regSubmitBtn.textContent = 'Criar Conta e Iniciar 7 Dias Grátis';
    regSubmitBtn.disabled = false;
  }
};

// Recuperação de Senha
window.handleAuthReset = async function(e) {
  e.preventDefault();
  const email = document.getElementById('resetEmail').value.trim();
  const resetSubmitBtn = document.getElementById('resetSubmitBtn');

  authError.textContent = '';
  authSuccess.textContent = '';
  resetSubmitBtn.textContent = 'Enviando...';
  resetSubmitBtn.disabled = true;

  try {
    await auth.sendPasswordResetEmail(email);
    authSuccess.textContent = '✅ E-mail enviado! Verifique sua caixa de entrada e spam para criar nova senha.';
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      authError.textContent = 'Não encontramos nenhuma conta com este e-mail.';
    } else {
      authError.textContent = 'Erro ao enviar redefinição: ' + err.message;
    }
  } finally {
    resetSubmitBtn.textContent = 'Enviar Link de Recuperação';
    resetSubmitBtn.disabled = false;
  }
};

window.handleLogout = function() {
  if (confirm('Deseja realmente sair da sua conta?')) {
    auth.signOut();
  }
};

// ==========================================
// CONTROLE DE ABAS DO MASTER
// ==========================================
window.switchMasterView = function(viewName) {
  if (viewName === 'clients') {
    viewClientsSection.style.display = 'block';
    viewResellersSection.style.display = 'none';
    tabClientsBtn.classList.add('active');
    tabResellersBtn.classList.remove('active');
  } else if (viewName === 'resellers') {
    viewClientsSection.style.display = 'none';
    viewResellersSection.style.display = 'block';
    tabClientsBtn.classList.remove('active');
    tabResellersBtn.classList.add('active');
    renderResellersList();
  }
};

// ==========================================
// STATUS DO CLIENTE
// ==========================================
function getStatus(dueDateString) {
  if (!dueDateString || typeof dueDateString !== 'string') {
    return { class: 'expired', label: 'Sem data', diffDays: -999 };
  }

  const [todayY, todayM, todayD] = getTodayLocal().split('-').map(Number);
  const today = new Date(todayY, todayM - 1, todayD);

  const [dueY, dueM, dueD] = dueDateString.split('-').map(Number);
  const due = new Date(dueY, dueM - 1, dueD);

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const daysLate = Math.abs(diffDays);
    return { class: 'expired', label: `Vencido há ${daysLate}d`, diffDays };
  } else if (diffDays <= 3) {
    return { class: 'warning', label: diffDays === 0 ? 'Vence hoje' : (diffDays === 1 ? 'Vence amanhã' : `Vence em ${diffDays}d`), diffDays };
  }
  return { class: 'ok', label: 'Em dia', diffDays };
}

// ==========================================
// BLOCO: AÇÕES DO DIA (HOJE E ATÉ 7 DIAS VENCIDOS)
// ==========================================
function updateDailyActions() {
  if (!dailyActionsSection) return;

  const dueToday = [];
  const lateClientsRecent = [];

  clients.forEach(c => {
    const st = getStatus(c.dueDate);
    if (st.diffDays === 0) {
      dueToday.push(c);
    } else if (st.diffDays < 0 && st.diffDays >= -7) {
      lateClientsRecent.push(c);
    }
  });

  const totalUrgent = dueToday.length + lateClientsRecent.length;

  if (totalUrgent === 0) {
    dailyActionsSection.style.display = 'none';
    return;
  }

  dailyActionsSection.style.display = 'block';
  dailyTotalBadge.textContent = `${totalUrgent}${totalUrgent === 1 ? 'prioridade' : 'prioridades'}`;

  if (dueToday.length > 0 && lateClientsRecent.length > 0) {
    dailyActionsSummary.textContent = `Você tem ${dueToday.length} cliente(s) vencendo hoje e${lateClientsRecent.length} vencido(s) recentemente (até 7d). Dispare a cobrança:`;
  } else if (dueToday.length > 0) {
    dailyActionsSummary.textContent = `Você tem ${dueToday.length} cliente(s) vencendo HOJE. Dispare a cobrança pelo WhatsApp:`;
  } else {
    dailyActionsSummary.textContent = `Atenção: ${lateClientsRecent.length} cliente(s) com vencimento recente (até 7d) precisam de aviso:`;
  }

  dailyActionsList.innerHTML = '';
  const urgentList = [...dueToday, ...lateClientsRecent];

  urgentList.forEach(client => {
    const st = getStatus(client.dueDate);
    const [y, m, d] = (client.dueDate || '0000-00-00').split('-');
    const formattedDate = `${d}/${m}/${y}`;
    const waUrl = createWhatsAppLink(client, formattedDate, st);

    const isToday = st.diffDays === 0;
    const statusText = isToday ? '⚠️ Vence Hoje' : `🔴 Vencido (${Math.abs(st.diffDays)}d atrás)`;
    const statusClass = isToday ? 'today' : 'late';

    const item = document.createElement('div');
    item.className = 'daily-item';
    item.innerHTML = `
      <div class="daily-item-info">
        <span class="daily-item-name">${esc(client.name)} (${esc(client.username)})</span>
        <span class="daily-item-status ${statusClass}">${statusText} •${formatCurrency(client.price)}</span>
      </div>
      <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-daily-wa" title="Cobrar no WhatsApp">
        💬 Cobrar
      </a>
    `;
    dailyActionsList.appendChild(item);
  });
}

// ==========================================
// PAGINAÇÃO (BLOCOS DE 20 CLIENTES)
// ==========================================
window.prevPage = function() {
  if (currentPage > 1) {
    currentPage--;
    renderClients();
    window.scrollTo({ top: 350, behavior: 'smooth' });
  }
};

window.nextPage = function() {
  if (currentPage < totalPages) {
    currentPage++;
    renderClients();
    window.scrollTo({ top: 350, behavior: 'smooth' });
  }
};

// ==========================================
// PAINEL DE REVENDEDORES, MÉTRICAS E RENOVAÇÕES
// ==========================================
function listenAllClientsGlobal() {
  if (unsubscribeAllClients) unsubscribeAllClients();
  unsubscribeAllClients = db.collection("clients").onSnapshot((snapshot) => {
    allSystemClients = [];
    snapshot.forEach(doc => {
      allSystemClients.push({ id: doc.id, ...doc.data() });
    });
    renderResellersList();
  });
}

function listenResellersList() {
  unsubscribeResellers = db.collection("resellers").onSnapshot((snapshot) => {
    globalResellersList = [];
    snapshot.forEach(doc => globalResellersList.push({ id: doc.id, ...doc.data() }));
    renderResellersList();
  });
}

function renderResellersList() {
  const container = document.getElementById('resellerCardsContainer');
  const countSpan = document.getElementById('resellerCount');
  if (!container) return;

  if (countSpan) countSpan.textContent = globalResellersList.length;

  if (globalResellersList.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #9ca3af; font-size: 0.85rem; padding: 16px;">Nenhum revendedor cadastrado até o momento.</p>';
    return;
  }

  const currentYearMonth = getTodayLocal().slice(0, 7);
  container.innerHTML = '';

  globalResellersList.forEach(reseller => {
    const rClients = allSystemClients.filter(c => c.ownerId === reseller.id);
    
    let activeCount = 0;
    let expiredCount = 0;
    let newThisMonth = 0;
    let totalRevenue = 0;

    rClients.forEach(c => {
      const st = getStatus(c.dueDate);
      const val = parseFloat(c.price) || 0;
      totalRevenue += val;

      if (st.class === 'expired') {
        expiredCount++;
      } else {
        activeCount++;
      }

      const createdMonth = (c.createdAt || c.dueDate || '').slice(0, 7);
      if (createdMonth === currentYearMonth) {
        newThisMonth++;
      }
    });

    const totalClients = rClients.length;
    const defaultRate = totalClients > 0 ? Math.round((expiredCount / totalClients) * 100) : 0;
    const revenueFormatted = Number(totalRevenue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const isBlocked = reseller.blocked === true;
    const isExpired = reseller.expiresAt && reseller.expiresAt < getTodayLocal();

    let waUrl = '';
    if (reseller.phone) {
      let cleanPhone = String(reseller.phone).replace(/\D/g, '');
      if (cleanPhone.length <= 11) cleanPhone = '55' + cleanPhone;
      waUrl = buildWhatsAppUrl(cleanPhone, '');
    }

    const card = document.createElement('div');
    card.className = `reseller-card ${isBlocked || isExpired ? 'blocked-card' : ''}`;

    const expDateFmt = reseller.expiresAt ? reseller.expiresAt.split('-').reverse().join('/') : 'N/A';

    card.innerHTML = `
      <div class="reseller-card-header">
        <div>
          <strong>${esc(reseller.name || 'Revendedor')}</strong> <span style="font-size: 0.8rem; color: #6b7280;">(${esc(reseller.email)})</span>${isExpired ? '<span style="color:#dc2626; font-weight: bold; font-size:0.75rem;"> [EXPIRADO]</span>' : ''}
          ${isBlocked ? '<span style="color:#dc2626; font-weight: bold; font-size:0.75rem;"> [BLOQUEADO]</span>' : ''}
          
          <div class="reseller-contact-line">
            ${reseller.phone ? `📱 ${esc(reseller.phone)} <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-reseller-wa">WhatsApp</a>` : '📱 Sem telefone'}
          </div>
          <div style="font-size: 0.72rem; color: #6b7280; margin-top: 3px;">
            Acesso até: <strong style="color: ${isExpired ? '#dc2626' : '#166534'};">${expDateFmt}</strong> | Último acesso: <strong>${reseller.lastAccess || 'Nunca'}</strong>
          </div>
        </div>
      </div>

      <div class="reseller-metrics-grid">
        <div class="reseller-metric-item">
          <span class="reseller-metric-label">🟢 Clientes Ativos</span>
          <span class="reseller-metric-val" style="color: #16a34a;">${activeCount}</span>
        </div>
        <div class="reseller-metric-item">
          <span class="reseller-metric-label">🔴 Inadimplência</span>
          <span class="reseller-metric-val" style="color: ${defaultRate > 25 ? '#dc2626' : '#4b5563'};">
            ${defaultRate}% <span style="font-size: 0.7rem; font-weight: normal;">(${expiredCount})</span>
          </span>
        </div>
        <div class="reseller-metric-item">
          <span class="reseller-metric-label">📈 Novos no Mês</span>
          <span class="reseller-metric-val" style="color: #2563eb;">+${newThisMonth}</span>
        </div>
        <div class="reseller-metric-item">
          <span class="reseller-metric-label">💰 Faturamento</span>
          <span class="reseller-metric-val" style="font-size: 0.85rem;">${revenueFormatted}</span>
        </div>
      </div>

      <div class="reseller-card-actions">
        <button type="button" class="btn-r-act btn-r-view" onclick="inspectReseller('${reseller.id}', '${esc(reseller.email)}')">👁️ Ver Tela</button>
        <button type="button" class="btn-r-act btn-r-renew" onclick="renewResellerSubscription('${reseller.id}', '${esc(reseller.email)}', '${reseller.expiresAt || getTodayLocal()}')">🔄 +30d</button>
        <button type="button" class="btn-r-act ${isBlocked ? 'btn-r-unblock' : 'btn-r-block'}" onclick="toggleBlockReseller('${reseller.id}',${!isBlocked})">
          ${isBlocked ? '🔓 Liberar' : '⏸️ Pausar'}
        </button>
        <button type="button" class="btn-r-act btn-r-backup" onclick="exportResellerData('${reseller.id}', '${esc(reseller.email)}')">💾 Backup</button>
        <button type="button" class="btn-r-act btn-r-del" title="Excluir Revendedor Permanentemente" onclick="deleteResellerAccount('${reseller.id}', '${esc(reseller.email)}')">✕ Excluir</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// EXCLUIR REVENDEDOR E LIMPAR DADOS VINCULADOS
window.deleteResellerAccount = async function(resellerId, resellerEmail) {
  const confirmMsg = `⚠️ ATENÇÃO: Deseja realmente EXCLUIR o revendedor "${resellerEmail}"?\n\nEssa ação é irreversível:\n1. A conta dele será apagada.\n2. Todos os clientes dele serão excluídos do banco.\n3. O número de WhatsApp dele será liberado.`;
  
  if (!confirm(confirmMsg)) return;

  try {
    const batch = db.batch();

    const clientsSnap = await db.collection("clients").where("ownerId", "==", resellerId).get();
    clientsSnap.forEach(doc => {
      batch.delete(doc.ref);
    });

    const resellerRef = db.collection("resellers").doc(resellerId);
    batch.delete(resellerRef);

    const settingsRef = db.collection("settings").doc(resellerId);
    batch.delete(settingsRef);

    await batch.commit();

    alert(`✅ Revendedor "${resellerEmail}" e seus clientes foram excluídos com sucesso!`);
  } catch (err) {
    alert("Erro ao excluir revendedor: " + err.message);
  }
};

// RENOVAÇÃO DE LICENÇA COM STATUS ACTIVE
window.renewResellerSubscription = async function(resellerId, resellerEmail, currentExpireDate) {
  const baseDate = currentExpireDate < getTodayLocal() ? getTodayLocal() : currentExpireDate;
  const newExpiration = addDaysToDate(baseDate, 30);
  const newDateFmt = newExpiration.split('-').reverse().join('/');

  if (!confirm(`Renovar assinatura de "${resellerEmail}" por +30 dias?\n\nNovo vencimento: ${newDateFmt}`)) return;

  try {
    await db.collection("resellers").doc(resellerId).update({
      expiresAt: newExpiration,
      blocked: false,
      status: 'active'
    });
    alert(`✅ Assinatura renovada com sucesso até ${newDateFmt}!`);
  } catch (err) {
    alert("Erro ao renovar: " + err.message);
  }
};

// Criação Manual pelo Admin
window.createNewResellerAccount = async function() {
  const nameInput = document.getElementById('newResellerName');
  const emailInput = document.getElementById('newResellerEmail');
  const phoneInput = document.getElementById('newResellerPhone');
  const passInput = document.getElementById('newResellerPass');
  
  const name = (nameInput.value || '').trim();
  const email = (emailInput.value || '').trim();
  const phone = (phoneInput.value || '').trim();
  const password = passInput.value;

  if (!email || !password) {
    alert("Informe o e-mail e a senha do revendedor.");
    return;
  }

  if (password.length < 6) {
    alert("A senha precisa ter no mínimo 6 caracteres.");
    return;
  }

  const cleanPhone = phone.replace(/\D/g, "");

  try {
    const secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp" + Date.now());
    const userCred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
    const newUid = userCred.user.uid;
    await secondaryApp.delete();

    await db.collection("resellers").doc(newUid).set({
      name: name || 'Revendedor',
      email: email,
      phone: phone,
      cleanPhone: cleanPhone,
      createdAt: getTodayLocal(),
      expiresAt: addDaysToDate(getTodayLocal(), 30),
      lastAccess: 'Nunca',
      blocked: false,
      activated: true,
      status: 'active'
    });

    alert(`✅ Revendedor criado com sucesso com 30 dias de acesso!\n\nE-mail: ${email}`);
    nameInput.value = '';
    emailInput.value = '';
    phoneInput.value = '';
    passInput.value = '';
  } catch (err) {
    alert("Erro ao cadastrar revendedor: " + err.message);
  }
};

window.toggleBlockReseller = async function(resellerId, shouldBlock) {
  const actionText = shouldBlock ? "BLOQUEAR" : "LIBERAR";
  if (!confirm(`Deseja realmente ${actionText} o acesso deste revendedor?`)) return;

  try {
    await db.collection("resellers").doc(resellerId).update({ blocked: shouldBlock });
    alert(`Acesso do revendedor ${shouldBlock ? 'bloqueado' : 'liberado'} com sucesso!`);
  } catch (err) {
    alert("Erro ao alterar status: " + err.message);
  }
};

window.exportResellerData = function(resellerId, resellerEmail) {
  const rClients = allSystemClients.filter(c => c.ownerId === resellerId);
  if (rClients.length === 0) {
    alert(`O revendedor ${resellerEmail} não possui clientes cadastrados para exportação.`);
    return;
  }

  let csvContent = 'Nome;Usuário;Valor;WhatsApp;Vencimento;Status;Pendência;Observações\n';
  rClients.forEach(c => {
    const status = getStatus(c.dueDate);
    const [y, m, d] = (c.dueDate || '0000-00-00').split('-');

    const sanitizeCsv = (val) => {
      let str = String(val ?? '').replace(/"/g, '""');
      if (/^[=\+\-@]/.test(str)) str = "'" + str;
      return str;
    };

    const priceFormatted = Number(c.price || 0).toFixed(2).replace('.', ',');
    csvContent += `"${sanitizeCsv(c.name)}";"${sanitizeCsv(c.username)}";"${priceFormatted}";"${sanitizeCsv(c.phone)}";"${d}/${m}/${y}";"${status.label}";"${c.hasPending ? 'Sim' : 'Não'}";"${sanitizeCsv(c.notes)}"\n`;
  });

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `clientes_${resellerEmail.replace(/[@.]/g, '_')}_${getTodayLocal()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

window.inspectReseller = async function(resellerId, resellerEmail) {
  activeOwnerId = resellerId;
  impersonatedEmail.textContent = resellerEmail;
  impersonationBanner.style.display = 'flex';
  currentPage = 1;
  
  switchMasterView('clients');
  await loadUserPixKey(activeOwnerId);
  startFirestoreSync(activeOwnerId);
};

window.exitResellerView = async function() {
  if (!currentUser) return;
  activeOwnerId = currentUser.uid;
  impersonationBanner.style.display = 'none';
  currentPage = 1;
  
  await loadUserPixKey(activeOwnerId);
  startFirestoreSync(activeOwnerId);
};

// ==========================================
// GESTÃO DE PIX POR USUÁRIO
// ==========================================
async function loadUserPixKey(targetUid) {
  if (!targetUid) return;
  try {
    const doc = await db.collection("settings").doc(targetUid).get();
    if (doc.exists && doc.data().pixKey) {
      myPixKey = doc.data().pixKey;
    } else {
      myPixKey = localStorage.getItem(`pix_key_${targetUid}`) || '';
    }
    if (pixKeyInput) pixKeyInput.value = myPixKey;
  } catch (err) {
    myPixKey = localStorage.getItem(`pix_key_${targetUid}`) || '';
    if (pixKeyInput) pixKeyInput.value = myPixKey;
  }
}

window.savePixKey = async function() {
  if (!activeOwnerId) return;
  myPixKey = (pixKeyInput.value || '').trim();
  localStorage.setItem(`pix_key_${activeOwnerId}`, myPixKey);

  try {
    await db.collection("settings").doc(activeOwnerId).set({ pixKey: myPixKey }, { merge: true });
    renderClients();
    alert('Chave Pix salva com sucesso!');
  } catch (err) {
    renderClients();
    alert('Chave Pix salva no dispositivo!');
  }
};

// ==========================================
// SINCRONIZAÇÃO OTIMIZADA COM WHERE
// ==========================================
function startFirestoreSync(targetOwnerId) {
  if (!targetOwnerId) return;
  if (unsubscribeFirestore) unsubscribeFirestore();

  const isMaster = currentUser.email && currentUser.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
  let query = db.collection("clients").where("ownerId", "==", targetOwnerId);

  unsubscribeFirestore = query.onSnapshot((snapshot) => {
    clients = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data && data.name && data.dueDate) {
        clients.push({ id: doc.id, ...data });
      }
    });

    if (syncStatus) {
      syncStatus.textContent = '☁️ Conectado à Nuvem (Sincronizado)';
      syncStatus.style.color = '#166534';
    }

    updateDailyActions();
    renderClients();
  }, (error) => {
    console.error("Erro no Firebase:", error);
    if (syncStatus) {
      syncStatus.textContent = '⚠️ Erro de permissão ou sincronização';
      syncStatus.style.color = '#dc2626';
    }
  });

  if (isMaster && targetOwnerId === currentUser.uid) {
    db.collection("clients").get().then((snap) => {
      const batch = db.batch();
      let hasMigration = false;
      snap.forEach((doc) => {
        const d = doc.data();
        if (d && !d.ownerId) {
          batch.update(doc.ref, { ownerId: currentUser.uid });
          hasMigration = true;
        }
      });
      if (hasMigration) batch.commit().catch(e => console.log("Migração legacy:", e));
    }).catch(e => console.log("Verificação legacy:", e));
  }
}

// Sanitização anti-XSS
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

// ==========================================
// DETECÇÃO DE DISPOSITIVO PARA WHATSAPP
// ==========================================
function buildWhatsAppUrl(cleanPhone, encodedText) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    return `whatsapp://send?phone=${cleanPhone}${encodedText ? `&text=${encodedText}` : ''}`;
  } else {
    return `https://web.whatsapp.com/send?phone=${cleanPhone}${encodedText ? `&text=${encodedText}` : ''}`;
  }
}

function createWhatsAppLink(client, formattedDate, status) {
  let p = String(client.phone || '').replace(/\D/g, '');

  if (p.length === 10 || p.length === 11) {
    p = '55' + p;
  }

  const priceFormatted = Number(client.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pixBlock = myPixKey 
    ? `\n\n👇 *CHAVE PIX:*\n\`\`\`\n${myPixKey}\n\`\`\`` 
    : '';

  let message = '';
  if (status.class === 'expired') {
    message = `Olá *${client.name}*, tudo bem?\nConstatamos que sua fatura de *${priceFormatted}* referente ao login *${client.username}* venceu em *${formattedDate}*.\nPor gentileza, entre em contato para regularizar o acesso.${pixBlock}`;
  } else if (status.diffDays === 0) {
    message = `Olá *${client.name}*, lembrete: sua fatura de *${priceFormatted}* referente ao login *${client.username}* vence *HOJE* (*${formattedDate}*).${pixBlock}`;
  } else if (status.diffDays === 1) {
    message = `Olá *${client.name}*, lembrete preventivo: sua fatura de *${priceFormatted}* referente ao login *${client.username}* vence amanhã (*${formattedDate}*).${pixBlock}`;
  } else if (status.class === 'warning') {
    message = `Olá *${client.name}*, lembrete: sua fatura de *${priceFormatted}* referente ao login *${client.username}* vence no dia *${formattedDate}*.${pixBlock}`;
  } else {
    message = `Olá *${client.name}*, tudo bem? Segue o aviso referente ao usuário *${client.username}* com vencimento para *${formattedDate}* no valor de ${priceFormatted}.${pixBlock}`;
  }

  return buildWhatsAppUrl(p, encodeURIComponent(message));
}

// ESTATÍSTICAS DO MÊS
function updateDashboard() {
  let total = 0, okTotal = 0, expiredTotal = 0;
  let cOk = 0, cWarn = 0, cExp = 0;

  clients.forEach(c => {
    const val = parseFloat(c.price) || 0;
    const st = getStatus(c.dueDate);

    total += val;
    if (st.class === 'expired') {
      expiredTotal += val;
      cExp++;
    } else {
      okTotal += val;
      if (st.class === 'warning') cWarn++;
      else cOk++;
    }
  });

  countActiveTotal.textContent = cOk + cWarn;
  countInactiveTotal.textContent = cExp;

  dashTotal.textContent = formatCurrency(total);
  dashOk.textContent = formatCurrency(okTotal);
  dashExpired.textContent = formatCurrency(expiredTotal);

  countAll.textContent = clients.length;
  countOk.textContent = cOk;
  countWarning.textContent = cWarn;
  countExpired.textContent = cExp;
}

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

function renderClients() {
  updateDashboard();
  clientList.innerHTML = '';

  const searchText = (searchInput.value || '').toLowerCase();

  let filtered = clients.filter(c => {
    const status = getStatus(c.dueDate);
    const notesText = (c.notes || '').toLowerCase();
    const matchesSearch = c.name.toLowerCase().includes(searchText) || 
                          c.username.toLowerCase().includes(searchText) ||
                          notesText.includes(searchText);

    if (!matchesSearch) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'ok') return status.class === 'ok';
    if (currentFilter === 'warning') return status.class === 'warning';
    if (currentFilter === 'expired') return status.class === 'expired';
    return true;
  });

  filtered.sort((a, b) => {
    if (currentSort === 'dueAsc') {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    } else if (currentSort === 'dueDesc') {
      return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
    } else if (currentSort === 'nameAsc') {
      return a.name.localeCompare(b.name);
    } else if (currentSort === 'priceDesc') {
      return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
    }
    return 0;
  });

  const totalItems = filtered.length;
  totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  if (totalItems > PAGE_SIZE) {
    paginationControls.style.display = 'flex';
    pageInfo.textContent = `Página ${currentPage} de ${totalPages} (${totalItems} clientes)`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
  } else {
    paginationControls.style.display = 'none';
  }

  if (totalItems === 0) {
    clientList.innerHTML = '<p style="text-align:center; color:#9ca3af; font-size:0.85rem; padding: 20px 0;">Nenhum cliente encontrado.</p>';
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageClients = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  pageClients.forEach(client => {
    const status = getStatus(client.dueDate);
    const card = document.createElement('div');
    card.className = `card ${status.class}`;

    const [y, m, d] = (client.dueDate || '0000-00-00').split('-');
    const formattedDate = `${d}/${m}/${y}`;
    const waUrl = createWhatsAppLink(client, formattedDate, status);

    const hasPending = Boolean(client.hasPending);
    const renewBtnBlocked = hasPending ? 'blocked' : '';
    const renewBtnTitle = hasPending 
      ? 'Bloqueado: consta pendência financeira' 
      : 'Renovar vencimento (escolher meses)';

    card.innerHTML = `
      <div class="card-header">
        <h3>${esc(client.name)}</h3>
        <span class="card-price">${formatCurrency(client.price)}</span>
      </div>
      <div class="card-details">
        <p><strong>Usuário:</strong> ${esc(client.username)}</p>
        <p><strong>WhatsApp:</strong> ${maskPhone(client.phone)}</p>
        <p><strong>Vencimento:</strong> ${formattedDate}</p>
        <span class="badge ${status.class}">${status.label}</span>
      </div>
      ${client.notes ? `<div class="card-notes">📝 <strong>Obs:</strong> ${esc(client.notes)}</div>` : ''}
      ${hasPending ? `
        <div class="card-pending-alert">
          <span>⚠️ Consta pendência financeira</span>
          <button type="button" class="btn-clear-pending" onclick="clearPending('${client.id}')">Quitar / Liberar</button>
        </div>` : ''}
      <div class="card-actions">
        <button type="button" class="btn-act btn-renew ${renewBtnBlocked}" title="${renewBtnTitle}" aria-label="Renovar vencimento" onclick="renewClient('${client.id}')">🔄 Renovar</button>
        <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-act btn-whatsapp" aria-label="Cobrar via WhatsApp" title="Enviar WhatsApp">💬 Cobrar</a>
        <button type="button" class="btn-act btn-edit" title="Editar" aria-label="Editar cliente" onclick="startEdit('${client.id}')">✏️ Editar</button>
        <button type="button" class="btn-act btn-delete" title="Excluir" aria-label="Excluir cliente" onclick="removeClient('${client.id}')">✕ Excluir</button>
      </div>
    `;

    clientList.appendChild(card);
  });
}

// SALVAR / ATUALIZAR CLIENTE (COM VALIDAÇÃO DE DATA)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeOwnerId) return;

  const id = clientIdInput.value;
  const name = document.getElementById('name').value.trim();
  const username = document.getElementById('username').value.trim();
  const price = document.getElementById('price').value;
  const phone = document.getElementById('phone').value.trim();
  const dueDate = document.getElementById('dueDate').value;
  const notes = document.getElementById('notes').value.trim();
  const hasPending = document.getElementById('hasPending').checked;

  if (!dueDate || dueDate.trim() === '') {
    alert("Por favor, selecione uma data de vencimento válida.");
    document.getElementById('dueDate').focus();
    return;
  }

  const isDuplicateLocal = clients.some(c => 
    c.username && c.username.toLowerCase() === username.toLowerCase() && c.id !== id
  );

  if (isDuplicateLocal) {
    alert(`⚠️ ATENÇÃO: O usuário/login "${username}" já existe nesta carteira!\n\nCada cliente precisa de um login único.`);
    document.getElementById('username').focus();
    return;
  }

  const clientData = { 
    name, 
    username, 
    price, 
    phone, 
    dueDate, 
    notes, 
    hasPending,
    ownerId: activeOwnerId,
    createdAt: id ? undefined : getTodayLocal()
  };

  try {
    if (id) {
      await db.collection("clients").doc(id).update(clientData);
    } else {
      await db.collection("clients").add(clientData);
    }
    cancelEdit();
  } catch (err) {
    alert("Erro ao salvar na nuvem: " + err.message);
  }
});

window.startEdit = function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;

  clientIdInput.value = client.id;
  document.getElementById('name').value = client.name;
  document.getElementById('username').value = client.username;
  document.getElementById('price').value = client.price || '';
  document.getElementById('phone').value = client.phone;
  document.getElementById('dueDate').value = client.dueDate;
  document.getElementById('notes').value = client.notes || '';
  document.getElementById('hasPending').checked = Boolean(client.hasPending);

  formTitle.textContent = 'Editar Cliente';
  saveBtn.textContent = 'Salvar Alterações';
  cancelEditBtn.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEdit = function() {
  form.reset();
  clientIdInput.value = '';
  document.getElementById('hasPending').checked = false;
  formTitle.textContent = 'Novo Cliente';
  saveBtn.textContent = 'Salvar Cliente';
  cancelEditBtn.style.display = 'none';
};

window.clearPending = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;

  if (confirm(`Confirmar regularização da pendência do cliente "${client.name}"?`)) {
    try {
      await db.collection("clients").doc(id).update({ hasPending: false });
    } catch (err) {
      alert("Erro ao atualizar pendência: " + err.message);
    }
  }
};

window.renewClient = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;

  if (client.hasPending) {
    alert(`⚠️ RENOVAÇÃO BLOQUEADA!\n\nO cliente "${client.name}" possui pendência financeira ativa.\n\nClique em "Quitar / Liberar" antes de renovar.`);
    return;
  }

  const inputMonths = prompt(
    `Renovar cliente: ${client.name}\n\nQuantos meses o cliente renovou?\n(Ex: digite 1, 2, 3, 6, 12):`,
    "1"
  );

  if (inputMonths === null) return;

  const monthsToAdd = parseInt(inputMonths, 10);
  if (isNaN(monthsToAdd) || monthsToAdd <= 0) {
    alert("Por favor, informe uma quantidade válida de meses (ex: 1, 2, 3...).");
    return;
  }

  const [year, month, day] = (client.dueDate || getTodayLocal()).split('-').map(Number);
  const targetDay = day;

  let totalMonths = (month - 1) + monthsToAdd;
  let newYear = year + Math.floor(totalMonths / 12);
  let newMonth = (totalMonths % 12) + 1;

  const daysInNextMonth = new Date(newYear, newMonth, 0).getDate();
  const adjustedDay = Math.min(targetDay, daysInNextMonth);

  const formattedMonth = String(newMonth).padStart(2, '0');
  const formattedDay = String(adjustedDay).padStart(2, '0');
  const nextDueDate = `${newYear}-${formattedMonth}-${formattedDay}`;

  const [ny, nm, nd] = nextDueDate.split('-');
  const confirmMsg = `Confirmar renovação de +${monthsToAdd} mês(es) para ${client.name}?\n\nNovo vencimento: ${nd}/${nm}/${ny}`;

  if (confirm(confirmMsg)) {
    try {
      await db.collection("clients").doc(id).update({ dueDate: nextDueDate });
    } catch (err) {
      alert("Erro ao renovar cliente: " + err.message);
    }
  }
};

window.removeClient = async function(id) {
  const client = clients.find(c => c.id === id);
  if (!client) return;

  if (confirm(`Deseja realmente excluir o cliente "${client.name}"?`)) {
    try {
      await db.collection("clients").doc(id).delete();
    } catch (err) {
      alert("Erro ao excluir do banco: " + err.message);
    }
  }
};

searchInput.addEventListener('input', () => {
  currentPage = 1;
  renderClients();
});

// Exportação Excel
window.exportToExcel = function() {
  if (clients.length === 0) return alert('Nenhum dado para exportar.');

  let csvContent = 'Nome;Usuário;Valor;WhatsApp;Vencimento;Status;Pendência;Observações\n';
  clients.forEach(c => {
    const status = getStatus(c.dueDate);
    const [y, m, d] = (c.dueDate || '0000-00-00').split('-');

    const sanitizeCsv = (val) => {
      let str = String(val ?? '').replace(/"/g, '""');
      if (/^[=\+\-@]/.test(str)) str = "'" + str;
      return str;
    };

    const priceFormatted = Number(c.price || 0).toFixed(2).replace('.', ',');
    csvContent += `"${sanitizeCsv(c.name)}";"${sanitizeCsv(c.username)}";"${priceFormatted}";"${sanitizeCsv(c.phone)}";"${d}/${m}/${y}";"${status.label}";"${c.hasPending ? 'Sim' : 'Não'}";"${sanitizeCsv(c.notes)}"\n`;
  });

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `clientes_${getTodayLocal()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

// Backup JSON
window.exportBackup = function() {
  if (clients.length === 0) return alert('Nenhum dado para salvar.');

  const blob = new Blob([JSON.stringify(clients, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `backup_clientes_${getTodayLocal()}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

// Restauração de backup
window.importBackup = async function(event) {
  const file = event.target.files[0];
  if (!file || !activeOwnerId) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) {
        const validClients = data.filter(c => c && c.name && typeof c.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.dueDate));

        if (validClients.length === 0) {
          alert('Arquivo de backup inválido.');
          return;
        }

        if (confirm(`Deseja importar ${validClients.length} clientes para este perfil?`)) {
          const batch = db.batch();
          validClients.forEach(c => {
            const docRef = db.collection("clients").doc();
            batch.set(docRef, {
              name: c.name,
              username: c.username || '',
              price: c.price || 0,
              phone: c.phone || '',
              dueDate: c.dueDate,
              notes: c.notes || '',
              hasPending: Boolean(c.hasPending),
              ownerId: activeOwnerId
            });
          });
          await batch.commit();
          alert('Backup restaurado com sucesso!');
        }
      } else {
        alert('Formato de arquivo incompatível.');
      }
    } catch (err) {
      alert('Erro ao importar backup: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
};

function formatCurrency(val) {
  if (isPrivacyMode) return '••••••';
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function maskPhone(phone) {
  if (!isPrivacyMode) return esc(phone);
  const raw = String(phone || '').replace(/\D/g, '');
  if (raw.length <= 4) return '••••••';
  return `(${raw.slice(0, 2)}) •••••-${raw.slice(-4)}`;
}

window.togglePrivacyMode = function() {
  isPrivacyMode = !isPrivacyMode;
  localStorage.setItem('user_privacy_mode', isPrivacyMode);
  updatePrivacyButtonUI();
  updateDailyActions();
  renderClients();
};

function updatePrivacyButtonUI() {
  if (!privacyBtn) return;
  privacyBtn.textContent = isPrivacyMode ? '🙈' : '👁️';
}
updatePrivacyButtonUI();

// Instalação PWA
let deferredInstallPrompt = null;
const installAppBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installAppBtn) installAppBtn.style.display = 'block';
});

window.triggerInstallPrompt = async function() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choiceResult = await deferredInstallPrompt.userChoice;
  if (choiceResult.outcome === 'accepted') {
    if (installAppBtn) installAppBtn.style.display = 'none';
  }
  deferredInstallPrompt = null;
};

window.addEventListener('appinstalled', () => {
  if (installAppBtn) installAppBtn.style.display = 'none';
  deferredInstallPrompt = null;
});