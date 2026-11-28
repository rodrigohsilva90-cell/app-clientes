// Site de vendas do Delivery Pro (página inicial, sem loja na URL).
// Preços e WhatsApp vêm da configuração do Master (/api/saas).
import { esc, formatarCentavos } from './config.js';

const RECURSOS = [
  ['🛍️', 'Cardápio com a sua marca', 'Link próprio e QR Code para Instagram, WhatsApp e mesa. Fotos, tamanhos, adicionais e ofertas do dia.'],
  ['💠', 'Pix automático', 'O cliente paga pelo Pix e o pedido só chega na loja depois de confirmado. Sem conferir comprovante.'],
  ['📍', 'Frete por distância', 'Valor fixo, por km ou por faixas, frete grátis acima de um valor e áreas sem entrega desenhadas no mapa.'],
  ['🧾', 'Balcão e cozinha', 'Painel com alerta sonoro, tela da cozinha sem valores, impressão de comanda e pedido por telefone.'],
  ['🛵', 'App do motoboy', 'Ele escolhe as entregas, o app monta a melhor rota e o cliente acompanha a moto ao vivo no mapa.'],
  ['💰', 'Caixa e acerto', 'Abertura e fechamento de caixa, sangria, despesas e acerto do motoboy no fim do dia, tudo somado.'],
  ['📦', 'Estoque e varejo', 'Estoque por tamanho e cor, várias fotos e lupa. Serve para roupas, calçados, adega e mercadinho.'],
  ['⭐', 'Clientes e fidelidade', 'Ficha de cada cliente, cartão fidelidade automático e avaliação em 1 toque depois da entrega.']
];

const PASSOS = [
  ['1', 'Crie sua loja', 'Nome, WhatsApp e o que você vende. Leva 2 minutos e não pede cartão.'],
  ['2', 'Monte o cardápio', 'Comece por um modelo pronto do seu ramo ou importe uma planilha. Ajuste preços e fotos.'],
  ['3', 'Divulgue e receba', 'Mande o link para os clientes. Os pedidos chegam no painel com som, já calculados.']
];

const RAMOS = ['🍕 Pizzarias', '🍔 Lanchonetes', '🍱 Restaurantes', '🍰 Docerias', '🍺 Adegas', '💊 Farmácias', '🛒 Mercadinhos', '👕 Roupas', '👟 Calçados'];

const FAQ = [
  ['Preciso de computador?', 'Não. Tudo funciona no celular: o painel da loja, a cozinha, o app do motoboy e o cardápio do cliente. Pode instalar como aplicativo direto pelo navegador.'],
  ['Vocês cobram comissão por pedido?', 'Não. Você paga só a mensalidade do plano. Pode vender 10 ou 10 mil pedidos no mês: o valor é o mesmo.'],
  ['O dinheiro do Pix cai para quem?', 'Direto na conta da sua loja, pelo seu Mercado Pago. O Delivery Pro não passa a mão no seu dinheiro.'],
  ['Meus motoboys precisam baixar algo?', 'Não. Eles entram pelo link que o app gera no cadastro da equipe, com e-mail e senha.'],
  ['Posso usar com motoboy de aplicativo ou avulso?', 'Pode. Dá para entregar com a sua equipe pelo app, ou mandar o resumo e o mapa para um motoboy avulso pelo WhatsApp.'],
  ['E se eu não gostar?', 'Você testa grátis por 7 dias, sem cartão. Se não fizer sentido, é só não assinar.']
];

export async function renderizarSite(root, { abrirCadastro, abrirLogin }) {
  document.body.classList.add('pagina-site');
  root.innerHTML = `
    <div class="st">
      <header class="st-topo">
        <span class="st-marca">🛵 Delivery Pro</span>
        <nav class="st-nav">
          <a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a>
          <button class="st-btn-link" type="button" data-entrar>Entrar</button>
        </nav>
      </header>

      <section class="st-hero">
        <div class="st-hero-texto">
          <span class="st-selo">Sem comissão por pedido</span>
          <h1>Seu delivery próprio, com a sua marca e o motoboy no mapa ao vivo</h1>
          <p>Cardápio online, Pix automático, cozinha, caixa e app do motoboy com rota inteligente. Tudo no celular, por uma mensalidade fixa.</p>
          <div class="st-acoes" id="st-acoes">
            <button class="st-btn" type="button" data-cadastro>🚀 Testar grátis por 7 dias</button>
            <button class="st-btn st-btn-sec" type="button" data-entrar>Já tenho conta — Entrar</button>
          </div>
          <ul class="st-garantias"><li>✔ Sem cartão de crédito</li><li>✔ Pronto em minutos</li><li>✔ Funciona no celular</li></ul>
        </div>
        <div class="st-celular" aria-hidden="true">
          <div class="st-tela">
            <div class="st-tela-topo">Pedido #128 · Ana</div>
            <div class="st-mapa">
              <span class="st-rua st-rua1"></span><span class="st-rua st-rua2"></span><span class="st-rua st-rua3"></span>
              <span class="st-rota"></span>
              <span class="st-pino-loja">🏪</span><span class="st-pino-moto">🛵</span><span class="st-pino-casa">🏠</span>
            </div>
            <div class="st-tela-status"><strong>🛵 Saiu para entrega</strong><span>Chega em ~12 min</span></div>
            <div class="st-tela-linha">✅ Pago no Pix · R$ 64,90</div>
          </div>
        </div>
      </section>

      <section class="st-sec st-compara">
        <h2>Pare de dividir o seu lucro</h2>
        <p class="st-sub">Nos aplicativos de marketplace, uma parte de cada pedido vai embora em comissão. No seu delivery próprio, ela fica com você.</p>
        <div class="st-tabela">
          <div class="st-linha st-cab"><span></span><span>Marketplace</span><span>Delivery Pro</span></div>
          <div class="st-linha"><span>Comissão por pedido</span><span class="nao">Sim, a cada venda</span><span class="sim">Zero</span></div>
          <div class="st-linha"><span>O cliente é seu</span><span class="nao">Não</span><span class="sim">Sim, com ficha e fidelidade</span></div>
          <div class="st-linha"><span>Sua marca e seu link</span><span class="nao">No meio dos concorrentes</span><span class="sim">Só a sua loja</span></div>
          <div class="st-linha"><span>Dinheiro do Pix</span><span class="nao">Repassado depois</span><span class="sim">Na sua conta na hora</span></div>
        </div>

        <div class="st-calc">
          <h3>💸 Quanto você deixaria de pagar?</h3>
          <div class="st-calc-campos">
            <label>Pedidos por mês<input type="number" min="0" inputmode="numeric" id="st-c-pedidos" value="600"></label>
            <label>Valor médio do pedido (R$)<input type="number" min="0" inputmode="decimal" id="st-c-ticket" value="55"></label>
            <label>Comissão que você paga hoje (%)<input type="number" min="0" max="50" inputmode="decimal" id="st-c-taxa" value="20"></label>
          </div>
          <p class="st-calc-res" id="st-c-res"></p>
          <p class="st-nota">Conta simples: pedidos × valor médio × comissão. Ajuste com os números da sua loja.</p>
        </div>
      </section>

      <section class="st-sec" id="recursos">
        <h2>Tudo o que a sua loja precisa, num app só</h2>
        <div class="st-grade">
          ${RECURSOS.map(([i, t, d]) => `<div class="st-card"><span class="st-icone">${i}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>

      <section class="st-sec st-motoboy">
        <div>
          <h2>O motoboy que sabe o melhor caminho</h2>
          <ul class="st-lista">
            <li>📤 O balcão libera o pedido e todos os motoboys são avisados.</li>
            <li>🧭 O app sugere o que combina com a rota de cada um.</li>
            <li>🗺️ Antes de sair, ele vê no mapa todas as entregas na melhor ordem.</li>
            <li>🛵 O cliente só recebe "saiu para entrega" quando ele inicia a rota.</li>
            <li>💰 No fim do dia, o acerto já sai calculado e entra no caixa.</li>
          </ul>
        </div>
        <div class="st-rota-demo" aria-hidden="true">
          <div class="st-rd-item"><span>1</span>#101 · Centro <small>1,2 km</small></div>
          <div class="st-rd-item"><span>2</span>#103 · Vila Nova <small>+0,8 km</small></div>
          <div class="st-rd-item"><span>3</span>#102 · Jardim <small>+1,5 km</small></div>
          <div class="st-rd-botao">Deslize para iniciar rota →</div>
        </div>
      </section>

      <section class="st-sec">
        <h2>Comece hoje, em 3 passos</h2>
        <div class="st-passos">
          ${PASSOS.map(([n, t, d]) => `<div class="st-passo"><span>${n}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
        <div class="st-ramos">${RAMOS.map(r => `<span>${r}</span>`).join('')}</div>
      </section>

      <section class="st-sec" id="planos">
        <h2>Planos sem surpresa</h2>
        <p class="st-sub">Mensalidade fixa, sem comissão e sem fidelidade. Teste 7 dias grátis antes de decidir.</p>
        <div class="st-planos" id="st-planos"><p class="st-sub">Carregando os planos...</p></div>
      </section>

      <section class="st-sec" id="duvidas">
        <h2>Perguntas frequentes</h2>
        <div class="st-faq">
          ${FAQ.map(([q, r]) => `<details><summary>${q}</summary><p>${r}</p></details>`).join('')}
        </div>
      </section>

      <section class="st-final">
        <h2>Seu delivery, suas regras, seu lucro.</h2>
        <p>Crie sua loja agora e receba o primeiro pedido ainda hoje.</p>
        <button class="st-btn" type="button" data-cadastro>🚀 Testar grátis por 7 dias</button>
        <div id="st-whats"></div>
      </section>

      <footer class="st-rodape">
        <span>🛵 Delivery Pro</span>
        <a href="/termos">Termos de uso</a><a href="/privacidade">Privacidade</a>
      </footer>
    </div>`;

  root.querySelectorAll('[data-cadastro]').forEach(b => { b.onclick = abrirCadastro; });
  root.querySelectorAll('[data-entrar]').forEach(b => { b.onclick = abrirLogin; });

  // Calculadora de economia
  const $ = (id) => root.querySelector('#' + id);
  const calcular = () => {
    const n = Math.max(0, Number($('st-c-pedidos').value) || 0);
    const t = Math.max(0, Number(String($('st-c-ticket').value).replace(',', '.')) || 0);
    const c = Math.min(50, Math.max(0, Number(String($('st-c-taxa').value).replace(',', '.')) || 0));
    const mes = Math.round(n * t * c);  // em centavos: n × R$ × % = n × t × c centavos
    $('st-c-res').innerHTML = mes
      ? `Por mês: <strong>${formatarCentavos(mes)}</strong> · por ano: <strong>${formatarCentavos(mes * 12)}</strong>`
      : 'Preencha os números da sua loja.';
  };
  ['st-c-pedidos', 'st-c-ticket', 'st-c-taxa'].forEach(id => $(id).addEventListener('input', calcular));
  calcular();

  // Planos e WhatsApp do Master
  let cfg = {};
  try { const r = await fetch('/api/saas'); if (r.ok) cfg = await r.json(); } catch (_) {}
  const zap = String(cfg.whatsappSuporte || '').replace(/\D/g, '');
  const linkZap = zap ? `https://wa.me/${zap.startsWith('55') ? zap : '55' + zap}?text=${encodeURIComponent('Olá! Quero saber mais sobre o Delivery Pro.')}` : '';
  const planos = [
    { nome: 'Essencial', preco: cfg.precoEssencialCentavos, itens: ['Cardápio online com seu link e QR Code', 'Pedidos ilimitados, sem comissão', 'Painel do balcão, cozinha e caixa', 'Pix automático e frete por distância'] },
    { nome: 'Pro', preco: cfg.precoProCentavos, destaque: true, itens: ['Tudo do Essencial', 'App do motoboy com rota inteligente', 'Cliente acompanha a moto ao vivo', 'Equipe, acerto dos motoboys e relatórios'] }
  ];
  const elPlanos = $('st-planos');
  if (elPlanos) elPlanos.innerHTML = planos.map(p => `
    <div class="st-plano${p.destaque ? ' destaque' : ''}">
      ${p.destaque ? '<span class="st-plano-selo">Mais completo</span>' : ''}
      <h3>${p.nome}</h3>
      <p class="st-preco">${p.preco ? `${formatarCentavos(p.preco)}<small>/mês</small>` : '<small>Fale com a gente</small>'}</p>
      <ul>${p.itens.map(i => `<li>✔ ${i}</li>`).join('')}</ul>
      <button class="st-btn${p.destaque ? '' : ' st-btn-sec'}" type="button" data-cadastro>Começar teste grátis</button>
    </div>`).join('');
  elPlanos?.querySelectorAll('[data-cadastro]').forEach(b => { b.onclick = abrirCadastro; });
  const elZap = $('st-whats');
  if (elZap && linkZap) elZap.innerHTML = `<a class="st-zap" href="${esc(linkZap)}" target="_blank" rel="noopener">💬 Tirar dúvidas no WhatsApp</a>`;
}
