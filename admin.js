// ============================================================
// ADMIN.JS - GESTÃO MASTER, REVENDEDORES & SEGURANÇA
// ============================================================

let currentMasterResellers = [];
let unsubscribeResellersGlobal = null;
let unsubscribeFeedbacksGlobal = null;

const PLAN_DEFINITIONS = {
  // preços padrão iguais aos da tela de bloqueio (auth.js) e do painel Master; o valor real vem de public_config
  starter: { name: 'Iniciante', maxClients: 15, price: 20 },
  trial: { name: 'Iniciante', maxClients: 15, price: 20 },
  pro: { name: 'Profissional', maxClients: 50, price: 35 },
  advanced: { name: 'Avançado', maxClients: 150, price: 70 },
  elite: { name: 'Avançado', maxClients: 150, price: 70 },
  master: { name: 'Master', maxClients: 500, price: 120 }
};

window.toggleMasterResellersPanel = function() {
  const panel = document.getElementById('viewResellersSection');
  if (!panel) return;

  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  if (isHidden) {
    panel.style.display = 'block';
    listenAllResellersGlobal();
    if (typeof loadMasterPlatformSettings === 'function') {
      loadMasterPlatformSettings();
    }
    panel.scrollIntoView({ behavior: 'smooth' });
  } else {
    panel.style.display = 'none';
    if (unsubscribeResellersGlobal) { unsubscribeResellersGlobal(); unsubscribeResellersGlobal = null; }
  }
};

window.toggleMasterFeedbacksPanel = function() {
  const panel = document.getElementById('viewFeedbacksSection');
  if (!panel) return;

  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  if (isHidden) {
    panel.style.display = 'block';
    listenAllFeedbacksGlobal();
    panel.scrollIntoView({ behavior: 'smooth' });
  } else {
    panel.style.display = 'none';
    if (unsubscribeFeedbacksGlobal) { unsubscribeFeedbacksGlobal(); unsubscribeFeedbacksGlobal = null; }
  }
};

function listenAllResellersGlobal() {
  if (unsubscribeResellersGlobal) return;

  const container = document.getElementById('resellerCardsContainer');
  if (container) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:10px 0;">Sincronizando revendedores...</p>';
  }

  unsubscribeResellersGlobal = db.collection("resellers")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      currentMasterResellers = [];
      snapshot.forEach(doc => {
        currentMasterResellers.push({ id: doc.id, ...doc.data() });
      });
      renderMasterResellersList();
    }, (err) => {
      console.error("Erro ao carregar revendedores:", err);
      if (container) {
        container.innerHTML = `<p style="text-align:center; color:#dc2626; font-size:0.8rem;">Erro de permissão: ${err.message}</p>`;
      }
    });
}

function renderMasterResellersList() {
  const container = document.getElementById('resellerCardsContainer');
  if (!container) return;
  container.innerHTML = '';

  if (currentMasterResellers.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:10px 0;">Nenhum revendedor cadastrado.</p>';
    return;
  }

  currentMasterResellers.forEach(reseller => {
    const card = document.createElement('div');
    card.className = 'card reseller-card';
    card.style.cssText = 'background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 8px;';

    const tierKey = reseller.planTier || 'starter';
    const tierInfo = PLAN_DEFINITIONS[tierKey] || { name: tierKey, maxClients: reseller.maxClients || 15 };
    const isBlocked = Boolean(reseller.blocked);
    const expiresText = reseller.expiresAt ? reseller.expiresAt.split('-').reverse().join('/') : 'Sem data';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div style="flex: 1; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <strong class="r-name" style="font-size: 0.9rem; color: var(--text-main);"></strong>
            <span class="badge r-tier-badge" style="background: #e0f2fe; color: #0369a1; font-size: 0.68rem; padding: 1px 6px;"></span>
            ${isBlocked ? '<span class="badge" style="background:#fee2e2; color:#dc2626; font-size:0.68rem; padding:1px 6px;">BLOQUEADO</span>' : ''}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
            <span class="r-email"></span> • <span class="r-phone"></span>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">
            Expira em: <strong class="r-expires"></strong> | Último acesso: <span class="r-last-access"></span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; flex-shrink: 0;">
          <button type="button" class="btn-tool btn-act-impersonate" style="background: #2563eb; font-size: 0.72rem; padding: 4px 8px;">👀 Acessar</button>
          <button type="button" class="btn-tool btn-act-plan" style="background: #0284c7; font-size: 0.72rem; padding: 4px 8px;">🏷️ Plano</button>
          <button type="button" class="btn-tool btn-act-toggle-block" style="background: ${isBlocked ? '#16a34a' : '#ea580c'}; font-size: 0.72rem; padding: 4px 8px;">
            ${isBlocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
          </button>
          <button type="button" class="btn-cancel btn-act-delete-reseller" style="font-size: 0.7rem; padding: 4px 8px;">✕ Excluir</button>
        </div>
      </div>
    `;

    card.querySelector('.r-name').textContent = reseller.name || 'Sem Nome';
    card.querySelector('.r-tier-badge').textContent = `${tierInfo.name} (${tierInfo.maxClients} clientes)`;
    card.querySelector('.r-email').textContent = reseller.email || '';
    card.querySelector('.r-phone').textContent = reseller.phone || 'Sem telefone';
    card.querySelector('.r-expires').textContent = expiresText;
    card.querySelector('.r-last-access').textContent = reseller.lastAccess || 'Nunca';

    card.querySelector('.btn-act-impersonate').addEventListener('click', () => {
      impersonateReseller(reseller.id, reseller.email);
    });

    card.querySelector('.btn-act-plan').addEventListener('click', () => {
      openPlanModal(reseller.id, reseller.name, tierKey);
    });

    card.querySelector('.btn-act-toggle-block').addEventListener('click', () => {
      toggleBlockReseller(reseller.id, !isBlocked);
    });

    card.querySelector('.btn-act-delete-reseller').addEventListener('click', () => {
      deleteResellerAccount(reseller.id, reseller.name);
    });

    container.appendChild(card);
  });
}

// Master vendo a conta de um revendedor: começa só leitura; edição só depois de habilitar de propósito
window.impersonateReadOnly = false;
window.toggleImpersonateEdit = function() {
  window.impersonateReadOnly = !window.impersonateReadOnly;
  const b = document.getElementById('btnToggleImpEdit');
  if (b) b.textContent = window.impersonateReadOnly ? '🔒 Somente leitura • Habilitar edição' : '✏️ Edição liberada • Voltar a só leitura';
};
(function () {
  const WRITE_SEL = '.btn-renew-quick, .btn-delete-quick, .btn-toggle-archive, .btn-toggle-block, .btn-support-register, .btn-apply-discount, .btn-reward-month, .btn-reactivate-client, .btn-wa-charge-confirm, #saveBtn, #btnSaveCustomApp';
  const guard = (ev) => {
    if (!window.impersonateReadOnly || !window.currentUser || window.activeOwnerId === window.currentUser.uid) return;
    const t = ev.target && ev.target.closest && ev.target.closest(WRITE_SEL + ', #clientForm');
    if (!t) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    alert('Você está vendo a conta do revendedor em modo somente leitura. Toque em "Habilitar edição" na barra azul para alterar.');
  };
  document.addEventListener('click', guard, true);
  document.addEventListener('submit', guard, true);
})();

window.impersonateReseller = function(resellerId, resellerEmail) {
  if (!resellerId) return;
  window.impersonateReadOnly = true;
  const impBtn = document.getElementById('btnToggleImpEdit');
  if (impBtn) impBtn.textContent = '🔒 Somente leitura • Habilitar edição';

  activeOwnerId = resellerId;

  const banner = document.getElementById('impersonationBanner');
  const targetEmailEl = document.getElementById('impersonatedEmail');
  const masterPanel = document.getElementById('viewResellersSection');

  if (masterPanel) masterPanel.style.display = 'none';
  if (unsubscribeResellersGlobal) { unsubscribeResellersGlobal(); unsubscribeResellersGlobal = null; }
  if (banner) banner.style.display = 'flex';
  if (targetEmailEl) targetEmailEl.textContent = resellerEmail || resellerId;

  if (typeof loadUserSettings === 'function') loadUserSettings(resellerId);
  if (typeof startFirestoreSync === 'function') startFirestoreSync(resellerId);
  if (typeof listenCustomApps === 'function') listenCustomApps(resellerId);

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.exitResellerView = function() {
  if (!currentUser) return;

  activeOwnerId = currentUser.uid;

  const banner = document.getElementById('impersonationBanner');
  if (banner) banner.style.display = 'none';

  if (typeof loadUserSettings === 'function') loadUserSettings(currentUser.uid);
  if (typeof startFirestoreSync === 'function') startFirestoreSync(currentUser.uid);
  if (typeof listenCustomApps === 'function') listenCustomApps(currentUser.uid);

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.openPlanModal = function(resellerId, resellerName, currentTier) {
  const modal = document.getElementById('planModal');
  const nameEl = document.getElementById('planModalResellerName');
  const idInp = document.getElementById('planModalResellerId');
  const tierSelect = document.getElementById('planSelectTier');

  if (!modal) return;

  if (nameEl) nameEl.textContent = `Revendedor: ${resellerName || resellerId}`;
  if (idInp) idInp.value = resellerId;
  if (tierSelect && currentTier) tierSelect.value = currentTier === 'elite' ? 'advanced' : currentTier;

  modal.style.display = 'flex';
};

window.closePlanModal = function() {
  const modal = document.getElementById('planModal');
  if (modal) modal.style.display = 'none';
};

window.submitPlanChange = async function() {
  const idInp = document.getElementById('planModalResellerId');
  const tierSelect = document.getElementById('planSelectTier');
  const daysInp = document.getElementById('planDaysToAdd');

  if (!idInp || !idInp.value || !tierSelect) return;

  const resellerId = idInp.value;
  const newTier = tierSelect.value;
  const daysToAdd = parseInt(daysInp ? daysInp.value : '0', 10) || 0;
  const tierConfig = PLAN_DEFINITIONS[newTier] || PLAN_DEFINITIONS.starter;

  try {
    const resellerDoc = await db.collection("resellers").doc(resellerId).get();
    if (!resellerDoc.exists) return alert("Revendedor não localizado.");

    const data = resellerDoc.data();
    const today = getTodayLocal();
    let baseDate = data.expiresAt && data.expiresAt > today ? data.expiresAt : today;
    let nextExpires = daysToAdd > 0 ? addDaysToDate(baseDate, daysToAdd) : baseDate;

    await db.collection("resellers").doc(resellerId).update({
      planTier: newTier,
      maxClients: tierConfig.maxClients,
      expiresAt: nextExpires,
      expiresTs: (typeof expiresTsSafe === 'function') ? expiresTsSafe(nextExpires) : null
    });

    alert(`✅ Plano atualizado para ${tierConfig.name} (${tierConfig.maxClients} clientes) com sucesso!\nNovo vencimento: ${nextExpires.split('-').reverse().join('/')}`);
    closePlanModal();
  } catch (err) {
    alert("Erro ao atualizar plano: " + err.message);
  }
};

async function toggleBlockReseller(resellerId, shouldBlock) {
  const actionText = shouldBlock ? 'BLOQUEAR' : 'DESBLOQUEAR';
  if (!confirm(`Deseja realmente ${actionText} o acesso deste revendedor?`)) return;

  try {
    await db.collection("resellers").doc(resellerId).update({
      blocked: shouldBlock
    });
    alert(`Revendedor ${shouldBlock ? 'bloqueado' : 'desbloqueado'} com sucesso!`);
  } catch (err) {
    alert("Erro ao alterar bloqueio: " + err.message);
  }
}

async function deleteResellerAccount(resellerId, resellerName) {
  const promptConfirm = prompt(`ATENÇÃO: Ação irreversível!\n\nIsso excluirá a conta e todos os clientes de "${resellerName}".\n\nPara confirmar, digite EXCLUIR abaixo:`);
  if (promptConfirm !== 'EXCLUIR') return;

  // apaga em lotes de 400 (o Firestore aceita até 500 operações por lote)
  const deleteInChunks = async (docs) => {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  };

  try {
    const resellerDoc = await db.collection("resellers").doc(resellerId).get().catch(() => null);
    const resellerEmail = resellerDoc && resellerDoc.exists ? String((resellerDoc.data() || {}).email || '').trim().toLowerCase() : '';

    const clientsSnap = await db.collection("clients").where("ownerId", "==", resellerId).get();
    await deleteInChunks(clientsSnap.docs);

    const appsSnap = await db.collection("custom_apps").where("ownerId", "==", resellerId).get();
    await deleteInChunks(appsSnap.docs);

    // Antes ficavam sobrando: links do portal, histórico de servidores e o convite
    const tokensSnap = await db.collection("portal_tokens").where("ownerId", "==", resellerId).get().catch(() => null);
    if (tokensSnap) await deleteInChunks(tokensSnap.docs);
    const logSnap = await db.collection("settings").doc(resellerId).collection("server_log").get().catch(() => null);
    if (logSnap) await deleteInChunks(logSnap.docs);
    if (resellerEmail) await db.collection("reseller_invites").doc(resellerEmail).delete().catch(() => {});

    await db.collection("settings").doc(resellerId).delete().catch(() => {});
    await db.collection("resellers").doc(resellerId).delete();

    alert(`✅ O revendedor ${resellerName} e seus clientes foram excluídos com sucesso.\n\nA conta de login dele continua existindo: para apagar de vez, vá no console do Firebase → Authentication e exclua o e-mail ${resellerEmail || '(do revendedor)'}. Sem o cadastro, ela não consegue mais entrar no app.`);
  } catch (err) {
    alert("Erro ao excluir revendedor: " + err.message);
  }
}

window.handleCreateResellerManual = async function(event) {
  event.preventDefault();

  const name = document.getElementById('manualResellerName').value.trim();
  const email = document.getElementById('manualResellerEmail').value.trim().toLowerCase();
  const phone = document.getElementById('manualResellerPhone').value.trim();
  const tier = document.getElementById('manualResellerTier').value;

  if (!name || !email || !phone) return;

  const tierConfig = PLAN_DEFINITIONS[tier] || PLAN_DEFINITIONS.starter;
  const today = getTodayLocal();
  const expiresAt = addDaysToDate(today, 30);

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    // Convite: quando este e-mail entrar (ou criar conta), o plano abaixo é aplicado no primeiro login
    await db.collection("reseller_invites").doc(email).set({
      name,
      email,
      phone,
      cleanPhone,
      planTier: tier,
      maxClients: tierConfig.maxClients,
      createdAt: today,
      expiresAt: expiresAt,
      expiresTs: (typeof expiresTsSafe === 'function') ? expiresTsSafe(expiresAt) : null
    });

    alert(`✅ Convite criado para ${email}!\nPlano: ${tierConfig.name} (${tierConfig.maxClients} clientes - até ${expiresAt.split('-').reverse().join('/')})\nO plano é aplicado quando essa pessoa entrar com este e-mail. Se ela já tem conta, use o botão de plano na lista.`);
    document.getElementById('newResellerManualForm').reset();
  } catch (err) {
    alert("Erro ao cadastrar revendedor: " + err.message);
  }
};

function listenAllFeedbacksGlobal() {
  if (unsubscribeFeedbacksGlobal) return;

  const container = document.getElementById('feedbackListContainer');
  const badge = document.getElementById('feedbackCounterBadge');

  unsubscribeFeedbacksGlobal = db.collection("feedback")
    .orderBy("createdAt", "desc")
    .limit(50)
    .onSnapshot((snapshot) => {
      if (badge) badge.textContent = snapshot.size;
      if (!container) return;

      container.innerHTML = '';
      if (snapshot.empty) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:10px 0;">Nenhuma mensagem de feedback recebida.</p>';
        return;
      }

      snapshot.forEach(doc => {
        const fb = doc.data();
        const item = document.createElement('div');
        item.style.cssText = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;';

        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong class="fb-user" style="font-size:0.8rem; color:var(--text-main);"></strong>
            <span class="badge" style="background:var(--surface-alt); color:var(--text-muted); font-size:0.68rem;">${esc(fb.type || 'sugestão')}</span>
          </div>
          <p class="fb-msg" style="font-size:0.78rem; color:var(--text-main); margin:0 0 4px 0; word-break:break-word;"></p>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <small style="color:var(--text-muted); font-size:0.7rem;">${esc(fb.createdAt || '')}</small>
            <button type="button" class="btn-cancel btn-del-feedback" style="font-size:0.65rem; padding:2px 6px;">✕ Excluir</button>
          </div>
        `;

        item.querySelector('.fb-user').textContent = fb.resellerEmail || fb.userEmail || fb.resellerName || 'Usuário anônimo';
        item.querySelector('.fb-msg').textContent = fb.message || '';

        item.querySelector('.btn-del-feedback').addEventListener('click', async () => {
          if (confirm("Excluir esta mensagem de feedback?")) {
            await db.collection("feedback").doc(doc.id).delete().catch(() => {});
          }
        });

        container.appendChild(item);
      });
    }, (err) => {
      console.warn("Erro ao ouvir feedbacks:", err);
    });
}

window.copyMasterPixKey = async function(buttonEl) {
  let keyToCopy = MASTER_ADMIN_EMAIL;
  try {
    const doc = await db.collection("public_config").doc("master").get();
    if (doc.exists && doc.data() && doc.data().pixKey) {
      keyToCopy = doc.data().pixKey;
    }
  } catch (e) {}

  copyTextSafe(keyToCopy, buttonEl, "Chave Pix Copiada! ✓");
};

window.contactMasterUpgrade = function() {
  const userIdentifier = currentUser ? (currentUser.email || currentUser.uid) : "meu painel";
  const msg = `Olá! Gostaria de solicitar um upgrade de plano/cota para o meu acesso (${userIdentifier}) no Gestão de Clientes Pro.`;
  openWhatsAppDirect(MASTER_ADMIN_PHONE, msg);
};

window.loadMasterPlatformSettings = async function() {
  const pixInput = document.getElementById('masterPlatformPixInput');
  const starterInp = document.getElementById('pricePlanStarter');
  const proInp = document.getElementById('pricePlanPro');
  const advInp = document.getElementById('pricePlanAdvanced');
  const masterInp = document.getElementById('pricePlanMaster');

  try {
    const doc = await db.collection("public_config").doc("master").get();
    if (doc.exists) {
      const data = doc.data() || {};
      if (pixInput && data.pixKey) pixInput.value = data.pixKey;

      const prices = data.planPrices || {};
      if (starterInp) starterInp.value = prices.starter !== undefined ? prices.starter : 20;
      if (proInp) proInp.value = prices.pro !== undefined ? prices.pro : 35;
      if (advInp) advInp.value = prices.advanced !== undefined ? prices.advanced : 70;
      if (masterInp) masterInp.value = prices.master !== undefined ? prices.master : 120;
    } else {
      if (starterInp) starterInp.value = 20;
      if (proInp) proInp.value = 35;
      if (advInp) advInp.value = 70;
      if (masterInp) masterInp.value = 120;
    }
  } catch (err) {
    console.warn("Erro ao buscar configurações Master:", err);
  }
};

window.saveMasterPlatformSettings = async function() {
  const pixInput = document.getElementById('masterPlatformPixInput');
  const starterInp = document.getElementById('pricePlanStarter');
  const proInp = document.getElementById('pricePlanPro');
  const advInp = document.getElementById('pricePlanAdvanced');
  const masterInp = document.getElementById('pricePlanMaster');

  const pixKey = pixInput ? pixInput.value.trim() : '';
  if (!pixKey) {
    alert("Informe uma chave Pix válida.");
    return;
  }

  const planPrices = {
    starter: parseFloat(starterInp.value) || 20,
    pro: parseFloat(proInp.value) || 35,
    advanced: parseFloat(advInp.value) || 70,
    master: parseFloat(masterInp.value) || 120
  };

  try {
    await db.collection("public_config").doc("master").set({
      pixKey,
      planPrices,
      updatedAt: getTodayLocal(),
      updatedBy: currentUser ? currentUser.email : "master"
    }, { merge: true });

    alert("✅ Configurações salvas com sucesso!\nA chave Pix e a tabela de preços foram atualizadas para todos os revendedores.");
  } catch (err) {
    alert("Erro ao salvar configurações da plataforma: " + err.message);
  }
};