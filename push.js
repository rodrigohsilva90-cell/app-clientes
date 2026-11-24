// ============================================================
// NOTIFICAÇÕES NO CELULAR (Ajustes → 🔔 Notificações)
// O aparelho se inscreve no serviço de push do navegador e a inscrição fica em
// settings/{uid}.pushSubs. Quem envia é o Worker do portal (gestaopro-portal):
// resumo do dia às 8h e aviso quando um cliente pede ajuda no portal.
// Não funciona dentro de APK "embrulhado" (AppsGeyser etc.): o app precisa ser
// instalado pelo Chrome (Adicionar à tela inicial).
// ============================================================
(function () {
  // Chave PÚBLICA das notificações (a privada fica só no Worker, como secret VAPID_PRIVATE_JWK)
  var PUSH_PUBLIC_KEY = 'BNhTxGEihcK7mxmkhb-djZaVZyLpxmOBl2REI_ogyCZRZEHQTm5xNQnNf9jr_2TT56BuvnTCrMCjtqlMAXzsaCU';
  var PUSH_API = String(window.PORTAL_API_URL || 'https://gestaopro-portal.rodrigo-h-silva90.workers.dev').replace(/\/+$/, '');
  var LS_KEY = 'push_sub_id';

  function $(id) { return document.getElementById(id); }
  function setStatus(txt, cor) {
    var s = $('pushStatus');
    if (s) { s.textContent = txt; s.style.color = cor || 'var(--text-muted)'; }
  }
  function lsGet() { try { return localStorage.getItem(LS_KEY) || ''; } catch (e) { return ''; } }
  function lsSet(v) { try { if (v) localStorage.setItem(LS_KEY, v); else localStorage.removeItem(LS_KEY); } catch (e) {} }

  function keyBytes(b64u) {
    var t = b64u.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function subId(endpoint) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return 's' + Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 24);
  }
  function uid() {
    var u = (typeof auth !== 'undefined' && auth.currentUser) || (window.firebase && firebase.auth().currentUser);
    return u ? u.uid : '';
  }
  function settingsRef() {
    var d = (typeof db !== 'undefined') ? db : firebase.firestore();
    return d.collection('settings').doc(uid());
  }
  function aparelho() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac/.test(ua)) return 'Mac';
    return 'Navegador';
  }

  // O que impede a notificação neste aparelho (null = pode)
  function motivoSemSuporte() {
    var ua = navigator.userAgent || '';
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (/iPhone|iPad/.test(ua) && !standalone) {
      return 'No iPhone, abra o site no Safari, toque em Compartilhar → "Adicionar à Tela de Início", abra o app por esse ícone e volte aqui.';
    }
    if (/; wv\)|AppsGeyser/i.test(ua) || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return 'Este app (APK) não aceita notificações. Abra o site no Chrome do celular, toque em ⋮ → "Instalar app" (ou "Adicionar à tela inicial"), abra o app por esse ícone e volte aqui.';
    }
    return null;
  }

  async function inscricaoAtual() {
    var reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  function mostrar(ativo) {
    var on = $('pushBtnOn'), off = $('pushBtnOff'), test = $('pushBtnTest'), prefs = $('pushPrefs');
    if (on) on.style.display = ativo ? 'none' : 'block';
    if (off) off.style.display = ativo ? 'block' : 'none';
    if (test) test.style.display = ativo ? 'block' : 'none';
    if (prefs) prefs.style.display = ativo ? 'block' : 'none';
  }

  async function carregar() {
    var card = $('pushCard');
    if (!card || !uid()) return;
    var motivo = motivoSemSuporte();
    if (motivo) { mostrar(false); $('pushBtnOn').style.display = 'none'; setStatus(motivo, '#b45309'); return; }
    try {
      var snap = await settingsRef().get();
      var s = (snap.exists && snap.data()) || {};
      $('pushDaily').checked = s.pushDaily !== false;
      $('pushHelp').checked = s.pushHelp !== false;
      var sub = await inscricaoAtual();
      var id = sub ? await subId(sub.endpoint) : '';
      var salvo = Boolean(id && s.pushSubs && s.pushSubs[id]);
      if (sub && !salvo && Notification.permission === 'granted') { await salvar(sub); salvo = true; } // inscrição renovada pelo navegador
      mostrar(salvo);
      if (Notification.permission === 'denied') setStatus('As notificações estão bloqueadas para este site. Libere nas configurações do navegador (cadeado ao lado do endereço → Notificações).', '#b91c1c');
      else setStatus(salvo ? 'Ativadas neste aparelho.' : 'Desativadas neste aparelho.', salvo ? '#15803d' : undefined);
    } catch (e) {
      console.warn('push carregar', e);
      setStatus('Não consegui verificar as notificações agora.');
    }
  }

  async function salvar(sub) {
    var j = sub.toJSON();
    var id = await subId(j.endpoint);
    var entrada = {};
    entrada[id] = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: aparelho(), at: Date.now() };
    await settingsRef().set({
      pushEnabled: true,
      pushDaily: $('pushDaily').checked,
      pushHelp: $('pushHelp').checked,
      pushSubs: entrada
    }, { merge: true });
    lsSet(id);
    return j;
  }

  async function testar(j) {
    var res = await fetch(PUSH_API + '/?acao=push-teste', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } })
    });
    var b = await res.json().catch(function () { return {}; });
    if (!b.ok) throw new Error(b.error || ('http ' + res.status));
  }

  window.enablePushNotifications = async function () {
    var motivo = motivoSemSuporte();
    if (motivo) { setStatus(motivo, '#b45309'); return; }
    setStatus('Ativando…');
    try {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { setStatus('Você não permitiu as notificações. Toque em "Ativar" de novo e escolha "Permitir".', '#b91c1c'); return; }
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH_PUBLIC_KEY) });
      var j = await salvar(sub);
      mostrar(true);
      setStatus('Ativadas! Enviando uma notificação de teste…', '#15803d');
      try { await testar(j); setStatus('Ativadas neste aparelho. A notificação de teste deve chegar em instantes.', '#15803d'); }
      catch (e) { setStatus('Ativadas, mas o teste falhou (' + e.message + '). Tente "Enviar teste" daqui a pouco.', '#b45309'); }
    } catch (e) {
      console.warn('push ativar', e);
      setStatus('Não foi possível ativar: ' + (e && e.message ? e.message : e), '#b91c1c');
    }
  };

  window.disablePushNotifications = async function () {
    setStatus('Desativando…');
    try {
      var sub = await inscricaoAtual();
      var id = sub ? await subId(sub.endpoint) : lsGet();
      if (sub) await sub.unsubscribe();
      if (id) {
        var upd = {};
        upd['pushSubs.' + id] = firebase.firestore.FieldValue.delete();
        await settingsRef().update(upd).catch(function () {});
      }
      lsSet('');
      mostrar(false);
      setStatus('Desativadas neste aparelho.');
    } catch (e) {
      setStatus('Não foi possível desativar: ' + (e && e.message ? e.message : e), '#b91c1c');
    }
  };

  window.sendTestPush = async function () {
    setStatus('Enviando teste…');
    try {
      var sub = await inscricaoAtual();
      if (!sub) { mostrar(false); setStatus('Este aparelho não está inscrito. Toque em "Ativar".'); return; }
      await testar(sub.toJSON());
      setStatus('Teste enviado. Deve chegar em instantes.', '#15803d');
    } catch (e) {
      setStatus('O teste falhou (' + (e && e.message ? e.message : e) + ').', '#b91c1c');
    }
  };

  window.savePushPrefs = async function () {
    try {
      await settingsRef().set({ pushDaily: $('pushDaily').checked, pushHelp: $('pushHelp').checked }, { merge: true });
      setStatus('Preferências salvas.', '#15803d');
    } catch (e) { setStatus('Não consegui salvar as preferências.', '#b91c1c'); }
  };

  // ---------- Toque na notificação "cobranças para enviar" → abre a fila "Cobrar em sequência" ----------
  // Chega de dois jeitos: o app abre com ?acao=cobrar, ou já estava aberto e o service worker avisa.
  var cobrarPendente = false;
  function pedirFila() { cobrarPendente = true; tentarFila(Date.now()); }
  function tentarFila(desde) {
    if (!cobrarPendente) return;
    var u = (typeof auth !== 'undefined' && auth.currentUser) || null;
    var lista = null;
    try { lista = clients; } catch (e) {}
    var pronto = u && window.activeOwnerId === u.uid && Array.isArray(lista) && (lista.length > 0 || Date.now() - desde > 8000);
    if (!pronto) {
      if (Date.now() - desde < 30000) setTimeout(function () { tentarFila(desde); }, 500);
      return;
    }
    cobrarPendente = false;
    if (document.querySelector('.modal-backdrop[style*="display:flex"], .modal-backdrop[style*="display: flex"]')) {
      // já tem uma janela aberta: não empilha outra por cima
      if (typeof showToast === 'function') showToast('Feche a janela aberta e toque em "Cobrar em sequência".');
      return;
    }
    if (typeof window.startDailyQueueBilling === 'function') window.startDailyQueueBilling();
  }
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('acao') === 'cobrar') {
      qs.delete('acao');
      history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '') + location.hash);
      pedirFila();
    }
  } catch (e) {}
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.tipo === 'notificacao' && /[?&]acao=cobrar\b/.test(String(d.url || ''))) pedirFila();
    });
  }

  // Carrega quando o usuário entra (e de novo ao abrir Ajustes)
  function iniciar() {
    try {
      var a = (typeof auth !== 'undefined') ? auth : firebase.auth();
      a.onAuthStateChanged(function (u) { if (u) carregar(); });
    } catch (e) {}
    var btn = $('tabNavSettings');
    if (btn) btn.addEventListener('click', function () { setTimeout(carregar, 50); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
