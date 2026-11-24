// ============================================================
// ANÁLISE DA CARTEIRA COM IA (só para a conta Master)
// - Todos os números são calculados aqui, no aparelho (caixa, meses, servidores, risco).
// - A IA (Gemini, via Worker "gestaopro-ai") só recebe números e códigos anônimos
//   e devolve diagnóstico, plano da semana, leitura por servidor e mensagens.
// - Nome, telefone, usuário, senha e MAC nunca saem do aparelho.
// ============================================================
(function () {
  'use strict';

  const CACHE_KEY = () => 'ai_report_v2_' + ((window.currentUser && window.currentUser.uid) || 'x');
  const TONE_KEY = 'ai_tone_v1';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
  const money0 = (n) => 'R$ ' + Math.round(Number(n) || 0).toLocaleString('pt-BR');
  const dayNum = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
  const monthIdx = (dn) => { const d = new Date(dn * 86400000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const round1 = (n) => Math.round(n * 10) / 10;
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sum = (a, f) => a.reduce((n, x) => n + (Number(f(x)) || 0), 0);
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function isMasterOwn() {
    const u = window.currentUser;
    return !!(u && u.email && window.MASTER_ADMIN_EMAIL && u.email.toLowerCase() === window.MASTER_ADMIN_EMAIL.toLowerCase() && window.activeOwnerId === u.uid);
  }

  // ---------- Métricas por cliente (tudo local) ----------
  function codeOf(c) { return 'c' + String(c.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10); }
  function costOf(c) { try { return typeof creditCostFor === 'function' ? (Number(creditCostFor(c)) || 0) : 0; } catch (e) { return 0; } }

  function payDelays(hist) {
    return hist.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map(h => {
      const a = dayNum(h.date), b = dayNum(h.prevDueDate);
      return a != null && b != null ? Math.max(0, a - b) : null;
    }).filter(v => v != null);
  }

  function metricsFor(c, today) {
    const hist = (Array.isArray(c.paymentHistory) ? c.paymentHistory : []).filter(h => h && h.date);
    let late = 0, delaySum = 0, delayN = 0;
    hist.forEach(h => {
      const a = dayNum(h.date), b = dayNum(h.prevDueDate);
      if (a != null && b != null) { const d = a - b; delayN++; delaySum += Math.max(0, d); if (d > 2) late++; }
    });
    const renewals = hist.length;
    const starts = [dayNum(c.createdAt)].concat(hist.map(h => dayNum(h.date))).filter(v => v != null);
    const start = starts.length ? Math.min.apply(null, starts) : null;
    const st = c.dueDate ? getStatus(c.dueDate) : { diffDays: 0 };
    const supHist = Array.isArray(c.supportHistory) ? c.supportHistory : [];
    const supports30 = supHist.filter(s => { const d = dayNum(s && s.date); return d != null && today - d <= 30; }).length;
    const supportsTotal = supHist.length || (parseInt(c.supportCount, 10) || 0);
    const supportOpenHours = c.supportOpenAt ? Math.max(0, Math.round((Date.now() - Date.parse(c.supportOpenAt)) / 3600000)) : null;
    const resolveTimes = supHist.map(h => h && h.durationHours).filter(v => v != null && isFinite(v));
    const supportAvgResolveHours = resolveTimes.length ? round1(avg(resolveTimes)) : null;
    let referrals = 0;
    try { referrals = (getClientReferralProgress(c) || {}).total || 0; } catch (e) {}
    let portalDays = null;
    if (c.portalLastAccess) { const t = Date.parse(c.portalLastAccess); if (t) portalDays = Math.max(0, Math.round((Date.now() - t) / 86400000)); }
    const delays = payDelays(hist);
    let delayTrend = null;
    if (delays.length >= 4) delayTrend = round1(avg(delays.slice(-2)) - avg(delays.slice(0, -2)));
    const paid = hist.map(h => dayNum(h.date)).filter(v => v != null);
    const lastPaymentDays = paid.length ? today - Math.max.apply(null, paid) : null;
    const price = Number(c.price) || 0;
    const m = {
      id: codeOf(c),
      tenureMonths: start == null ? null : round1((today - start) / 30.4),
      renewals,
      lateRenewals: late,
      avgDelayDays: delayN ? round1(delaySum / delayN) : null,
      delayTrend,
      lastPaymentDays,
      overdueDays: st.diffDays < 0 ? -st.diffDays : 0,
      daysToDue: st.diffDays,
      supports30,
      supportsTotal,
      supportOpenHours,
      supportAvgResolveHours,
      referrals,
      price,
      margin: round1(price - costOf(c)),
      owed: Number(c.owedAmount) || 0,
      portalDaysSinceOpen: portalDays,
      onTimePct: renewals && delayN ? Math.round(100 * (delayN - late) / delayN) : null,
      server: c.assignedServer || ''
    };
    m.riskScore = risk(m);
    return m;
  }

  function risk(m) {
    let s = 0;
    if (m.overdueDays > 0) s += 30 + Math.min(20, m.overdueDays);
    if (m.renewals >= 2 && m.lateRenewals / m.renewals >= 0.5) s += 20;
    else if (m.lateRenewals >= 1) s += 8;
    if (m.delayTrend != null && m.delayTrend >= 3) s += 8;
    if (m.supports30 >= 3) s += 15; else if (m.supports30 >= 2) s += 7;
    if (m.supportOpenHours != null && m.supportOpenHours >= 24) s += 10; else if (m.supportOpenHours != null && m.supportOpenHours >= 4) s += 4;
    if (m.daysToDue <= 7 && (m.portalDaysSinceOpen == null || m.portalDaysSinceOpen > 30)) s += 8;
    if (m.owed > 0) s += 10;
    if (m.tenureMonths != null && m.tenureMonths < 2 && m.renewals <= 1) s += 10;
    if (m.referrals > 0) s -= 10;
    if (m.renewals >= 6 && (m.onTimePct == null || m.onTimePct >= 85)) s -= 15;
    return Math.max(0, Math.min(100, Math.round(s)));
  }

  function isLoyal(m) { return m.renewals >= 6 && (m.onTimePct == null || m.onTimePct >= 85) && m.riskScore < 20 && m.overdueDays === 0; }
  function localLevel(score) { return score >= 60 ? 'alto' : (score >= 40 ? 'medio' : 'baixo'); }

  function localReason(m) {
    const p = [];
    if (m.overdueDays > 0) p.push(`${m.overdueDays} dia(s) de atraso`);
    if (m.renewals >= 2 && m.lateRenewals) p.push(`${m.lateRenewals} de ${m.renewals} renovações atrasadas`);
    if (m.delayTrend != null && m.delayTrend >= 3) p.push('atrasos aumentando');
    if (m.supports30) p.push(`${m.supports30} suporte(s) em 30 dias`);
    if (m.supportOpenHours != null) p.push(`suporte aberto há ${m.supportOpenHours < 1 ? 'poucos minutos' : m.supportOpenHours + 'h'}`);
    if (m.owed > 0) p.push(`deve ${money(m.owed)}`);
    if (m.daysToDue >= 0 && m.daysToDue <= 7 && (m.portalDaysSinceOpen == null || m.portalDaysSinceOpen > 30)) p.push('vence em breve e não abre o portal');
    if (m.tenureMonths != null && m.tenureMonths < 2 && m.renewals <= 1) p.push('cliente novo');
    return p.join(' • ') || 'sem sinais fortes';
  }

  // ---------- Métricas da carteira (tudo local) ----------
  function monthLabel(idx) { return MES[idx % 12] + '/' + String(Math.floor(idx / 12)).slice(-2); }

  function collect() {
    const today = dayNum(safeGetTodayLocal());
    const base = clients.filter(c => !c.isArchived && !c.isTrial && !c.isDeleted);
    const all = base.map(c => ({ c, m: metricsFor(c, today) }));
    const risky = all.filter(x => x.m.riskScore >= 25 && !isLoyal(x.m)).sort((a, b) => b.m.riskScore - a.m.riskScore).slice(0, 25);
    const loyal = all.filter(x => isLoyal(x.m)).sort((a, b) => (b.m.renewals + b.m.referrals * 3) - (a.m.renewals + a.m.referrals * 3)).slice(0, 5);

    const since = Date.now() - 30 * 86400000;
    const pool = clients.concat(window.deletedClients || []).filter(c => (c.isTrial || c.trialConvertedAt) && Date.parse(c.trialEndsAt || '') >= since);

    // Receita, margem e dinheiro parado
    const mrr = sum(base, c => c.price);
    const cost = sum(base, c => costOf(c));
    const overdueList = all.filter(x => x.m.overdueDays > 0);
    const atRisk = all.filter(x => x.m.riskScore >= 40 && !isLoyal(x.m));

    // Pontualidade (renovações pagas nos últimos 90 dias)
    let pay90 = 0, ok90 = 0;
    clients.filter(c => !c.isTrial && !c.isDeleted).forEach(c => (c.paymentHistory || []).forEach(h => {
      const d = dayNum(h && h.date); if (d == null || today - d > 90 || !(Number(h.amount) > 0)) return;
      pay90++; const b = dayNum(h.prevDueDate); if (b == null || d - b <= 2) ok90++;
    }));

    // Últimos 6 meses
    const cur = monthIdx(today), months = [];
    for (let k = 5; k >= 0; k--) months.push({ idx: cur - k, label: monthLabel(cur - k), renewals: 0, revenue: 0, newClients: 0 });
    const byIdx = {}; months.forEach(x => { byIdx[x.idx] = x; });
    clients.filter(c => !c.isTrial && !c.isDeleted).forEach(c => {
      (c.paymentHistory || []).forEach(h => { const d = dayNum(h && h.date); if (d == null) return; const x = byIdx[monthIdx(d)]; if (x && Number(h.amount) > 0) { x.renewals++; x.revenue += Number(h.amount) || 0; } });
      const cd = dayNum(c.createdAt); if (cd != null) { const x = byIdx[monthIdx(cd)]; if (x) x.newClients++; }
    });
    months.forEach(x => { x.revenue = Math.round(x.revenue); });
    const lost30 = (window.deletedClients || []).filter(c => { const d = dayNum(c.deletedAt); return d != null && today - d <= 30; }).length;
    const new30 = base.filter(c => { const d = dayNum(c.createdAt); return d != null && today - d <= 30; }).length;

    // Caixa dos próximos 30 dias (previsto = preço × chance de pagar)
    const prob = (m) => Math.max(0.3, 1 - m.riskScore / 150);
    const bucketOf = (m) => m.overdueDays > 0 ? 'atrasados' : (m.daysToDue <= 7 ? 'd0_7' : m.daysToDue <= 14 ? 'd8_14' : m.daysToDue <= 21 ? 'd15_21' : m.daysToDue <= 30 ? 'd22_30' : null);
    const cashDef = [['atrasados', 'Atrasados'], ['d0_7', 'Vencem em 7 dias'], ['d8_14', 'De 8 a 14 dias'], ['d15_21', 'De 15 a 21 dias'], ['d22_30', 'De 22 a 30 dias']];
    const cash = cashDef.map(([id, label]) => {
      const items = all.filter(x => bucketOf(x.m) === id);
      return { id, label, count: items.length, amount: Math.round(sum(items, x => x.m.price)), expected: Math.round(sum(items, x => x.m.price * prob(x.m))) };
    });

    // Servidores
    const srvs = (typeof srvList === 'function' ? srvList() : []) || [];
    const names = Array.from(new Set(all.map(x => x.m.server || 'Sem servidor')));
    const servers = names.map(name => {
      const items = all.filter(x => (x.m.server || 'Sem servidor') === name);
      const s = srvs.find(v => v && v.name === name);
      let stock = null, need = null;
      try { if (s && typeof serverHasStock === 'function' && serverHasStock(s)) { stock = Number(s.creditStock); need = serverCreditsNeeded(s); } } catch (e) {}
      return {
        name,
        clients: items.length,
        overdue: items.filter(x => x.m.overdueDays > 0).length,
        due7: items.filter(x => x.m.overdueDays === 0 && x.m.daysToDue >= 0 && x.m.daysToDue <= 7).length,
        mrr: Math.round(sum(items, x => x.m.price)),
        avgRisk: Math.round(avg(items.map(x => x.m.riskScore))),
        supportsPerClient: items.length ? round1(sum(items, x => x.m.supports30) / items.length) : 0,
        creditStock: stock,
        creditsNeeded: need,
        costPerCredit: s && s.costPerCredit !== '' && s.costPerCredit != null && !isNaN(parseFloat(s.costPerCredit)) ? parseFloat(s.costPerCredit) : null
      };
    }).sort((a, b) => b.clients - a.clients).slice(0, 12);

    // Concentração de suporte (os 5 que mais chamam)
    const supTotal = sum(all, x => x.m.supports30);
    const top5 = all.map(x => x.m.supports30).sort((a, b) => b - a).slice(0, 5).reduce((n, v) => n + v, 0);

    // Suportes abertos (ainda sem fechar) e tempo de resolução dos últimos fechados
    const openList = all.filter(x => x.m.supportOpenHours != null);
    const resolveTimesAll = all.map(x => x.m.supportAvgResolveHours).filter(v => v != null);

    const portfolio = {
      total: base.length,
      overdue: overdueList.length,
      due7: all.filter(x => x.m.overdueDays === 0 && x.m.daysToDue >= 0 && x.m.daysToDue <= 7).length,
      avgPrice: base.length ? round1(mrr / base.length) : 0,
      mrr: Math.round(mrr),
      margin: Math.round(mrr - cost),
      overdueAmount: Math.round(sum(overdueList, x => x.m.price)),
      atRiskAmount: Math.round(sum(atRisk, x => x.m.price)),
      onTimePct90: pay90 ? Math.round(100 * ok90 / pay90) : null,
      new30, lost30,
      noPortalDue7: all.filter(x => x.m.daysToDue <= 7 && (x.m.portalDaysSinceOpen == null || x.m.portalDaysSinceOpen > 30)).length,
      supportTop5Pct: supTotal ? Math.round(100 * top5 / supTotal) : null,
      openSupportTickets: openList.length,
      oldestOpenHours: openList.length ? Math.max.apply(null, openList.map(x => x.m.supportOpenHours)) : null,
      avgResolveHours: resolveTimesAll.length ? round1(avg(resolveTimesAll)) : null,
      trials30: pool.length,
      trialsConverted30: pool.filter(c => c.trialConvertedAt && !c.isTrial).length
    };
    const extra = extraCollect(all, servers, today);
    return { all, risky, loyal, portfolio, months, cash, servers, extra };
  }

  // ---------- Análises extras (calculadas aqui; a IA só recebe códigos e números) ----------
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  function extraCollect(all, servers, today) {
    const act = all.filter(x => !x.c.isTrial);

    // Risco silencioso: em dia com o pagamento, mas com sinais de que pode cancelar
    const silent = act
      .filter(x => x.m.overdueDays === 0 && !isLoyal(x.m) && (
        (x.m.supports30 >= 1 && (x.m.delayTrend >= 2 || x.m.lateRenewals >= 1 || (x.m.portalDaysSinceOpen != null && x.m.portalDaysSinceOpen > 30))) ||
        (x.m.riskScore >= 25 && x.m.supports30 >= 1) ||
        (x.m.delayTrend != null && x.m.delayTrend >= 3)))
      .sort((a, b) => b.m.riskScore - a.m.riskScore).slice(0, 10);

    // Candidatos a plano longo: 4+ renovações sem nenhum atraso
    const upsell = act
      .filter(x => x.m.renewals >= 4 && x.m.lateRenewals === 0 && x.m.overdueDays === 0 && x.m.riskScore < 25)
      .sort((a, b) => b.m.renewals - a.m.renewals).slice(0, 10);

    // Quem mais indica
    const promoters = act.filter(x => x.m.referrals > 0).sort((a, b) => b.m.referrals - a.m.referrals).slice(0, 5);

    // Safra de entrada: mês de cadastro (últimos 6 meses) e quantos chegaram à 3ª renovação
    const cur = monthIdx(today);
    const cohorts = [];
    for (let k = 5; k >= 0; k--) cohorts.push({ idx: cur - k, label: monthLabel(cur - k), total: 0, reached3: 0 });
    all.forEach(x => {
      const cd = dayNum(x.c.createdAt); if (cd == null) return;
      const co = cohorts.find(z => z.idx === monthIdx(cd)); if (!co) return;
      co.total++; if (x.m.renewals >= 3) co.reached3++;
    });

    // Dia da semana dos pagamentos (últimos 90 dias)
    const weekdays = WD.map((nome, dia) => ({ dia, nome, payments: 0, late: 0 }));
    all.forEach(x => (x.c.paymentHistory || []).forEach(h => {
      const d = dayNum(h && h.date); if (d == null || d < today - 90) return;
      const w = weekdays[(d + 4) % 7]; // 1970-01-01 foi quinta (índice 4)
      w.payments++;
      const b = dayNum(h.prevDueDate); if (b != null && d - b > 2) w.late++;
    }));

    // Aplicativo × suporte (campo "App" do cadastro)
    const appMap = {};
    all.forEach(x => {
      const raw = String(x.c.macApp || '').trim();
      const key = raw.toLowerCase() || '__sem__';
      const a = appMap[key] || (appMap[key] = { name: raw || 'Sem aplicativo', clients: 0, supports30: 0 });
      a.clients++; a.supports30 += x.m.supports30 || 0;
    });
    const apps = Object.values(appMap).map(a => ({ ...a, perClient: a.clients ? round1(a.supports30 / a.clients) : 0 }))
      .sort((a, b) => b.clients - a.clients).slice(0, 8);

    // Motivos de cancelamento (gravados ao excluir)
    const rmap = {};
    (window.deletedClients || []).forEach(c => { const r = String(c.cancelReason || '').trim() || 'Sem motivo informado'; rmap[r] = (rmap[r] || 0) + 1; });
    const reasons = Object.keys(rmap).map(r => ({ reason: r, count: rmap[r] })).sort((a, b) => b.count - a.count).slice(0, 10);

    // Compra de créditos: quem vence em 30 dias, mais 1 de folga, menos o estoque
    const compra = (servers || []).map(s => {
      const need30 = all.filter(x => (x.m.server || 'Sem servidor') === s.name && x.c.dueDate && x.m.daysToDue <= 30).length;
      const stock = s.creditStock == null ? null : Number(s.creditStock);
      return { name: s.name, stock, need30, buy: stock == null ? null : Math.max(0, need30 + 1 - stock), cost: s.costPerCredit == null ? null : s.costPerCredit };
    });

    // Clientes que saíram nos últimos 180 dias (sem testes), para reativação. Nomes ficam só no aparelho.
    const lost = (window.deletedClients || [])
      .filter(c => c && c.name && !c.isTrial && dayNum(c.deletedAt) != null && today - dayNum(c.deletedAt) <= 180)
      .map(c => ({ c, reason: String(c.cancelReason || '').trim(), daysAgo: today - dayNum(c.deletedAt) }))
      .sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 20);

    return { silent, upsell, promoters, cohorts, weekdays, apps, reasons, compra, lost };
  }

  // Só códigos e números seguem para a IA; nome e usuário ficam no aparelho
  function extraPayload(ex) {
    return {
      silent: ex.silent.map(x => ({ id: x.m.id, supports30: x.m.supports30, riskScore: x.m.riskScore, lateRenewals: x.m.lateRenewals, renewals: x.m.renewals })),
      upsell: ex.upsell.map(x => ({ id: x.m.id, renewals: x.m.renewals })),
      promoters: ex.promoters.map(x => ({ id: x.m.id, referrals: x.m.referrals })),
      apps: ex.apps.map(a => ({ name: a.name, clients: a.clients, supports30: a.supports30, perClient: a.perClient })),
      cohorts: ex.cohorts.map(c => ({ label: c.label, total: c.total, reached3: c.reached3 })),
      weekdays: ex.weekdays.map(d => ({ dia: d.nome, payments: d.payments, late: d.late })),
      reasons: ex.reasons,
      compra: ex.compra.map(s => ({ name: s.name, stock: s.stock, need30: s.need30, comprar: s.buy }))
    };
  }

  // ---------- Chamada ao Worker ----------
  const ERR = {
    login: 'Seu login expirou. Saia e entre de novo no app.',
    sem_acesso: 'Esta conta não tem acesso à análise com IA.',
    origem: 'O Worker não aceita este endereço do app. Confira ALLOWED_ORIGIN.',
    configuracao: 'O Worker está sem alguma configuração (chave, projeto ou e-mail Master).',
    limite: 'A Gemini recusou por limite de uso. Tente de novo mais tarde.',
    limite_hora: 'Limite de análises por hora atingido. Tente mais tarde.',
    chave: 'A chave da Gemini foi recusada. Confira o GEMINI_API_KEY no Worker.',
    modelo: 'O modelo da Gemini não foi encontrado. Defina GEMINI_MODEL com um nome válido do AI Studio.',
    formato: 'A Gemini recusou o formato do pedido. Defina GEMINI_MODEL com outro modelo.',
    resposta_vazia: 'A IA não devolveu a análise. Tente de novo.',
    rede: 'Não consegui falar com a Gemini. Tente de novo.',
    interno: 'O Worker teve um erro interno.',
    problema: 'Escolha um problema da lista antes de pedir ajuda.',
    objetivo: 'Escolha um objetivo da lista antes de gerar a mensagem.'
  };

  async function callAi(payload) {
    const url = window.AI_API_URL;
    if (!url || /COLE_AQUI/i.test(url)) throw new Error('Falta configurar o endereço do Worker em ai-config.js.');
    const user = window.currentUser;
    if (!user || !user.getIdToken) throw new Error(ERR.login);
    const token = await user.getIdToken();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 180000);
    try {
      const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) });
      let data = null, parseFailed = false;
      try { data = await r.json(); } catch (e) { parseFailed = true; }
      if (!r.ok) throw new Error((ERR[(data && data.error) || ''] || ('Erro ao gerar a análise (' + r.status + ').')) + (data && data.detalhe ? ' [' + data.detalhe + ']' : ''));
      // O Worker manda o 200 de cabeçalho logo no início e só fecha o corpo no fim (fluxo longo, com
      // pings a cada 5s para o celular não derrubar a conexão). Se a tela apagou, o app foi para
      // segundo plano ou a rede trocou no meio do caminho, o corpo chega incompleto: r.ok fica true,
      // mas não dá para extrair o JSON. Nesse caso a causa é a conexão, não o Worker.
      if (parseFailed || !data) throw new Error('A conexão caiu antes de a análise terminar. Deixe a tela do celular ligada e o app aberto em primeiro plano até o fim (de preferência no Wi-Fi) e tente de novo.');
      if (!data.ok) throw new Error((ERR[data.error || ''] || ('Erro ao gerar a análise (' + r.status + ').')) + (data.detalhe ? ' [' + data.detalhe + ']' : ''));
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('A análise demorou demais. Tente de novo.');
      if (e instanceof TypeError) throw new Error('Sem conexão com o Worker da IA. O app está em ' + location.origin + ' e chama ' + url + '. Abra o endereço do Worker no navegador e confira se ALLOWED_ORIGIN mostra exatamente o endereço do app.');
      throw e;
    } finally { clearTimeout(t); }
  }

  // Triagem de suporte: só app, servidor e um problema de uma lista fixa (sem texto livre do cliente)
  // ---------- Mensagem personalizada para um cliente (botão ✨ IA no cartão) ----------
  const MSG_OPTIONS = [
    ['cobranca', 'Lembrar do vencimento'],
    ['atraso', 'Cobrar atraso'],
    ['suporte', 'Acompanhar o suporte'],
    ['plano', 'Oferecer plano de 3 ou 6 meses'],
    ['indicacao', 'Pedir uma indicação']
  ];
  const MSG_KEEP = ['overdueDays', 'daysToDue', 'renewals', 'lateRenewals', 'delayTrend', 'supports30', 'supportOpenHours', 'referrals', 'tenureMonths', 'riskScore', 'lastPaymentDays', 'portalDaysSinceOpen', 'onTimePct'];

  window.openClientAiMessage = function (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    if (!window.isAiMasterNow()) { alert('Só a conta Master usa a IA.'); return; }
    const old = document.getElementById('aiMsgOverlay'); if (old) old.remove();
    const first = String(client.name || '').trim().split(/\s+/)[0] || '';
    const ov = document.createElement('div');
    ov.id = 'aiMsgOverlay';
    ov.className = 'modal-backdrop';
    ov.style.zIndex = '10050';
    ov.style.display = 'flex';
    ov.innerHTML = `
      <div class="modal-card" style="max-width: 440px; width: 92vw; text-align: left;">
        <h3 style="margin: 0 0 2px; font-size: 1rem;">✨ Mensagem com IA</h3>
        <p style="font-size: 0.74rem; color: var(--text-muted); margin: 0 0 10px;">Para ${esc(client.name || '')}. A IA recebe só números e o objetivo; o nome entra aqui, no seu aparelho.</p>
        <label for="aiMsgPurpose" style="font-size: 0.74rem; font-weight: 700;">Objetivo</label>
        <select id="aiMsgPurpose" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border); margin: 4px 0 8px;">${MSG_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <label for="aiMsgTone" style="font-size: 0.74rem; font-weight: 700;">Tom (opcional)</label>
        <input type="text" id="aiMsgTone" maxlength="200" value="${esc(localStorage.getItem(TONE_KEY) || '')}" placeholder="Ex: informal, curto, trato por você" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border); margin: 4px 0 8px; box-sizing: border-box;">
        <button type="button" id="aiMsgGen" style="width: 100%; background: #7c3aed; color: #fff; border: none; border-radius: 8px; padding: 9px; font-weight: 700; cursor: pointer;">🤖 Gerar mensagem</button>
        <div id="aiMsgErr" role="alert" style="display: none; color: #991b1b; font-size: 0.76rem; margin-top: 6px;"></div>
        <textarea id="aiMsgText" rows="6" aria-label="Mensagem" placeholder="A mensagem aparece aqui para você revisar." style="width: 100%; box-sizing: border-box; margin-top: 8px; padding: 8px; border-radius: 6px; border: 1px solid var(--border); font-size: 0.82rem;"></textarea>
        <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
          <button type="button" id="aiMsgSend" disabled style="flex: 2; background: #25d366; color: #fff; border: none; border-radius: 8px; padding: 9px; font-weight: 700; cursor: pointer; opacity: .5;">📲 Enviar no WhatsApp</button>
          <button type="button" id="aiMsgCopy" disabled style="flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 9px; background: transparent; cursor: pointer; opacity: .5;">Copiar</button>
          <button type="button" id="aiMsgClose" style="flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 9px; background: transparent; cursor: pointer;">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const $ = (id) => ov.querySelector('#' + id);
    const close = () => ov.remove();
    const setErr = (t) => { const e = $('aiMsgErr'); e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; };
    const enable = (on) => { ['aiMsgSend', 'aiMsgCopy'].forEach(id => { const b = $(id); b.disabled = !on; b.style.opacity = on ? '1' : '.5'; }); };
    // O Worker devolve {nome} e {login}; a troca acontece só aqui, no aparelho
    const fill = (msg) => String(msg || '').split('{nome}').join(first).split('{login}').join(client.username || '');

    $('aiMsgGen').onclick = async () => {
      const btn = $('aiMsgGen');
      btn.disabled = true; btn.textContent = '⏳ Escrevendo…';
      setErr(''); enable(false);
      try {
        const m = metricsFor(client, dayNum(safeGetTodayLocal()));
        const metrics = {}; MSG_KEEP.forEach(k => { metrics[k] = m[k] == null ? null : m[k]; });
        const tone = String($('aiMsgTone').value || '').slice(0, 200);
        try { localStorage.setItem(TONE_KEY, tone); } catch (e) {}
        const res = await callAi({ mode: 'mensagem', purpose: $('aiMsgPurpose').value, tone, metrics });
        $('aiMsgText').value = fill(res.message);
        enable(true);
      } catch (e) {
        setErr(e && e.message ? e.message : 'Não consegui gerar a mensagem.');
      } finally {
        btn.disabled = false; btn.textContent = '🤖 Gerar mensagem';
      }
    };
    $('aiMsgSend').onclick = () => { const t = $('aiMsgText').value.trim(); if (t) openWhatsAppDirect(client.phone, t); };
    $('aiMsgCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('aiMsgText').value);
        $('aiMsgCopy').textContent = 'Copiado ✓';
        setTimeout(() => { const b = $('aiMsgCopy'); if (b) b.textContent = 'Copiar'; }, 1500);
      } catch (e) { setErr('Não consegui copiar. Selecione o texto e copie.'); }
    };
    $('aiMsgClose').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  };

  // ---------- Cobrança com IA (botão "Cobrar agora") ----------
  // A IA escreve só a abertura (saudação e uma frase). Valor, Pix, portal e desconto são montados pelo app
  // (buildChargeMessage) e nunca passam pela IA. Abertura com número, data ou link é descartada.
  window.openChargeReview = function (client, dueDateFormatted, status, pixKey, refProgress, opts) {
    opts = opts || {};
    const tone = (typeof chargeToneFor === 'function') ? chargeToneFor(client, status) : 'normal';
    const purpose = (status.diffDays < 0 || tone === 'firme' || tone === 'ultimo') ? 'abertura_atraso' : 'abertura_cobranca';
    const tail = opts.finalTail || '';
    const compose = (intro) => buildChargeMessage(client, dueDateFormatted, status, pixKey, refProgress, intro || '') + tail;
    const fillNames = (s) => String(s || '').split('{nome}').join(client.name || '').split('{login}').join(client.username || '');

    const old = document.getElementById('aiChargeOverlay'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'aiChargeOverlay';
    ov.className = 'modal-backdrop';
    ov.style.zIndex = '10050';
    ov.style.display = 'flex';
    ov.innerHTML = `
      <div class="modal-card" style="max-width: 460px; width: 92vw; text-align: left;">
        <h3 style="margin: 0 0 2px; font-size: 1rem;">✨ Cobrança com IA</h3>
        <p style="font-size: 0.74rem; color: var(--text-muted); margin: 0 0 10px;">Para ${esc(client.name || '')}. A IA escreve só a abertura. Valor, Pix e portal vêm do app, como sempre.</p>
        <div id="aiChargeErr" role="alert" style="display: none; color: #991b1b; font-size: 0.76rem; margin-bottom: 6px;"></div>
        <textarea id="aiChargeText" rows="10" aria-label="Mensagem de cobrança" placeholder="Escrevendo a abertura…" style="width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px; border: 1px solid var(--border); font-size: 0.82rem;"></textarea>
        <button type="button" id="aiChargeSend" disabled style="width: 100%; margin-top: 8px; background: #25d366; color: #fff; border: none; border-radius: 8px; padding: 9px; font-weight: 700; cursor: pointer; opacity: .5;">📲 Enviar no WhatsApp</button>
        <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
          <button type="button" id="aiChargeRegen" disabled style="flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: transparent; cursor: pointer;">🤖 Outra abertura</button>
          <button type="button" id="aiChargeStd" disabled style="flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: transparent; cursor: pointer;">Modelo padrão</button>
          <button type="button" id="aiChargeClose" style="flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: transparent; cursor: pointer;">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const $ = (id) => ov.querySelector('#' + id);
    const close = () => ov.remove();
    let busy = false, lastShown = '';
    const setErr = (t) => { const e = $('aiChargeErr'); e.textContent = t || ''; e.style.display = t ? 'block' : 'none'; };
    const syncButtons = () => {
      const send = $('aiChargeSend');
      const ok = !busy && $('aiChargeText').value.trim() !== '';
      send.disabled = !ok; send.style.opacity = ok ? '1' : '.5';
      ['aiChargeRegen', 'aiChargeStd'].forEach(id => { const b = $(id); b.disabled = busy; b.style.opacity = busy ? '.5' : '1'; });
    };
    const edited = () => $('aiChargeText').value !== lastShown;
    const mayReplace = () => !edited() || confirm('Substituir o texto que você editou?');
    const show = (text) => { $('aiChargeText').value = text; lastShown = text; syncButtons(); };

    const gen = async () => {
      if (busy || !mayReplace()) return;
      busy = true; setErr(''); $('aiChargeText').value = ''; syncButtons();
      try {
        const m = metricsFor(client, dayNum(safeGetTodayLocal()));
        const metrics = {}; MSG_KEEP.forEach(k => { metrics[k] = m[k] == null ? null : m[k]; });
        const toneText = String(localStorage.getItem(TONE_KEY) || '').slice(0, 200);
        const res = await callAi({ mode: 'mensagem', purpose, tone: toneText, metrics });
        const raw = String(res.message || '').trim();
        // Trava local: se a IA pôs número, data, valor ou link na abertura, descarta e usa o modelo padrão
        if (!raw || /[0-9]|R\$|pix|https?:|www\./i.test(raw)) throw new Error('A IA escreveu número ou link na abertura. Usei o modelo padrão.');
        show(compose(fillNames(raw)));
      } catch (e) {
        show(compose(''));
        setErr(((e && e.message) || 'Não consegui gerar a abertura.') + (/Usei o modelo padrão/.test((e && e.message) || '') ? '' : ' Usei o modelo padrão.'));
      } finally { busy = false; syncButtons(); }
    };

    $('aiChargeText').addEventListener('input', syncButtons);
    $('aiChargeRegen').onclick = gen;
    $('aiChargeStd').onclick = () => { if (!busy && mayReplace()) { setErr(''); show(compose('')); } };
    $('aiChargeSend').onclick = () => {
      const t = $('aiChargeText').value.trim();
      if (!t) return;
      openWhatsAppDirect(client.phone, t);
      if (typeof opts.onSent === 'function') opts.onSent();
      close();
    };
    $('aiChargeClose').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    gen();
  };

  // ---------- Bloco "Prioridades da IA" na tela inicial (Carteira) ----------
  window.aiRenderHomeBox = function () {
    const box = document.getElementById('aiHomeBox');
    if (!box) return;
    if (!window.isAiMasterNow()) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const c = loadCache();
    const pri = (c && c.result && Array.isArray(c.result.priorities)) ? c.result.priorities.slice(0, 3) : [];
    const head = `<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;"><strong style="font-size: 0.88rem;">🧠 Prioridades da IA</strong><span style="font-size: 0.7rem; color: var(--text-muted);">${c && c.at ? 'Análise de ' + esc(whenLabel(c.at)) : 'Ainda não analisada'}</span></div>`;
    const list = pri.length
      ? `<ol style="margin: 0 0 8px; padding-left: 18px; font-size: 0.8rem; line-height: 1.45;">${pri.map(p => `<li><strong>${esc(p.title)}</strong>${p.action ? ' — ' + esc(p.action) : ''}</li>`).join('')}</ol>`
      : `<div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 8px;">A IA olha sua carteira, o suporte e o financeiro, e aponta o que fazer primeiro.</div>`;
    box.innerHTML = `<div style="border: 1px solid #ddd6fe; border-radius: 10px; padding: 10px 12px; margin: 8px 0;">${head}${list}<button type="button" onclick="openAiReport()" style="width: 100%; background: #7c3aed; color: #fff; border: none; border-radius: 8px; padding: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">${pri.length ? 'Ver análise completa' : '🤖 Analisar carteira'}</button></div>`;
    box.style.display = 'block';
  };

  window.aiTriage = async function (app, server, problema) {
    const url = window.AI_API_URL;
    if (!url || /COLE_AQUI/i.test(url)) throw new Error('Falta configurar o endereço do Worker em ai-config.js.');
    const user = window.currentUser;
    if (!user || !user.getIdToken) throw new Error(ERR.login);
    const token = await user.getIdToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ mode: 'triagem', app: String(app || '').slice(0, 40), servidor: String(server || '').slice(0, 40), problema: String(problema || '').slice(0, 60) })
    });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok || !data || !data.ok) throw new Error((ERR[(data && data.error) || ''] || ('Erro na triagem (' + r.status + ').')) + (data && data.detalhe ? ' [' + data.detalhe + ']' : ''));
    return data.passos || [];
  };

  // ---------- Tela ----------
  const LVL = { alto: ['Risco alto', '#dc2626'], medio: ['Risco médio', '#d97706'], baixo: ['Risco baixo', '#2563eb'], fiel: ['Cliente fiel', '#16a34a'] };

  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null'); } catch (e) { return null; } }
  function saveCache(v) { try { localStorage.setItem(CACHE_KEY(), JSON.stringify(v)); } catch (e) {} }

  function whenLabel(ts) {
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    const days = Math.floor((Date.now() - ts) / 86400000);
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}${days >= 7 ? ' (desatualizada)' : ''}`;
  }

  let state = null; // { data, ai, busy, error, view }

  const section = (title, inner, hint) => `<div class="ai-sec"><div class="ai-sec-t">${title}</div>${hint ? `<div class="ai-hint">${hint}</div>` : ''}${inner}</div>`;

  function kpiHtml(p) {
    const conv = p.trials30 ? Math.round(100 * p.trialsConverted30 / p.trials30) : null;
    const k = (v, l, color) => `<div><b${color ? ` style="color:${color};"` : ''}>${v}</b><span>${l}</span></div>`;
    return `<div class="ai-kpis">
      ${k(money0(p.mrr), 'receita mensal')}
      ${k(money0(p.margin), 'sobra após créditos')}
      ${k(money0(p.atRiskAmount), 'em risco de perder', p.atRiskAmount ? '#dc2626' : '')}
      ${k(p.onTimePct90 == null ? '—' : p.onTimePct90 + '%', 'renovam em dia (90d)')}
      ${k(`${p.overdue} • ${money0(p.overdueAmount)}`, 'atrasados', p.overdue ? '#dc2626' : '')}
      ${k(p.due7, 'vencem em 7 dias')}
      ${k(`+${p.new30} / −${p.lost30}`, 'novos / removidos (30d)')}
      ${k(conv == null ? '—' : conv + '%', 'testes que viraram cliente')}
      ${k(p.openSupportTickets || 0, p.oldestOpenHours ? `suporte(s) aberto(s) • mais antigo há ${p.oldestOpenHours < 24 ? p.oldestOpenHours + 'h' : Math.round(p.oldestOpenHours / 24) + 'd'}` : 'suporte(s) aberto(s)', p.openSupportTickets ? '#dc2626' : '')}
    </div>`;
  }

  function cashHtml(cash) {
    const max = Math.max.apply(null, cash.map(x => x.amount).concat([1]));
    const tot = sum(cash, x => x.amount), exp = sum(cash, x => x.expected);
    const rows = cash.map(x => `<div class="ai-bar"><span class="ai-bar-l">${x.label}</span>
      <div class="ai-bar-track"><i style="width:${Math.round(100 * x.amount / max)}%; background:${x.id === 'atrasados' ? '#dc2626' : 'var(--primary)'};"></i></div>
      <span class="ai-bar-v">${money0(x.amount)}<small>${x.count} cl.</small></span></div>`).join('');
    return section('💰 Caixa dos próximos 30 dias', rows + `<div class="ai-note">Total a receber: <b>${money0(tot)}</b> • provável pelo histórico de cada um: <b>${money0(exp)}</b></div>`, 'Soma dos valores de cada cliente por data de vencimento.');
  }

  function monthsHtml(months) {
    const max = Math.max.apply(null, months.map(x => x.revenue).concat([1]));
    const cols = months.map((x, i) => `<div class="ai-col"><span class="ai-col-v">${x.revenue ? money0(x.revenue) : '—'}</span>
      <div class="ai-col-bar"><i style="height:${Math.max(3, Math.round(100 * x.revenue / max))}%; opacity:${i === months.length - 1 ? 0.55 : 1};"></i></div>
      <span class="ai-col-l">${x.label}</span><small>${x.renewals} renov.</small><small>+${x.newClients}</small></div>`).join('');
    return section('📈 Últimos 6 meses', `<div class="ai-cols">${cols}</div>`, 'Receita das renovações pagas, quantas foram e clientes novos (+). O mês atual ainda está em andamento.');
  }

  function serversHtml(servers, ai) {
    if (!servers.length) return '';
    const insights = {}; ((ai && ai.result && ai.result.servers) || []).forEach(s => { insights[s.name] = s.insight; });
    const rows = servers.map(s => {
      const stock = s.creditStock == null ? '' : `<span class="${s.creditsNeeded > s.creditStock ? 'ai-bad' : ''}">crédito ${s.creditStock}/${s.creditsNeeded} p/ 7 dias</span>`;
      return `<div class="ai-srv"><div class="ai-srv-h"><strong>${esc(s.name)}</strong><span>${s.clients} clientes • ${money0(s.mrr)}</span></div>
        <div class="ai-chips"><span class="${s.overdue ? 'ai-bad' : ''}">${s.overdue} atrasado(s)</span><span>${s.due7} vencem em 7d</span><span>risco médio ${s.avgRisk}</span><span>${s.supportsPerClient} suporte/cliente (30d)</span>${stock}</div>
        ${insights[s.name] ? `<div class="ai-ins">${esc(insights[s.name])}</div>` : ''}</div>`;
    }).join('');
    return section('🖥️ Por servidor', rows);
  }

  function aiHtml(ai) {
    if (!ai || !ai.result) return '';
    const r = ai.result;
    let h = '';
    h += section('🧠 Diagnóstico', `<div class="ai-box">${esc(r.diagnosis || r.summary)}</div>${r.cash ? `<div class="ai-box"><b>Caixa:</b> ${esc(r.cash)}</div>` : ''}${r.support ? `<div class="ai-box"><b>Suporte:</b> ${esc(r.support)}</div>` : ''}`);
    if (r.priorities && r.priorities.length) {
      h += section('🎯 Plano da semana', r.priorities.map((p, i) => `<div class="ai-pri"><div class="ai-pri-n">${i + 1}</div><div>
        <div style="font-weight:700; font-size:0.86rem;">${esc(p.title)}</div>
        ${p.why ? `<div class="ai-pri-t">${esc(p.why)}</div>` : ''}
        ${p.action ? `<div class="ai-pri-t">👉 <strong>${esc(p.action)}</strong></div>` : ''}
        ${p.impact ? `<div class="ai-pri-t" style="color:var(--success);">Efeito esperado: ${esc(p.impact)}</div>` : ''}</div></div>`).join(''));
    }
    if (r.opportunities && r.opportunities.length) h += section('🌱 Oportunidades', `<ul class="ai-ul">${r.opportunities.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
    if (r.highlights && r.highlights.length) h += section('🔎 Padrões encontrados', `<ul class="ai-ul">${r.highlights.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
    return h;
  }

  const tbl = (head, rows) => `<div style="overflow-x:auto;"><table style="width:100%; font-size:0.74rem; border-collapse:collapse;"><thead><tr>${head.map(t => `<th style="text-align:left; padding:4px 6px; border-bottom:1px solid var(--border); color:var(--text-muted); font-weight:700;">${t}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td style="padding:4px 6px; border-bottom:1px solid var(--border);">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  // Estado dos blocos de reativação e do simulador (preenchido a cada tela)
  let lostList = [], lostMsgs = {}, simRows = [];
  // Chave igual à limpeza que o Worker aplica aos motivos (assim a mensagem da IA casa com o motivo daqui)
  const keyOf = (s) => String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60);
  const DEFAULT_MSG = 'Olá, {nome}! Tudo bem? Sentimos sua falta por aqui. Se quiser voltar a assistir, é só me chamar.';
  // Simulador: com o estoque + a compra, quantos dias cobre no ritmo dos próximos 30 dias
  const simOut = (row, qty) => {
    const total = row.stock + qty;
    const daily = row.need30 / 30;
    const parts = [daily > 0 ? `cobre ~${Math.floor(total / daily)} dias no ritmo atual` : 'sem vencimentos em 30 dias'];
    if (row.cost != null && qty > 0) parts.push(`custo R$ ${(qty * row.cost).toFixed(2).replace('.', ',')}`);
    return parts.join(' · ');
  };
  window.aiSimCredit = function(i, v) {
    const el = document.getElementById('ai-sim-' + i);
    if (el && simRows[i]) el.textContent = simOut(simRows[i], Math.max(0, Math.floor(Number(v) || 0)));
  };
  // Mensagem de volta: troca {nome} pelo nome só aqui, no aparelho, e abre o WhatsApp para você revisar e enviar
  window.aiReactivate = function(i) {
    const x = lostList[i]; if (!x) return;
    const tpl = lostMsgs[keyOf(x.reason)] || DEFAULT_MSG;
    openWhatsAppDirect(x.c.phone, tpl.split('{nome}').join(x.c.name || ''));
  };

  function extraHtml(data, ai) {
    const ex = data.extra; if (!ex) return '';
    const r = (ai && ai.result) || {};
    const pick = (arr, id) => { const f = (arr || []).find(x => x && x.id === id); return f ? esc(f.why) : ''; };
    const note = (t) => t ? `<br><span class="ai-ins">${t}</span>` : '';
    const who = (c) => `${esc(c.name || c.username || '')}${(c.name && c.username) ? ` <span style="color:var(--text-muted); font-weight:400;">(${esc(c.username)})</span>` : ''}`;
    const silentReason = (m) => {
      const p = [];
      if (m.supports30) p.push(`${m.supports30} suporte(s) em 30 dias`);
      if (m.delayTrend >= 2) p.push('atrasos crescendo');
      if (m.lateRenewals) p.push(`${m.lateRenewals} de ${m.renewals} renovações atrasadas`);
      if (m.portalDaysSinceOpen != null && m.portalDaysSinceOpen > 30) p.push(`portal sem abrir há ${m.portalDaysSinceOpen}d`);
      return p.join(' • ') || 'sinais leves';
    };
    let h = '';
    if (ex.silent.length) h += section('🔇 Risco silencioso', `<ul class="ai-ul">${ex.silent.map(x => `<li>${who(x.c)}: ${esc(silentReason(x.m))}${note(pick(r.churn, x.m.id))}</li>`).join('')}</ul>`, 'Em dia com o pagamento, mas com sinais de que pode cancelar. Vale uma conversa antes do vencimento.');
    if (ex.upsell.length) h += section('⬆️ Candidatos a plano longo', `<ul class="ai-ul">${ex.upsell.map(x => `<li>${who(x.c)}: ${x.m.renewals} renovações sem nenhum atraso${note(pick(r.upsell, x.m.id))}</li>`).join('')}</ul>`, 'Planos de 3 ou 6 meses antecipam caixa. Ofereça sem prometer desconto.');
    if (ex.promoters.length) h += section('⭐ Quem mais indica', `<ul class="ai-ul">${ex.promoters.map(x => `<li>${who(x.c)}: ${x.m.referrals} indicação(ões)${note(pick(r.promoters, x.m.id))}</li>`).join('')}</ul>`);
    h += section('🧭 Safra de entrada', tbl(['Mês', 'Entraram', 'Chegaram à 3ª', '%'], ex.cohorts.map(c => [esc(c.label), c.total, c.reached3, c.total ? Math.round(100 * c.reached3 / c.total) + '%' : '—'])) + (r.cohort ? `<div class="ai-box">${esc(r.cohort)}</div>` : ''), 'Quantos clientes de cada mês de entrada já chegaram à terceira renovação.');
    h += section('📅 Dia da semana dos pagamentos', tbl(['Dia', 'Pagamentos (90d)', 'Com atraso', '% atraso'], ex.weekdays.map(d => [d.nome, d.payments, d.late, d.payments ? Math.round(100 * d.late / d.payments) + '%' : '—'])) + (r.pico ? `<div class="ai-box">${esc(r.pico)}</div>` : ''), 'Os dias com mais atraso mostram quando vale disparar a cobrança.');
    if (ex.apps.length) h += section('📱 Aplicativo × suporte', tbl(['App', 'Clientes', 'Suportes (30d)', 'Por cliente'], ex.apps.map(a => [esc(a.name), a.clients, a.supports30, a.perClient])) + ((r.apps && r.apps.length) ? `<ul class="ai-ul">${r.apps.map(a => `<li><b>${esc(a.name)}</b>: ${esc(a.insight)}</li>`).join('')}</ul>` : ''), 'Apps com mais suporte por cliente são candidatos a migração preventiva. Vem do campo "App" do cadastro.');
    if (ex.reasons.length) h += section('🚪 Motivos de cancelamento', tbl(['Motivo', 'Clientes'], ex.reasons.map(x => [esc(x.reason), x.count])) + (r.reativacao ? `<div class="ai-box">${esc(r.reativacao)}</div>` : ''), 'Os motivos passam a ser gravados ao excluir um cliente.');
    if (ex.lost && ex.lost.length) {
      lostList = ex.lost;
      lostMsgs = {};
      ((r.reativacaoMsgs) || []).forEach(m => { lostMsgs[keyOf(m.reason)] = m.message; });
      const rowsL = ex.lost.map((x, i) => `<li style="margin-bottom:6px;">${who(x.c)} <span style="color:var(--text-muted);">· ${esc(x.reason || 'sem motivo')} · ${x.daysAgo === 0 ? 'hoje' : 'há ' + x.daysAgo + ' dias'}</span> <button type="button" onclick="aiReactivate(${i})" style="background:#25d366; color:#fff; border:none; border-radius:6px; padding:3px 8px; font-size:0.72rem; font-weight:700; cursor:pointer;">📲 Mandar</button></li>`).join('');
      h += section('↩️ Clientes que saíram', `<ul class="ai-ul">${rowsL}</ul>`, 'Mensagem de volta por motivo, escrita pela IA. O nome entra só no seu aparelho, e o WhatsApp abre para você revisar antes de enviar.');
    }
    if (ex.compra.length) {
      simRows = ex.compra.map(s => ({ stock: s.stock == null ? 0 : s.stock, need30: s.need30, cost: s.cost }));
      const simHtml = ex.compra.map((s, i) => {
        const q = s.buy == null ? 0 : s.buy;
        return `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 0; border-bottom:1px solid var(--border);"><strong style="font-size:0.8rem; min-width:90px;">${esc(s.name)}</strong><input type="number" min="0" step="1" value="${q}" oninput="aiSimCredit(${i}, this.value)" style="width:76px; padding:4px 6px; border-radius:6px; border:1px solid var(--border);"><span id="ai-sim-${i}" style="font-size:0.74rem; color:var(--text-muted);">${esc(simOut(simRows[i], q))}</span></div>`;
      }).join('');
      h += section('💳 Compra de créditos', tbl(['Servidor', 'Estoque', 'Vencem em 30d', 'Sugestão'], ex.compra.map(s => [esc(s.name), s.stock == null ? 'sem controle' : s.stock, s.need30, s.buy == null ? '—' : s.buy])) + `<div style="font-size:0.72rem; color:var(--text-muted); margin:8px 0 2px;">Simule uma compra (quantidade de créditos):</div>${simHtml}` + (r.compra ? `<div class="ai-box">${esc(r.compra)}</div>` : ''), 'Conta: clientes que vencem em 30 dias, mais 1 de folga, menos o estoque. O simulador usa o mesmo ritmo, sem desconto, porque o desconto não está no app.');
    }
    return h;
  }

  function render() {
    const body = document.getElementById('aiReportBody');
    if (!body || !state) return;
    const { data, ai, busy, error } = state;
    const byId = {}; (ai && ai.result ? ai.result.clients : []).forEach(x => { byId[x.id] = x; });
    const rows = data.risky.concat(data.loyal);
    const tone = (localStorage.getItem(TONE_KEY) || '');

    let h = kpiHtml(data.portfolio);
    h += `<div class="field" style="margin:12px 0 8px;"><label for="aiTone" style="font-size:0.74rem;">Seu jeito de falar com cliente (opcional)</label>
      <input type="text" id="aiTone" maxlength="200" placeholder="Ex: informal, curto, trato por você" value="${esc(tone)}"></div>`;
    h += `<button type="button" id="aiRun" class="btn-pix-save" style="width:100%; background:#7c3aed;" ${busy ? 'disabled' : ''}>${busy ? '⏳ Analisando… pode levar 1 a 2 minutos; mantenha esta tela aberta' : (ai ? '🔄 Gerar nova análise com IA' : '🤖 Gerar análise com IA')}</button>`;
    h += `<div style="font-size:0.7rem; color:var(--text-muted); margin:6px 0 10px;">${ai ? `Última análise: ${whenLabel(ai.at)}${ai.model ? ' • ' + esc(ai.model) : ''}. ` : ''}A IA recebe só números e códigos; nomes e telefones ficam no seu aparelho.</div>`;
    if (error) h += `<div role="alert" style="background:#fef2f2; color:#991b1b; border:1px solid #fca5a5; border-radius:8px; padding:8px 10px; font-size:0.78rem; margin-bottom:10px;">${esc(error)}</div>`;

    h += aiHtml(ai);
    h += cashHtml(data.cash);
    h += monthsHtml(data.months);
    h += serversHtml(data.servers, ai);
    h += extraHtml(data, ai);

    if (!rows.length) {
      h += `<div class="ai-box">Nenhum cliente com sinal de risco agora. 👏</div>`;
    } else {
      const order = { alto: 0, medio: 1, baixo: 2, fiel: 3 };
      const view = rows.map(x => {
        const a = byId[x.m.id];
        const level = a ? a.level : (isLoyal(x.m) ? 'fiel' : localLevel(x.m.riskScore));
        return { x, a, level };
      }).sort((p, q) => (order[p.level] - order[q.level]) || (q.x.m.riskScore - p.x.m.riskScore));
      h += `<div class="ai-sec-t" style="margin-top:14px;">👥 Para olhar primeiro (${rows.length})</div>`;
      h += view.map(({ x, a, level }, i) => {
        const m = x.m, lv = LVL[level] || LVL.medio;
        const chips = [];
        if (m.overdueDays) chips.push(`atraso ${m.overdueDays}d`);
        if (m.renewals) chips.push(`${m.renewals} renov.${m.lateRenewals ? ' (' + m.lateRenewals + ' atrasadas)' : ''}`);
        if (m.delayTrend != null && m.delayTrend >= 3) chips.push('atrasos aumentando');
        if (m.lastPaymentDays != null) chips.push(`pagou há ${m.lastPaymentDays}d`);
        if (m.supports30) chips.push(`${m.supports30} suporte(s)/30d`);
        if (m.referrals) chips.push(`${m.referrals} indicação(ões)`);
        chips.push(money(m.price));
        return `<div class="ai-row" data-i="${i}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <strong style="font-size:0.9rem;">${esc(x.c.name || x.c.username)}${(x.c.name && x.c.username) ? ` <span style="font-weight:400; color:var(--text-muted); font-size:0.78rem;">(${esc(x.c.username)})</span>` : ''}</strong>
            <span class="ai-badge" style="background:${lv[1]};">${lv[0]}</span>
          </div>
          <div class="ai-chips">${chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>
          <div style="font-size:0.8rem; margin-top:6px;">${esc(a && a.reason ? a.reason : localReason(m))}</div>
          ${a && a.action ? `<div style="font-size:0.8rem; margin-top:4px;">👉 <strong>${esc(a.action)}</strong></div>` : ''}
          ${a && a.message ? `<textarea class="ai-msg" rows="3" aria-label="Mensagem sugerida">${esc(a.message.replace(/\{nome\}/g, String(x.c.name || '').trim().split(/\s+/)[0] || ''))}</textarea>
          <div class="ai-btns"><button type="button" data-act="send">💬 Enviar</button><button type="button" data-act="copy">📋 Copiar</button><button type="button" data-act="open">Abrir ficha</button></div>`
          : `<div class="ai-btns"><button type="button" data-act="open">Abrir ficha</button></div>`}
        </div>`;
      }).join('');
      state.view = view;
    }
    body.innerHTML = h;

    const run = document.getElementById('aiRun'); if (run) run.addEventListener('click', runAnalysis);
    const toneEl = document.getElementById('aiTone'); if (toneEl) toneEl.addEventListener('change', () => { try { localStorage.setItem(TONE_KEY, toneEl.value.trim().slice(0, 200)); } catch (e) {} });
    body.querySelectorAll('.ai-row').forEach(row => {
      const v = (state.view || [])[parseInt(row.dataset.i, 10)]; if (!v) return;
      row.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        const act = b.dataset.act, ta = row.querySelector('.ai-msg'), msg = ta ? ta.value : '';
        if (act === 'send') { if (!v.x.c.phone) return showToast('Cliente sem telefone'); openWhatsAppDirect(v.x.c.phone, msg); }
        else if (act === 'copy') { copyTextSafe(msg, b, 'Copiado ✓'); }
        else if (act === 'open') { closeModal(); const s = document.getElementById('search'); if (s) s.value = v.x.c.name || v.x.c.username || ''; switchAppTab('clients'); if (typeof setFilter === 'function') { try { setFilter('all', document.querySelector('.tab')); } catch (e) {} } currentPage = 1; renderClients(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      }));
    });
  }

  async function runAnalysis() {
    if (!state || state.busy) return;
    const toneEl = document.getElementById('aiTone');
    const tone = toneEl ? toneEl.value.trim().slice(0, 200) : '';
    try { localStorage.setItem(TONE_KEY, tone); } catch (e) {}
    const data = collect();
    state.data = data; state.busy = true; state.error = '';
    render();
    const items = data.risky.map(x => Object.assign({}, x.m, { kind: 'risco' })).concat(data.loyal.map(x => Object.assign({}, x.m, { kind: 'fiel' })));
    if (!items.length) { state.busy = false; render(); return; }
    try {
      const res = await callAi({
        clients: items, portfolio: data.portfolio, tone,
        servers: data.servers,
        months: data.months.map(x => ({ idx: x.idx - data.months[0].idx, renewals: x.renewals, revenue: x.revenue, newClients: x.newClients })),
        cash: data.cash.map(x => ({ id: x.id, count: x.count, amount: x.amount, expected: x.expected })),
        extra: extraPayload(data.extra)
      });
      state.ai = { at: Date.now(), model: res.model || '', result: res.result };
      saveCache(state.ai);
      if (window.aiRenderHomeBox) window.aiRenderHomeBox();
      buzz(40);
    } catch (e) {
      state.error = e && e.message ? e.message : 'Não foi possível gerar a análise.';
    }
    state.busy = false;
    render();
  }

  function closeModal() { const m = document.getElementById('aiReportModal'); if (m) m.remove(); state = null; }

  window.openAiReport = function () {
    if (typeof closeFabMenu === 'function') closeFabMenu();
    if (!isMasterOwn()) return alert('A análise com IA está disponível só para a conta Master.');
    const old = document.getElementById('aiReportModal'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'aiReportModal'; ov.className = 'modal-backdrop'; ov.style.cssText = 'display:flex; z-index:10050;';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="modal-card" style="max-width:560px; width:100%; max-height:90vh; overflow-y:auto; text-align:left; padding:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; font-size:1rem;">🤖 Análise da carteira</h3>
        <button type="button" id="aiClose" aria-label="Fechar" style="border:none; background:transparent; font-size:1.3rem; cursor:pointer; color:var(--text-muted);">✕</button>
      </div>
      <div id="aiReportBody"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    ov.querySelector('#aiClose').addEventListener('click', closeModal);
    state = { data: collect(), ai: loadCache(), busy: false, error: '' };
    render();
  };

  // ---------- Estilos ----------
  const css = document.createElement('style');
  css.textContent = `
    .ai-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
    .ai-kpis > div { background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:8px 4px; text-align:center; min-width:0; }
    .ai-kpis b { display:block; font-size:0.92rem; overflow-wrap:anywhere; }
    .ai-kpis span { display:block; font-size:0.6rem; color:var(--text-muted); line-height:1.2; margin-top:2px; }
    .ai-sec { margin-top:14px; }
    .ai-sec-t { font-weight:700; font-size:0.86rem; margin-bottom:6px; }
    .ai-hint { font-size:0.68rem; color:var(--text-muted); margin:-3px 0 7px; }
    .ai-note { font-size:0.76rem; margin-top:8px; color:var(--text-main); }
    .ai-box { background:var(--surface-alt); border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-size:0.82rem; margin-bottom:8px; line-height:1.45; }
    .ai-ul { margin:0 0 0 18px; padding:0; font-size:0.82rem; line-height:1.45; }
    .ai-ul li { margin-bottom:4px; }
    .ai-pri { display:flex; gap:10px; align-items:flex-start; padding:9px 0; border-top:1px solid var(--border); }
    .ai-pri:first-of-type { border-top:none; }
    .ai-pri-n { flex:0 0 24px; height:24px; border-radius:50%; background:var(--primary); color:#fff; font-size:0.78rem; font-weight:700; display:flex; align-items:center; justify-content:center; }
    .ai-pri-t { font-size:0.79rem; margin-top:3px; line-height:1.4; }
    .ai-bar { display:grid; grid-template-columns:104px 1fr 78px; gap:8px; align-items:center; margin-bottom:6px; font-size:0.74rem; }
    .ai-bar-l { color:var(--text-muted); }
    .ai-bar-track { height:10px; background:var(--surface-alt); border-radius:99px; overflow:hidden; border:1px solid var(--border); }
    .ai-bar-track i { display:block; height:100%; border-radius:99px; }
    .ai-bar-v { text-align:right; font-weight:700; }
    .ai-bar-v small { display:block; font-weight:400; font-size:0.62rem; color:var(--text-muted); }
    .ai-cols { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; align-items:end; }
    .ai-col { display:flex; flex-direction:column; align-items:center; gap:2px; min-width:0; text-align:center; }
    .ai-col-v { font-size:0.62rem; font-weight:700; }
    .ai-col-bar { width:100%; height:70px; display:flex; align-items:flex-end; background:var(--surface-alt); border-radius:6px; overflow:hidden; }
    .ai-col-bar i { display:block; width:100%; background:var(--primary); border-radius:6px 6px 0 0; }
    .ai-col-l { font-size:0.68rem; font-weight:700; }
    .ai-col small { font-size:0.58rem; color:var(--text-muted); line-height:1.1; }
    .ai-srv { border:1px solid var(--border); border-radius:10px; padding:9px 12px; margin-bottom:7px; background:var(--surface); }
    .ai-srv-h { display:flex; justify-content:space-between; gap:8px; font-size:0.84rem; flex-wrap:wrap; }
    .ai-srv-h span { color:var(--text-muted); font-size:0.74rem; }
    .ai-ins { font-size:0.78rem; margin-top:6px; line-height:1.4; }
    .ai-bad { color:#dc2626 !important; border-color:#fca5a5 !important; }
    .ai-row { border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:8px; background:var(--surface); }
    .ai-badge { color:#fff; font-size:0.66rem; font-weight:700; padding:3px 8px; border-radius:99px; white-space:nowrap; }
    .ai-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
    .ai-chips span { background:var(--surface-alt); border:1px solid var(--border); border-radius:99px; padding:2px 8px; font-size:0.68rem; color:var(--text-muted); }
    .ai-msg { width:100%; box-sizing:border-box; margin-top:8px; font-size:0.8rem; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--surface-alt); color:var(--text-main); resize:vertical; }
    .ai-btns { display:flex; gap:6px; margin-top:8px; }
    .ai-btns button { flex:1; min-height:38px; border:1px solid var(--border); border-radius:8px; background:var(--surface-alt); color:var(--text-main); font-size:0.78rem; font-weight:700; cursor:pointer; }
    .ai-btns button[data-act="send"] { background:#16a34a; color:#fff; border-color:#16a34a; }
    @media (max-width: 460px) { .ai-kpis { grid-template-columns:repeat(2,1fr); } .ai-bar { grid-template-columns:86px 1fr 70px; } }
  `;
  document.head.appendChild(css);
})();