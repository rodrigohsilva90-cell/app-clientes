// Caixa por turno: abrir (com fundo de troco), acompanhar e fechar com resumo.
// O turno não depende do relógio (um turno das 18h às 02h fica inteiro).
// Estado atual: lojas/{lojaId}/publico/estado  |  Histórico: lojas/{lojaId}/turnos/{turnoId}
import { db, auth, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import {
  doc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp
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
    await setDoc(refEstado(), { caixaAberto: true, turnoId: turno.id, abertoEm: serverTimestamp(), fundoTrocoCentavos });
    showToast('Caixa aberto! Bom turno.');
    return true;
  } catch (err) {
    console.error(err);
    showToast(err.code === 'permission-denied' ? 'Sem permissão para abrir o caixa (atualize as regras do Firestore).' : 'Erro ao abrir o caixa.');
    return false;
  }
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
  r.dinheiroEsperadoCentavos = r.fundoTrocoCentavos + (r.porPagamento.Dinheiro || 0);
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
    ${linha('Dinheiro esperado na gaveta', formatarCentavos(r.dinheiroEsperadoCentavos))}
    ${linha('Cancelados', r.cancelados)}
    ${linha('Com ocorrência', r.ocorrencias)}
  `;
}

export async function fecharCaixa(estado) {
  if (!estado?.turnoId) return;
  let pedidos;
  try {
    const snap = await getDocs(query(collection(db, 'lojas', AppState.lojaId, 'pedidos'), where('turnoId', '==', estado.turnoId)));
    pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar os pedidos do turno.');
    return;
  }
  const r = calcularResumo(pedidos, estado);

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
        status: 'fechado', fechadoEm: serverTimestamp(), fechadoPor: auth.currentUser?.uid || null, resumo: r
      });
      await setDoc(refEstado(), { caixaAberto: false, turnoId: null, ultimoTurnoId: estado.turnoId, fechadoEm: serverTimestamp() });
      overlay.remove();
      showToast('Caixa fechado. Resumo salvo.');
    } catch (err) {
      console.error(err);
      e.target.disabled = false;
      showToast('Erro ao fechar o caixa.');
    }
  };
}
