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
export async function abrirAcertos() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form cl-caixa" style="max-width:640px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>💰 Acerto dos motoboys</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div class="rl-periodos"><button type="button" class="rl-chip ativo" data-aba="turnos">Turnos de hoje</button><button type="button" class="rl-chip" data-aba="historico">Histórico</button></div>
      <div id="ac-corpo"><p class="gc-dica">Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const corpo = overlay.querySelector('#ac-corpo');
  overlay.querySelectorAll('[data-aba]').forEach(b => {
    b.onclick = () => { overlay.querySelectorAll('[data-aba]').forEach(x => x.classList.toggle('ativo', x === b)); (b.dataset.aba === 'turnos' ? turnos : historico)(); };
  });

  async function turnos() {
    corpo.innerHTML = '<p class="gc-dica">Carregando...</p>';
    let d;
    try { d = await api({ acao: 'listar' }); } catch (err) { corpo.innerHTML = `<p class="gc-dica">${esc(err.message)}</p>`; return; }
    if (!d.repasse) corpo.innerHTML = '<p class="mb-alerta-pino">Configure primeiro quanto paga cada entrega em ⚙ Configurações → 🛵 Repasse dos motoboys.</p>';
    else corpo.innerHTML = '';
    corpo.innerHTML += `<button class="btn-outline-sm" type="button" data-chuva style="margin-bottom:8px;">${d.repasse && d.repasse.chuvaAtiva ? '🌧 Adicional de chuva: LIGADO (tocar para desligar)' : '☀ Adicional de chuva: desligado (tocar para ligar)'}</button>`;
    if (!d.entregadores.length) { corpo.innerHTML += '<p class="gc-dica">Nenhum motoboy cadastrado. Cadastre em ⚙ Configurações → Equipe.</p>'; }
    corpo.innerHTML += d.entregadores.map(e => `
      <div class="cl-item">
        <div class="cl-topo"><div><strong>🛵 ${esc(e.nome)}</strong><small>${e.status === 'aguardando_acerto' ? '🧾 Encerrou o turno: confira e confirme' : e.emRota ? `🟢 Em rota (${e.emRota})` : '🟢 Turno aberto'}</small></div><strong>${e.entregas} entrega(s)</strong></div>
        <div class="mb-comprovante">
          <div class="mb-bag-total"><span>Diária</span><strong>${formatarCentavos(e.diariaCentavos)}</strong></div>
          <div class="mb-bag-total"><span>Corridas</span><strong>${formatarCentavos(e.somaCorridasCentavos)}</strong></div>
          ${e.bonusCentavos ? `<div class="mb-bag-total"><span>Bônus da meta</span><strong>${formatarCentavos(e.bonusCentavos)}</strong></div>` : ''}
          <div class="mb-bag-total"><span>Dinheiro recebido dos clientes</span><strong>− ${formatarCentavos(e.dinheiroRecebidoCentavos)}</strong></div>
          <div class="mb-bag-total"><span>Troco inicial entregue</span><strong>− ${formatarCentavos(e.fundoTrocoCentavos)}</strong></div>
          <div class="mb-saldo ${e.saldoCentavos >= 0 ? 'positivo' : 'negativo'}">${e.saldoCentavos >= 0 ? `Pagar ao motoboy: <strong>${formatarCentavos(e.saldoCentavos)}</strong>` : `O motoboy devolve: <strong>${formatarCentavos(-e.saldoCentavos)}</strong>`}</div>
        </div>
        <div class="cl-acoes" style="margin-top:6px;">
          <button class="btn-outline-sm" type="button" data-troco="${esc(e.uid)}">💵 Troco inicial</button>
          ${e.corridas.length || e.status === 'aguardando_acerto' ? `<button class="btn-primary" style="width:auto;" type="button" data-confirmar="${esc(e.uid)}" ${e.emRota ? 'disabled title="Ainda tem entrega em rota"' : ''}>✅ Confirmar acerto e fechar turno</button>` : ''}
        </div>
      </div>`).join('');
    corpo.querySelector('[data-chuva]').onclick = async () => {
      try { const lig = await alternarChuva(); showToast(lig ? '🌧 Adicional ligado para os próximos pedidos.' : 'Adicional desligado.'); turnos(); } catch (_) { showToast('Não foi possível mudar.'); }
    };
    corpo.querySelectorAll('[data-troco]').forEach(b => {
      b.onclick = async () => {
        const v = prompt('Quanto de troco você entregou para este motoboy no início do turno? (R$)', '50,00');
        if (v === null) return;
        try { await api({ acao: 'fundoTroco', uid: b.dataset.troco, centavos: centavos(v) }); showToast('Troco inicial registrado.'); turnos(); } catch (err) { showToast(err.message, 5000); }
      };
    });
    corpo.querySelectorAll('[data-confirmar]').forEach(b => {
      b.onclick = async () => {
        const e = d.entregadores.find(x => x.uid === b.dataset.confirmar);
        if (!confirm(`Confirmar o acerto de ${e.nome}?\n\n${e.saldoCentavos >= 0 ? `A loja paga ${formatarCentavos(e.saldoCentavos)} ao motoboy.` : `O motoboy devolve ${formatarCentavos(-e.saldoCentavos)} à loja.`}\n\nO turno é fechado e essas corridas não contam de novo.`)) return;
        b.disabled = true;
        try { await api({ acao: 'confirmar', uid: e.uid }); showToast('✅ Acerto confirmado e turno fechado.'); turnos(); }
        catch (err) { showToast(err.message, 5000); b.disabled = false; }
      };
    });
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
      ${lista.map(x => `<div class="mb-bag-linha"><span>${x.confirmadoEm ? new Date(x.confirmadoEm).toLocaleDateString('pt-BR') : ''} · ${esc(x.nome)} · ${x.entregas} entrega(s)</span><span>${formatarCentavos(x.receberCentavos)}</span></div>`).join('') || '<p class="gc-dica">Nenhum acerto ainda.</p>'}`;
    corpo.querySelector('[data-csv]').onclick = () => {
      const linhas = [['data', 'motoboy', 'entregas', 'diaria', 'corridas', 'bonus', 'total_a_receber', 'dinheiro_recebido', 'troco_inicial', 'saldo']]
        .concat(lista.map(x => [x.confirmadoEm ? new Date(x.confirmadoEm).toLocaleString('pt-BR') : '', x.nome, x.entregas, x.diariaCentavos, x.somaCorridasCentavos, x.bonusCentavos, x.receberCentavos, x.dinheiroRecebidoCentavos, x.fundoTrocoCentavos, x.saldoCentavos]
          .map((v, i) => (i >= 3 ? reais(v) : String(v ?? '')))));
      const csv = '\uFEFF' + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `acertos-motoboys-${AppState.lojaDados.slug || 'loja'}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
    };
  }

  turnos();
}
