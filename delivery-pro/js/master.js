// Painel Master do SaaS (/master): lojas, planos, testes, alerta de loja parada, parceiros e configuração.
// Tudo passa pelo Worker (/api/master), que confere se o login é de um Master.
import { auth, formatarCentavos, showToast, esc } from './config.js';
import { statusAssinatura } from './plano.js';

const DIA_MS = 24 * 60 * 60 * 1000;
let lojas = [];
let stats = {};
let filtro = 'todas';
let busca = '';

async function api(corpo) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch('/api/master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo)
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(dados.erro || 'Erro no servidor.'); e.status = r.status; throw e; }
  return dados;
}

const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DIA_MS) : null);

export async function iniciarMaster() {
  const root = document.getElementById('app-root');
  document.getElementById('global-topbar')?.classList.remove('hidden');
  const nomeTopo = document.getElementById('topbar-store-name');
  if (nomeTopo) nomeTopo.textContent = 'Painel Master';

  if (!auth.currentUser) {
    root.innerHTML = '<div class="card"><h2>🔐 Painel Master</h2><p>Entre com sua conta de administrador (botão "Entrar" no topo).</p></div>';
    return;
  }
  root.innerHTML = '<div class="card"><p>Carregando lojas...</p></div>';
  try {
    const r = await api({ acao: 'listar' });
    lojas = r.lojas || [];
  } catch (err) {
    root.innerHTML = `<div class="card"><h2>🔒 Acesso restrito</h2><p>${esc(err.status === 403 ? 'Esta conta não é de administrador.' : err.message)}</p></div>`;
    return;
  }
  render();
  carregarEstatisticas();
}

async function carregarEstatisticas() {
  const ids = lojas.map(l => l.id);
  for (let i = 0; i < ids.length; i += 10) {
    try {
      const r = await api({ acao: 'estatisticas', lojaIds: ids.slice(i, i + 10) });
      Object.assign(stats, r.estatisticas || {});
      render();
    } catch (err) { console.error(err); }
  }
}

function classificar(l) {
  const ass = statusAssinatura(l);
  const st = stats[l.id];
  const pagante = ['essencial', 'pro'].includes(l.plano) && ass.ativa;
  const parada = pagante && st && (st.ultimoPedido ? diasDesde(st.ultimoPedido) >= 5 : diasDesde(l.criadoEm) >= 5);
  const vencendo = ass.ativa && ass.fim && ass.fim - Date.now() < 2 * DIA_MS;
  return { ass, st, pagante, parada, vencendo };
}

function render() {
  const root = document.getElementById('app-root');
  const info = lojas.map(l => ({ l, ...classificar(l) }));
  const k = {
    total: info.length,
    teste: info.filter(x => x.ass.emTeste).length,
    pagantes: info.filter(x => x.pagante).length,
    bloqueadas: info.filter(x => !x.ass.ativa).length,
    vencendo: info.filter(x => x.vencendo).length,
    paradas: info.filter(x => x.parada).length
  };
  const visiveis = info.filter(x => {
    if (busca && !`${x.l.nome} ${x.l.slug} ${x.l.whatsapp || ''}`.toLowerCase().includes(busca)) return false;
    if (filtro === 'teste') return x.ass.emTeste;
    if (filtro === 'pagantes') return x.pagante;
    if (filtro === 'bloqueadas') return !x.ass.ativa;
    if (filtro === 'alertas') return x.parada || x.vencendo;
    return true;
  });
  const parceiros = {};
  lojas.forEach(l => { if (l.origemParceiro) parceiros[l.origemParceiro] = (parceiros[l.origemParceiro] || 0) + 1; });

  root.innerHTML = `
    <div class="ms-kpis">
      ${[['Lojas', k.total, 'todas'], ['Em teste', k.teste, 'teste'], ['Pagantes', k.pagantes, 'pagantes'], ['Bloqueadas', k.bloqueadas, 'bloqueadas'], ['Alertas', k.vencendo + k.paradas, 'alertas']]
        .map(([t, v, f]) => `<button class="ms-kpi${filtro === f ? ' ativo' : ''}" data-filtro="${f}"><strong>${v}</strong><span>${t}</span></button>`).join('')}
    </div>
    <div class="ms-barra">
      <input id="ms-busca" type="search" placeholder="🔍 Buscar loja, link ou WhatsApp" value="${esc(busca)}" />
      <a class="btn-outline-sm" href="/demo" target="_blank" rel="noopener" style="text-decoration:none;">🛵 Simulador de rota</a>
      <button class="btn-outline-sm" id="ms-config">⚙ Configurações</button>
    </div>
    <div class="ms-lista">
      ${visiveis.length ? visiveis.map(cartao).join('') : '<div class="card"><p class="gc-dica">Nenhuma loja neste filtro.</p></div>'}
    </div>
    <div class="card">
      <h3>🤝 Parceiros (indicações)</h3>
      ${Object.keys(parceiros).length
        ? Object.entries(parceiros).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<div class="tr-linha"><span>${esc(p)}</span><strong>${n} loja(s)</strong></div>`).join('')
        : '<p class="gc-dica">Nenhuma loja veio por link de parceiro ainda. Link de indicação: <code>' + esc(window.location.origin) + '/?ref=NOME</code></p>'}
    </div>
  `;
  root.querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => { filtro = b.dataset.filtro; render(); });
  const campoBusca = root.querySelector('#ms-busca');
  campoBusca.oninput = () => { busca = campoBusca.value.trim().toLowerCase(); const pos = campoBusca.selectionStart; render(); const novo = document.getElementById('ms-busca'); novo.focus(); novo.setSelectionRange(pos, pos); };
  root.querySelector('#ms-config').onclick = abrirConfig;
  root.querySelectorAll('[data-acao]').forEach(b => b.onclick = () => executar(b.dataset.loja, b.dataset.acao, b.dataset.dias));
}

function cartao({ l, ass, st, parada, vencendo }) {
  const rotuloPlano = { teste: 'Teste', essencial: 'Essencial', pro: 'Pro', bloqueada: 'Bloqueada', livre: 'Sem plano' }[ass.plano] || ass.plano;
  const situacao = !ass.ativa ? '🔴 Bloqueada' : ass.emCarencia ? '🟠 Em tolerância' : ass.emTeste ? `🟡 Teste · ${ass.diasRestantes ?? '?'} dia(s)` : '🟢 Ativa';
  const zap = String(l.whatsapp || '').replace(/\D/g, '');
  const ultimo = st ? (st.ultimoPedido ? `há ${diasDesde(st.ultimoPedido)} dia(s)` : 'nunca') : '…';
  return `
    <div class="card ms-loja${parada || vencendo ? ' alerta' : ''}">
      <div class="ms-topo">
        <div>
          <strong>${esc(l.nome)}</strong> <span class="badge">${esc(rotuloPlano)}</span>
          <div class="gc-dica" style="margin:2px 0 0;">
            <a href="/${esc(l.slug || '')}" target="_blank" rel="noopener">/${esc(l.slug || '—')}</a>
            · criada ${dataBr(l.criadoEm)}${l.origemParceiro ? ` · parceiro: ${esc(l.origemParceiro)}` : ''}
          </div>
        </div>
        <span class="ms-situacao">${situacao}</span>
      </div>
      <div class="ms-dados">
        <span>📦 7 dias: <strong>${st ? st.pedidos7d : '…'}</strong> pedidos</span>
        <span>💰 ${st ? formatarCentavos(st.total7dCentavos) : '…'}</span>
        <span>🕒 Último pedido: <strong>${ultimo}</strong></span>
        <span>📅 Vence: ${ass.fim ? new Date(ass.fim).toLocaleDateString('pt-BR') : '—'}</span>
      </div>
      ${parada ? '<div class="pedido-aviso">⚠ Loja pagante parada há 5 dias ou mais — ligue para o dono antes que ele cancele.</div>' : ''}
      ${vencendo ? '<div class="tr-alerta" style="margin:6px 0;">⏳ Vence em menos de 2 dias.</div>' : ''}
      <div class="ms-acoes">
        ${zap ? `<a class="btn-outline-sm" href="https://wa.me/55${esc(zap.replace(/^55/, ''))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        ${l.slug ? `<a class="btn-outline-sm" href="/demo?loja=${esc(l.slug)}" target="_blank" rel="noopener" title="Simular uma entrega saindo desta loja">🎬 Simular entrega</a>` : ''}
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="teste" data-dias="7">+7 dias de teste</button>
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="essencial" data-dias="30">Essencial 30 dias</button>
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="pro" data-dias="30">Pro 30 dias</button>
        ${ass.plano !== 'bloqueada' ? `<button class="btn-outline-sm gc-perigo" data-loja="${esc(l.id)}" data-acao="bloqueada">Bloquear</button>` : ''}
      </div>
    </div>`;
}

async function executar(lojaId, plano, dias) {
  const loja = lojas.find(l => l.id === lojaId);
  const msg = plano === 'bloqueada' ? `Bloquear "${loja.nome}"? O cardápio e o painel ficam pausados.`
    : plano === 'teste' ? `Dar mais ${dias} dias de teste para "${loja.nome}"?`
    : `Ativar o plano ${plano === 'pro' ? 'Pro' : 'Essencial'} por ${dias} dias para "${loja.nome}"? (use depois de receber o pagamento)`;
  if (!confirm(msg)) return;
  try {
    const r = await api({ acao: 'plano', lojaId, plano, dias: Number(dias) || 0 });
    Object.assign(loja, r.loja);
    showToast('Atualizado!');
    render();
  } catch (err) { showToast(err.message); }
}

async function abrirConfig() {
  let cfg = {};
  try { cfg = (await api({ acao: 'lerConfig' })).config || {}; } catch (_) {}
  const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:440px; width:100%; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>⚙ Configurações do SaaS</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <label>Seu WhatsApp de vendas/suporte (com DDD)</label>
      <input name="zap" value="${esc(cfg.whatsappSuporte || '')}" placeholder="11999999999" />
      <div class="gc-linha">
        <div><label>Preço Essencial (R$/mês)</label><input name="essencial" inputmode="decimal" value="${reais(cfg.precoEssencialCentavos)}" /></div>
        <div><label>Preço Pro (R$/mês)</label><input name="pro" inputmode="decimal" value="${reais(cfg.precoProCentavos)}" /></div>
      </div>
      <label>Comissão média dos apps de delivery (%) — usada no cálculo de economia</label>
      <input name="pct" inputmode="numeric" value="${Number(cfg.comissaoMarketplacePct) || 20}" />
      <h4 class="gc-subtitulo">📄 Seus dados nos Termos e na Privacidade</h4>
      <p class="gc-dica">Aparecem nas páginas /termos e /privacidade como responsável e contato (LGPD).</p>
      <label>Seu nome ou razão social</label>
      <input name="respNome" maxlength="100" value="${esc(cfg.responsavelNome || '')}" placeholder="Ex: Rodrigo Silva ou Delivery Pro Tecnologia Ltda" />
      <div class="gc-linha">
        <div><label>CPF ou CNPJ (opcional)</label><input name="respDoc" maxlength="20" value="${esc(cfg.responsavelDoc || '')}" /></div>
        <div><label>E-mail de contato</label><input name="respEmail" type="email" maxlength="100" value="${esc(cfg.emailContato || '')}" /></div>
      </div>
      <button class="btn-primary" type="submit" style="margin-top:12px;">💾 Salvar</button>

      <h4 class="gc-subtitulo">💳 Receber mensalidades por Pix (Mercado Pago)</h4>
      <div id="ms-mp"><p class="gc-dica">Carregando...</p></div>
      <h4 class="gc-subtitulo">Últimos pagamentos de mensalidade</h4>
      <div id="ms-cobrancas"><p class="gc-dica">Carregando...</p></div>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  desenharMercadoPago(overlay.querySelector('#ms-mp'));
  desenharCobrancas(overlay.querySelector('#ms-cobrancas'));
  overlay.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const centavos = (t) => { let s = String(t).replace(/R\$|\s/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
    const dados = {
      whatsappSuporte: f.zap.value.replace(/\D/g, ''),
      precoEssencialCentavos: centavos(f.essencial.value),
      precoProCentavos: centavos(f.pro.value),
      comissaoMarketplacePct: Math.min(50, Math.max(0, Number(f.pct.value) || 0)),
      responsavelNome: f.respNome.value.trim(),
      responsavelDoc: f.respDoc.value.trim(),
      emailContato: f.respEmail.value.trim()
    };
    if (dados.precoEssencialCentavos === null || dados.precoProCentavos === null) return showToast('Preço inválido.');
    try { await api({ acao: 'salvarConfig', config: dados }); showToast('Configurações salvas!'); overlay.remove(); }
    catch (err) { showToast(err.message); }
  };
}

// Conta Mercado Pago do dono do SaaS: recebe as mensalidades e libera os dias sozinho
async function desenharMercadoPago(box) {
  let st = { conectado: false };
  try { st = await api({ acao: 'mpStatus' }); } catch (_) {}
  if (st.conectado) {
    box.innerHTML = `
      <div class="pix-ok">✅ <strong>Cobrança automática ligada</strong><span>Conta: ${esc(st.conta || 'Mercado Pago')}</span></div>
      <p class="gc-dica">As lojas veem "Pagar com Pix" na faixa do teste, 5 dias antes de vencer e na tela de bloqueio. Pagou → +30 dias liberados na hora.</p>
      <button class="btn-outline-sm gc-perigo" type="button" id="ms-mp-desligar">Desligar</button>`;
    box.querySelector('#ms-mp-desligar').onclick = async () => {
      if (!confirm('Desligar a cobrança automática? As lojas voltam a ver o botão do WhatsApp.')) return;
      try { await api({ acao: 'mpDesligar' }); showToast('Desligado.'); desenharMercadoPago(box); } catch (err) { showToast(err.message); }
    };
    return;
  }
  box.innerHTML = `
    <p class="gc-dica">Cole o <strong>Access Token de produção</strong> da SUA conta Mercado Pago (mercadopago.com.br/developers → Suas integrações → Criar aplicação → Credenciais de produção). Começa com <code>APP_USR-</code>.</p>
    <input id="ms-mp-token" type="password" autocomplete="off" placeholder="APP_USR-..." />
    <button class="btn-outline-sm" type="button" id="ms-mp-salvar" style="margin-top:8px;">Conectar Mercado Pago</button>`;
  box.querySelector('#ms-mp-salvar').onclick = async (e) => {
    const btn = e.currentTarget;
    const token = box.querySelector('#ms-mp-token').value.trim();
    if (!token) return showToast('Cole o Access Token.');
    btn.disabled = true;
    try { const r = await api({ acao: 'mpSalvar', token }); showToast(`Conectado: ${r.conta}`); desenharMercadoPago(box); }
    catch (err) { showToast(err.message, 6000); btn.disabled = false; }
  };
}

async function desenharCobrancas(box) {
  try {
    const { cobrancas = [] } = await api({ acao: 'cobrancas' });
    const rotulo = { aprovado: '✅ pago', pendente: '⏳ aguardando', expirado: '⌛ expirou' };
    box.innerHTML = cobrancas.length ? cobrancas.slice(0, 20).map(c => `
      <div class="av-linha">
        <span>${esc(c.lojaNome || c.lojaId)} · ${c.plano === 'pro' ? 'Pro' : 'Essencial'}</span>
        <span>${formatarCentavos(c.valorCentavos)}</span>
        <small>${rotulo[c.status] || esc(c.status)} ${c.pagoEm || c.criadoEm ? new Date(c.pagoEm || c.criadoEm).toLocaleDateString('pt-BR') : ''}</small>
      </div>`).join('') : '<p class="gc-dica">Nenhum pagamento ainda.</p>';
  } catch (_) { box.innerHTML = '<p class="gc-dica">Não foi possível carregar.</p>'; }
}
