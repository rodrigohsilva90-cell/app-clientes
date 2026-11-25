// Painel: clientes que montaram a sacola, informaram o WhatsApp e saíram sem finalizar
// (aparecem depois de 20 min parados; somem quando fazem o pedido ou após 3 dias).
import { auth, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';

async function chamar(corpo) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch('/api/carrinhos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Falhou.');
  return d;
}

function linkWhats(c) {
  const numero = String(c.whatsapp || '').replace(/\D/g, '');
  const nome = String(c.nome || '').trim().split(/\s+/)[0];
  const itens = (c.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(', ');
  const texto = `Oi${nome ? `, ${nome}` : ''}! Aqui é da ${AppState.lojaDados.nome}. Vi que você montou um pedido (${itens}) e não finalizou. Posso ajudar? Seu carrinho continua salvo: ${window.location.origin}/${AppState.slug}`;
  return `https://wa.me/${numero.startsWith('55') ? numero : '55' + numero}?text=${encodeURIComponent(texto)}`;
}

export async function abrirCarrinhos() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>🛒 Carrinhos abandonados</h3>
        <button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Clientes que colocaram produtos na sacola, informaram o WhatsApp e saíram sem finalizar há mais de 20 minutos. Um "oi" amigável recupera muitas vendas.</p>
      <div id="car-lista"><p>Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const box = overlay.querySelector('#car-lista');

  const desenhar = (lista) => {
    box.innerHTML = lista.length ? lista.map(c => `
      <div class="car-item">
        <div class="car-topo">
          <strong>${esc(c.nome || 'Cliente')}</strong>
          <span>${formatarCentavos(c.totalCentavos)}</span>
        </div>
        <small>${esc((c.itens || []).map(i => `${i.quantidade}x ${i.nome}`).join(' · '))}</small>
        <small>${c.atualizadoEm ? `Saiu ${new Date(c.atualizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</small>
        <div class="car-acoes">
          <a class="btn-outline-sm btn-whats" href="${esc(linkWhats(c))}" target="_blank" rel="noopener" data-chamou="${esc(c.whatsapp)}">💬 Chamar no WhatsApp</a>
          <button class="btn-outline-sm" type="button" data-remover="${esc(c.whatsapp)}">✓ Resolvido</button>
        </div>
      </div>`).join('') : '<p class="gc-dica">Nenhum carrinho abandonado agora. 🎉</p>';
    box.querySelectorAll('[data-remover]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          await chamar({ acao: 'remover', whatsapp: b.dataset.remover });
          desenhar(lista.filter(c => c.whatsapp !== b.dataset.remover));
          lista = lista.filter(c => c.whatsapp !== b.dataset.remover);
        } catch (err) { showToast(err.message); b.disabled = false; }
      };
    });
  };

  let lista = [];
  try {
    lista = (await chamar({ acao: 'listar' })).carrinhos || [];
    desenhar(lista);
  } catch (err) {
    box.innerHTML = `<p>${esc(err.message)}</p>`;
  }
}
