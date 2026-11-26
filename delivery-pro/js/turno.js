// Caixa por turno: abrir (com fundo de troco), acompanhar e fechar com resumo.
// O turno não depende do relógio (um turno das 18h às 02h fica inteiro).
// Estado atual: lojas/{lojaId}/publico/estado  |  Histórico: lojas/{lojaId}/turnos/{turnoId}
import { db, auth, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { calcularRepasse } from './frete.js';
import {
  doc, setDoc, addDoc, updateDoc, getDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp, arrayUnion, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const NOMES_PAGAMENTO = { dinheiro: 'Dinheiro', cartao: 'Cartão', cartao_entrega: 'Cartão', pix: 'Pix', balcao: 'Balcão (antigo)' };

const reaisParaCentavos = (t) => {
  let s = String(t ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

const refEstado = () => doc(db, 'lojas', AppState.lojaId, 'publico', 'estado');

export function escutarEstadoCaixa(callback) {
  return onSnapshot(refEstado(),
    (snap) => callback(snap.exists() ? snap.data() : { caixaAberto: false }),
    (err) => { console.error(err); callback({ caixaAberto: false, erro: true }); });
}

export async function abrirCaixa() {
  const texto = prompt('Abrir caixa\n\nQuanto há de dinheiro no caixa para troco? (R$)', '0,00');
  if (texto === null) return false;
  const fundoTrocoCentavos = reaisParaCentavos(texto);
  if (fundoTrocoCentavos === null) { showToast('Valor inválido. Use o formato 50,00.'); return false; }
  try {
    const turno = await addDoc(collection(db, 'lojas', AppState.lojaId, 'turnos'), {
      status: 'aberto',
      abertoEm: serverTimestamp(),
      abertoPor: auth.currentUser?.uid || null,
      fundoTrocoCentavos
    });
    await setDoc(refEstado(), { caixaAberto: true, turnoId: turno.id, abertoEm: serverTimestamp(), fundoTrocoCentavos }, { merge: true });
    showToast('Caixa aberto! Bom turno.');
    return true;
  } catch (err) {
    console.error(err);
    showToast(err.code === 'permission-denied' ? 'Sem permissão para abrir o caixa (atualize as regras do Firestore).' : 'Erro ao abrir o caixa.');
    return false;
  }
}

// Despesa (gás, gelo, troco pago a fornecedor...) ou sangria (dinheiro retirado da gaveta) no turno aberto
export function lancarMovimento(estado) {
  if (!estado?.caixaAberto || !estado.turnoId) { showToast('Abra o caixa primeiro.'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form" style="max-width:400px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>💸 Despesa ou sangria</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div class="rl-periodos" style="margin:8px 0;">
        <button type="button" class="rl-chip ativo" data-tipo="despesa">🧾 Despesa</button>
        <button type="button" class="rl-chip" data-tipo="sangria">💵 Sangria</button>
      </div>
      <p class="gc-dica" data-explica>Algo que foi pago com o dinheiro da gaveta (gás, gelo, embalagem...).</p>
      <label>Valor (R$)<input type="text" inputmode="decimal" data-valor placeholder="0,00"/></label>
      <label>O que foi?<input type="text" maxlength="80" data-desc placeholder="Ex.: botijão de gás"/></label>
      <button class="btn-primary" type="button" data-salvar style="margin-top:10px;">Lançar</button>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (q) => overlay.querySelector(q);
  let tipo = 'despesa';
  $('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
    tipo = b.dataset.tipo;
    overlay.querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('ativo', x === b));
    $('[data-explica]').textContent = tipo === 'sangria' ? 'Dinheiro tirado da gaveta para guardar (cofre, banco, dono levou).' : 'Algo que foi pago com o dinheiro da gaveta (gás, gelo, embalagem...).';
    $('[data-desc]').placeholder = tipo === 'sangria' ? 'Ex.: levado para o cofre' : 'Ex.: botijão de gás';
  });
  $('[data-salvar]').onclick = async (e) => {
    const valorCentavos = reaisParaCentavos($('[data-valor]').value);
    const descricao = $('[data-desc]').value.trim().slice(0, 80);
    if (!valorCentavos) { showToast('Informe o valor. Ex.: 25,00'); return; }
    if (!descricao) { showToast('Escreva o que foi.'); return; }
    e.target.disabled = true;
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'turnos', estado.turnoId), {
        movimentos: arrayUnion({ tipo, valorCentavos, descricao, em: Timestamp.now(), por: auth.currentUser?.uid || null })
      });
      overlay.remove();
      showToast(tipo === 'sangria' ? 'Sangria lançada.' : 'Despesa lançada.');
    } catch (err) {
      console.error(err);
      e.target.disabled = false;
      showToast('Não foi possível lançar agora.');
    }
  };
}

function calcularResumo(pedidos, estado) {
  const r = {
    quantidade: 0, totalCentavos: 0, freteCentavos: 0,
    porPagamento: {}, porCanal: { vitrine: 0, balcao: 0 },
    cancelados: 0, ocorrencias: 0, emAberto: 0, retiradas: 0, entregas: 0
  };
  for (const p of pedidos) {
    if (p.status === 'cancelado') { r.cancelados++; continue; }
    if (p.status === 'ocorrencia') { r.ocorrencias++; continue; }
    if (['novo', 'preparo', 'entrega'].includes(p.status)) r.emAberto++;
    r.quantidade++;
    r.totalCentavos += Number(p.totalCentavos) || 0;
    r.freteCentavos += Number(p.freteCentavos) || 0;
    const forma = NOMES_PAGAMENTO[p.formaPagamento] || p.formaPagamento || 'Outro';
    r.porPagamento[forma] = (r.porPagamento[forma] || 0) + (Number(p.totalCentavos) || 0);
    if (p.canal === 'vitrine') r.porCanal.vitrine++; else r.porCanal.balcao++;
    if (p.tipoEntrega === 'retirada') r.retiradas++; else r.entregas++;
  }
  r.ticketMedioCentavos = r.quantidade ? Math.round(r.totalCentavos / r.quantidade) : 0;
  r.fundoTrocoCentavos = Number(estado.fundoTrocoCentavos) || 0;
  const movs = Array.isArray(estado.movimentos) ? estado.movimentos : [];
  r.despesasCentavos = movs.filter(m => m.tipo === 'despesa').reduce((a, m) => a + (Number(m.valorCentavos) || 0), 0);
  r.sangriasCentavos = movs.filter(m => m.tipo === 'sangria').reduce((a, m) => a + (Number(m.valorCentavos) || 0), 0);
  r.movimentos = movs.map(m => ({ tipo: m.tipo, valorCentavos: Number(m.valorCentavos) || 0, descricao: String(m.descricao || '') }));
  r.dinheiroEsperadoCentavos = r.fundoTrocoCentavos + (r.porPagamento.Dinheiro || 0) - r.despesasCentavos - r.sangriasCentavos;
  // Repasse das corridas dos motoboys deste turno (o que a loja paga por entrega)
  const rep = AppState.lojaDados && AppState.lojaDados.repasse;
  r.corridasMotoboyCentavos = pedidos.filter(p => p.motoboyId && p.status === 'concluido')
    .reduce((a, p) => a + (p.repasseMotoboyCentavos != null ? Number(p.repasseMotoboyCentavos) || 0 : (rep ? calcularRepasse(rep, p) : 0)), 0);
  return r;
}

function htmlResumo(r, estado, paraImpressao = false) {
  const linha = (a, b) => paraImpressao ? `${a}: ${b}<br/>` : `<div class="tr-linha"><span>${a}</span><strong>${b}</strong></div>`;
  const abertoEm = estado.abertoEm?.toDate ? estado.abertoEm.toDate().toLocaleString('pt-BR') : '-';
  return `
    ${linha('Aberto em', esc(abertoEm))}
    ${linha('Fechado em', new Date().toLocaleString('pt-BR'))}
    ${paraImpressao ? '<br/>' : '<hr/>'}
    ${linha('Pedidos válidos', r.quantidade)}
    ${linha('Faturamento', formatarCentavos(r.totalCentavos))}
    ${linha('Ticket médio', formatarCentavos(r.ticketMedioCentavos))}
    ${linha('Taxas de entrega', formatarCentavos(r.freteCentavos))}
    ${linha('Entregas / Retiradas', `${r.entregas} / ${r.retiradas}`)}
    ${linha('Pelo site / No balcão', `${r.porCanal.vitrine} / ${r.porCanal.balcao}`)}
    ${paraImpressao ? '<br/>' : '<hr/>'}
    ${Object.entries(r.porPagamento).map(([forma, v]) => linha(esc(forma), formatarCentavos(v))).join('') || linha('Vendas', 'nenhuma')}
    ${paraImpressao ? '<br/>' : '<hr/>'}
    ${linha('Fundo de troco', formatarCentavos(r.fundoTrocoCentavos))}
    ${r.despesasCentavos ? linha('Despesas pagas da gaveta', '− ' + formatarCentavos(r.despesasCentavos)) : ''}
    ${r.sangriasCentavos ? linha('Sangrias (dinheiro retirado)', '− ' + formatarCentavos(r.sangriasCentavos)) : ''}
    ${linha('Dinheiro esperado na gaveta', formatarCentavos(r.dinheiroEsperadoCentavos))}
    ${linha('Cancelados', r.cancelados)}
    ${linha('Com ocorrência', r.ocorrencias)}
    ${r.movimentos.length ? (paraImpressao ? '<br/>' : '<hr/>') + r.movimentos.map(m => linha(`${m.tipo === 'sangria' ? '💵 Sangria' : '🧾 Despesa'}: ${esc(m.descricao)}`, formatarCentavos(m.valorCentavos))).join('') : ''}
    ${r.lucro ? (paraImpressao ? '<br/>' : '<hr/>') + `
      ${linha('Faturamento', formatarCentavos(r.totalCentavos))}
      ${linha('− Corridas dos motoboys', formatarCentavos(r.lucro.corridasCentavos))}
      ${linha('− Diárias e bônus acertados', formatarCentavos(r.lucro.diariasBonusCentavos))}
      ${linha('− Despesas do turno', formatarCentavos(r.despesasCentavos))}
      ${linha('= Lucro operacional', formatarCentavos(r.lucro.lucroCentavos))}
      ${paraImpressao ? '' : '<p class="gc-dica">Antes de descontar o custo dos produtos (ingredientes, mercadoria). Diárias e bônus entram quando o acerto do motoboy é confirmado.</p>'}` : ''}
  `;
}

export async function fecharCaixa(estado, { dono = false } = {}) {
  if (!estado?.turnoId) return;
  let pedidos;
  try {
    const snap = await getDocs(query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('turnoId', '==', estado.turnoId)));
    pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const t = await getDoc(doc(db, 'lojas', AppState.lojaId, 'turnos', estado.turnoId));
    if (t.exists()) estado = { ...estado, movimentos: t.data().movimentos || [] };
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar os pedidos do turno.');
    return;
  }
  const r = calcularResumo(pedidos, estado);
  // Só o dono vê o lucro do dia (o funcionário não vê o total do dia)
  if (dono) {
    let diariasBonusCentavos = 0;
    try {
      const desde = estado.abertoEm?.toMillis ? estado.abertoEm.toMillis() : 0;
      const u = auth.currentUser;
      const resp = await fetch('/api/acertos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, acao: 'historico' }) });
      const d = await resp.json().catch(() => ({}));
      for (const a of (resp.ok && d.acertos) || []) {
        if (a.confirmadoEm && new Date(a.confirmadoEm).getTime() >= desde) diariasBonusCentavos += (Number(a.diariaCentavos) || 0) + (Number(a.bonusCentavos) || 0);
      }
    } catch (_) { /* sem internet: mostra sem as diárias */ }
    r.lucro = { corridasCentavos: r.corridasMotoboyCentavos, diariasBonusCentavos,
      lucroCentavos: r.totalCentavos - r.corridasMotoboyCentavos - diariasBonusCentavos - r.despesasCentavos };
  }

  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:440px; width:100%; max-height:92vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3>🔒 Fechar caixa</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      ${r.emAberto ? `<div class="tr-alerta">⚠️ Ainda há ${r.emAberto} pedido(s) em andamento. Eles ficam neste turno, mas confira antes de fechar.</div>` : ''}
      <div class="tr-resumo">${htmlResumo(r, estado)}</div>
      <div style="display:flex; gap:8px; margin-top:14px; flex-wrap:wrap;">
        <button class="btn-outline-sm" data-imprimir>🖨️ Imprimir resumo</button>
        <button class="btn-primary" data-confirmar style="flex:1;">Confirmar fechamento</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelector('[data-imprimir]').onclick = () => {
    const area = document.getElementById('print-receipt');
    if (!area) return;
    area.innerHTML = `
      <div style="text-align:center; border-bottom:1px dashed #000; padding-bottom:6px;">
        <strong>${esc((AppState.lojaDados.nome || '').toUpperCase())}</strong><br/>FECHAMENTO DE CAIXA
      </div>
      <div style="padding-top:6px;">${htmlResumo(r, estado, true)}</div>
    `;
    window.print();
  };
  overlay.querySelector('[data-confirmar]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId, 'turnos', estado.turnoId), {
        status: 'fechado', fechadoEm: serverTimestamp(), fechadoPor: auth.currentUser?.uid || null, resumo: (({ lucro, ...resto }) => resto)(r)
      });
      await setDoc(refEstado(), { caixaAberto: false, turnoId: null, ultimoTurnoId: estado.turnoId, fechadoEm: serverTimestamp() }, { merge: true });
      overlay.remove();
      showToast('Caixa fechado. Resumo salvo.');
    } catch (err) {
      console.error(err);
      e.target.disabled = false;
      showToast('Erro ao fechar o caixa.');
    }
  };
}

// Pausa/retoma os pedidos online na hora (imprevisto, cozinha lotada...)
export async function pausarPedidos(pausar) {
  try {
    await setDoc(refEstado(), { pausada: !!pausar, pausadaEm: pausar ? serverTimestamp() : null }, { merge: true });
    showToast(pausar ? '⏸ Pedidos online pausados.' : '▶ Pedidos online liberados.');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível alterar. Confira as regras do Firestore.');
  }
}
