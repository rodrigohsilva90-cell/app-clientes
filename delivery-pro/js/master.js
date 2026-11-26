// Painel Master do SaaS (/master): lojas, planos, testes, alerta de loja parada, parceiros e configuração.
// Tudo passa pelo Worker (/api/master), que confere se o login é de um Master.
import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { statusAssinatura } from './plano.js';
import { RAMOS, cardapioDoRamo, buscasDosModelos, BUSCA_FOTO, BUSCA_RAMO } from './importar-cardapio.js';
import { doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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
      <button class="btn-primary" id="ms-criar-loja" style="width:auto;">🏪 Criar loja para cliente</button>
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
  root.querySelector('#ms-criar-loja').onclick = abrirCriarLoja;
  root.querySelectorAll('[data-transferir]').forEach(b => b.onclick = () => abrirTransferir(lojas.find(l => l.id === b.dataset.transferir)));
  root.querySelectorAll('[data-excluir]').forEach(b => b.onclick = () => abrirExcluir(lojas.find(l => l.id === b.dataset.excluir)));
  root.querySelectorAll('[data-fotos]').forEach(b => b.onclick = () => colocarFotos(lojas.find(l => l.id === b.dataset.fotos), b));
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
          <strong>${esc(l.nome)}</strong> ${l.demo ? '<span class="badge ms-demo">🎬 Demonstração</span>' : `<span class="badge">${esc(rotuloPlano)}</span>`}${l.ramo && RAMOS[l.ramo] ? ` <span class="gc-dica">${esc(RAMOS[l.ramo].nome)}</span>` : ''}
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
        ${l.demo ? `<a class="btn-outline-sm" href="/${esc(l.slug || '')}/painel" target="_blank" rel="noopener">🛠 Montar loja</a><button class="btn-primary" style="width:auto; font-size:13px; padding:6px 12px;" data-transferir="${esc(l.id)}">🤝 Entregar ao cliente</button><button class="btn-outline-sm" data-fotos="${esc(l.id)}">📷 Colocar fotos</button>` : ''}
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="teste" data-dias="7">+7 dias de teste</button>
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="essencial" data-dias="30">Essencial 30 dias</button>
        <button class="btn-outline-sm" data-loja="${esc(l.id)}" data-acao="pro" data-dias="30">Pro 30 dias</button>
        ${ass.plano !== 'bloqueada' ? `<button class="btn-outline-sm gc-perigo" data-loja="${esc(l.id)}" data-acao="bloqueada">Bloquear</button>` : ''}
        <button class="btn-outline-sm gc-perigo" data-excluir="${esc(l.id)}">🗑 Excluir loja</button>
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
      <h4 class="gc-subtitulo">📷 Fotos dos modelos (Unsplash)</h4>
      <div id="ms-fotos"><p class="gc-dica">Carregando...</p></div>
      <h4 class="gc-subtitulo">Últimos pagamentos de mensalidade</h4>
      <div id="ms-cobrancas"><p class="gc-dica">Carregando...</p></div>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  desenharMercadoPago(overlay.querySelector('#ms-mp'));
  desenharCobrancas(overlay.querySelector('#ms-cobrancas'));
  desenharFotosModelos(overlay.querySelector('#ms-fotos'));
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

// ===================== Vitrine pronta: loja de demonstração para um cliente =====================
const slugDe = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function abrirCriarLoja() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  const lista = Object.entries(RAMOS);
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>🏪 Criar loja para um cliente</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Monte a loja do cliente <strong>antes da visita</strong>, igual à que ele vai receber. Você fica como dono provisório para ajustar logo, preços e fotos; na visita, toque em "Entregar ao cliente".</p>

      <label>1. Ramo do comércio (define cardápio, cores e visual)</label>
      <div class="ms-ramos">
        ${lista.map(([k, r]) => `<button type="button" class="ms-ramo" data-ramo="${k}" style="--cor-ramo:${r.cor};"><strong>${esc(r.nome)}</strong><span>${r.layout === 'varejo' ? 'Grade varejo' : 'Lista com foto'} · ${r.itens} itens</span></button>`).join('')}
      </div>

      <label>2. Nome do comércio</label>
      <input name="nome" maxlength="60" placeholder="Ex: Pizzaria do Paulinho" />
      <label>Endereço do cardápio</label>
      <div class="cad-slug"><span>${esc(window.location.host)}/</span><input name="slug" maxlength="40" placeholder="pizzaria-do-paulinho" /></div>
      <div class="gc-linha">
        <div><label>WhatsApp da loja (opcional)</label><input name="zap" inputmode="tel" placeholder="11999999999" /></div>
        <div><label>Cor principal</label><input name="cor" type="color" value="#ea1d2c" style="height:42px; padding:2px;" /></div>
      </div>
      <label>Frase de apresentação</label>
      <textarea name="desc" rows="2" maxlength="160"></textarea>

      <div class="ms-previa" id="ms-previa"></div>
      <button class="btn-primary" type="submit" style="margin-top:12px;">✨ Criar loja de demonstração</button>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const f = overlay.querySelector('form');
  let ramo = null;
  let slugMexido = false;

  const previa = () => {
    const r = RAMOS[ramo];
    const nome = f.nome.value.trim() || 'Nome do comércio';
    overlay.querySelector('#ms-previa').innerHTML = r ? `
      <div class="ms-previa-capa" style="background:linear-gradient(135deg, ${esc(f.cor.value)}, #111827);"></div>
      <div class="ms-previa-info"><div class="ms-previa-logo" style="background:${esc(f.cor.value)};">${esc(nome.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
        <div><strong>${esc(nome)}</strong><small>${esc(f.desc.value || r.descricao)}</small><small>⏱ ${esc(r.tempo)} · ${r.layout === 'varejo' ? 'grade em 2 colunas' : 'lista com foto'}</small></div></div>` : '';
  };
  overlay.querySelectorAll('[data-ramo]').forEach(b => {
    b.onclick = () => {
      ramo = b.dataset.ramo;
      overlay.querySelectorAll('[data-ramo]').forEach(x => x.classList.toggle('ativo', x === b));
      f.cor.value = RAMOS[ramo].cor;
      f.desc.value = RAMOS[ramo].descricao;
      previa();
    };
  });
  f.nome.oninput = () => { if (!slugMexido) f.slug.value = slugDe(f.nome.value); previa(); };
  f.slug.oninput = () => { slugMexido = true; f.slug.value = slugDe(f.slug.value); };
  f.cor.oninput = previa;
  f.desc.oninput = previa;

  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!ramo) return showToast('Escolha o ramo do comércio.');
    if (f.nome.value.trim().length < 2) return showToast('Informe o nome do comércio.');
    if (f.slug.value.length < 3) return showToast('O endereço precisa ter pelo menos 3 letras.');
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Criando...';
    try {
      const r = RAMOS[ramo];
      // Fotos do banco (se já foram buscadas no Unsplash): produtos, capa e logo do ramo
      let banco = {};
      try { banco = (await api({ acao: 'lerFotos' })).fotos || {}; } catch (_) {}
      const fotos = fotosProntas(banco, 'w=600&h=600');
      const cardapio = cardapioDoRamo(ramo, fotos);
      const capa = BUSCA_RAMO[ramo] && banco[BUSCA_RAMO[ramo].capa];
      const logo = BUSCA_RAMO[ramo] && banco[BUSCA_RAMO[ramo].logo];
      const downloads = [capa, logo, ...cardapio.produtos.map(p => banco[BUSCA_FOTO[p.nome]])].filter(x => x && x.download).map(x => x.download);
      const res = await api({
        acao: 'criarLojaDemo', nome: f.nome.value.trim(), slug: f.slug.value, whatsapp: f.zap.value, cor: f.cor.value, descricao: f.desc.value.trim(), tempo: r.tempo, layout: r.layout, ramo,
        bannerUrl: capa && capa.raw ? `${capa.raw}&w=1400&h=560&fit=crop&q=70&auto=format` : null,
        logoUrl: logo && logo.raw ? `${logo.raw}&w=300&h=300&fit=crop&q=75&auto=format` : null,
        downloads
      });
      // Cardápio do ramo (o Master é dono provisório, então pode gravar)
      await setDoc(doc(db, 'lojas', res.lojaId, 'publico', 'cardapio_completo'), { ...cardapio, atualizadoEm: serverTimestamp() });
      const link = `${window.location.origin}/${res.slug}`;
      f.innerHTML = `
        <h3>✅ Loja criada!</h3>
        <p class="gc-dica">A vitrine já está no ar com o cardápio de ${esc(r.nome)}. Antes da visita, abra "Montar loja" e toque em ⚙ Configurações para colocar o logo (🎨 Aparência), ajustar preços e fotos e, se quiser, o endereço da loja (🛵 Entrega e frete).</p>
        <div class="ms-links">
          <a class="btn-primary" style="text-decoration:none; text-align:center;" href="/${esc(res.slug)}" target="_blank" rel="noopener">👀 Ver cardápio</a>
          <a class="btn-outline-sm" style="text-decoration:none; text-align:center;" href="/${esc(res.slug)}/painel" target="_blank" rel="noopener">🛠 Montar loja (logo, preços, fotos)</a>
          <a class="btn-outline-sm" style="text-decoration:none; text-align:center;" href="/demo?loja=${esc(res.slug)}" target="_blank" rel="noopener">🎬 Simular entrega desta loja</a>
          <button class="btn-outline-sm" type="button" id="ms-copiar">📋 Copiar link: ${esc(link)}</button>
        </div>
        <button class="btn-outline-sm" type="button" data-fechar style="margin-top:10px;">Fechar</button>`;
      f.querySelector('#ms-copiar').onclick = async () => { try { await navigator.clipboard.writeText(link); showToast('Link copiado!'); } catch (_) { showToast(link, 8000); } };
      f.querySelector('[data-fechar]').onclick = () => { overlay.remove(); iniciarMaster(); };
    } catch (err) {
      showToast(err.message, 6000);
      btn.disabled = false; btn.textContent = '✨ Criar loja de demonstração';
    }
  };
}

function abrirTransferir(loja) {
  if (!loja) return;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:460px; width:100%; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>🤝 Entregar "${esc(loja.nome)}"</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">O cliente vira o dono da loja e os <strong>7 dias de teste grátis começam agora</strong>. Se ele ainda não tem login, o sistema cria um com senha provisória. Você sai da equipe da loja.</p>
      <label>Nome do dono</label>
      <input name="nome" maxlength="60" placeholder="Ex: Paulo Souza" />
      <label>E-mail do dono (será o login dele)</label>
      <input name="email" type="email" placeholder="cliente@email.com" />
      <button class="btn-primary" type="submit" style="margin-top:12px;">Entregar a loja</button>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const f = overlay.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.email.value.trim()) return showToast('Informe o e-mail do cliente.');
    if (!confirm(`Entregar "${loja.nome}" para ${f.email.value.trim()}? Você deixa de ser dono desta loja.`)) return;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Entregando...';
    try {
      const r = await api({ acao: 'transferirLoja', lojaId: loja.id, email: f.email.value.trim(), nomeDono: f.nome.value.trim() });
      const painel = `${window.location.origin}/${r.slug || loja.slug}/painel`;
      const texto = `Olá${f.nome.value.trim() ? `, ${f.nome.value.trim().split(/\s+/)[0]}` : ''}! Sua loja "${loja.nome}" está pronta 🎉\nCardápio para os clientes: ${window.location.origin}/${r.slug || loja.slug}\nSeu painel: ${painel}\nLogin: ${r.email}${r.senhaProvisoria ? `\nSenha provisória: ${r.senhaProvisoria}\n(Troque em "Entrar" → "Esqueci minha senha".)` : '\nEntre com a senha que você já usa.'}\nSão 7 dias grátis com tudo liberado!`;
      const zap = String(loja.whatsapp || '').replace(/\D/g, '');
      f.innerHTML = `
        <h3>✅ Loja entregue!</h3>
        <p>Login: <strong>${esc(r.email)}</strong></p>
        ${r.senhaProvisoria ? `<p>Senha provisória: <strong class="ms-senha">${esc(r.senhaProvisoria)}</strong></p><p class="gc-dica">Mostre ao cliente agora ou mande pelo WhatsApp. Ele pode trocar em "Entrar" → "Esqueci minha senha".</p>` : '<p class="gc-dica">Esse e-mail já tinha login: o cliente entra com a senha que já usa.</p>'}
        <div class="ms-links">
          ${zap ? `<a class="btn-primary btn-whats" style="text-decoration:none; text-align:center;" href="https://wa.me/${zap.startsWith('55') ? zap : '55' + zap}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">📲 Enviar acesso no WhatsApp</a>` : ''}
          <button class="btn-outline-sm" type="button" id="ms-copiar-acesso">📋 Copiar mensagem de acesso</button>
        </div>
        <button class="btn-outline-sm" type="button" data-fechar style="margin-top:10px;">Fechar</button>`;
      f.querySelector('#ms-copiar-acesso').onclick = async () => { try { await navigator.clipboard.writeText(texto); showToast('Mensagem copiada!'); } catch (_) { showToast('Não deu para copiar.'); } };
      f.querySelector('[data-fechar]').onclick = () => { overlay.remove(); iniciarMaster(); };
    } catch (err) {
      showToast(err.message, 6000);
      btn.disabled = false; btn.textContent = 'Entregar a loja';
    }
  };
}

// ===================== Fotos dos modelos (Unsplash) =====================
// banco = { termo: { raw, autor, link, download } } → { termo: { url, autor, link } } no tamanho pedido
function fotosProntas(banco, tamanho) {
  const out = {};
  Object.entries(banco).forEach(([t, f]) => {
    if (f && f.raw) out[t] = { url: `${f.raw}&${tamanho}&fit=crop&q=70&auto=format`, autor: f.autor || '', link: f.link ? `${f.link}?utm_source=delivery_pro&utm_medium=referral` : '' };
  });
  return out;
}

async function desenharFotosModelos(box) {
  let r;
  try { r = await api({ acao: 'lerFotos' }); } catch (err) { box.innerHTML = `<p class="gc-dica">${esc(err.message)}</p>`; return; }
  const todas = buscasDosModelos();
  const prontas = todas.filter(t => r.fotos[t] && (r.fotos[t].raw || r.fotos[t].vazio));
  const comFoto = todas.filter(t => r.fotos[t] && r.fotos[t].raw).length;
  const faltam = todas.filter(t => !prontas.includes(t));
  if (!r.temChave) {
    box.innerHTML = `<p class="gc-dica">Para as lojas de demonstração já nascerem com fotos, coloque a "Chave de acesso" do Unsplash no Cloudflare: <strong>Workers e Pages → delivery-pro → Configurações → Variáveis e segredos → Adicionar</strong>, tipo <strong>Segredo</strong>, nome <code>UNSPLASH_ACCESS_KEY</code>.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="ms-fotos-barra"><div style="width:${Math.round((prontas.length / todas.length) * 100)}%"></div></div>
    <p class="gc-dica"><strong>${comFoto} de ${todas.length}</strong> fotos prontas. ${faltam.length ? 'O Unsplash grátis libera cerca de 50 buscas por hora: toque abaixo, e se pedir para esperar, volte em 1 hora.' : '✅ Todas as fotos estão prontas! As próximas lojas de demonstração já nascem com fotos.'}</p>
    ${faltam.length ? '<button class="btn-outline-sm" type="button" id="ms-buscar-fotos">📷 Buscar fotos agora</button>' : ''}
    ${comFoto ? '<button class="btn-outline-sm" type="button" id="ms-ver-fotos">👀 Ver as fotos por ramo e categoria</button>' : ''}
    <p class="gc-dica" style="font-size:12px;">Fotos gratuitas do <a href="https://unsplash.com/?utm_source=delivery_pro&utm_medium=referral" target="_blank" rel="noopener">Unsplash</a>, com crédito ao fotógrafo no cardápio.</p>`;
  const ver = box.querySelector('#ms-ver-fotos');
  if (ver) ver.onclick = () => abrirGaleria(r.fotos);
  const btn = box.querySelector('#ms-buscar-fotos');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Buscando fotos... (até 1 minuto)';
    try {
      const res = await api({ acao: 'buscarFotos', termos: faltam.slice(0, 40) });
      showToast(res.limite ? `+${res.feitas} fotos. O Unsplash pediu uma pausa: volte em 1 hora para continuar.` : `+${res.feitas} fotos prontas!`, 6000);
    } catch (err) { showToast(err.message, 6000); }
    desenharFotosModelos(box);
  };
}

// Galeria: mostra em qual ramo e categoria cada foto do banco vai entrar
function abrirGaleria(banco) {
  const fotos = fotosProntas(banco, 'w=200&h=200');
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  const mini = (f, legenda, largo) => `<figure class="ms-gal-item${largo ? ' largo' : ''}">${f ? `<img src="${esc(f.url)}" alt="" loading="lazy" />` : '<span>sem foto ainda</span>'}<figcaption>${esc(legenda)}</figcaption></figure>`;
  overlay.innerHTML = `
    <div class="card gc-form" style="max-width:720px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>📷 Fotos dos modelos</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Estas fotos entram sozinhas nas lojas de demonstração: ao <strong>criar</strong> uma loja nova, ou tocando em <strong>📷 Colocar fotos</strong> numa loja de demonstração que já existe.</p>
      ${Object.keys(BUSCA_RAMO).map(ramo => {
        const c = cardapioDoRamo(ramo, fotos);
        if (!c) return '';
        return `<details class="ms-gal-ramo"><summary><strong>${esc(RAMOS[ramo] ? RAMOS[ramo].nome : ramo)}</strong> <span class="gc-dica">${c.produtos.filter(p => p.imagemUrl).length} de ${c.produtos.length} produtos com foto</span></summary>
          <div class="ms-gal-grade">${mini(fotos[BUSCA_RAMO[ramo].capa], 'Capa', true)}${mini(fotos[BUSCA_RAMO[ramo].logo], 'Logo')}</div>
          ${c.categorias.map(cat => `<h4 class="gc-subtitulo">${esc(cat.nome)}</h4><div class="ms-gal-grade">${c.produtos.filter(p => p.categoriaId === cat.id).map(p => mini(p.imagemUrl ? { url: p.imagemUrl } : null, p.nome)).join('')}</div>`).join('')}
        </details>`;
      }).join('')}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// Coloca as fotos do banco numa loja de demonstração que já existe (só onde não tem foto)
async function colocarFotos(loja, btn) {
  if (!loja) return;
  if (!loja.ramo || !BUSCA_RAMO[loja.ramo]) { showToast('Esta loja não tem ramo de modelo, então não sei quais fotos usar.', 6000); return; }
  btn.disabled = true; btn.textContent = 'Colocando fotos...';
  try {
    const banco = (await api({ acao: 'lerFotos' })).fotos || {};
    const fotos = fotosProntas(banco, 'w=600&h=600');
    if (!Object.keys(fotos).length) throw new Error('O banco de fotos está vazio. Vá em ⚙ Configurações → Buscar fotos.');
    const ref = doc(db, 'lojas', loja.id, 'publico', 'cardapio_completo');
    const snap = await getDoc(ref);
    let novas = 0;
    const downloads = [];
    if (snap.exists()) {
      const c = snap.data();
      (c.produtos || []).forEach(p => {
        const termo = BUSCA_FOTO[p.nome];
        if (p.imagemUrl || !termo || !fotos[termo]) return;
        p.imagemUrl = fotos[termo].url;
        p.imagemCredito = { autor: fotos[termo].autor, link: fotos[termo].link };
        if (banco[termo].download) downloads.push(banco[termo].download);
        novas++;
      });
      if (novas) await setDoc(ref, { ...c, atualizadoEm: serverTimestamp() });
    }
    const capa = banco[BUSCA_RAMO[loja.ramo].capa], logo = banco[BUSCA_RAMO[loja.ramo].logo];
    [capa, logo].forEach(x => { if (x && x.download) downloads.push(x.download); });
    const r = await api({
      acao: 'fotosLojaDemo', lojaId: loja.id, downloads,
      bannerUrl: capa && capa.raw ? `${capa.raw}&w=1400&h=560&fit=crop&q=70&auto=format` : null,
      logoUrl: logo && logo.raw ? `${logo.raw}&w=300&h=300&fit=crop&q=75&auto=format` : null
    });
    showToast(`✅ ${novas} foto(s) de produto${r.capa ? ', capa' : ''}${r.logo ? ' e logo' : ''} colocadas. Abra o cardápio para ver.`, 6000);
  } catch (err) { showToast(err.message, 6000); }
  btn.disabled = false; btn.textContent = '📷 Colocar fotos';
}

// Exclui a loja de vez (pede para digitar o endereço, para não apagar sem querer)
function abrirExcluir(loja) {
  if (!loja) return;
  const alvo = loja.slug || loja.nome;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:420px; width:100%; margin:0;" novalidate>
      <h3>🗑 Excluir "${esc(loja.nome)}"</h3>
      <p>Isso apaga <strong>de vez</strong> a loja: cardápio, pedidos, equipe, fotos e o endereço <strong>/${esc(loja.slug || '')}</strong>. <strong>Não tem como desfazer.</strong></p>
      ${loja.demo ? '' : '<div class="pedido-aviso">⚠ Esta loja já pertence a um cliente. O dono perde o acesso ao cardápio e ao painel.</div>'}
      <label>Para confirmar, digite: <strong>${esc(alvo)}</strong></label>
      <input name="conf" autocomplete="off" autocapitalize="none" />
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn-outline-sm" type="button" data-fechar>Cancelar</button>
        <button class="btn-primary gc-perigo" type="submit" style="width:auto; background:#dc2626; border-color:#dc2626;">Excluir de vez</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  const f = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.conf.value.trim().toLowerCase() !== String(alvo).toLowerCase()) { showToast('O texto não confere. Digite exatamente: ' + alvo, 5000); return; }
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Excluindo...';
    try {
      await api({ acao: 'excluirLoja', lojaId: loja.id, confirmar: f.conf.value.trim() });
      lojas = lojas.filter(l => l.id !== loja.id);
      overlay.remove();
      showToast('Loja excluída.');
      render();
    } catch (err) { showToast(err.message, 6000); btn.disabled = false; btn.textContent = 'Excluir de vez'; }
  };
}
