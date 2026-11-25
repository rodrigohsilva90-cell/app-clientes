// Faixa de "teste grátis" no painel e tela de bloqueio persuasiva quando o teste/plano vence.
import { db, auth, formatarCentavos, esc } from './config.js';
import { AppState } from './router.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const DIA_MS = 24 * 60 * 60 * 1000;
let configCache = null;

export async function configSaas() {
  if (configCache) return configCache;
  try {
    const r = await fetch('/api/saas');
    configCache = r.ok ? await r.json() : {};
  } catch (_) { configCache = {}; }
  return configCache;
}

function linkAssinar(cfg, plano) {
  const numero = String(cfg.whatsappSuporte || '').replace(/\D/g, '');
  if (!numero) return null;
  const texto = `Olá! Quero assinar o plano ${plano} para a loja "${AppState.lojaDados.nome}" (${window.location.origin}/${AppState.slug}).`;
  return `https://wa.me/${numero.startsWith('55') ? numero : '55' + numero}?text=${encodeURIComponent(texto)}`;
}

// ---- Pagamento da mensalidade por Pix (Mercado Pago do Delivery Pro) ----
const nomePlano = (p) => (p === 'pro' ? 'Pro' : 'Essencial');
async function chamarAssinatura(corpo) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch('/api/assinatura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível concluir.');
  return d;
}

// Abre a janela de pagamento. Sem plano: deixa escolher Essencial ou Pro.
export async function abrirPagamentoAssinatura(plano) {
  const cfg = await configSaas();
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `<div class="card" style="max-width:440px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><h3>💳 Pagar assinatura</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button></div>
    <div id="ass-pix"></div></div>`;
  document.body.appendChild(overlay);
  let verificador = null;
  const fechar = () => { if (verificador) clearInterval(verificador); overlay.remove(); };
  overlay.querySelector('[data-fechar]').onclick = fechar;
  const box = overlay.querySelector('#ass-pix');

  const escolher = () => {
    box.innerHTML = `<p class="gc-dica">Escolha o plano. Cada pagamento libera <strong>30 dias</strong> (se ainda faltar tempo, ele é somado).</p>
      ${['essencial', 'pro'].map(p => {
        const preco = p === 'pro' ? cfg.precoProCentavos : cfg.precoEssencialCentavos;
        return preco ? `<button class="btn-outline-sm ass-escolha" type="button" data-plano="${p}"><strong>${nomePlano(p)}</strong><span>${formatarCentavos(preco)} / 30 dias</span></button>` : '';
      }).join('')}`;
    box.querySelectorAll('[data-plano]').forEach(b => { b.onclick = () => gerar(b.dataset.plano); });
  };

  const gerar = async (p) => {
    box.innerHTML = '<p>Gerando o Pix...</p>';
    let cob;
    try { cob = await chamarAssinatura({ acao: 'pagar', plano: p }); }
    catch (err) { box.innerHTML = `<p>${esc(err.message)}</p>`; return; }
    box.innerHTML = `
      <div class="pix-box">
        <strong>Plano ${nomePlano(cob.plano)} — 30 dias</strong>
        <span class="pix-valor">${formatarCentavos(cob.valorCentavos)}</span>
        ${cob.qrBase64 ? `<img class="pix-qr" alt="QR Code Pix" src="data:image/png;base64,${esc(cob.qrBase64)}" />` : ''}
        <button class="btn-primary" type="button" id="ass-copiar">📋 Copiar código Pix</button>
        <textarea class="pix-codigo" readonly rows="3">${esc(cob.qrCode)}</textarea>
        <p class="pix-tempo" id="ass-status">Aguardando o pagamento... (esta janela confere sozinha)</p>
        <button class="btn-outline-sm" type="button" id="ass-verificar" style="width:100%;">Já paguei</button>
      </div>`;
    box.querySelector('#ass-copiar').onclick = async () => {
      try { await navigator.clipboard.writeText(cob.qrCode); } catch (_) { box.querySelector('textarea').select(); document.execCommand('copy'); }
      box.querySelector('#ass-copiar').textContent = '✅ Copiado! Cole no app do banco';
    };
    const conferir = async () => {
      try {
        const r = await chamarAssinatura({ acao: 'verificar', mpId: cob.mpId });
        if (r.pago) {
          if (verificador) clearInterval(verificador);
          box.innerHTML = '<div class="pix-ok">✅ <strong>Pagamento confirmado!</strong><span>Sua assinatura foi renovada. Recarregando...</span></div>';
          setTimeout(() => window.location.reload(), 2000);
        } else if (r.status === 'expirado') {
          if (verificador) clearInterval(verificador);
          box.querySelector('#ass-status').textContent = '⌛ Este Pix expirou. Feche e gere outro.';
        }
      } catch (_) {}
    };
    box.querySelector('#ass-verificar').onclick = () => { box.querySelector('#ass-status').textContent = 'Conferindo...'; conferir(); };
    verificador = setInterval(conferir, 8000);
  };

  if (!cfg.pagamentoOnline) {
    const link = linkAssinar(cfg, nomePlano(plano));
    box.innerHTML = `<p>O pagamento online ainda não está disponível.</p>${link ? `<a class="btn-primary" style="display:block; text-align:center; text-decoration:none;" href="${esc(link)}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}`;
    return;
  }
  if (plano) gerar(plano); else escolher();
}

// Botões de pagar (em qualquer lugar da tela) abrem o Pix
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pagar-assinatura]');
  if (!b) return;
  e.preventDefault();
  abrirPagamentoAssinatura(b.dataset.pagarAssinatura || null);
});

// Faixa no topo do painel: teste grátis, renovação próxima (5 dias) ou tolerância de pagamento
export async function bannerAssinatura(ass) {
  const renovarLogo = ass && !ass.emTeste && !ass.emCarencia && ['essencial', 'pro'].includes(ass.plano) && ass.diasRestantes && ass.diasRestantes <= 5;
  if (!ass || !(ass.emTeste || ass.emCarencia || renovarLogo)) return '';
  const cfg = await configSaas();
  const link = linkAssinar(cfg, 'Essencial');
  const ate = ass.fim ? new Date(ass.fim).toLocaleDateString('pt-BR') : '';
  const texto = ass.emCarencia
    ? `⚠ Sua assinatura venceu em ${ate}. Renove em até 48 horas para a loja não ser pausada.`
    : renovarLogo
      ? `📅 Sua assinatura ${nomePlano(ass.plano)} vence ${ass.diasRestantes === 1 ? 'amanhã' : `em ${ass.diasRestantes} dias`} (${ate}).`
      : `🎁 Teste grátis: ${ass.diasRestantes === 1 ? 'último dia' : `faltam ${ass.diasRestantes} dias`}${ate ? ` (até ${ate})` : ''}. Tudo liberado!`;
  const planoAtual = ['essencial', 'pro'].includes(ass.plano) ? ass.plano : '';
  const botao = cfg.pagamentoOnline
    ? `<button class="btn-outline-sm" type="button" data-pagar-assinatura="${planoAtual}">${ass.emTeste ? 'Assinar com Pix' : 'Renovar com Pix'}</button>`
    : (link ? `<a class="btn-outline-sm" href="${esc(link)}" target="_blank" rel="noopener">Assinar agora</a>` : '');
  return `<div class="ass-faixa${ass.emCarencia || renovarLogo ? ' alerta' : ''}"><span>${texto}</span>${botao}</div>`;
}

// Tela de bloqueio: mostra os números reais do período para convencer o dono a assinar
export async function telaBloqueio(ass, ehDono) {
  const root = document.getElementById('app-root');
  if (!ehDono) {
    root.innerHTML = `<div class="card ass-bloqueio"><h2>🔒 Acesso pausado</h2><p>O painel desta loja está pausado. Fale com o dono da loja.</p></div>`;
    return;
  }
  root.innerHTML = '<div class="card"><p>Carregando...</p></div>';
  const cfg = await configSaas();
  const fim = ass.fim || Date.now();
  let qtd = 0, totalCentavos = 0;
  try {
    const snap = await getDocs(query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('criadoEm', '>=', new Date(fim - 7 * DIA_MS))));
    snap.docs.forEach(d => {
      const p = d.data();
      if (p.status === 'cancelado' || p.status === 'ocorrencia') return;
      qtd++;
      totalCentavos += Number(p.totalCentavos) || 0;
    });
  } catch (err) { console.error(err); }
  const pct = Number(cfg.comissaoMarketplacePct) || 20;
  const economia = Math.round(totalCentavos * pct / 100);
  const titulo = ass.motivo === 'teste_vencido' ? 'Seu teste grátis terminou' : ass.motivo === 'pagamento_vencido' ? 'Sua assinatura venceu' : 'Sua loja está pausada';
  const planos = [
    { nome: 'Essencial', preco: cfg.precoEssencialCentavos, itens: ['Cardápio online e pedidos ilimitados', 'Painel, cozinha e caixa', 'Frete por distância'] },
    { nome: 'Pro', preco: cfg.precoProCentavos, itens: ['Tudo do Essencial', 'Motoboys com GPS ao vivo', 'Equipe e relatórios'] }
  ];
  root.innerHTML = `
    <div class="card ass-bloqueio">
      <h2>⏸ ${titulo}</h2>
      <p class="gc-dica">Seu cardápio está pausado para os clientes. Assine para voltar a vender agora mesmo — nada foi apagado.</p>
      <div class="ass-numeros">
        <div><strong>${qtd}</strong><span>pedidos na última semana</span></div>
        <div><strong>${formatarCentavos(totalCentavos)}</strong><span>vendidos</span></div>
        <div class="destaque"><strong>${formatarCentavos(economia)}</strong><span>que você deixou de pagar em comissões (${pct}% dos apps)</span></div>
      </div>
      <div class="ass-planos">
        ${planos.map(p => {
          const link = linkAssinar(cfg, p.nome);
          return `
            <div class="ass-plano">
              <h3>${p.nome}</h3>
              <div class="ass-preco">${p.preco ? `${formatarCentavos(p.preco)}<small>/mês</small>` : 'Consulte'}</div>
              <ul>${p.itens.map(i => `<li>✓ ${i}</li>`).join('')}</ul>
              ${cfg.pagamentoOnline && p.preco
                ? `<button class="btn-primary" type="button" data-pagar-assinatura="${p.nome === 'Pro' ? 'pro' : 'essencial'}">Pagar ${p.nome} com Pix</button>${link ? `<a class="gc-dica" style="text-align:center;" href="${esc(link)}" target="_blank" rel="noopener">Dúvidas? Falar no WhatsApp</a>` : ''}`
                : link ? `<a class="btn-primary" style="text-decoration:none; display:block; text-align:center;" href="${esc(link)}" target="_blank" rel="noopener">Quero assinar o ${p.nome}</a>`
                     : '<p class="gc-dica">Fale com o suporte para assinar.</p>'}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
