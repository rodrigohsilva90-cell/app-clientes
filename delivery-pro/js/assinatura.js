// Faixa de "teste grátis" no painel e tela de bloqueio persuasiva quando o teste/plano vence.
import { db, formatarCentavos, esc } from './config.js';
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

// Faixa no topo do painel durante o teste ou na tolerância de pagamento
export async function bannerAssinatura(ass) {
  if (!ass || !(ass.emTeste || ass.emCarencia)) return '';
  const cfg = await configSaas();
  const link = linkAssinar(cfg, 'Essencial');
  const ate = ass.fim ? new Date(ass.fim).toLocaleDateString('pt-BR') : '';
  const texto = ass.emCarencia
    ? `⚠ Sua assinatura venceu em ${ate}. Renove em até 48 horas para a loja não ser pausada.`
    : `🎁 Teste grátis: ${ass.diasRestantes === 1 ? 'último dia' : `faltam ${ass.diasRestantes} dias`}${ate ? ` (até ${ate})` : ''}. Tudo liberado!`;
  return `<div class="ass-faixa${ass.emCarencia ? ' alerta' : ''}"><span>${texto}</span>${link ? `<a class="btn-outline-sm" href="${esc(link)}" target="_blank" rel="noopener">Assinar agora</a>` : ''}</div>`;
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
              ${link ? `<a class="btn-primary" style="text-decoration:none; display:block; text-align:center;" href="${esc(link)}" target="_blank" rel="noopener">Quero assinar o ${p.nome}</a>`
                     : '<p class="gc-dica">Fale com o suporte para assinar.</p>'}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}
