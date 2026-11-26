// Backup completo da loja (só o dono): baixa um arquivo .json com tudo e uma planilha .csv dos pedidos.
// Guarde o arquivo no computador/Google Drive. Ele serve para conferência e para recuperar dados.
import { db, auth, showToast } from './config.js';
import { AppState } from './router.js';
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Converte datas do Firestore em texto (o JSON não entende o formato do Firestore)
function limpar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(limpar);
  if (typeof v === 'object') {
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) return { lat: v.latitude, lng: v.longitude };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpar(x)]));
  }
  return v;
}

async function api(rota, corpo) {
  const u = auth.currentUser;
  const r = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'falhou');
  return d;
}

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const celula = (v) => {
  const t = String(v ?? '');
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function baixarBackupLoja() {
  const lojaId = AppState.lojaId;
  showToast('📦 Preparando o backup... pode levar alguns segundos.', 4000);
  try {
    const ref = (...c) => doc(db, 'lojas', lojaId, ...c);
    const [loja, cardapio, estado, pedidosSnap, turnosSnap] = await Promise.all([
      getDoc(doc(db, 'lojas', lojaId)),
      getDoc(ref('publico', 'cardapio_completo')),
      getDoc(ref('publico', 'estado')),
      getDocs(collection(db, 'lojas', lojaId, 'pedidos')),
      getDocs(collection(db, 'lojas', lojaId, 'turnos')).catch(() => ({ docs: [] }))
    ]);
    const pedidos = pedidosSnap.docs.map(d => ({ id: d.id, ...limpar(d.data()) }));
    let clientes = null, acertos = null;
    try { clientes = (await api('/api/clientes', { acao: 'listar' })).clientes || null; } catch (_) { /* segue sem */ }
    try { acertos = (await api('/api/acertos', { acao: 'historico' })).acertos || null; } catch (_) { /* segue sem */ }
    const lojaDados = limpar(loja.data() || {});
    const backup = {
      tipo: 'backup-delivery-pro', versao: 1, geradoEm: new Date().toISOString(), lojaId,
      loja: lojaDados,
      cardapio: limpar(cardapio.data() || {}),
      estadoCaixa: limpar(estado.data() || {}),
      turnos: turnosSnap.docs.map(d => ({ id: d.id, ...limpar(d.data()) })),
      pedidos, clientes, acertosMotoboy: acertos
    };
    const dia = new Date().toISOString().slice(0, 10);
    const nomeBase = `backup-${(lojaDados.slug || lojaId).replace(/[^a-z0-9-]/gi, '')}-${dia}`;
    baixar(`${nomeBase}.json`, JSON.stringify(backup, null, 2), 'application/json');

    const linhas = [['Data', 'Número', 'Status', 'Cliente', 'WhatsApp', 'Tipo', 'Pagamento', 'Itens', 'Frete (R$)', 'Total (R$)']];
    pedidos.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm))).forEach(p => linhas.push([
      p.criadoEm ? new Date(p.criadoEm).toLocaleString('pt-BR') : '', p.numeroPedido || '', p.status || '', p.clienteNome || '', p.clienteWhatsapp || '',
      p.tipoEntrega || '', p.formaPagamento || '',
      (p.itens || []).map(i => `${i.quantidade || 1}x ${i.nome || ''}`).join(' | '),
      ((Number(p.freteCentavos) || 0) / 100).toFixed(2).replace('.', ','), ((Number(p.totalCentavos) || 0) / 100).toFixed(2).replace('.', ',')
    ]));
    setTimeout(() => baixar(`${nomeBase}-pedidos.csv`, '\uFEFF' + linhas.map(l => l.map(celula).join(';')).join('\n'), 'text/csv;charset=utf-8'), 800);
    showToast(`✅ Backup baixado: ${pedidos.length} pedido(s)${clientes ? `, ${clientes.length} cliente(s)` : ''}. Guarde o arquivo em local seguro.`, 7000);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível gerar o backup agora. Confira a internet e tente de novo.');
  }
}
