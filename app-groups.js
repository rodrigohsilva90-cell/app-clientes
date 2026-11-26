// ============================================================
// CLIENTES POR APLICATIVO (menu rápido → 📺, e no Relatório de suportes)
// - Agrupa os clientes ativos pelo aplicativo cadastrado. O campo é texto livre, então
//   "Quick Player Pro", "quick player pro" e "QuickPlayer Pro" viram o mesmo grupo.
// - Mostra quantos suportes cada app gerou em 90 dias e marca os que estão acima da média.
// - Escolha um app → selecione os clientes → mande uma mensagem ("está tudo bem?") em
//   sequência pelo WhatsApp, um toque por cliente. Quem já recebeu hoje é pulado
//   (campo lastAppCheckAt no cliente).
// ============================================================
(function () {
  'use strict';

  const MSG_KEY = 'app_check_msg_v1';
  const DEFAULT_MSG = 'Olá, {nome}! Tudo bem? 😊\nEstou passando para saber se o {app} está funcionando direitinho por aí. Se notar travamento, lentidão ou qualquer coisa estranha, é só me chamar aqui que eu resolvo.';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayNum = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
  const todayNum = () => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
  const todayStr = () => (typeof safeGetTodayLocal === 'function' ? safeGetTodayLocal() : new Date().toISOString().slice(0, 10));
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => String(round2(n)).replace('.', ',');

  // "Quick Player Pro" / "quickplayer pro" / "Quick-Player PRO" → "quickplayerpro"
  function normApp(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function allClients() { try { return Array.isArray(clients) ? clients : []; } catch (e) { return []; } }
  function phoneOk(c) { return String(c.phone || '').replace(/\D/g, '').length >= 8; }
  function supportsIn(c, dias) {
    const desde = todayNum() - dias;
    return (Array.isArray(c.supportHistory) ? c.supportHistory : []).filter(h => { const d = dayNum(h && h.date); return d != null && d >= desde; });
  }

  function grupos() {
    const map = new Map();
    allClients().forEach(c => {
      if (!c || c.isArchived || c.isTrial || c.isDeleted) return;
      const key = normApp(c.macApp) || '_sem';
      const g = map.get(key) || { key, nomes: new Map(), clientes: [], sup90: 0, sup30: 0, abertos: 0 };
      const nome = String(c.macApp || '').trim();
      if (nome) g.nomes.set(nome, (g.nomes.get(nome) || 0) + 1);
      g.clientes.push(c);
      g.sup90 += supportsIn(c, 90).length;
      g.sup30 += supportsIn(c, 30).length;
      if (c.supportOpenAt) g.abertos++;
      map.set(key, g);
    });
    const lista = [...map.values()].map(g => {
      // nome exibido = a grafia mais usada
      const nome = g.key === '_sem' ? 'Sem aplicativo cadastrado' : [...g.nomes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { key: g.key, nome, clientes: g.clientes, total: g.clientes.length, sup90: g.sup90, sup30: g.sup30, abertos: g.abertos, porCliente: g.clientes.length ? g.sup90 / g.clientes.length : 0 };
    });
    const totCli = lista.reduce((n, g) => n + g.total, 0);
    const totSup = lista.reduce((n, g) => n + g.sup90, 0);
    const media = totCli ? totSup / totCli : 0;
    lista.forEach(g => { g.alerta = g.key !== '_sem' && g.sup90 >= 3 && media > 0 && g.porCliente >= media * 1.5; });
    lista.sort((a, b) => (b.alerta - a.alerta) || (b.sup90 - a.sup90) || (b.total - a.total));
    return { lista, media };
  }

  // ---------- Tela ----------
  let st = null; // { view: 'lista' | 'app', key, sel: Set, soSuporte }

  function close() { const m = document.getElementById('appGroupsModal'); if (m) m.remove(); st = null; }

  function render() {
    const body = document.getElementById('appGroupsBody');
    if (!body || !st) return;
    const { lista, media } = grupos();
    if (st.view === 'lista') {
      if (!lista.length) { body.innerHTML = '<div class="ai-box">Nenhum cliente ativo ainda.</div>'; return; }
      let h = `<div class="ai-hint" style="margin:0 0 8px;">Clientes ativos por aplicativo e suportes nos últimos 90 dias. Média geral: ${fmt(media)} suporte por cliente. Toque num aplicativo para ver os clientes e mandar uma mensagem.</div>`;
      h += lista.map(g => `<button type="button" data-app="${esc(g.key)}" style="display:block; width:100%; text-align:left; background:var(--surface-alt); border:1px solid ${g.alerta ? '#f59e0b' : 'var(--border)'}; border-radius:10px; padding:9px 11px; margin-bottom:6px; cursor:pointer; color:var(--text-main);">
          <div style="display:flex; justify-content:space-between; gap:8px; align-items:baseline;"><b style="font-size:0.88rem;">${g.alerta ? '⚠️ ' : ''}${esc(g.nome)}</b><span style="font-size:0.74rem; color:var(--text-muted); white-space:nowrap;">${g.total} cliente${g.total > 1 ? 's' : ''} ›</span></div>
          <div style="font-size:0.74rem; color:${g.alerta ? '#b45309' : 'var(--text-muted)'}; margin-top:2px;">${g.sup90} suporte${g.sup90 === 1 ? '' : 's'} em 90 dias (${g.sup30} em 30) · ${fmt(g.porCliente)} por cliente${g.alerta ? ' · acima da média' : ''}${g.abertos ? ` · ${g.abertos} aberto${g.abertos > 1 ? 's' : ''} agora` : ''}</div>
        </button>`).join('');
      body.innerHTML = h;
      body.querySelectorAll('[data-app]').forEach(b => b.addEventListener('click', () => abrirApp(b.getAttribute('data-app'))));
      return;
    }

    const g = lista.find(x => x.key === st.key);
    if (!g) { st.view = 'lista'; return render(); }
    const hoje = todayStr();
    let cli = g.clientes.slice().map(c => ({ c, sup: supportsIn(c, 90) })).sort((a, b) => b.sup.length - a.sup.length || String(a.c.name || '').localeCompare(String(b.c.name || '')));
    if (st.soSuporte) cli = cli.filter(x => x.sup.length > 0);
    const marcados = cli.filter(x => st.sel.has(x.c.id) && phoneOk(x.c));
    const msg = (() => { try { return localStorage.getItem(MSG_KEY) || DEFAULT_MSG; } catch (e) { return DEFAULT_MSG; } })();

    let h = `<button type="button" id="agBack" class="btn-tool" style="background:transparent; color:var(--text-muted); border:1px solid var(--border); padding:4px 10px; font-size:0.74rem; margin-bottom:8px;">‹ Todos os aplicativos</button>`;
    h += `<div class="ai-box"><b>${g.alerta ? '⚠️ ' : ''}${esc(g.nome)}</b><br>${g.total} cliente${g.total > 1 ? 's' : ''} · ${g.sup90} suporte${g.sup90 === 1 ? '' : 's'} em 90 dias · ${fmt(g.porCliente)} por cliente (média geral ${fmt(media)})</div>`;
    h += `<div style="display:flex; gap:6px; margin:8px 0;">
      <button type="button" data-filtro="0" class="btn-tool" style="flex:1; padding:6px; font-size:0.74rem; font-weight:700; background:${!st.soSuporte ? '#2563eb' : 'var(--surface-alt)'}; color:${!st.soSuporte ? '#fff' : 'var(--text-main)'}; border:1px solid var(--border);">Todos (${g.total})</button>
      <button type="button" data-filtro="1" class="btn-tool" style="flex:1; padding:6px; font-size:0.74rem; font-weight:700; background:${st.soSuporte ? '#2563eb' : 'var(--surface-alt)'}; color:${st.soSuporte ? '#fff' : 'var(--text-main)'}; border:1px solid var(--border);">Só quem teve suporte</button>
    </div>`;
    h += `<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.74rem; margin-bottom:4px;"><span>${marcados.length} selecionado${marcados.length === 1 ? '' : 's'}</span><span><a href="#" id="agTodos">marcar todos</a> · <a href="#" id="agNenhum">nenhum</a></span></div>`;
    h += `<div style="max-height:34vh; overflow-y:auto; border:1px solid var(--border); border-radius:10px; margin-bottom:10px;">` + (cli.length ? cli.map(({ c, sup }) => {
      const ult = sup.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const semTel = !phoneOk(c);
      return `<label style="display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-bottom:1px solid var(--border); font-size:0.8rem; ${semTel ? 'opacity:0.55;' : ''}">
        <input type="checkbox" data-cli="${esc(c.id)}" ${st.sel.has(c.id) && !semTel ? 'checked' : ''} ${semTel ? 'disabled' : ''} style="margin-top:3px;">
        <span style="flex:1; min-width:0;"><b>${esc(c.name || c.username)}</b>${c.lastAppCheckAt === hoje ? ' <span style="color:#16a34a; font-size:0.7rem;">✓ perguntado hoje</span>' : ''}
          <span style="display:block; font-size:0.7rem; color:var(--text-muted);">${semTel ? 'sem telefone' : (sup.length ? `${sup.length} suporte${sup.length > 1 ? 's' : ''} em 90 dias · último: ${esc(ult.reason || 'Atendimento')}` : 'nenhum suporte em 90 dias')}${c.supportOpenAt ? ' · ⏳ suporte aberto' : ''}</span></span>
      </label>`;
    }).join('') : '<div style="padding:12px; font-size:0.78rem; color:var(--text-muted);">Nenhum cliente neste filtro.</div>') + `</div>`;
    h += `<label for="agMsg" style="font-weight:700; font-size:0.8rem;">Mensagem</label>
      <div class="ai-hint" style="margin:2px 0 4px;">{nome} vira o primeiro nome do cliente e {app} o nome do aplicativo.</div>
      <textarea id="agMsg" rows="5" style="width:100%; box-sizing:border-box; font:inherit; font-size:0.8rem; padding:8px; border-radius:8px; border:1px solid var(--border);">${esc(msg)}</textarea>
      <div style="text-align:right; margin:2px 0 8px;"><a href="#" id="agPadrao" style="font-size:0.72rem;">voltar ao texto padrão</a></div>
      <button type="button" id="agEnviar" class="btn-auth" style="width:100%; background:#16a34a; padding:11px; font-weight:800;" ${marcados.length ? '' : 'disabled'}>💬 Enviar em sequência (${marcados.length})</button>
      <div class="ai-hint" style="margin-top:6px;">Abre o WhatsApp de um cliente por vez com a mensagem pronta: você só toca em Enviar. Quem já recebeu hoje é pulado.</div>`;
    body.innerHTML = h;

    body.querySelector('#agBack').addEventListener('click', () => { st.view = 'lista'; render(); });
    body.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => { st.soSuporte = b.getAttribute('data-filtro') === '1'; render(); }));
    body.querySelectorAll('[data-cli]').forEach(cb => cb.addEventListener('change', () => { const id = cb.getAttribute('data-cli'); if (cb.checked) st.sel.add(id); else st.sel.delete(id); render(); }));
    body.querySelector('#agTodos').addEventListener('click', (e) => { e.preventDefault(); cli.forEach(x => { if (phoneOk(x.c)) st.sel.add(x.c.id); }); render(); });
    body.querySelector('#agNenhum').addEventListener('click', (e) => { e.preventDefault(); cli.forEach(x => st.sel.delete(x.c.id)); render(); });
    const ta = body.querySelector('#agMsg');
    ta.addEventListener('input', () => { try { localStorage.setItem(MSG_KEY, ta.value); } catch (e) {} });
    body.querySelector('#agPadrao').addEventListener('click', (e) => { e.preventDefault(); ta.value = DEFAULT_MSG; try { localStorage.removeItem(MSG_KEY); } catch (er) {} });
    body.querySelector('#agEnviar').addEventListener('click', () => enviar(g, marcados.map(x => x.c), ta.value));
  }

  function preencher(texto, c, app) {
    const primeiro = String(c.name || c.username || '').trim().split(/\s+/)[0] || '';
    return String(texto || '').replace(/\{nome\}/gi, primeiro).replace(/\{app\}/gi, app);
  }

  function enviar(g, lista, texto) {
    if (!lista.length) return;
    if (!String(texto || '').trim()) return alert('Escreva a mensagem antes de enviar.');
    const hoje = todayStr();
    const fs = (typeof db !== 'undefined') ? db : firebase.firestore();
    close();
    window.startDailyQueueBilling({
      list: lista,
      isDone: (c) => c.lastAppCheckAt === hoje,
      verb: 'Perguntar a',
      doneTitle: 'Mensagens enviadas',
      emptyMsg: 'Nenhum cliente selecionado.',
      sub: (c) => { const n = supportsIn(c, 90).length; return `${g.nome} · ${n ? n + ' suporte' + (n > 1 ? 's' : '') + ' em 90 dias' : 'sem suporte em 90 dias'}`; },
      send: (c) => {
        openWhatsAppDirect(c.phone, preencher(texto, c, g.nome));
        c.lastAppCheckAt = hoje;
        try {
          const p = fs.collection('clients').doc(c.id).update({ lastAppCheckAt: hoje });
          (typeof offlineSafe === 'function' ? offlineSafe(p) : p).catch(() => {});
        } catch (e) {}
      }
    });
  }

  function abrirApp(key) {
    const g = grupos().lista.find(x => x.key === key);
    const sel = new Set();
    if (g) g.clientes.forEach(c => { if (phoneOk(c)) sel.add(c.id); });
    st.view = 'app'; st.key = key; st.sel = sel; st.soSuporte = false;
    render();
  }

  // appName (opcional): abre direto no aplicativo indicado (usado pelo Relatório de suportes)
  window.openAppGroups = function (appName) {
    if (typeof closeFabMenu === 'function') closeFabMenu();
    const old = document.getElementById('appGroupsModal'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'appGroupsModal'; ov.className = 'modal-backdrop'; ov.style.cssText = 'display:flex; z-index:10060;';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="modal-card" style="max-width:520px; width:100%; max-height:90vh; overflow-y:auto; text-align:left; padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:1rem;">📺 Clientes por aplicativo</h3>
        <button type="button" id="agClose" aria-label="Fechar" style="border:none; background:transparent; font-size:1.3rem; cursor:pointer; color:var(--text-muted);">✕</button>
      </div>
      <div id="appGroupsBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#agClose').addEventListener('click', close);
    st = { view: 'lista' };
    const key = appName ? (normApp(appName) || '_sem') : '';
    if (key && grupos().lista.some(x => x.key === key)) abrirApp(key); else render();
  };

  // exposto para testes
  window.__appGroups = { normApp, grupos, preencher };
})();
