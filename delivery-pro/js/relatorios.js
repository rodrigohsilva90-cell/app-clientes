// Relatórios do dono: vendas, produtos mais vendidos, horários de pico e clientes.
// Tudo calculado no celular do dono a partir dos pedidos da loja (só a equipe pode ler).
import { db, formatarCentavos, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { collection, query, where, getDocs, Timestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const DIA = 24 * 60 * 60 * 1000;
const PAGAMENTOS = { dinheiro: 'Dinheiro', cartao: 'Cartão', cartao_entrega: 'Cartão', pix: 'Pix', balcao: 'Balcão' };
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const inicioDoDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Cada período: [início, fim) e o período anterior do mesmo tamanho (para comparar)
function periodo(id) {
  const hoje = inicioDoDia(new Date());
  const amanha = new Date(hoje.getTime() + DIA);
  if (id === 'hoje') return { ini: hoje, fim: amanha, nome: 'Hoje', antes: 'ontem' };
  if (id === 'ontem') return { ini: new Date(hoje.getTime() - DIA), fim: hoje, nome: 'Ontem', antes: 'anteontem' };
  if (id === '7d') return { ini: new Date(hoje.getTime() - 6 * DIA), fim: amanha, nome: 'Últimos 7 dias', antes: '7 dias anteriores' };
  if (id === '30d') return { ini: new Date(hoje.getTime() - 29 * DIA), fim: amanha, nome: 'Últimos 30 dias', antes: '30 dias anteriores' };
  if (id === 'mes') return { ini: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: amanha, nome: 'Este mês', antes: 'mesmo período do mês passado', mesAnterior: true };
  return { ini: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), fim: new Date(hoje.getFullYear(), hoje.getMonth(), 1), nome: 'Mês passado', antes: 'mês retrasado', mesInteiroAnterior: true };
}

function periodoAnterior(p) {
  if (p.mesAnterior) {
    const ini = new Date(p.ini.getFullYear(), p.ini.getMonth() - 1, 1);
    return { ini, fim: new Date(ini.getTime() + (p.fim - p.ini)) };
  }
  if (p.mesInteiroAnterior) return { ini: new Date(p.ini.getFullYear(), p.ini.getMonth() - 1, 1), fim: p.ini };
  const tam = p.fim - p.ini;
  return { ini: new Date(p.ini.getTime() - tam), fim: p.ini };
}

async function buscarPedidos(ini, fim) {
  const q = query(collection(db, 'lojas', AppState.lojaId, 'pedidos'),
    where('criadoEm', '>=', Timestamp.fromDate(ini)), where('criadoEm', '<', Timestamp.fromDate(fim)));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.status !== 'aguardando_pagamento'); // Pix que nunca foi pago não é venda
}

const dataDe = (p) => (p.criadoEm && p.criadoEm.toDate ? p.criadoEm.toDate() : null);

function calcular(pedidos, p) {
  const r = { total: 0, qtd: 0, frete: 0, cancelados: 0, porDia: new Map(), porHora: Array(24).fill(0), porSemana: Array(7).fill(0),
    produtos: new Map(), pagamentos: new Map(), entregas: 0, retiradas: 0, site: 0, balcao: 0, clientes: new Map() };
  // Dias do período (para o gráfico mostrar também os dias sem venda)
  for (let t = p.ini.getTime(); t < p.fim.getTime() && t <= Date.now(); t += DIA) r.porDia.set(inicioDoDia(new Date(t)).getTime(), { total: 0, qtd: 0 });
  for (const ped of pedidos) {
    if (ped.status === 'cancelado' || ped.status === 'ocorrencia') { r.cancelados++; continue; }
    const valor = Number(ped.totalCentavos) || 0;
    const d = dataDe(ped);
    r.qtd++; r.total += valor; r.frete += Number(ped.freteCentavos) || 0;
    if (d) {
      const dia = r.porDia.get(inicioDoDia(d).getTime());
      if (dia) { dia.total += valor; dia.qtd++; }
      r.porHora[d.getHours()]++;
      r.porSemana[d.getDay()] += valor;
    }
    (ped.itens || []).forEach(i => {
      const nome = String(i.nome || 'Item');
      const x = r.produtos.get(nome) || { qtd: 0, total: 0 };
      const q = Number(i.quantidade) || 1;
      x.qtd += q; x.total += (Number(i.unitarioCentavos) || 0) * q;
      r.produtos.set(nome, x);
    });
    const forma = PAGAMENTOS[ped.formaPagamento] || 'Outro';
    r.pagamentos.set(forma, (r.pagamentos.get(forma) || 0) + valor);
    if (ped.tipoEntrega === 'retirada') r.retiradas++; else r.entregas++;
    if (ped.canal === 'vitrine') r.site++; else r.balcao++;
    const tel = String(ped.clienteWhatsapp || '').replace(/\D/g, '');
    if (tel) {
      const c = r.clientes.get(tel) || { nome: ped.clienteNome || 'Cliente', qtd: 0, total: 0, tel };
      c.qtd++; c.total += valor; r.clientes.set(tel, c);
    }
  }
  r.ticket = r.qtd ? Math.round(r.total / r.qtd) : 0;
  return r;
}

// Variação contra o período anterior: "▲ 12%" / "▼ 5%" (com texto, não só cor)
function variacao(atual, antes) {
  if (!antes) return atual ? '<span class="rl-var sobe">▲ novo</span>' : '';
  const v = Math.round(((atual - antes) / antes) * 100);
  if (v === 0) return '<span class="rl-var">= igual</span>';
  return `<span class="rl-var ${v > 0 ? 'sobe' : 'desce'}">${v > 0 ? '▲' : '▼'} ${Math.abs(v)}%</span>`;
}

// Barras verticais simples (uma série, cor da loja). Cada barra mostra o valor ao tocar/passar o dedo.
function colunas(lista, rotulo, dica, destaque) {
  const max = Math.max(1, ...lista.map(x => x.v));
  return `<div class="rl-colunas" role="img">
    ${lista.map(x => `<div class="rl-col${destaque && x.v === max && x.v > 0 ? ' pico' : ''}" title="${esc(dica(x))}" tabindex="0">
      <div class="rl-col-barra" style="height:${Math.max(x.v ? 4 : 0, Math.round((x.v / max) * 100))}%"></div>
      <span>${esc(rotulo(x))}</span>
    </div>`).join('')}
  </div>`;
}

// Ranking com barra fina horizontal
function ranking(lista, valor, extra) {
  const max = Math.max(1, ...lista.map(valor));
  return lista.map((x, i) => `<div class="rl-rank">
    <div class="rl-rank-topo"><span>${i + 1}. ${esc(x.nome)}</span><strong>${extra(x)}</strong></div>
    <div class="rl-rank-trilho"><div style="width:${Math.round((valor(x) / max) * 100)}%"></div></div>
  </div>`).join('');
}

function baixarCsv(pedidos, nomeArquivo) {
  const linhas = [['data', 'hora', 'numero', 'cliente', 'whatsapp', 'tipo', 'canal', 'pagamento', 'status', 'itens', 'frete', 'total']];
  pedidos.forEach(p => {
    const d = dataDe(p);
    linhas.push([
      d ? d.toLocaleDateString('pt-BR') : '', d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      p.numeroPedido || '', p.clienteNome || '', p.clienteWhatsapp || '', p.tipoEntrega || '', p.canal || '',
      PAGAMENTOS[p.formaPagamento] || p.formaPagamento || '', p.status || '',
      (p.itens || []).map(i => `${i.quantidade || 1}x ${i.nome}`).join(' | '),
      ((Number(p.freteCentavos) || 0) / 100).toFixed(2).replace('.', ','),
      ((Number(p.totalCentavos) || 0) / 100).toFixed(2).replace('.', ',')
    ]);
  });
  const csv = '\uFEFF' + linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nomeArquivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function abrirRelatorios() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card gc-form rl-caixa" style="max-width:760px; width:100%; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <h3>📊 Relatórios</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div class="rl-periodos">
        ${[['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['mespassado', 'Mês passado']]
          .map(([id, n]) => `<button type="button" class="rl-chip${id === '7d' ? ' ativo' : ''}" data-periodo="${id}">${n}</button>`).join('')}
      </div>
      <div id="rl-corpo"><p class="gc-dica">Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  const corpo = overlay.querySelector('#rl-corpo');

  async function carregar(id) {
    overlay.querySelectorAll('[data-periodo]').forEach(b => b.classList.toggle('ativo', b.dataset.periodo === id));
    corpo.innerHTML = '<p class="gc-dica">Carregando...</p>';
    const p = periodo(id);
    const ant = periodoAnterior(p);
    let pedidos, anteriores;
    try {
      [pedidos, anteriores] = await Promise.all([buscarPedidos(p.ini, p.fim), buscarPedidos(ant.ini, ant.fim)]);
    } catch (err) {
      console.error(err);
      corpo.innerHTML = '<p class="gc-dica">Não foi possível carregar os pedidos agora. Confira a internet e tente de novo.</p>';
      return;
    }
    const r = calcular(pedidos, p);
    const a = calcular(anteriores, { ini: ant.ini, fim: ant.ini });
    if (!pedidos.length) {
      corpo.innerHTML = `<p class="gc-dica" style="margin-top:12px;">Nenhum pedido em <strong>${esc(p.nome.toLowerCase())}</strong>. Escolha outro período acima.</p>`;
      return;
    }
    const clientes = [...r.clientes.values()];
    const voltaram = clientes.filter(c => c.qtd >= 2).length;
    const dias = [...r.porDia.entries()].map(([t, x]) => ({ t, v: x.total, qtd: x.qtd }));
    const umDia = dias.length <= 1;
    const horas = r.porHora.map((v, h) => ({ h, v })).filter(x => x.h >= 6 || x.v);
    const pico = r.porHora.indexOf(Math.max(...r.porHora));
    const melhorDiaSemana = r.porSemana.indexOf(Math.max(...r.porSemana));
    const produtos = [...r.produtos.entries()].map(([nome, x]) => ({ nome, ...x })).sort((x, y) => y.qtd - x.qtd).slice(0, 10);
    const pagamentos = [...r.pagamentos.entries()].map(([nome, v]) => ({ nome, v })).sort((x, y) => y.v - x.v);
    const melhores = clientes.sort((x, y) => y.total - x.total).slice(0, 5);
    const pct = (n) => (r.qtd ? Math.round((n / r.qtd) * 100) : 0);

    corpo.innerHTML = `
      <p class="gc-dica" style="margin:6px 0 10px;">${esc(p.nome)} · comparado com ${esc(p.antes)}</p>
      <div class="rl-tiles">
        <div class="rl-tile principal"><span>Faturamento</span><strong>${formatarCentavos(r.total)}</strong>${variacao(r.total, a.total)}</div>
        <div class="rl-tile"><span>Pedidos</span><strong>${r.qtd}</strong>${variacao(r.qtd, a.qtd)}</div>
        <div class="rl-tile"><span>Ticket médio</span><strong>${formatarCentavos(r.ticket)}</strong>${variacao(r.ticket, a.ticket)}</div>
        <div class="rl-tile"><span>Cancelados</span><strong>${r.cancelados}</strong><span class="rl-var">${r.qtd + r.cancelados ? Math.round((r.cancelados / (r.qtd + r.cancelados)) * 100) : 0}% dos pedidos</span></div>
      </div>

      ${umDia ? '' : `<h4 class="gc-subtitulo">💰 Vendas por dia</h4>
      ${colunas(dias, x => { const d = new Date(x.t); if (dias.length <= 10) return `${SEMANA[d.getDay()]} ${d.getDate()}`; return d.getDate() === 1 || (d.getDate() % 5 === 0 && d.getDate() < 30) ? String(d.getDate()) : ''; },
        x => `${new Date(x.t).toLocaleDateString('pt-BR')}: ${formatarCentavos(x.v)} em ${x.qtd} pedido(s)`, true)}`}

      <h4 class="gc-subtitulo">🕒 Horário dos pedidos</h4>
      <p class="gc-dica">Horário de pico: <strong>${pico}h às ${pico + 1}h</strong>. Deixe a equipe completa nesse horário.</p>
      ${colunas(horas, x => (x.h % 3 === 0 ? `${x.h}h` : ''), x => `${x.h}h às ${x.h + 1}h: ${x.v} pedido(s)`, true)}

      ${dias.length >= 7 ? `<p class="gc-dica">Dia da semana que mais vende: <strong>${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][melhorDiaSemana]}</strong>.</p>` : ''}

      <h4 class="gc-subtitulo">🏆 Mais vendidos</h4>
      ${ranking(produtos, x => x.qtd, x => `${x.qtd} un. · ${formatarCentavos(x.total)}`)}
      ${produtos.length > 3 ? `<p class="gc-dica">Dica: coloque o "${esc(produtos[produtos.length - 1].nome)}" em 🔥 Oferta do dia para girar mais.</p>` : ''}

      <div class="rl-duas">
        <div>
          <h4 class="gc-subtitulo">💳 Formas de pagamento</h4>
          ${ranking(pagamentos, x => x.v, x => formatarCentavos(x.v))}
        </div>
        <div>
          <h4 class="gc-subtitulo">🛵 Como pediram</h4>
          <div class="tr-linha"><span>Entrega</span><strong>${r.entregas} (${pct(r.entregas)}%)</strong></div>
          <div class="tr-linha"><span>Retirada</span><strong>${r.retiradas} (${pct(r.retiradas)}%)</strong></div>
          <div class="tr-linha"><span>Pelo link (site)</span><strong>${r.site} (${pct(r.site)}%)</strong></div>
          <div class="tr-linha"><span>Balcão / telefone</span><strong>${r.balcao} (${pct(r.balcao)}%)</strong></div>
          <div class="tr-linha"><span>Taxas de entrega</span><strong>${formatarCentavos(r.frete)}</strong></div>
        </div>
      </div>

      <h4 class="gc-subtitulo">👥 Clientes</h4>
      <div class="rl-tiles">
        <div class="rl-tile"><span>Clientes diferentes</span><strong>${clientes.length}</strong></div>
        <div class="rl-tile"><span>Pediram 2 vezes ou mais</span><strong>${voltaram}</strong><span class="rl-var">${clientes.length ? Math.round((voltaram / clientes.length) * 100) : 0}% voltaram</span></div>
      </div>
      ${melhores.length ? `<p class="gc-dica" style="margin-top:8px;">Melhores clientes do período (mande um agradecimento!):</p>
      ${melhores.map(c => `<div class="tr-linha"><span>${esc(c.nome)} · ${c.qtd} pedido(s)</span><span style="display:flex; gap:8px; align-items:center;"><strong>${formatarCentavos(c.total)}</strong><a class="btn-outline-sm btn-whats" style="padding:2px 8px;" href="https://wa.me/${c.tel.startsWith('55') ? c.tel : '55' + c.tel}?text=${encodeURIComponent(`Olá, ${String(c.nome).split(/\s+/)[0]}! Obrigado por pedir na ${AppState.lojaDados.nome || 'nossa loja'} 😊`)}" target="_blank" rel="noopener">💬</a></span></div>`).join('')}` : ''}

      <button class="btn-outline-sm" type="button" id="rl-csv" style="margin-top:14px;">⬇ Baixar planilha dos pedidos (Excel)</button>`;
    corpo.querySelector('#rl-csv').onclick = () => {
      baixarCsv(pedidos, `pedidos-${AppState.lojaDados.slug || 'loja'}-${p.ini.toISOString().slice(0, 10)}.csv`);
      showToast('Planilha baixada! Abra no Excel ou Google Planilhas.');
    };
  }

  overlay.querySelectorAll('[data-periodo]').forEach(b => { b.onclick = () => carregar(b.dataset.periodo); });
  carregar('7d');
}
