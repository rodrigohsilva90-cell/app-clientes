// ============================================================
// RELATÓRIO DE SUPORTES COM IA (só para a conta Master)
// - Junta os atendimentos do período (motivo, seus comentários de abertura e
//   fechamento, tempo até resolver, servidor e aplicativo do cliente).
// - Os números e gráficos são calculados aqui, no aparelho.
// - Antes de ir para a IA, os comentários passam por uma limpeza: nome, login,
//   telefone, MAC e senha do cliente saem do texto. O cliente vira um código (c...).
// - A IA (Worker "gestaopro-ai", modo "suportes") devolve causas, padrões,
//   roteiros que funcionaram e ações para reduzir os chamados.
// ============================================================
(function () {
  'use strict';

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayNum = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
  const todayNum = () => { const d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
  const round1 = (n) => Math.round(n * 10) / 10;
  const CACHE_KEY = (dias) => 'support_report_v1_' + ((window.currentUser && window.currentUser.uid) || 'x') + '_' + dias;
  const ERR = {
    login: 'Faça login de novo e tente outra vez.',
    sem_acesso: 'O relatório com IA está disponível só para a conta Master.',
    limite: 'A Gemini recusou por limite de uso. Tente de novo mais tarde.',
    limite_hora: 'Limite de análises por hora atingido. Tente mais tarde.',
    sem_atendimentos: 'Não há atendimentos fechados neste período.',
    resposta_vazia: 'A IA não devolveu o relatório. Tente de novo.',
    origem: 'O Worker da IA não aceitou o endereço deste app (ALLOWED_ORIGIN).'
  };

  function isMasterOwn() {
    const u = window.currentUser;
    return !!(u && u.email && window.MASTER_ADMIN_EMAIL && u.email.toLowerCase() === window.MASTER_ADMIN_EMAIL.toLowerCase() && window.activeOwnerId === u.uid);
  }
  function allClients() { try { return Array.isArray(clients) ? clients : []; } catch (e) { return []; } }
  function codeOf(c) { return 'c' + String(c.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10); }
  function appOf(c) { return String(c.macApp || c.app || '').trim() || 'Não informado'; }
  function srvOf(c) { return String(c.assignedServer || '').trim() || 'Sem servidor'; }

  // Tira do texto o que identifica o cliente (nome, login, telefone, MAC, senha, e-mail, números longos)
  function scrub(text, c) {
    let t = String(text || '');
    const words = [];
    String(c.name || '').split(/\s+/).forEach(w => { if (w.length >= 3) words.push(w); });
    [c.username, c.serverPassword, c.macAddress, c.email].forEach(v => { v = String(v || '').trim(); if (v.length >= 2) words.push(v); });
    // Palavra inteira (não apaga "ana" dentro de "banana"), sem diferenciar maiúsculas
    words.sort((a, b) => b.length - a.length).forEach(w => {
      const re = new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'giu');
      t = t.replace(re, '$1[cliente]');
    });
    t = t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
      .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[mac]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => /^\d{1,3}(\.\d{1,3}){3}$/.test(m.trim()) ? m : '[numero]');
    return t.replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  // ---------- Dados do período (tudo local) ----------
  function collect(dias) {
    const hoje = todayNum();
    const desde = hoje - dias;
    const tickets = [];
    const abertos = [];
    const porCliente = new Map();
    allClients().forEach(c => {
      if (!c || c.isDeleted) return;
      const hist = Array.isArray(c.supportHistory) ? c.supportHistory : [];
      hist.forEach(h => {
        const d = dayNum(h && h.date);
        if (d == null || d < desde || d > hoje) return;
        tickets.push({ c, d, date: h.date, reason: String(h.reason || 'Atendimento Geral'), notes: String(h.notes || ''), hours: (h.durationHours != null && isFinite(h.durationHours)) ? Number(h.durationHours) : null });
        porCliente.set(c.id, (porCliente.get(c.id) || 0) + 1);
      });
      if (c.supportOpenAt) {
        const horas = Math.max(0, Math.round((Date.now() - Date.parse(c.supportOpenAt)) / 3600000));
        abertos.push({ c, reason: String(c.supportOpenReason || 'Atendimento Geral'), notes: String(c.supportOpenNotes || ''), horas: isFinite(horas) ? horas : null });
      }
    });
    tickets.sort((a, b) => b.d - a.d);

    const conta = (arr, key) => {
      const m = new Map();
      arr.forEach(x => { const k = key(x); const o = m.get(k) || { name: k, count: 0, hours: [] }; o.count++; if (x.hours != null) o.hours.push(x.hours); m.set(k, o); });
      return [...m.values()].map(o => ({ name: o.name, count: o.count, avgHours: o.hours.length ? round1(o.hours.reduce((a, b) => a + b, 0) / o.hours.length) : null })).sort((a, b) => b.count - a.count);
    };
    const ativos = allClients().filter(c => c && !c.isDeleted && !c.isArchived);
    const clientesPorSrv = new Map(), clientesPorApp = new Map();
    ativos.forEach(c => { clientesPorSrv.set(srvOf(c), (clientesPorSrv.get(srvOf(c)) || 0) + 1); clientesPorApp.set(appOf(c), (clientesPorApp.get(appOf(c)) || 0) + 1); });

    const motivos = conta(tickets, t => t.reason);
    const servidores = conta(tickets, t => srvOf(t.c)).map(s => ({ ...s, clientes: clientesPorSrv.get(s.name) || 0, porCliente: clientesPorSrv.get(s.name) ? round1(s.count / clientesPorSrv.get(s.name)) : null }));
    const apps = conta(tickets, t => appOf(t.c)).map(s => ({ ...s, clientes: clientesPorApp.get(s.name) || 0, porCliente: clientesPorApp.get(s.name) ? round1(s.count / clientesPorApp.get(s.name)) : null }));
    const horas = tickets.map(t => t.hours).filter(h => h != null);
    const recorrentes = [...porCliente.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, n]) => { const c = allClients().find(x => x.id === id); return { c, n }; }).filter(x => x.c);

    // Semanas (mais antiga → mais recente) para ver a tendência
    const semanas = [];
    const nSem = Math.max(1, Math.ceil(dias / 7));
    for (let i = nSem - 1; i >= 0; i--) {
      const ini = hoje - (i + 1) * 7 + 1, fim = hoje - i * 7;
      semanas.push({ semanasAtras: i, atendimentos: tickets.filter(t => t.d >= ini && t.d <= fim).length });
    }

    return {
      dias, tickets, abertos, motivos, servidores, apps, recorrentes, semanas,
      total: tickets.length,
      clientesComSuporte: porCliente.size,
      clientesAtivos: ativos.length,
      mediaHoras: horas.length ? round1(horas.reduce((a, b) => a + b, 0) / horas.length) : null,
      mais24h: horas.filter(h => h > 24).length,
      semComentario: tickets.filter(t => !t.notes.trim()).length
    };
  }

  function payloadFor(d) {
    return {
      mode: 'suportes',
      periodoDias: d.dias,
      resumo: { total: d.total, abertosAgora: d.abertos.length, clientesComSuporte: d.clientesComSuporte, clientesAtivos: d.clientesAtivos, mediaHoras: d.mediaHoras, mais24h: d.mais24h, semComentario: d.semComentario },
      motivos: d.motivos.slice(0, 12),
      servidores: d.servidores.slice(0, 12),
      apps: d.apps.slice(0, 12),
      semanas: d.semanas.slice(-13),
      atendimentos: d.tickets.slice(0, 300).map(t => ({
        id: codeOf(t.c), diasAtras: todayNum() - t.d, motivo: t.reason.slice(0, 60), comentario: scrub(t.notes, t.c),
        horas: t.hours, app: appOf(t.c).slice(0, 40), servidor: srvOf(t.c).slice(0, 24)
      })),
      abertos: d.abertos.slice(0, 30).map(a => ({ id: codeOf(a.c), motivo: a.reason.slice(0, 60), comentario: scrub(a.notes, a.c), horasAberto: a.horas, app: appOf(a.c).slice(0, 40), servidor: srvOf(a.c).slice(0, 24) }))
    };
  }

  async function callAi(payload) {
    const url = window.AI_API_URL;
    if (!url) throw new Error('Falta configurar o endereço do Worker em ai-config.js.');
    const user = window.currentUser;
    if (!user || !user.getIdToken) throw new Error(ERR.login);
    const token = await user.getIdToken();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 180000);
    try {
      const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
      let data = null;
      try { data = await r.json(); } catch (e) {}
      if (!data) throw new Error(r.ok ? 'A conexão caiu antes de o relatório terminar. Deixe o app aberto até o fim e tente de novo.' : 'Erro ao gerar o relatório (' + r.status + ').');
      if (!data.ok) throw new Error((ERR[data.error] || ('Erro ao gerar o relatório (' + (data.error || r.status) + ').')) + (data.detalhe ? ' [' + data.detalhe + ']' : ''));
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('O relatório demorou demais. Tente de novo.');
      if (e instanceof TypeError) throw new Error('Sem conexão com o Worker da IA. Confira a internet e tente de novo.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // ---------- Tela ----------
  let st = null; // { dias, data, ai, busy, error }

  function loadCache(dias) { try { return JSON.parse(localStorage.getItem(CACHE_KEY(dias)) || 'null'); } catch (e) { return null; } }
  function saveCache(dias, v) { try { localStorage.setItem(CACHE_KEY(dias), JSON.stringify(v)); } catch (e) {} }
  const sec = (title, inner, hint) => `<div class="ai-sec"><div class="ai-sec-t">${title}</div>${hint ? `<div class="ai-hint">${hint}</div>` : ''}${inner}</div>`;
  const hrs = (h) => h == null ? '—' : (h < 1 ? Math.round(h * 60) + ' min' : (h < 48 ? round1(h) + ' h' : Math.round(h / 24) + ' dias'));

  function bars(list, extra) {
    const max = Math.max(1, ...list.map(x => x.count));
    return list.slice(0, 8).map(x => `<div class="ai-bar"><span class="ai-bar-l" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(x.name)}">${esc(x.name)}</span><span class="ai-bar-track"><span style="display:block; height:100%; width:${Math.round(x.count / max * 100)}%; background:var(--primary);"></span></span><span style="text-align:right;">${x.count}${extra ? extra(x) : ''}</span></div>`).join('');
  }

  function nomeDe(id) {
    const c = allClients().find(x => codeOf(x) === id);
    return c ? (c.name || c.username || id) : id;
  }

  function render() {
    const body = document.getElementById('supRepBody');
    if (!body || !st) return;
    const d = st.data;
    let h = `<div style="display:flex; gap:6px; margin-bottom:10px;">${[30, 90].map(n => `<button type="button" data-dias="${n}" class="btn-tool" style="flex:1; padding:6px; font-size:0.74rem; font-weight:700; background:${st.dias === n ? '#7c3aed' : 'var(--surface-alt)'}; color:${st.dias === n ? '#fff' : 'var(--text-main)'}; border:1px solid var(--border);">Últimos ${n} dias</button>`).join('')}</div>`;

    h += `<div class="ai-kpis">
      <div><b>${d.total}</b><span>atendimentos</span></div>
      <div><b style="color:${d.abertos.length ? '#dc2626' : 'inherit'}">${d.abertos.length}</b><span>abertos agora</span></div>
      <div><b>${hrs(d.mediaHoras)}</b><span>tempo médio p/ resolver</span></div>
      <div><b>${d.clientesAtivos ? Math.round(d.clientesComSuporte / d.clientesAtivos * 100) : 0}%</b><span>dos clientes chamaram</span></div>
    </div>`;

    if (!d.total && !d.abertos.length) {
      h += `<div class="ai-box" style="margin-top:12px;">Nenhum atendimento registrado neste período. Os atendimentos entram aqui quando você usa "Abrir atendimento" e "Fechar suporte" no cartão do cliente.</div>`;
      body.innerHTML = h; bind(); return;
    }

    if (d.abertos.length) {
      h += sec('⏳ Abertos agora', `<ul class="ai-ul">${d.abertos.sort((a, b) => (b.horas || 0) - (a.horas || 0)).slice(0, 8).map(a => `<li><b>${esc(a.c.name || a.c.username)}</b> · ${esc(a.reason)} · há ${hrs(a.horas)}</li>`).join('')}</ul>`);
    }
    h += sec('🎯 Motivos', bars(d.motivos, x => x.avgHours != null ? ` <small style="color:var(--text-muted)">· ${hrs(x.avgHours)}</small>` : ''), 'Quantidade de atendimentos e tempo médio para resolver.');
    if (d.servidores.length > 1) h += sec('🖥️ Por servidor', bars(d.servidores, x => x.porCliente != null ? ` <small style="color:var(--text-muted)">· ${x.porCliente}/cli</small>` : ''), 'Atendimentos e média por cliente ativo do servidor.');
    if (d.apps.length > 1) h += sec('📺 Por aplicativo', bars(d.apps, x => x.porCliente != null ? ` <small style="color:var(--text-muted)">· ${x.porCliente}/cli</small>` : '') + `<button type="button" id="supRepApps" class="btn-tool" style="width:100%; background:#2563eb; padding:7px; font-size:0.76rem; font-weight:700; margin-top:4px;">📺 Ver clientes de um aplicativo e mandar mensagem</button>`);
    if (d.recorrentes.length) h += sec('🔁 Clientes que mais chamaram', `<ul class="ai-ul">${d.recorrentes.map(r => `<li><b>${esc(r.c.name || r.c.username)}</b> · ${r.n} atendimentos · ${esc(appOf(r.c))} · ${esc(srvOf(r.c))}</li>`).join('')}</ul>`);
    if (d.semComentario) h += `<div class="ai-note">📝 ${d.semComentario} de ${d.total} atendimentos fechados sem comentário. Quanto mais você escreve no "Como foi resolvido?", melhor a IA entende as soluções.</div>`;

    // IA
    h += `<div class="ai-sec"><div class="ai-sec-t">🤖 Análise da IA</div>`;
    if (st.busy) h += `<div class="ai-box">Analisando ${d.total} atendimentos… isso pode levar até 1 minuto. Deixe o app aberto.</div>`;
    else if (st.error) h += `<div class="ai-box" style="border-color:#fca5a5; color:#991b1b;">${esc(st.error)}</div>`;
    if (!st.busy) h += `<button type="button" id="supRepRun" class="btn-tool" style="width:100%; background:#7c3aed; padding:9px; font-weight:700; font-size:0.8rem;" ${d.total ? '' : 'disabled'}>${st.ai ? '🔄 Gerar de novo' : '🤖 Analisar com IA'}</button>`;
    if (st.ai && st.ai.dias === st.dias) h += renderAi(st.ai);
    h += `</div>`;
    body.innerHTML = h;
    bind();
  }

  function renderAi(c) {
    const r = c.result || {};
    const when = new Date(c.at);
    const p = (n) => String(n).padStart(2, '0');
    let h = `<div class="ai-hint" style="margin-top:8px;">Gerado em ${p(when.getDate())}/${p(when.getMonth() + 1)} ${p(when.getHours())}:${p(when.getMinutes())} com ${c.total} atendimentos.</div>`;
    if (r.resumo) h += `<div class="ai-box">${esc(r.resumo)}</div>`;
    if (r.acoes && r.acoes.length) h += sec('✅ O que fazer para reduzir os chamados', r.acoes.map((a, i) => `<div class="ai-pri"><div class="ai-pri-n">${i + 1}</div><div><b style="font-size:0.84rem;">${esc(a.title)}</b><div class="ai-pri-t">${esc(a.why)}</div><div class="ai-pri-t"><b>Ação:</b> ${esc(a.action)}</div></div></div>`).join(''));
    if (r.problemas && r.problemas.length) h += sec('🔍 Problemas, causas e soluções', r.problemas.map(x => `<div class="ai-box"><b>${esc(x.motivo)}</b>${x.quantidade != null ? ` · ${esc(x.quantidade)}` : ''}<div style="margin-top:4px;"><b>Causa provável:</b> ${esc(x.causa)}</div>${x.solucao ? `<div><b>O que resolveu:</b> ${esc(x.solucao)}</div>` : ''}${x.prevencao ? `<div><b>Como evitar:</b> ${esc(x.prevencao)}</div>` : ''}</div>`).join(''));
    if (r.padroes && r.padroes.length) h += sec('💡 Padrões', `<ul class="ai-ul">${r.padroes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
    if (r.tempo) h += sec('⏱️ Tempo de resolução', `<div class="ai-box">${esc(r.tempo)}</div>`);
    if (r.servidores && r.servidores.length) h += sec('🖥️ Servidores', `<ul class="ai-ul">${r.servidores.map(x => `<li><b>${esc(x.name)}:</b> ${esc(x.insight)}</li>`).join('')}</ul>`);
    if (r.apps && r.apps.length) h += sec('📺 Aplicativos', `<ul class="ai-ul">${r.apps.map(x => `<li><b>${esc(x.name)}:</b> ${esc(x.insight)} <a href="#" data-abrir-app="${esc(x.name)}">ver clientes ›</a></li>`).join('')}</ul>`);
    if (r.recorrentes && r.recorrentes.length) h += sec('🔁 Clientes para acompanhar', `<ul class="ai-ul">${r.recorrentes.map(x => `<li><b>${esc(nomeDe(x.id))}:</b> ${esc(x.why)} <i>${esc(x.action)}</i></li>`).join('')}</ul>`);
    if (r.roteiros && r.roteiros.length) h += sec('📋 Roteiros prontos (do que já funcionou)', r.roteiros.map((x, i) => `<div class="ai-box"><b>${esc(x.problema)}</b><ol class="ai-ul" style="margin-top:4px;">${x.passos.map(s => `<li>${esc(s)}</li>`).join('')}</ol><button type="button" class="btn-tool" data-copiar="${i}" style="background:#0d9488; padding:5px 8px; font-size:0.72rem; margin-top:4px;">📋 Copiar para o WhatsApp</button></div>`).join(''), 'Montados a partir dos seus comentários de "como foi resolvido".');
    return h;
  }

  function bind() {
    const body = document.getElementById('supRepBody');
    if (!body) return;
    body.querySelectorAll('[data-dias]').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.getAttribute('data-dias'));
      st = { dias: n, data: collect(n), ai: loadCache(n), busy: false, error: '' };
      render();
    }));
    const apps = body.querySelector('#supRepApps');
    if (apps) apps.addEventListener('click', () => { if (typeof window.openAppGroups === 'function') window.openAppGroups(); });
    body.querySelectorAll('[data-abrir-app]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); if (typeof window.openAppGroups === 'function') window.openAppGroups(a.getAttribute('data-abrir-app')); }));
    const run = body.querySelector('#supRepRun');
    if (run) run.addEventListener('click', gerar);
    body.querySelectorAll('[data-copiar]').forEach(b => b.addEventListener('click', () => {
      const x = st.ai && st.ai.result && st.ai.result.roteiros && st.ai.result.roteiros[Number(b.getAttribute('data-copiar'))];
      if (!x) return;
      const txt = `*${x.problema}*\n` + x.passos.map((s, i) => `${i + 1}. ${s}`).join('\n');
      const ok = () => { b.textContent = '✅ Copiado'; setTimeout(() => { b.textContent = '📋 Copiar para o WhatsApp'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok).catch(() => {}); else ok();
    }));
  }

  async function gerar() {
    if (!st || st.busy) return;
    st.busy = true; st.error = ''; render();
    try {
      const data = await callAi(payloadFor(st.data));
      st.ai = { at: Date.now(), dias: st.dias, total: st.data.total, result: data.result };
      saveCache(st.dias, st.ai);
    } catch (e) {
      st.error = e && e.message ? e.message : 'Não foi possível gerar o relatório.';
    }
    st.busy = false;
    render();
  }

  function closeModal() { const m = document.getElementById('supRepModal'); if (m) m.remove(); st = null; }

  window.openSupportReport = function () {
    if (typeof closeFabMenu === 'function') closeFabMenu();
    if (!isMasterOwn()) return alert('O relatório de suportes com IA está disponível só para a conta Master.');
    const old = document.getElementById('supRepModal'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'supRepModal'; ov.className = 'modal-backdrop'; ov.style.cssText = 'display:flex; z-index:10050;';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="modal-card" style="max-width:560px; width:100%; max-height:90vh; overflow-y:auto; text-align:left; padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:1rem;">🛠️ Relatório de suportes</h3>
        <button type="button" id="supRepClose" aria-label="Fechar" style="border:none; background:transparent; font-size:1.3rem; cursor:pointer; color:var(--text-muted);">✕</button>
      </div>
      <div id="supRepBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    ov.querySelector('#supRepClose').addEventListener('click', closeModal);
    st = { dias: 90, data: collect(90), ai: loadCache(90), busy: false, error: '' };
    render();
  };

  // Mostra o botão só para a conta Master (mesma regra do botão da análise da carteira)
  function syncButtons() {
    const show = isMasterOwn();
    const b = document.getElementById('btnSupportReport'); if (b) b.style.display = show ? 'block' : 'none';
    const f = document.getElementById('fabSupportReport'); if (f) f.style.display = show ? '' : 'none';
  }
  window.syncSupportReportButtons = syncButtons;
  setInterval(syncButtons, 3000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncButtons); else syncButtons();

  // exposto para testes
  window.__supportReport = { scrub, collect, payloadFor };
})();
