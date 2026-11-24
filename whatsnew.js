// ============================================================
// WHATSNEW.JS - TOUR DE NOVIDADES + EXPLICAÇÃO DOS INDICADORES
// Para anunciar uma atualização: adicione um item NO TOPO de APP_RELEASES
// (versão maior que a anterior). O tour aparece uma vez para cada revendedor.
// ============================================================
const APP_RELEASES = [
  {
    version: '2026.11.22.5',
    title: 'Cobrança com IA e ajuda com a tela no portal',
    steps: [
      { icon: '💬', title: 'Cobrar agora com IA', text: 'Em Cobrar agora, a IA escreve a abertura da mensagem (saudação e uma frase). Valor, Pix, link do portal e desconto continuam vindo do app, e você revisa antes de enviar.' },
      { icon: '📸', title: 'Ajuda com a tela no portal', text: 'O assinante tira uma foto do erro na TV e a ajuda explica o problema e o que fazer, passo a passo. São até 3 fotos por dia, e a foto não é guardada.' },
      { icon: '🏠', title: 'Tela inicial mais limpa', text: 'Saiu o bloco de crédito em estoque da tela inicial. O estoque continua na aba Servidores.' }
    ]
  },
  {
    version: '2026.11.22.4',
    title: 'IA nos cartões e na tela inicial',
    steps: [
      { icon: '✨', title: 'Mensagem com IA por cliente', text: 'Cada cartão tem o botão ✨ IA. Escolha o objetivo (lembrar do vencimento, cobrar atraso, acompanhar suporte, plano longo ou indicação), gere a mensagem e revise antes de enviar pelo WhatsApp. O nome entra só no seu aparelho.' },
      { icon: '🧠', title: 'Prioridades na tela inicial', text: 'A Carteira mostra as três prioridades da última análise da IA. Se ainda não houve análise, o bloco convida você a analisar.' },
      { icon: '⏱️', title: 'Mais uso por hora', text: 'O limite de chamadas à IA por hora subiu para 60 no total, para caber análise, ajuda de atendimento e mensagens.' }
    ]
  },
  {
    version: '2026.11.22.3',
    title: 'Cadastro por texto, reativação e simulador de crédito',
    steps: [
      { icon: '🪄', title: 'Cadastro escrevendo', text: 'Na caixa de preenchimento rápido você pode escrever a frase do cliente, por exemplo: João, usuário joao1, senha 123, vence dia 15, R$ 35. O app preenche os campos. Tudo fica no seu aparelho.' },
      { icon: '↩️', title: 'Reativação de quem saiu', text: 'A aba de análise lista os clientes que saíram, com a mensagem de volta para cada motivo. Você confere e envia pelo WhatsApp.' },
      { icon: '💳', title: 'Simulador de compra', text: 'Em cada servidor você digita quantos créditos quer comprar e vê quantos dias cobre e o custo. Não entra desconto, porque ele não está no app.' },
      { icon: '💬', title: 'Cobrança pelo perfil', text: 'A mensagem de cobrança muda o tom conforme o histórico do cliente: mais atenciosa para quem paga em dia e mais firme para quem atrasa com frequência.' }
    ]
  },
  {
    version: '2026.11.22.2',
    title: 'IA mais completa e ajuda no atendimento',
    steps: [
      { icon: '🔇', title: 'Risco silencioso e planos longos', text: 'A IA aponta clientes que estão em dia mas mostram sinais de cancelamento, e quem tem bom histórico para oferecer plano de 3 ou 6 meses.' },
      { icon: '📊', title: 'Padrões da carteira', text: 'Novos cards mostram safra de entrada, dia da semana dos atrasos, aplicativos com mais suporte, motivos de cancelamento e quanto comprar de crédito por servidor.' },
      { icon: '🧭', title: 'Ajuda ao abrir suporte', text: 'Ao abrir um atendimento você pode pedir passos sugeridos pela IA. Ela recebe só o aplicativo, o servidor e o problema, nunca o nome do cliente.' },
      { icon: '🚪', title: 'Motivo ao excluir cliente', text: 'Ao excluir um cliente, você pode anotar o motivo (opcional). Isso ajuda a IA a encontrar o que faz os clientes saírem.' }
    ]
  },
  {
    version: '2026.11.22.1',
    title: 'Suporte com abrir/fechar e menos estoque pra alimentar',
    steps: [
      { icon: '🤝', title: 'Suporte: abrir e fechar', text: 'O botão Suporte agora abre o atendimento; só fecha (e avisa o cliente) quando você confirma que terminou. Suporte aberto aparece em destaque no topo do app até ser fechado.' },
      { icon: '📦', title: 'Estoque de crédito opcional', text: 'Na aba Servidores tem um botão para parar de controlar o estoque em todos os servidores de uma vez. O app continua mostrando quantos clientes vencem em breve, só não cobra mais você por alimentar número.' },
      { icon: '🤖', title: 'IA agora cobre suporte', text: 'A análise com IA passou a olhar atendimentos abertos, tempo de resolução e padrões de suporte, além de mostrar o nome e o usuário do cliente ao lado de cada recomendação.' }
    ]
  },
  {
    version: '2026.11.22',
    title: 'Correções e segurança',
    steps: [
      { icon: '📦', title: 'Estoque sincronizado', text: 'Com o app aberto no celular e no computador, o estoque de créditos e as edições de servidor não se apagam mais um ao outro.' },
      { icon: '🎁', title: 'Mês grátis com Desfazer', text: 'O resgate do mês grátis agora desconta 1 crédito do estoque, mantém o dia de cobrança e pode ser desfeito logo depois.' },
      { icon: '🔐', title: 'Portal mais seguro', text: 'O link M3U só aparece no portal quando usuário e senha estão liberados, porque ele leva os dois dentro.' }
    ]
  },
  {
    version: '2026.11.19',
    title: 'Clientes em teste',
    steps: [
      { icon: '🧪', title: 'Aba Testes', text: 'No cadastro, marque "Cliente em teste" e escolha 1, 2, 4 ou 24 horas. Ele fica na aba Testes, separado da carteira, com o horário em que o teste termina.' },
      { icon: '✅', title: 'Efetivar = 1ª renovação', text: 'Quando o cliente decidir ficar, toque em Efetivar e faça a renovação. Só aí ele entra na carteira, no financeiro e conta como indicação de quem o indicou.' },
      { icon: '🎁', title: 'Boas-vindas na hora certa', text: 'O desconto de boas-vindas do indicado entra na 1ª mensalidade, no momento de efetivar. Teste que não renovou é só excluir.' }
    ]
  },
  {
    version: '2026.11.07',
    title: 'Atalhos no card',
    steps: [
      { icon: '🔄', title: 'Trocar servidor num toque', text: 'Quando você tem mais de um servidor, o card do cliente ganha o botão Trocar servidor. O histórico de pagamentos antigo continua no servidor de antes.' },
      { icon: '📋', title: 'Copiar MAC', text: 'O MAC do cliente agora tem um botão para copiar direto no card.' },
      { icon: '📣', title: 'Cobrança em sequência', text: 'O botão de cobrança rápida mostra um cliente por vez com um botão grande. Toque em Cobrar, envie no WhatsApp e, ao voltar, o próximo já está pronto.' }
    ]
  },
  {
    version: '2026.11.06',
    title: 'Mais segurança e controle',
    steps: [
      { icon: '↩️', title: 'Desfazer renovação e exclusão', text: 'Renovou sem querer? Toque em Desfazer logo depois, ou em "Desfazer última renovação" no card. Cliente excluído também pode voltar, e o histórico de pagamentos dele continua no financeiro.' },
      { icon: '💳', title: 'Valor recebido e "a receber"', text: 'Na renovação você pode ajustar o valor e marcar se o cliente já pagou. Quem ficou devendo aparece no card com o botão Marcar pago, e só entra no Recebido depois disso.' },
      { icon: '📣', title: 'Fila de cobrança nova', text: 'A fila agora é uma lista: toque em Cobrar em cada cliente. A cobrança leva a chave Pix, o Pix copia e cola com o valor (chave e-mail, CNPJ ou aleatória) e o link do portal.' },
      { icon: '🔐', title: 'PIN no portal', text: 'Em Ajustes você pode pedir os 4 últimos dígitos do telefone para abrir o portal, protegendo usuário e senha se o link for encaminhado.' }
    ]
  },
  {
    version: '2026.11.05',
    title: 'Indicações e modo escuro',
    steps: [
      { icon: '🎁', title: 'Avise quem indicou', text: 'Ao cadastrar um cliente indicado por outro, o app oferece uma mensagem pronta para o indicador: seu amigo assinou e faltam X para o mês grátis. É só tocar em Enviar.' },
      { icon: '🌙', title: 'Modo escuro melhorado', text: 'Ajustamos cores, campos e botões do modo escuro para ficarem mais fáceis de ler.' }
    ]
  },
  {
    version: '2026.11.04',
    title: 'Calendário de recebimentos',
    steps: [
      { icon: '📅', title: 'Quanto entra por dia', text: 'No Financeiro há um calendário que mostra quanto vence em cada dia. Quando o dia chega, uma bolinha avisa: verde, recebeu todos; amarela, falta alguém; vermelha, não recebeu. Toque em um dia para ver quem é e cobrar direto. Navegue pelos meses com as setas.', goto: 'finance', gotoLabel: 'Ver calendário' }
    ]
  },
  {
    version: '2026.11.03',
    title: 'Mais uma novidade',
    steps: [
      { icon: '📈', title: 'Simulador de crescimento', text: 'No botão ⚡ toque em "Simular Crescimento". Informe quantos clientes novos quer por mês, o cancelamento e o custo do crédito, e veja o lucro mês a mês. Também mostra quantos clientes você precisa para chegar na sua meta de lucro.' }
    ]
  },
  {
    version: '2026.11.02',
    title: 'Mais novidades',
    steps: [
      { icon: '🔎', title: 'Busca rápida de cliente', text: 'No botão ⚡ agora tem "Buscar Cliente". Digite nome, usuário, telefone ou MAC e cobre, renove, ative ou abra o portal na hora, sem rolar a carteira. Sem digitar nada, ele mostra quem você precisa cobrar agora.' },
      { icon: 'ℹ️', title: 'Toque nos indicadores', text: 'No Financeiro, toque em qualquer card para ver o que aquele número significa.', goto: 'finance', gotoLabel: 'Ver financeiro' }
    ]
  },
  {
    version: '2026.11.01',
    title: 'Novidades desta atualização',
    steps: [
      { icon: '🔗', title: 'Portal do Assinante', text: 'Cada cliente pode ter uma página só dele, com vencimento, usuário, senha, DNS, lista M3U e Pix. Abra um cliente e toque em 🔗 Portal para gerar o link. Ele também vai junto na mensagem de renovação.', goto: 'clients', gotoLabel: 'Abrir carteira' },
      { icon: '👁', title: 'Saiba quem acessa', text: 'No card do cliente aparece se ele já abriu o portal e quando foi o último acesso. Em Ajustes você vê quantos clientes já acessaram.' },
      { icon: '🌐', title: 'Servidores e valor do crédito', text: 'Cadastre vários DNS (IP e URL) por servidor, cole o texto do servidor para preencher sozinho e informe o valor do crédito. Cada DNS gera o seu link M3U.', goto: 'servers', gotoLabel: 'Ver servidores' },
      { icon: '📲', title: 'Ativar o cliente no app', text: 'O botão 📲 Ativar do card junta MAC, site do aplicativo e link M3U em uma tela só, com um toque para copiar cada um.' },
      { icon: '📊', title: 'Financeiro por mês', text: 'Os indicadores agora recomeçam a cada mês. Escolha o período no topo e compare os servidores. Toque em ℹ️ para ver o que cada número significa.', goto: 'finance', gotoLabel: 'Ver financeiro' },
      { icon: '⚡', title: 'Ações do Dia', text: 'A lista mostra quem vence em até 2 dias, quem vence hoje e quem está atrasado há até 7 dias, para você cobrar na hora certa.' },
      { icon: '🔒', title: 'Bloquear cliente', text: 'No cadastro do cliente há uma chave para bloquear e desbloquear o acesso. Um aviso discreto ⚠️ aparece no card, e o portal esconde os dados dele.' }
    ]
  }
];

const FINANCE_HELP = [
  { key: 'mrr', icon: '💰', title: 'Faturamento (MRR)', text: 'Soma das mensalidades dos clientes ativos (não arquivados). É a previsão do que entra por mês e só muda quando você adiciona, arquiva ou altera o preço de um cliente.' },
  { key: 'profit', icon: '💵', title: 'Lucro do mês', text: 'Recebido no período menos o custo dos créditos usados nas renovações desse período. O custo de cada renovação é o número de meses vezes o valor do crédito do servidor (ou o custo padrão, se o servidor não tiver valor).' },
  { key: 'next7', icon: '⏱️', title: 'Próx. 7 dias', text: 'Soma das mensalidades que vencem de hoje até daqui a 7 dias. Toque no card para ver esses clientes.' },
  { key: 'late', icon: '⚠️', title: 'Em atraso', text: 'Soma das mensalidades dos clientes ativos que já passaram do vencimento. Toque no card para ver quem são.' },
  { key: 'received', icon: '💎', title: 'Recebido no mês', text: 'Total das renovações registradas no período escolhido, já com os descontos aplicados. Só entra aqui o que foi renovado pelo botão Renovar.' },
  { key: 'default', icon: '📉', title: 'Inadimplência', text: 'Porcentagem de clientes ativos que estão em atraso hoje.' },
  { key: 'period', icon: '📅', title: 'Período', text: 'O seletor no topo define o mês dos indicadores de Lucro e Recebido e da tabela por servidor. O padrão é o mês atual e muda sozinho a cada mês. "Todo o período" soma tudo desde o início.' },
  { key: 'servers', icon: '🖥️', title: 'Financeiro por servidor', text: 'Compara cada servidor no período: recebido, renovações, descontos, custo e lucro. Nomes iguais (Alpha e ALPHA) contam como o mesmo servidor. Ativos, MRR e Atraso mostram a situação de hoje.' },
  { key: 'cost', icon: '⚙️', title: 'Custo por crédito', text: 'Defina o valor do crédito de cada servidor na aba Servidores. O custo padrão, no fim desta aba, só é usado quando o servidor está sem valor.' }
];

(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const vnum = (v) => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const vcmp = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const keyFor = () => 'app_seen_version_' + ((window.currentUser && window.currentUser.uid) || 'anon');
  const readSeen = () => { try { return localStorage.getItem(keyFor()) || ''; } catch (e) { return ''; } };
  const writeSeen = (v) => { try { localStorage.setItem(keyFor(), v); } catch (e) {} };
  const latest = () => APP_RELEASES.reduce((a, r) => (!a || vcmp(r.version, a.version) > 0) ? r : a, null);

  let overlay = null;
  function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') { markSeen(); closeOverlay(); } }
  let pendingVersion = '';
  function markSeen() { if (pendingVersion) { writeSeen(pendingVersion); pendingVersion = ''; } }

  function frame(inner) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.zIndex = '10050';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="modal-card" style="max-width:400px; max-height:92vh; display:flex; flex-direction:column; text-align:left;">${inner}</div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    return overlay.firstElementChild;
  }

  // ---------- Tour passo a passo ----------
  function runTour(title, steps, version) {
    if (!steps.length) return;
    pendingVersion = version || '';
    let i = 0;
    const draw = () => {
      const s = steps[i];
      const last = i === steps.length - 1;
      const card = frame(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:0.7rem; font-weight:700; color:var(--text-muted);">✨ ${esc(title)}</span>
          <button type="button" id="tourSkip" class="btn-cancel" style="padding:3px 9px; font-size:0.7rem;">Pular</button>
        </div>
        <div style="text-align:center; font-size:2.4rem; margin:8px 0 4px;">${esc(s.icon || '✨')}</div>
        <h3 style="margin:0 0 6px; font-size:1.05rem; text-align:center;">${esc(s.title)}</h3>
        <p style="font-size:0.84rem; line-height:1.5; color:var(--text-main); margin:0 0 12px; overflow-y:auto;">${esc(s.text)}</p>
        ${s.goto ? `<button type="button" id="tourGoto" class="btn-tool" style="width:100%; background:#0f766e; padding:9px; margin-bottom:8px;">${esc(s.gotoLabel || 'Ver agora')}</button>` : ''}
        <div style="display:flex; justify-content:center; gap:5px; margin-bottom:10px;">
          ${steps.map((_, n) => `<span style="width:${n === i ? 18 : 7}px; height:7px; border-radius:99px; background:${n === i ? '#2563eb' : '#cbd5e1'}; transition:width .2s;"></span>`).join('')}
        </div>
        <div style="display:flex; gap:6px;">
          ${i > 0 ? '<button type="button" id="tourPrev" class="btn-cancel" style="flex:1; padding:9px;">Voltar</button>' : ''}
          <button type="button" id="tourNext" class="btn-auth" style="flex:2; padding:9px;">${last ? 'Concluir' : 'Próximo'}</button>
        </div>`);
      card.querySelector('#tourSkip').onclick = () => { markSeen(); closeOverlay(); };
      const prev = card.querySelector('#tourPrev'); if (prev) prev.onclick = () => { i--; draw(); };
      card.querySelector('#tourNext').onclick = () => { if (last) { markSeen(); closeOverlay(); } else { i++; draw(); } };
      const go = card.querySelector('#tourGoto');
      if (go) go.onclick = () => { markSeen(); closeOverlay(); if (typeof switchAppTab === 'function') switchAppTab(s.goto); };
      card.querySelector('#tourNext').focus();
    };
    draw();
  }

  // Abre sozinho quando há novidade que este revendedor ainda não viu
  window.maybeShowWhatsNew = function () {
    const rel = latest(); if (!rel) return;
    const seen = readSeen();
    if (seen && vcmp(seen, rel.version) >= 0) return;
    const newest = (list) => list.sort((a, b) => vcmp(b.version, a.version));
    const fresh = newest(seen ? APP_RELEASES.filter(r => vcmp(r.version, seen) > 0) : APP_RELEASES.slice());
    const steps = fresh.flatMap(r => r.steps).slice(0, 8);
    setTimeout(() => runTour(rel.title, steps, rel.version), 900);
  };

  // Botão "✨ Ver novidades" em Ajustes
  window.openWhatsNew = function () {
    const rel = latest(); if (!rel) return;
    const recent = APP_RELEASES.slice().sort((a, b) => vcmp(b.version, a.version)).slice(0, 2);
    runTour('Novidades', recent.flatMap(r => r.steps).slice(0, 8), rel.version);
  };

  // ---------- Explicação de UM indicador (toque no card) ----------
  window.openIndicatorHelp = function (key) {
    const h = FINANCE_HELP.find(x => x.key === key);
    if (!h) return window.openFinanceHelp();
    const card = frame(`
      <div style="text-align:center; font-size:2.2rem; margin:4px 0;">${esc(h.icon)}</div>
      <h3 style="margin:0 0 6px; font-size:1.05rem; text-align:center;">${esc(h.title)}</h3>
      <p style="font-size:0.86rem; line-height:1.5; margin:0 0 14px;">${esc(h.text)}</p>
      <div style="display:flex; gap:6px;">
        <button type="button" id="helpAll" class="btn-cancel" style="flex:1; padding:9px;">Ver todos</button>
        <button type="button" id="helpClose" class="btn-auth" style="flex:1; padding:9px;">Entendi</button>
      </div>`);
    card.querySelector('#helpClose').onclick = closeOverlay;
    card.querySelector('#helpAll').onclick = () => window.openFinanceHelp();
  };

  // ---------- Lista de explicações (ℹ️ do Financeiro) ----------
  window.openFinanceHelp = function () {
    const card = frame(`
      <h3 style="margin:0 0 4px; font-size:1.05rem;">📊 O que cada indicador significa</h3>
      <p style="font-size:0.74rem; color:var(--text-muted); margin:0 0 8px;">Valores respeitam o servidor e o período escolhidos.</p>
      <div style="overflow-y:auto; margin-bottom:10px; padding-right:2px;">
        ${FINANCE_HELP.map(h => `<div style="padding:8px 0; border-top:1px solid var(--border);"><div style="font-size:0.84rem; font-weight:800;">${esc(h.icon)} ${esc(h.title)}</div><div style="font-size:0.78rem; color:var(--text-muted); line-height:1.45; margin-top:2px;">${esc(h.text)}</div></div>`).join('')}
      </div>
      <button type="button" id="helpClose" class="btn-auth" style="padding:9px;">Entendi</button>`);
    card.querySelector('#helpClose').onclick = closeOverlay;
  };
})();