// Painel do dono: regra de repasse dos motoboys e acerto de turno (com histórico e planilha).
import { auth, db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');
const centavos = (t) => Math.round((Number(String(t || '').replace(/\./g, '').replace(',', '.')) || 0) * 100);

async function api(corpo) {
  const u = auth.currentUser;
  if (!u) throw new Error('Entre de novo na sua conta.');
  const r = await fetch('/api/acertos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível carregar.');
  return d;
}

// ---------------- Regra de repasse ----------------
export function abrirConfigRepasse() {
  const r = AppState.lojaDados.repasse || {};
  const faixas = Array.isArray(r.faixas) && r.faixas.length ? r.faixas : [{ ateKm: 2, centavos: 500 }, { ateKm: 4, centavos: 700 }, { ateKm: 99, centavos: 1000 }];
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card gc-form" style="max-width:480px; width:100%; max-height:94vh; overflow-y:auto; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>🛵 Repasse dos motoboys</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Quanto cada motoboy ganha. O app dele mostra o ganho de cada corrida e o total do turno, e o acerto no fim do dia sai calculado.</p>
      <label>Diária fixa por turno (R$, 0 se não paga)</label>
      <input name="diaria" inputmode="decimal" value="${reais(r.diariaCentavos)}" />
      <label>Como paga cada entrega?</label>
      <div class="chk-tipo" style="flex-direction:column; align-items:stretch;">
        <label><input type="radio" name="tipo" value="fixo" ${!r.tipo || r.tipo === 'fixo' ? 'checked' : ''} /> Valor fixo por entrega</label>
        <label><input type="radio" name="tipo" value="taxa" ${r.tipo === 'taxa' ? 'checked' : ''} /> Uma parte da taxa de entrega do cliente</label>
        <label><input type="radio" name="tipo" value="faixas" ${r.tipo === 'faixas' ? 'checked' : ''} /> Por distância (faixas de km)</label>
      </div>
      <div data-bloco="fixo"><label>Valor por entrega (R$)</label><input name="porEntrega" inputmode="decimal" value="${reais(r.porEntregaCentavos || 500)}" /></div>
      <div data-bloco="taxa"><label>Quanto da taxa vai para o motoboy (%)</label><input name="percentual" type="number" min="1" max="100" value="${esc(r.percentualTaxa || 100)}" /></div>
      <div data-bloco="faixas">
        <label>Faixas de distância</label>
        ${faixas.slice(0, 4).map((f, i) => `<div class="gc-linha"><div><small>Até (km)</small><input name="km${i}" inputmode="decimal" value="${esc(String(f.ateKm).replace('.', ','))}" /></div><div><small>Paga (R$)</small><input name="vf${i}" inputmode="decimal" value="${reais(f.centavos)}" /></div></div>`).join('')}
      </div>
      <label>Mínimo por corrida (R$) <small>vale também quando o cliente ganha frete grátis</small></label>
      <input name="minimo" inputmode="decimal" value="${reais(r.minimoCentavos)}" />
      <label>🌧 Adicional de chuva / horário nobre (R$ por entrega)</label>
      <input name="chuva" inputmode="decimal" value="${reais(r.adicionalChuvaCentavos)}" />
      <label class="chk-lembrar"><input type="checkbox" name="chuvaAtiva" ${r.chuvaAtiva ? 'checked' : ''} /> <span><strong>Adicional ligado agora</strong> <small>Vale para os pedidos que entrarem a partir de agora.</small></span></label>
      <label>🎯 Meta de entregas no turno (0 = sem meta)</label>
      <div class="gc-linha">
        <div><small>Entregas</small><input name="meta" type="number" min="0" max="200" value="${esc(r.metaEntregas || 0)}" /></div>
        <div><small>Bônus (R$)</small><input name="bonus" inputmode="decimal" value="${reais(r.bonusMetaCentavos)}" /></div>
      </div>
      <button class="btn-primary" type="submit">💾 Salvar</button>
    </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const mostrar = () => overlay.querySelectorAll('[data-bloco]').forEach(b => b.classList.toggle('hidden', b.dataset.bloco !== form.tipo.value));
  form.querySelectorAll('input[name="tipo"]').forEach(x => x.onchange = mostrar);
  mostrar();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fx = [0, 1, 2, 3].filter(i => form[`km${i}`]).map(i => ({ ateKm: Number(String(form[`km${i}`].value).replace(',', '.')) || 0, centavos: centavos(form[`vf${i}`].value) })).filter(f => f.ateKm > 0);
    const dados = {
      tipo: form.tipo.value, diariaCentavos: centavos(form.diaria.value), porEntregaCentavos: centavos(form.porEntrega.value),
      percentualTaxa: Math.min(100, Math.max(1, Number(form.percentual.value) || 100)), faixas: fx, minimoCentavos: centavos(form.minimo.value),
      adicionalChuvaCentavos: centavos(form.chuva.value), chuvaAtiva: form.chuvaAtiva.checked,
      metaEntregas: Math.max(0, Math.min(200, Number(form.meta.value) || 0)), bonusMetaCentavos: centavos(form.bonus.value)
    };
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId), { repasse: dados });
      AppState.lojaDados.repasse = dados;
      showToast('Repasse salvo!');
      overlay.remove();
    } catch (err) { console.error(err); showToast('Não foi possível salvar.'); }
  };
}

// Liga/desliga o adicional de chuva em 1 toque
export async function alternarChuva() {
  const r = { ...(AppState.lojaDados.repasse || {}) };
  r.chuvaAtiva = !r.chuvaAtiva;
  await updateDoc(doc(db, 'lojas', AppState.lojaId), { repasse: r });
  AppState.lojaDados.repasse = r;
  return r.chuvaAtiva;
}

// ---------------- Acerto dos motoboys ----------------
// Janela própria (menu ⚙) — o mesmo conteúdo também aparece na aba 🗺️ Motoboys → 💰 Hoje e acerto
export async function abrirAcertos() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form cl-caixa" style="max-width:640px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>💰 Motoboys: hoje e acerto</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div id="ac-caixa"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  montarAcertos(overlay.querySelector('#ac-caixa'));
}

const FORMAS = [
  ['online', '✅ Pago pelo site (Pix/cartão online)', 'já está na conta da loja'],
  ['dinheiro', '💵 Dinheiro', 'está com o motoboy até o acerto'],
  ['cartao', '💳 Cartão na maquininha', 'cai na conta da maquininha'],
  ['pix_pendente', '⏳ Pix ainda não confirmado', 'confira no banco']
];
const hora = (t) => (t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
const NOME_FORMA = { online: 'pago no site', dinheiro: 'dinheiro', cartao: 'maquininha', pix_pendente: 'Pix pendente', cancelado: 'cancelado', outro: 'outro' };

export function montarAcertos(raiz) {
  raiz.innerHTML = `
    <div class="rl-periodos"><button type="button" class="rl-chip ativo" data-aba="turnos">Hoje (por motoboy)</button><button type="button" class="rl-chip" data-aba="historico">Histórico</button></div>
    <div data-corpo><p class="gc-dica">Carregando...</p></div>`;
  const corpo = raiz.querySelector('[data-corpo]');
  raiz.querySelectorAll('[data-aba]').forEach(b => {
    b.onclick = () => { raiz.querySelectorAll('[data-aba]').forEach(x => x.classList.toggle('ativo', x === b)); (b.dataset.aba === 'turnos' ? turnos : historico)(); };
  });

  async function turnos() {
    corpo.innerHTML = '<p class="gc-dica">Carregando...</p>';
    let d;
    try { d = await api({ acao: 'listar' }); } catch (err) { corpo.innerHTML = `<p class="gc-dica">${esc(err.message)}</p>`; return; }
    const tot = d.entregadores.reduce((a, e) => ({ entregas: a.entregas + e.entregas + e.acertadoHoje.entregas, vendido: a.vendido + e.vendidoCentavos + e.acertadoHoje.vendidoCentavos, ganho: a.ganho + e.receberCentavos + e.acertadoHoje.receberCentavos, rua: a.rua + e.dinheiroRecebidoCentavos }), { entregas: 0, vendido: 0, ganho: 0, rua: 0 });
    corpo.innerHTML = `
      ${d.repasse && d.repasse.tipo ? '' : '<p class="gc-dica">ℹ️ Sem regra própria de pagamento: cada motoboy ganha a <strong>taxa de entrega que o cliente pagou</strong>. Para pagar diferente (valor fixo, por km, diária), configure em ⚙ Configurações → 🛵 Repasse dos motoboys.</p>'}
      ${d.caixaAberto ? '' : '<p class="mb-alerta-pino">🔒 O caixa está fechado: o acerto fica registrado, mas o dinheiro só entra na gaveta do caixa se ele estiver aberto. Abra o caixa antes de acertar.</p>'}
      <div class="ac-totais">
        <div><small>Entregas hoje</small><strong>${tot.entregas}</strong></div>
        <div><small>Vendido nas entregas</small><strong>${formatarCentavos(tot.vendido)}</strong></div>
        <div><small>Ganho dos motoboys</small><strong>${formatarCentavos(tot.ganho)}</strong></div>
        <div><small>Dinheiro na rua</small><strong>${formatarCentavos(tot.rua)}</strong></div>
      </div>
      <button class="btn-outline-sm" type="button" data-chuva style="margin:8px 0;">${d.repasse && d.repasse.chuvaAtiva ? '🌧 Adicional de chuva: LIGADO (tocar para desligar)' : '☀ Adicional de chuva: desligado (tocar para ligar)'}</button>
      ${d.entregadores.length ? '' : '<p class="gc-dica">Nenhum motoboy cadastrado. Cadastre em ⚙ Configurações → Equipe.</p>'}
      ${d.entregadores.map(cartao).join('')}`;
    corpo.querySelector('[data-chuva]').onclick = async () => {
      try { const lig = await alternarChuva(); showToast(lig ? '🌧 Adicional ligado para os próximos pedidos.' : 'Adicional desligado.'); turnos(); } catch (_) { showToast('Não foi possível mudar.'); }
    };
    corpo.querySelectorAll('[data-troco]').forEach(b => {
      b.onclick = async () => {
        const e = d.entregadores.find(x => x.uid === b.dataset.troco);
        const v = prompt(`Quanto de troco você deu para ${e.nome} levar? (R$)\n\nEsse valor sai da gaveta do caixa e volta no acerto.`, reais(e.fundoTrocoCentavos || 5000));
        if (v === null) return;
        try { const r = await api({ acao: 'fundoTroco', uid: e.uid, centavos: centavos(v) }); showToast(r.noCaixa ? '💵 Troco registrado e tirado da gaveta do caixa.' : 'Troco registrado (caixa fechado: não mexeu na gaveta).', 5000); turnos(); } catch (err) { showToast(err.message, 5000); }
      };
    });
    corpo.querySelectorAll('[data-corridas]').forEach(b => {
      b.onclick = () => { const el = corpo.querySelector(`[data-lista="${b.dataset.corridas}"]`); el.classList.toggle('hidden'); };
    });
    corpo.querySelectorAll('[data-confirmar]').forEach(b => {
      b.onclick = () => confirmarAcerto(d.entregadores.find(x => x.uid === b.dataset.confirmar), d.caixaAberto, turnos);
    });
  }

  function cartao(e) {
    const pf = e.porForma || {};
    const formas = FORMAS.filter(([f]) => pf[f] && pf[f].qtd).map(([f, nome, onde]) =>
      `<div class="mb-bag-total"><span>${nome} <small>· ${pf[f].qtd}x · ${onde}</small></span><strong>${formatarCentavos(pf[f].centavos)}</strong></div>`).join('');
    const ah = e.acertadoHoje || {};
    return `
      <div class="cl-item ac-motoboy">
        <div class="cl-topo"><div><strong>🛵 ${esc(e.nome)}</strong><small>${e.status === 'aguardando_acerto' ? '🧾 Encerrou o turno: confira e faça o acerto' : e.emRota ? `🟢 Na rua agora (${e.emRota} na bag)` : e.corridas.length ? '🟢 Turno aberto' : '⚪ Sem corridas para acertar'}</small></div>
          <strong>${e.entregas} entrega(s)</strong></div>
        ${ah.acertos ? `<p class="gc-dica">Já acertado hoje: ${ah.entregas} entrega(s) · ganhou ${formatarCentavos(ah.receberCentavos)}</p>` : ''}
        ${e.corridas.length ? `
        <div class="ac-bloco"><b>Como os clientes pagaram</b> <small>(vendido: ${formatarCentavos(e.vendidoCentavos)})</small>
          ${formas || '<p class="gc-dica">—</p>'}
          ${e.cancelados ? `<p class="gc-dica">${e.cancelados} cancelado(s) com corrida paga ao motoboy.</p>` : ''}
        </div>
        <div class="ac-bloco"><b>Quanto o motoboy ganhou</b>
          <div class="mb-bag-total"><span>Diária</span><strong>${formatarCentavos(e.diariaCentavos)}</strong></div>
          <div class="mb-bag-total"><span>Corridas (${e.corridas.length})</span><strong>${formatarCentavos(e.somaCorridasCentavos)}</strong></div>
          ${e.bonusCentavos ? `<div class="mb-bag-total"><span>Bônus da meta</span><strong>${formatarCentavos(e.bonusCentavos)}</strong></div>` : ''}
          <div class="mb-bag-total"><span><b>Total do motoboy</b></span><strong>${formatarCentavos(e.receberCentavos)}</strong></div>
        </div>
        <div class="ac-bloco"><b>Acerto</b>
          <div class="mb-bag-total"><span>Dinheiro dos clientes que está com ele</span><strong>${formatarCentavos(e.dinheiroRecebidoCentavos)}</strong></div>
          <div class="mb-bag-total"><span>Troco que você deu para ele levar</span><strong>${formatarCentavos(e.fundoTrocoCentavos)}</strong></div>
          <div class="mb-bag-total"><span>− Ganho dele</span><strong>${formatarCentavos(e.receberCentavos)}</strong></div>
          <div class="mb-saldo ${e.saldoCentavos >= 0 ? 'positivo' : 'negativo'}">${e.saldoCentavos >= 0 ? `A loja paga ao motoboy: <strong>${formatarCentavos(e.saldoCentavos)}</strong>` : `O motoboy entrega à loja: <strong>${formatarCentavos(-e.saldoCentavos)}</strong>`}</div>
        </div>
        <div data-lista="${esc(e.uid)}" class="hidden ac-corridas">
          ${e.corridas.map(c => `<div class="mb-bag-linha"><span>${hora(c.em)} · #${esc(c.numero || '')} ${esc(c.bairro || '')} · ${NOME_FORMA[c.forma] || ''}${c.valorCentavos ? ' ' + formatarCentavos(c.valorCentavos) : ''}</span><span>ganho ${formatarCentavos(c.repasseCentavos)}</span></div>`).join('')}
        </div>` : ''}
        <div class="cl-acoes" style="margin-top:6px; flex-wrap:wrap;">
          <button class="btn-outline-sm" type="button" data-troco="${esc(e.uid)}">💵 Troco ${e.fundoTrocoCentavos ? `(${formatarCentavos(e.fundoTrocoCentavos)})` : 'para levar'}</button>
          ${e.corridas.length ? `<button class="btn-outline-sm" type="button" data-corridas="${esc(e.uid)}">📋 Ver corridas</button>` : ''}
          ${e.corridas.length || e.status === 'aguardando_acerto' ? `<button class="btn-primary" style="width:auto;" type="button" data-confirmar="${esc(e.uid)}" ${e.emRota ? 'disabled title="Ainda tem entrega na rua"' : ''}>✅ Fazer acerto</button>` : ''}
        </div>
        ${e.emRota && e.corridas.length ? '<p class="gc-dica">O acerto libera quando ele terminar as entregas que estão na bag.</p>' : ''}
      </div>`;
  }

  async function historico() {
    corpo.innerHTML = '<p class="gc-dica">Carregando...</p>';
    let d;
    try { d = await api({ acao: 'historico' }); } catch (err) { corpo.innerHTML = `<p class="gc-dica">${esc(err.message)}</p>`; return; }
    const lista = d.acertos;
    const total = lista.reduce((a, x) => a + (x.receberCentavos || 0), 0);
    corpo.innerHTML = `
      <p class="gc-dica">${lista.length} acerto(s) · custo total com motoboys: <strong>${formatarCentavos(total)}</strong></p>
      <button class="btn-outline-sm" type="button" data-csv>⬇ Baixar planilha (Excel)</button>
      ${lista.map(x => `<div class="mb-bag-linha"><span>${x.confirmadoEm ? new Date(x.confirmadoEm).toLocaleDateString('pt-BR') : ''} · ${esc(x.nome)} · ${x.entregas} entrega(s)${x.pagoComo ? ` · pago em ${x.pagoComo === 'pix' ? 'Pix' : 'dinheiro'}` : ''}</span><span>${formatarCentavos(x.receberCentavos)}</span></div>`).join('') || '<p class="gc-dica">Nenhum acerto ainda.</p>'}`;
    corpo.querySelector('[data-csv]').onclick = () => {
      const pf = (x, f) => (x.porForma && x.porForma[f] ? x.porForma[f].centavos : 0);
      const linhas = [['data', 'motoboy', 'entregas', 'vendido', 'pago_no_site', 'dinheiro', 'maquininha', 'pix_pendente', 'diaria', 'corridas', 'bonus', 'ganho_motoboy', 'troco_inicial', 'saldo', 'pago_como']]
        .concat(lista.map(x => [x.confirmadoEm ? new Date(x.confirmadoEm).toLocaleString('pt-BR') : '', x.nome, x.entregas,
          reais(x.vendidoCentavos), reais(pf(x, 'online')), reais(x.dinheiroRecebidoCentavos), reais(x.cartaoCentavos), reais(pf(x, 'pix_pendente')),
          reais(x.diariaCentavos), reais(x.somaCorridasCentavos), reais(x.bonusCentavos), reais(x.receberCentavos), reais(x.fundoTrocoCentavos), reais(x.saldoCentavos), x.pagoComo || '']
          .map(v => String(v ?? ''))));
      const csv = '﻿' + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `acertos-motoboys-${AppState.lojaDados.slug || 'loja'}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
    };
  }

  turnos();
}

// Confirmar o acerto: o dono diz como pagou o motoboy (dinheiro da gaveta ou Pix) e o caixa é ajustado sozinho
function confirmarAcerto(e, caixaAberto, depois) {
  const ov = document.createElement('div');
  ov.className = 'gc-overlay';
  const naGaveta = (como) => (como === 'dinheiro' ? e.devolverCentavos - e.receberCentavos : e.devolverCentavos);
  const texto = (como) => {
    const v = naGaveta(como);
    return v > 0 ? `Entra na gaveta do caixa: <strong>${formatarCentavos(v)}</strong>` : v < 0 ? `Sai da gaveta do caixa: <strong>${formatarCentavos(-v)}</strong>` : 'A gaveta do caixa não muda.';
  };
  ov.innerHTML = `
    <div class="card gc-form" style="max-width:420px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;"><h3>✅ Acerto de ${esc(e.nome)}</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button></div>
      <p>${e.entregas} entrega(s) · ganho dele: <strong>${formatarCentavos(e.receberCentavos)}</strong></p>
      <p class="gc-dica">Ele te entrega <strong>${formatarCentavos(e.dinheiroRecebidoCentavos)}</strong> de dinheiro dos clientes${e.fundoTrocoCentavos ? ` + <strong>${formatarCentavos(e.fundoTrocoCentavos)}</strong> do troco` : ''}.</p>
      <p style="margin-top:10px;"><b>Como você vai pagar o ganho dele?</b></p>
      <label class="ac-opcao"><input type="radio" name="como" value="dinheiro" checked /> <span>💵 Em dinheiro, na hora (desconta do que ele entrega)<br/><small data-t="dinheiro">${texto('dinheiro')}</small></span></label>
      <label class="ac-opcao"><input type="radio" name="como" value="pix" /> <span>📲 Por Pix / transferência (ele entrega todo o dinheiro)<br/><small data-t="pix">${texto('pix')}</small></span></label>
      ${caixaAberto ? '<p class="gc-dica">O movimento é lançado sozinho no caixa aberto (aparece no fechamento).</p>' : '<p class="mb-alerta-pino">Caixa fechado: o acerto fica registrado, mas não entra na gaveta.</p>'}
      <button class="btn-primary" type="button" data-ok style="margin-top:10px;">Confirmar acerto e fechar o turno dele</button>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-fechar]').onclick = () => ov.remove();
  ov.querySelector('[data-ok]').onclick = async (ev) => {
    const como = ov.querySelector('input[name="como"]:checked').value;
    ev.target.disabled = true;
    try {
      const r = await api({ acao: 'confirmar', uid: e.uid, pagoComo: como });
      ov.remove();
      showToast(r.noCaixa ? '✅ Acerto feito e lançado no caixa.' : '✅ Acerto feito (caixa fechado: não entrou na gaveta).', 5000);
      depois();
    } catch (err) { showToast(err.message, 5000); ev.target.disabled = false; }
  };
}
