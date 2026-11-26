// Ficha de clientes (CRM) e Cartão Fidelidade da loja.
// A lista vem do Worker (só a equipe vê). O cliente nunca vê dados de outra pessoa.
import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

async function api(corpo) {
  const u = auth.currentUser;
  if (!u) throw new Error('Entre de novo na sua conta.');
  const r = await fetch('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
    body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível carregar.');
  return d;
}

export function formatarWhats(n) {
  const d = String(n || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const NOME_DIA = { d0: 'domingo', d1: 'segunda', d2: 'terça', d3: 'quarta', d4: 'quinta', d5: 'sexta', d6: 'sábado' };
const pediuHoje = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

export async function abrirClientes() {
  const ehDono = true; // esta tela só abre pelo menu ⚙ Configurações, que é exclusivo do dono (o Worker confere de novo)
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form cl-caixa" style="max-width:640px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>📇 Clientes</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Todo cliente que pede com WhatsApp (pelo link ou no balcão) entra aqui sozinho. Os números contam quando o pedido é concluído.</p>
      <input id="cl-busca" type="search" placeholder="Buscar por nome ou telefone" class="cl-busca" />
      <div class="rl-periodos" id="cl-filtros">
        <button type="button" class="rl-chip ativo" data-filtro="todos">Todos</button>
        <button type="button" class="rl-chip" data-filtro="campanha">📣 Oferta de hoje</button>
        <button type="button" class="rl-chip" data-filtro="vip">⭐ VIP</button>
        <button type="button" class="rl-chip" data-filtro="sumidos">💤 Sumidos (30+ dias)</button>
      </div>
      <p class="gc-dica hidden" id="cl-dica-filtro"></p>
      <div id="cl-lista"><p class="gc-dica">Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const lista = overlay.querySelector('#cl-lista');
  let dados;
  try { dados = await api({ acao: 'listar' }); } catch (err) { lista.innerHTML = `<p class="gc-dica">${esc(err.message)}</p>`; return; }

  let filtro = 'todos';
  const hoje = `d${dados.hoje}`;
  const desenhar = () => {
    const termo = overlay.querySelector('#cl-busca').value.trim().toLowerCase();
    const soNum = termo.replace(/\D/g, '');
    const dica = overlay.querySelector('#cl-dica-filtro');
    const textos = {
      campanha: `Clientes que <strong>aceitaram receber promoções</strong>, costumam pedir na ${NOME_DIA[hoje] || 'hoje'} e ainda não pediram hoje. Mande uma mensagem por vez (envio em massa pode bloquear seu WhatsApp).`,
      vip: 'Clientes com 5 ou mais pedidos concluídos.',
      sumidos: 'Clientes que não pedem há mais de 30 dias. Só mande oferta para quem aceitou receber promoções.'
    };
    dica.classList.toggle('hidden', filtro === 'todos');
    dica.innerHTML = textos[filtro] || '';
    const filtrados = dados.clientes.filter(c => !termo || String(c.nome).toLowerCase().includes(termo) || (soNum && c.whatsapp.includes(soNum)))
      .filter(c => filtro === 'todos'
        || (filtro === 'campanha' && c.optInMarketing && c.diaFavorito === hoje && !pediuHoje(c.ultimaCompraEm))
        || (filtro === 'vip' && c.totalPedidos >= 5)
        || (filtro === 'sumidos' && c.ultimaCompraEm && Date.now() - Date.parse(c.ultimaCompraEm) > 30 * 864e5));
    if (!dados.clientes.length) { lista.innerHTML = '<p class="gc-dica">Ainda não há clientes. Eles aparecem aqui depois do primeiro pedido com WhatsApp.</p>'; return; }
    lista.innerHTML = `<p class="gc-dica">${filtrados.length} de ${dados.clientes.length} cliente(s)</p>` + filtrados.slice(0, 200).map(c => {
      const f = c.fidelidade;
      const zap = c.whatsapp.length <= 11 ? '55' + c.whatsapp : c.whatsapp;
      const primeiroNome = String(c.nome).split(/\s+/)[0];
      const oferta = `Olá, ${primeiroNome}! Aqui é da ${AppState.lojaDados.nome || 'loja'} 😊 Hoje tem novidade no cardápio: ${window.location.origin}/${AppState.lojaDados.slug || ''}\n(Se não quiser mais receber, é só responder SAIR.)`;
      const podeOferta = c.optInMarketing && (filtro === 'campanha' || filtro === 'sumidos');
      return `<div class="cl-item">
        <div class="cl-topo">
          <div><strong>${esc(c.nome)}</strong>${c.totalPedidos >= 5 ? ' <span class="badge-vip">⭐ VIP</span>' : ''}<small>${esc(formatarWhats(c.whatsapp))}${c.optInMarketing ? ' · 📣 aceita promoções' : ''}</small></div>
          <strong>${formatarCentavos(c.totalGastoCentavos)}</strong>
        </div>
        <div class="cl-dados">
          <span>📦 ${c.totalPedidos} pedido(s) concluído(s)</span>
          <span>🕒 Última: ${dataBr(c.ultimaCompraEm)}</span>
          ${c.totalPedidos ? `<span>🎟 Ticket médio: ${formatarCentavos(Math.round(c.totalGastoCentavos / c.totalPedidos))}</span>` : ''}
          ${c.diaFavorito ? `<span>📅 Costuma pedir: ${NOME_DIA[c.diaFavorito] || '—'}${c.horaFavorita ? `, por volta das ${String(c.horaFavorita).replace('h', '')}h` : ''}</span>` : ''}
          ${f ? `<span>🎁 ${f.carimbos}/${f.meta} carimbos${f.premios ? ` · <strong>${f.premios} prêmio(s)</strong>` : ''}</span>` : ''}
        </div>
        ${c.ultimoEnderecoTexto ? `<div class="cl-end">📍 ${esc(c.ultimoEnderecoTexto)}</div>` : ''}
        ${c.ausenciasSeguidas >= 2 ? `<div class="mb-alerta-pino">⚠ ${c.ausenciasSeguidas} ausências seguidas: os pedidos desse cliente pedem Pix antecipado. <button class="btn-outline-sm" type="button" data-liberar="${esc(c.whatsapp)}">Liberar</button></div>` : ''}
        <div class="cl-acoes">
          <a class="btn-outline-sm btn-whats" href="https://wa.me/${esc(zap)}${podeOferta ? `?text=${encodeURIComponent(oferta)}` : ''}" target="_blank" rel="noopener">${podeOferta ? '📣 Enviar oferta' : '💬 WhatsApp'}</a>
          ${ehDono ? `<button class="btn-outline-sm gc-perigo" type="button" data-anonimizar="${esc(c.whatsapp)}">🗑 Apagar dados (LGPD)</button>` : ''}
        </div>
      </div>`;
    }).join('');
    lista.querySelectorAll('[data-liberar]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          await api({ acao: 'liberarCliente', whatsapp: b.dataset.liberar });
          const c = dados.clientes.find(x => x.whatsapp === b.dataset.liberar);
          if (c) c.ausenciasSeguidas = 0;
          showToast('Cliente liberado: pode pagar na entrega de novo.');
          desenhar();
        } catch (err) { showToast(err.message, 5000); b.disabled = false; }
      };
    });
    lista.querySelectorAll('[data-anonimizar]').forEach(b => {
      b.onclick = async () => {
        const c = dados.clientes.find(x => x.whatsapp === b.dataset.anonimizar);
        if (!confirm(`Apagar os dados de ${c.nome}?\n\nUse só quando o cliente pedir. O nome, o telefone e os endereços dele somem desta lista e dos pedidos antigos (os valores das vendas continuam nos relatórios). Os carimbos do cartão fidelidade também são apagados. Não tem como desfazer.`)) return;
        b.disabled = true; b.textContent = 'Apagando...';
        try {
          const r = await api({ acao: 'anonimizar', whatsapp: c.whatsapp });
          dados.clientes = dados.clientes.filter(x => x !== c);
          showToast(`Dados apagados (${r.pedidos} pedido(s) anonimizados).`, 5000);
          desenhar();
        } catch (err) { showToast(err.message, 6000); b.disabled = false; b.textContent = '🗑 Apagar dados (LGPD)'; }
      };
    });
  };
  overlay.querySelector('#cl-busca').oninput = desenhar;
  overlay.querySelectorAll('[data-filtro]').forEach(b => {
    b.onclick = () => {
      filtro = b.dataset.filtro;
      overlay.querySelectorAll('[data-filtro]').forEach(x => x.classList.toggle('ativo', x === b));
      desenhar();
    };
  });
  desenhar();
}

export function abrirConfigFidelidade() {
  const f = AppState.lojaDados.fidelidade || {};
  const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');
  const centavos = (t) => Math.round((Number(String(t || '').replace(/\./g, '').replace(',', '.')) || 0) * 100);
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:440px; width:100%; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>🎁 Cartão fidelidade</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">A cada pedido concluído o cliente ganha 1 carimbo, ligado ao WhatsApp dele (sem senha e sem cadastro). Ao completar o cartão, ele ganha um desconto no próximo pedido pelo link. Pedidos lançados no balcão com WhatsApp também contam.</p>
      <label class="chk-lembrar"><input type="checkbox" name="ativo" ${f.ativo ? 'checked' : ''} /> <span><strong>Ligar o cartão fidelidade</strong></span></label>
      <label>Quantos pedidos para ganhar o prêmio?</label>
      <input name="meta" type="number" min="3" max="30" value="${esc(f.meta || 10)}" />
      <label>Valor do prêmio (desconto em R$)</label>
      <input name="premio" inputmode="decimal" placeholder="10,00" value="${f.premioCentavos ? reais(f.premioCentavos) : '10,00'}" />
      <label>Pedido mínimo para ganhar carimbo (R$, sem a entrega)</label>
      <input name="minimo" inputmode="decimal" placeholder="0,00" value="${reais(f.minimoCentavos || 0)}" />
      <p class="gc-dica" id="fd-previa"></p>
      <button class="btn-primary" type="submit">Salvar</button>
    </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const previa = () => {
    const meta = Math.min(30, Math.max(3, Number(form.meta.value) || 10));
    overlay.querySelector('#fd-previa').innerHTML = `Como o cliente vê: <strong>"A cada ${meta} pedidos você ganha ${formatarCentavos(centavos(form.premio.value))} de desconto"</strong>${centavos(form.minimo.value) ? ` (pedidos a partir de ${formatarCentavos(centavos(form.minimo.value))})` : ''}.`;
  };
  form.oninput = previa;
  previa();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
      ativo: form.ativo.checked,
      meta: Math.min(30, Math.max(3, Number(form.meta.value) || 10)),
      premioCentavos: Math.min(100000, centavos(form.premio.value)),
      minimoCentavos: Math.min(1000000, centavos(form.minimo.value))
    };
    if (dados.ativo && dados.premioCentavos < 100) { showToast('Informe o valor do prêmio (mínimo R$ 1,00).'); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId), { fidelidade: dados });
      AppState.lojaDados.fidelidade = dados;
      showToast(dados.ativo ? '🎁 Cartão fidelidade ligado!' : 'Cartão fidelidade desligado.');
      overlay.remove();
    } catch (err) {
      console.error(err);
      showToast('Não foi possível salvar. Tente de novo.');
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  };
}
