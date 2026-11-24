// ============================================================
// AUTH.JS - AUTENTICAÇÃO, CONTROLE DE ACESSO & ASSINATURA (CORRIGIDO)
// ============================================================

const getAuth = () => (typeof auth !== 'undefined' ? auth : firebase.auth());
const getDb = () => (typeof db !== 'undefined' ? db : firebase.firestore());
const MASTER_EMAIL = (typeof MASTER_ADMIN_EMAIL !== 'undefined' ? MASTER_ADMIN_EMAIL : (window.MASTER_ADMIN_EMAIL || 'rodrigo.h.silva90@gmail.com'));
const MASTER_PHONE = (typeof MASTER_ADMIN_PHONE !== 'undefined' ? MASTER_ADMIN_PHONE : (window.MASTER_ADMIN_PHONE || '5511999999999'));

window.isRegisteringAccount = false;

// Fim do dia de vencimento (horário de Brasília) como Timestamp: é o que as regras do Firestore conferem
function expiresTsSafe(dateStr) {
  try { return firebase.firestore.Timestamp.fromDate(new Date(dateStr + 'T23:59:59-03:00')); } catch (e) { return null; }
}
window.expiresTsSafe = expiresTsSafe;

function getTodaySafe() {
  if (typeof getTodayLocal === 'function') return getTodayLocal();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysSafe(dateStr, days) {
  if (typeof addDaysToDate === 'function') return addDaysToDate(dateStr, days);
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

window.switchAuthMode = function(mode) {
  const formLogin = document.getElementById('authFormLogin');
  const formRegister = document.getElementById('authFormRegister');
  const formReset = document.getElementById('authFormReset');
  const tabLogin = document.getElementById('tabAuthLogin');
  const tabRegister = document.getElementById('tabAuthRegister');
  const tabReset = document.getElementById('tabAuthReset');
  const subtitle = document.getElementById('authSubtitle');
  const errEl = document.getElementById('authError');
  const succEl = document.getElementById('authSuccess');

  if (errEl) errEl.textContent = '';
  if (succEl) succEl.textContent = '';

  [tabLogin, tabRegister, tabReset].forEach(t => t && t.classList.remove('active'));

  if (mode === 'login') {
    if (formLogin) formLogin.style.display = 'block';
    if (formRegister) formRegister.style.display = 'none';
    if (formReset) formReset.style.display = 'none';
    if (tabLogin) tabLogin.classList.add('active');
    if (subtitle) subtitle.textContent = 'Digite seus dados para continuar:';
  } else if (mode === 'register') {
    if (formLogin) formLogin.style.display = 'none';
    if (formRegister) formRegister.style.display = 'block';
    if (formReset) formReset.style.display = 'none';
    if (tabRegister) tabRegister.classList.add('active');
    if (subtitle) subtitle.textContent = 'Crie sua conta e teste grátis por 7 dias:';
  } else if (mode === 'reset') {
    if (formLogin) formLogin.style.display = 'none';
    if (formRegister) formRegister.style.display = 'none';
    if (formReset) formReset.style.display = 'block';
    if (tabReset) tabReset.classList.add('active');
    if (subtitle) subtitle.textContent = 'Informe seu e-mail para recuperar a senha:';
  }
};

window.togglePasswordVisibility = function(inputId, buttonEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (buttonEl) buttonEl.textContent = '🙈';
  } else {
    input.type = 'password';
    if (buttonEl) buttonEl.textContent = '👁️';
  }
};

window.handleAuthLogin = async function(event) {
  event.preventDefault();
  const emailInp = document.getElementById('authEmail');
  const passInp = document.getElementById('authPassword');
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (errEl) errEl.textContent = '';
  if (submitBtn) submitBtn.disabled = true;

  try {
    await getAuth().signInWithEmailAndPassword(emailInp.value.trim(), passInp.value);
  } catch (error) {
    if (errEl) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        errEl.textContent = 'E-mail ou senha incorretos.';
      } else if (error.code === 'auth/too-many-requests') {
        errEl.textContent = 'Muitas tentativas sem sucesso. Aguarde alguns instantes.';
      } else {
        errEl.textContent = 'Erro ao entrar: ' + error.message;
      }
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

window.handleAuthRegister = async function(event) {
  event.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const pass = document.getElementById('regPassword').value;
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('regSubmitBtn');

  if (errEl) errEl.textContent = '';
  if (pass.length < 6) {
    if (errEl) errEl.textContent = 'A senha deve conter no mínimo 6 dígitos.';
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  window.isRegisteringAccount = true;

  try {
    const cred = await getAuth().createUserWithEmailAndPassword(email, pass);
    const user = cred.user;

    const today = getTodaySafe();
    const trialExpires = addDaysSafe(today, 7);
    const cleanPhone = phone.replace(/\D/g, '');

    // Se o Master deixou um convite para este e-mail, usa o plano dele em vez do teste grátis
    let invite = null;
    try {
      const invDoc = await getDb().collection("reseller_invites").doc(String(email).trim().toLowerCase()).get();
      if (invDoc.exists) invite = invDoc.data();
    } catch (e) {}

    await getDb().collection("resellers").doc(user.uid).set(invite ? {
      name,
      email,
      phone,
      cleanPhone,
      createdAt: today,
      expiresAt: invite.expiresAt,
      expiresTs: invite.expiresTs || expiresTsSafe(invite.expiresAt),
      lastAccess: today,
      blocked: false,
      activated: true,
      planTier: invite.planTier,
      maxClients: invite.maxClients,
      status: 'active'
    } : {
      name,
      email,
      phone,
      cleanPhone,
      createdAt: today,
      expiresAt: trialExpires,
      expiresTs: expiresTsSafe(trialExpires),
      lastAccess: today,
      blocked: false,
      activated: true,
      planTier: 'starter',
      maxClients: 15,
      status: 'trial'
    });

    await getDb().collection("settings").doc(user.uid).set({
      pixKey: '',
      servers: [{ name: 'Servidor Principal', dns: '', panelUrl: '' }],
      costPerCredit: 0,
      referralGoal: 3,
      referralDiscount: 5,
      referralMessage: ''
    }, { merge: true });

    await bootUser(user);
  } catch (error) {
    if (errEl) {
      if (error.code === 'auth/email-already-in-use') {
        errEl.textContent = 'Este e-mail já está em uso por outra conta.';
      } else {
        errEl.textContent = 'Erro ao criar conta: ' + error.message;
      }
    }
  } finally {
    window.isRegisteringAccount = false;
    if (submitBtn) submitBtn.disabled = false;
  }
};

window.handleAuthReset = async function(event) {
  event.preventDefault();
  const email = document.getElementById('resetEmail').value.trim();
  const succEl = document.getElementById('authSuccess');
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('resetSubmitBtn');

  if (errEl) errEl.textContent = '';
  if (succEl) succEl.textContent = '';
  if (submitBtn) submitBtn.disabled = true;

  try {
    await getAuth().sendPasswordResetEmail(email);
    if (succEl) succEl.textContent = 'Link de redefinição enviado com sucesso para o seu e-mail!';
  } catch (error) {
    if (errEl) errEl.textContent = 'Erro: ' + error.message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

window.handleLogout = async function() {
  if (confirm("Deseja realmente sair da sua conta?")) {
    try {
      await getAuth().signOut();
      window.location.reload();
    } catch (e) {
      console.warn("Erro ao deslogar:", e);
    }
  }
};

async function bootUser(user) {
  if (!user || !user.uid) return;

  window.currentUser = user;
  if (typeof currentUser !== 'undefined') currentUser = user;

  window.activeOwnerId = user.uid;
  if (typeof activeOwnerId !== 'undefined') activeOwnerId = user.uid;

  const isAuthorized = await verifySubscriptionStrict(user);
  if (!isAuthorized) return;

  const loginEl = document.getElementById('loginScreen');
  const subEl = document.getElementById('subscriptionBlockScreen');
  const appEl = document.getElementById('appContainer');

  if (loginEl) loginEl.style.display = 'none';
  if (subEl) subEl.style.display = 'none';
  if (appEl) appEl.style.display = 'block';

  const fabEl = document.getElementById('fabContainer');
  if (fabEl) fabEl.style.display = 'flex';

  setupUserInterfaceHeader(user);

  if (typeof loadUserSettings === 'function') await loadUserSettings(user.uid);
  
  if (typeof window.startFirestoreSync === 'function') {
    window.startFirestoreSync(user.uid);
  } else if (typeof startFirestoreSync === 'function') {
    startFirestoreSync(user.uid);
  }

  if (typeof window.maybeShowWhatsNew === 'function') window.maybeShowWhatsNew();
  if (typeof window.handleLaunchAction === 'function') window.handleLaunchAction();

  if (typeof window.listenCustomApps === 'function') {
    window.listenCustomApps(user.uid);
  } else if (typeof listenCustomApps === 'function') {
    listenCustomApps(user.uid);
  }
}

getAuth().onAuthStateChanged(async (user) => {
  if (window.isRegisteringAccount) return;

  if (user) {
    await bootUser(user);
  } else {
    window.currentUser = null;
    if (typeof currentUser !== 'undefined') currentUser = null;

    window.activeOwnerId = null;
    if (typeof activeOwnerId !== 'undefined') activeOwnerId = null;

    window.currentResellerData = null;
    if (typeof currentResellerData !== 'undefined') currentResellerData = null;

    const loginEl = document.getElementById('loginScreen');
    const appEl = document.getElementById('appContainer');
    const subEl = document.getElementById('subscriptionBlockScreen');

    if (loginEl) loginEl.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
    if (subEl) subEl.style.display = 'none';

    const fabOut = document.getElementById('fabContainer');
    if (fabOut) fabOut.style.display = 'none';
  }
});

// Revalida a licença ao voltar para o app, no máximo a cada 15 minutos (evita uma leitura por cobrança enviada)
let lastSubCheckAt = 0;
const SUB_CHECK_INTERVAL_MS = 15 * 60 * 1000;
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && !window.isRegisteringAccount) {
    if (Date.now() - lastSubCheckAt < SUB_CHECK_INTERVAL_MS) return;
    const user = getAuth().currentUser;
    if (user) {
      await verifySubscriptionStrict(user);
    }
  }
});

async function verifySubscriptionStrict(user) {
  lastSubCheckAt = Date.now();
  const isMaster = user.email && user.email.toLowerCase() === MASTER_EMAIL.toLowerCase();

  if (isMaster) {
    const masterData = { planTier: 'master', maxClients: 9999, name: 'Administrador Master' };
    window.currentResellerData = masterData;
    if (typeof currentResellerData !== 'undefined') currentResellerData = masterData;
    return true;
  }

  try {
    const docRef = getDb().collection("resellers").doc(user.uid);
    let doc = await docRef.get();

    // Conta sem cadastro: NÃO ganha teste grátis novo. Só entra se o Master deixou um convite para este e-mail.
    if (!doc.exists) {
      const emailKey = String(user.email || '').trim().toLowerCase();
      const inv = emailKey ? await getDb().collection("reseller_invites").doc(emailKey).get().catch(() => null) : null;
      if (inv && inv.exists) {
        const p = inv.data() || {};
        await docRef.set({
          name: p.name || emailKey.split('@')[0],
          email: emailKey,
          phone: p.phone || '',
          cleanPhone: p.cleanPhone || '',
          createdAt: getTodaySafe(),
          expiresAt: p.expiresAt,
          expiresTs: p.expiresTs || expiresTsSafe(p.expiresAt),
          lastAccess: getTodaySafe(),
          blocked: false,
          activated: true,
          planTier: p.planTier,
          maxClients: p.maxClients,
          status: 'active'
        });
        doc = await docRef.get();
      } else {
        showSubscriptionBlock("Esta conta não tem cadastro de revendedor ativo. Fale com o suporte para liberar o acesso.");
        return false;
      }
    }

    const data = doc.data();
    window.currentResellerData = data;
    if (typeof currentResellerData !== 'undefined') currentResellerData = data;

    // último acesso: no máximo uma gravação por dia
    const today = getTodaySafe();
    try {
      const k = 'last_access_written_' + user.uid;
      if (localStorage.getItem(k) !== today) {
        localStorage.setItem(k, today);
        docRef.update({ lastAccess: today }).catch(() => {});
      }
    } catch (e) {}

    if (data.blocked === true) {
      showSubscriptionBlock("Sua conta está bloqueada administrativamente.");
      return false;
    }

    if (data.expiresAt && data.expiresAt < today) {
      showSubscriptionBlock(`Seu período de acesso encerrou em ${data.expiresAt.split('-').reverse().join('/')}.`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Falha ao checar autorização:", error);
    // Falha fechada: sem confirmar a licença, não libera o app
    showSubscriptionBlock("Não foi possível confirmar sua assinatura agora. Verifique a internet e tente novamente.");
    return false;
  }
}

async function showSubscriptionBlock(message) {
  const loginEl = document.getElementById('loginScreen');
  const appEl = document.getElementById('appContainer');
  const subEl = document.getElementById('subscriptionBlockScreen');
  const msgEl = document.getElementById('subscriptionBlockMessage');
  const pixDisplay = document.getElementById('paywallPixDisplay');
  const plansContainer = document.getElementById('paywallPlansList');

  if (loginEl) loginEl.style.display = 'none';
  if (appEl) appEl.style.display = 'none';
  if (subEl) subEl.style.display = 'flex';
  if (msgEl) msgEl.textContent = message;

  const fabBlocked = document.getElementById('fabContainer');
  if (fabBlocked) fabBlocked.style.display = 'none';

  const plans = [
    { tier: 'starter', name: 'Iniciante', maxClients: 15, price: 20 },
    { tier: 'pro', name: 'Profissional', maxClients: 50, price: 35 },
    { tier: 'advanced', name: 'Avançado', maxClients: 150, price: 70 },
    { tier: 'master', name: 'Master', maxClients: 500, price: 120 }
  ];

  let masterPix = MASTER_EMAIL;
  try {
    const doc = await getDb().collection("public_config").doc("master").get();
    if (doc.exists && doc.data()) {
      const data = doc.data();
      if (data.pixKey) masterPix = data.pixKey;
      if (data.planPrices) {
        plans.forEach(p => {
          if (data.planPrices[p.tier] !== undefined) p.price = data.planPrices[p.tier];
        });
      }
    }
  } catch (e) {
    console.warn("Fallback para dados Master padrão:", e);
  }

  if (pixDisplay) pixDisplay.textContent = masterPix;

  const currentTier = (window.currentResellerData && window.currentResellerData.planTier) 
    ? window.currentResellerData.planTier 
    : 'starter';

  if (plansContainer) {
    plansContainer.innerHTML = '';
    plans.forEach(p => {
      const isCurrent = p.tier === currentTier;
      const card = document.createElement('div');
      card.className = `paywall-plan-item ${isCurrent ? 'selected' : ''}`;
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="font-size: 0.82rem; color: #0f172a; display: block;">${p.name}</strong>
            <small style="font-size: 0.7rem; color: #64748b;">Até ${p.maxClients} clientes</small>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 0.9rem; font-weight: 800; color: #2563eb;">R$ ${p.price.toFixed(2).replace('.', ',')}</span>
            <small style="font-size: 0.65rem; color: #94a3b8; display: block;">/mês</small>
          </div>
        </div>
        ${isCurrent ? '<span class="badge" style="background:#dbeafe; color:#1d4ed8; font-size:0.62rem; margin-top:4px;">Seu Plano Anterior</span>' : ''}
      `;
      plansContainer.appendChild(card);
    });
  }

  const waBtn = document.getElementById('paywallWhatsAppBtn');
  if (waBtn) {
    waBtn.onclick = () => {
      const u = getAuth().currentUser;
      const uEmail = u ? u.email : "meu acesso";
      const userPlan = plans.find(p => p.tier === currentTier) || plans[0];
      const text = `Olá! Meu acesso expirou e gostaria de renovar minha licença do Gestão de Clientes Pro (${uEmail}).\n\nPlano: *${userPlan.name}* (R$ ${userPlan.price.toFixed(2).replace('.', ',')}/mês - até ${userPlan.maxClients} clientes).\n\nSegue comprovante de pagamento.`;
      
      if (typeof openWhatsAppDirect === 'function') {
        openWhatsAppDirect(MASTER_PHONE, text);
      } else {
        window.open(`https://api.whatsapp.com/send?phone=${MASTER_PHONE}&text=${encodeURIComponent(text)}`, '_blank');
      }
    };
  }
}

function setupUserInterfaceHeader(user) {
  const isMaster = user.email && user.email.toLowerCase() === MASTER_EMAIL.toLowerCase();

  const masterTopBarEl = document.getElementById('masterTopBar');
  if (masterTopBarEl) {
    masterTopBarEl.style.display = isMaster ? 'flex' : 'none';
  }

  const userBadgeEl = document.getElementById('userBadge');
  if (userBadgeEl) {
    userBadgeEl.innerHTML = '';

    const userSpan = document.createElement('span');
    userSpan.style.cssText = 'font-size: 0.74rem; color: #475569; font-weight: 600;';
    userSpan.textContent = user.email;

    const roleBadge = document.createElement('span');
    roleBadge.className = 'badge';
    roleBadge.style.cssText = isMaster 
      ? 'background: #1e3a8a; color: #fff; font-size: 0.65rem; margin-left: 4px;' 
      : 'background: #e2e8f0; color: #334155; font-size: 0.65rem; margin-left: 4px;';
    roleBadge.textContent = isMaster ? 'MASTER' : 'REVENDEDOR';

    userBadgeEl.appendChild(userSpan);
    userBadgeEl.appendChild(roleBadge);
  }

  const rData = window.currentResellerData || (typeof currentResellerData !== 'undefined' ? currentResellerData : null);
  const resellerTrialBadgeEl = document.getElementById('resellerTrialBadge');

  if (resellerTrialBadgeEl && rData) {
    if (isMaster) {
      resellerTrialBadgeEl.style.display = 'none';
    } else {
      const expDate = rData.expiresAt || '';
      const expFmt = expDate ? expDate.split('-').reverse().join('/') : 'Indeterminado';
      resellerTrialBadgeEl.style.display = 'block';
      resellerTrialBadgeEl.textContent = `⏳ Licença válida até: ${expFmt}`;
    }
  }

  const planNameEl = document.getElementById('settingsCurrentPlanName');
  if (planNameEl && rData) {
    const tierMap = {
      starter: 'Iniciante (15 clientes)',
      trial: 'Iniciante (15 clientes)',
      pro: 'Profissional (50 clientes)',
      advanced: 'Avançado (150 clientes)',
      elite: 'Avançado (150 clientes)',
      master: 'Master (500 clientes)'
    };
    planNameEl.textContent = tierMap[rData.planTier] || rData.planTier || 'Iniciante (15 clientes)';
  }

  if (isMaster && typeof loadMasterPlatformSettings === 'function') {
    loadMasterPlatformSettings();
  }
}