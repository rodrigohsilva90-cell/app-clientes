// Painel do dono: horário de funcionamento por dia da semana (até 2 faixas por dia)
import { db, showToast } from './config.js';
import { AppState } from './router.js';
import { DIAS, NOMES_DIA, situacaoLoja } from './horario.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ORDEM = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

export function abrirConfigHorarios() {
  const atuais = AppState.lojaDados.horarios || {};
  const linha = (dia) => {
    const faixas = atuais[dia] || [];
    const f1 = faixas[0] || { abre: '18:00', fecha: '23:00' };
    const f2 = faixas[1] || null;
    return `
      <div class="hr-dia" data-dia="${dia}">
        <label class="hr-nome"><input type="checkbox" data-abre ${faixas.length ? 'checked' : ''} /> ${NOMES_DIA[dia][0].toUpperCase() + NOMES_DIA[dia].slice(1)}</label>
        <div class="hr-faixas">
          <div class="hr-faixa"><input type="time" data-a="1" value="${f1.abre}" /> até <input type="time" data-f="1" value="${f1.fecha}" /></div>
          <div class="hr-faixa ${f2 ? '' : 'hidden'}" data-segunda><input type="time" data-a="2" value="${f2 ? f2.abre : '11:00'}" /> até <input type="time" data-f="2" value="${f2 ? f2.fecha : '14:00'}" />
            <button type="button" class="btn-outline-sm" data-tirar title="Remover 2º horário">✕</button></div>
          <button type="button" class="hr-mais ${f2 ? 'hidden' : ''}" data-mais>+ 2º horário</button>
        </div>
      </div>`;
  };

  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>🕒 Horário de funcionamento</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      <p class="gc-dica">Fora destes horários o cardápio mostra "Fechado" e não aceita pedidos. Se fechar depois da meia-noite, é só colocar o horário (ex.: 18:00 até 02:00).</p>
      <div id="hr-lista">${ORDEM.map(linha).join('')}</div>
      <button type="button" class="btn-outline-sm" id="hr-copiar" style="margin:8px 0;">📋 Copiar o horário de segunda para todos os dias marcados</button>
      <p class="gc-dica" id="hr-previa"></p>
      <button class="btn-primary" id="hr-salvar">💾 Salvar horários</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  $('[data-fechar]').onclick = () => overlay.remove();

  const ler = () => {
    const horarios = {};
    overlay.querySelectorAll('.hr-dia').forEach(el => {
      const dia = el.dataset.dia;
      if (!el.querySelector('[data-abre]').checked) { horarios[dia] = []; return; }
      const faixas = [{ abre: el.querySelector('[data-a="1"]').value, fecha: el.querySelector('[data-f="1"]').value }];
      if (!el.querySelector('[data-segunda]').classList.contains('hidden')) {
        faixas.push({ abre: el.querySelector('[data-a="2"]').value, fecha: el.querySelector('[data-f="2"]').value });
      }
      horarios[dia] = faixas;
    });
    return horarios;
  };
  const previa = () => {
    const s = situacaoLoja({ ...AppState.lojaDados, horarios: ler() }, null);
    $('#hr-previa').textContent = `Com estes horários, agora o cardápio mostraria: "${s.texto}".`;
  };

  overlay.querySelectorAll('.hr-dia').forEach(el => {
    const atualizarAtivo = () => el.classList.toggle('hr-fechado', !el.querySelector('[data-abre]').checked);
    el.querySelector('[data-abre]').onchange = () => { atualizarAtivo(); previa(); };
    el.querySelector('[data-mais]').onclick = () => {
      el.querySelector('[data-segunda]').classList.remove('hidden');
      el.querySelector('[data-mais]').classList.add('hidden');
      previa();
    };
    el.querySelector('[data-tirar]').onclick = () => {
      el.querySelector('[data-segunda]').classList.add('hidden');
      el.querySelector('[data-mais]').classList.remove('hidden');
      previa();
    };
    el.querySelectorAll('input[type="time"]').forEach(i => i.oninput = previa);
    atualizarAtivo();
  });

  $('#hr-copiar').onclick = () => {
    const base = overlay.querySelector('.hr-dia[data-dia="seg"]');
    const valores = [...base.querySelectorAll('input[type="time"]')].map(i => i.value);
    const temSegunda = !base.querySelector('[data-segunda]').classList.contains('hidden');
    overlay.querySelectorAll('.hr-dia').forEach(el => {
      if (el === base || !el.querySelector('[data-abre]').checked) return;
      el.querySelectorAll('input[type="time"]').forEach((i, n) => { i.value = valores[n]; });
      el.querySelector('[data-segunda]').classList.toggle('hidden', !temSegunda);
      el.querySelector('[data-mais]').classList.toggle('hidden', temSegunda);
    });
    previa();
    showToast('Horário de segunda copiado.');
  };

  $('#hr-salvar').onclick = async (e) => {
    const horarios = ler();
    for (const dia of DIAS) {
      for (const f of horarios[dia]) {
        if (!f.abre || !f.fecha) { showToast(`Preencha os horários de ${NOMES_DIA[dia]}.`); return; }
      }
    }
    if (!DIAS.some(d => horarios[d].length)) {
      if (!confirm('Nenhum dia marcado: a loja ficará sempre fechada. Continuar?')) return;
    }
    e.target.disabled = true;
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId), { horarios, fusoHorario: 'America/Sao_Paulo' });
      AppState.lojaDados = { ...AppState.lojaDados, horarios, fusoHorario: 'America/Sao_Paulo' };
      showToast('Horários salvos!');
      overlay.remove();
      document.dispatchEvent(new CustomEvent('loja-atualizada'));
    } catch (err) {
      console.error(err);
      showToast(err.code === 'permission-denied' ? 'Só o dono pode alterar os horários.' : 'Erro ao salvar.');
      e.target.disabled = false;
    }
  };
  previa();
}
