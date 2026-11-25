// Termos de Uso e Política de Privacidade (/termos e /privacidade) + aceite do lojista.
// Ao mudar o texto de forma importante, suba VERSAO_TERMOS (aqui e no Worker): os donos aceitam de novo.
import { auth, esc, showToast } from './config.js';
import { AppState } from './router.js';

export const VERSAO_TERMOS = '2026-11-25';
const DATA_TEXTO = '25 de novembro de 2026';

async function dadosResponsavel() {
  try {
    const r = await fetch('/api/saas');
    return r.ok ? await r.json() : {};
  } catch (_) { return {}; }
}

function blocoContato(cfg) {
  const zap = String(cfg.whatsappSuporte || '').replace(/\D/g, '');
  const itens = [
    cfg.responsavelNome ? `<li><strong>Responsável:</strong> ${esc(cfg.responsavelNome)}${cfg.responsavelDoc ? ` — ${esc(cfg.responsavelDoc)}` : ''}</li>` : '',
    cfg.emailContato ? `<li><strong>E-mail:</strong> <a href="mailto:${esc(cfg.emailContato)}">${esc(cfg.emailContato)}</a></li>` : '',
    zap ? `<li><strong>WhatsApp:</strong> <a href="https://wa.me/${zap.startsWith('55') ? zap : '55' + zap}" target="_blank" rel="noopener">${esc(zap)}</a></li>` : ''
  ].filter(Boolean).join('');
  return itens ? `<ul>${itens}</ul>` : '<p>Use o contato de suporte informado no painel da sua loja.</p>';
}

function termosHtml(cfg) {
  const nome = esc(cfg.responsavelNome || 'o responsável pela plataforma Delivery Pro');
  return `
    <h1>Termos de Uso — Delivery Pro</h1>
    <p class="doc-versao">Versão ${VERSAO_TERMOS} · atualizado em ${DATA_TEXTO}</p>

    <h2>1. O que é o Delivery Pro</h2>
    <p>O Delivery Pro é uma ferramenta de tecnologia (software) que permite a comércios ("Lojista") ter um cardápio online com link próprio, receber pedidos, organizar a operação da loja e acompanhar entregas. A plataforma é mantida por ${nome} ("Plataforma").</p>
    <p><strong>A Plataforma não vende, não prepara, não entrega e não intermedeia a venda dos produtos.</strong> Cada venda é feita diretamente entre o Lojista e o seu cliente.</p>

    <h2>2. Conta e acesso</h2>
    <ul>
      <li>O Lojista deve informar dados verdadeiros no cadastro e mantê-los atualizados.</li>
      <li>O Lojista é responsável por guardar a sua senha e pelas pessoas que cadastrar na equipe (balcão, cozinha e entregadores).</li>
      <li>A conta pode ser suspensa em caso de uso indevido, fraude ou descumprimento destes Termos.</li>
    </ul>

    <h2>3. Teste grátis, planos e pagamento</h2>
    <ul>
      <li>Toda loja nova tem <strong>7 dias de teste grátis</strong>, sem cartão de crédito.</li>
      <li>Depois do teste, o uso continua mediante pagamento do plano escolhido (Essencial ou Pro), pelos valores mostrados no painel. Cada pagamento libera 30 dias de uso.</li>
      <li>Não há fidelidade nem multa: o Lojista pode simplesmente não renovar. Se o pagamento vencer, há tolerância de 48 horas; depois disso, o cardápio fica pausado até a renovação, <strong>sem apagar os dados</strong>.</li>
      <li>Os valores pagos referem-se a períodos de uso já liberados e não são devolvidos de forma proporcional, salvo quando a lei exigir.</li>
      <li>Os preços podem mudar; a mudança vale a partir do próximo pagamento e é avisada no painel.</li>
    </ul>

    <h2>4. Responsabilidades do Lojista</h2>
    <p>O Lojista é o único responsável por:</p>
    <ul>
      <li>produtos, preços, ofertas, fotos e descrições publicados no cardápio;</li>
      <li>qualidade, preparo, higiene, embalagem e entrega dos pedidos, e pelo atendimento aos seus clientes;</li>
      <li>licenças, alvarás, normas sanitárias e de defesa do consumidor, emissão de notas fiscais e tributos;</li>
      <li>a relação com funcionários e entregadores. <strong>Não existe qualquer vínculo de emprego, prestação de serviço ou subordinação entre a Plataforma e os funcionários ou entregadores do Lojista;</strong></li>
      <li>trocas, cancelamentos, devoluções e estornos feitos aos seus clientes;</li>
      <li>usar os dados dos clientes só para atender os pedidos e conforme a Lei Geral de Proteção de Dados (LGPD).</li>
    </ul>

    <h2>5. Pagamentos dos clientes</h2>
    <p>Quando o Lojista ativa o Pix automático, os pagamentos dos clientes caem <strong>diretamente na conta Mercado Pago do Lojista</strong>. A Plataforma não recebe, não guarda e não repassa esses valores. Taxas, prazos, contestações e estornos seguem as regras do Mercado Pago e são de responsabilidade do Lojista. Pagamentos em dinheiro ou cartão na entrega são combinados diretamente entre Lojista e cliente.</p>

    <h2>6. Uso proibido</h2>
    <p>É proibido usar a Plataforma para vender produtos ilegais ou proibidos, praticar fraude, enviar mensagens em massa não solicitadas (spam), tentar invadir ou sobrecarregar o sistema, ou copiar o software.</p>

    <h2>7. Funcionamento do serviço</h2>
    <p>A Plataforma usa serviços de terceiros (Cloudflare, Google Firebase, Mercado Pago, OpenStreetMap e os serviços de notificação dos navegadores) e se esforça para mantê-la sempre disponível, mas não garante funcionamento sem interrupções, falhas de internet, do celular ou desses serviços. Recursos como GPS e notificações dependem do aparelho e da permissão de cada usuário.</p>

    <h2>8. Limitação de responsabilidade</h2>
    <p>Na máxima extensão permitida pela lei, a Plataforma não responde por lucros cessantes, perda de vendas ou danos decorrentes de indisponibilidade temporária, de informações cadastradas pelo Lojista, de atos do Lojista, de seus funcionários, entregadores ou clientes. Quando houver responsabilidade, ela fica limitada ao valor pago pelo Lojista nos últimos 3 meses.</p>

    <h2>9. Dados pessoais</h2>
    <p>O tratamento de dados pessoais está descrito na <a href="/privacidade">Política de Privacidade</a>. Em relação aos dados dos clientes da loja, o Lojista é o <strong>controlador</strong> e a Plataforma atua como <strong>operadora</strong>, tratando os dados apenas para fazer o sistema funcionar.</p>

    <h2>10. Encerramento e exclusão</h2>
    <p>O Lojista pode pedir o encerramento da conta e a exclusão dos dados da loja a qualquer momento pelo contato abaixo. Os dados são apagados em até 30 dias, exceto os que a lei obrigar a guardar.</p>

    <h2>11. Alterações destes Termos</h2>
    <p>Estes Termos podem ser atualizados. Mudanças importantes serão avisadas no painel e exigirão um novo aceite para continuar usando a Plataforma.</p>

    <h2>12. Lei e foro</h2>
    <p>Aplicam-se as leis brasileiras. Fica eleito o foro do domicílio do responsável pela Plataforma, ressalvados os direitos garantidos ao consumidor.</p>

    <h2>Contato</h2>
    ${blocoContato(cfg)}`;
}

function privacidadeHtml(cfg) {
  const nome = esc(cfg.responsavelNome || 'o responsável pela plataforma Delivery Pro');
  return `
    <h1>Política de Privacidade — Delivery Pro</h1>
    <p class="doc-versao">Versão ${VERSAO_TERMOS} · atualizado em ${DATA_TEXTO}</p>
    <p>Esta Política explica, em linguagem simples, quais dados pessoais são usados no Delivery Pro, para quê e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).</p>

    <h2>1. Quem cuida dos dados</h2>
    <ul>
      <li><strong>Clientes que fazem pedidos:</strong> a <strong>loja</strong> onde você pediu é a controladora dos seus dados (é ela quem decide como atender o pedido). O Delivery Pro, mantido por ${nome}, é o <strong>operador</strong>: guarda e processa os dados só para o sistema funcionar.</li>
      <li><strong>Lojistas e equipes das lojas:</strong> o Delivery Pro é o controlador dos dados de cadastro e uso da plataforma.</li>
    </ul>

    <h2>2. Quais dados usamos</h2>
    <ul>
      <li><strong>Cliente:</strong> nome, WhatsApp, endereço e o ponto marcado no mapa (para calcular a entrega e guiar o entregador), itens do pedido, forma de pagamento e, se quiser, a avaliação do pedido.</li>
      <li><strong>Lojista e equipe:</strong> nome, e-mail, WhatsApp da loja e dados da loja (cardápio, horários, endereço da loja).</li>
      <li><strong>Entregador:</strong> nome, e-mail e a <strong>localização do celular apenas durante uma entrega em andamento</strong>.</li>
      <li><strong>Dados técnicos:</strong> endereço IP e informações do navegador, usados só para segurança (anti-fraude e anti-trote).</li>
      <li><strong>No seu próprio celular:</strong> sacola, endereços salvos (Casa, Trabalho) e último pedido ficam guardados apenas no seu aparelho, para você não digitar de novo.</li>
    </ul>

    <h2>3. Para que usamos</h2>
    <ul>
      <li>Registrar e entregar o pedido, calcular o frete e mostrar o acompanhamento ao vivo.</li>
      <li>Avisar sobre o andamento do pedido (notificações no celular, se você ativar) e permitir que a loja fale com você pelo WhatsApp sobre o pedido — inclusive se ele não for concluído (sacola abandonada).</li>
      <li>Proteger contra fraudes, trotes e abusos.</li>
      <li>Cobrar a mensalidade dos lojistas e cumprir obrigações legais.</li>
    </ul>
    <p><strong>Não vendemos dados pessoais</strong> e não usamos seus dados para publicidade de terceiros.</p>

    <h2>4. Localização</h2>
    <p>O ponto que o cliente marca no mapa é usado para o frete e para o entregador chegar. O GPS do entregador só é enviado enquanto há uma entrega em andamento; a transmissão para o cliente <strong>para quando o entregador chega a cerca de 50 metros</strong> do endereço e é encerrada ao concluir a entrega. Em rotas com várias entregas, cada cliente vê apenas quantas entregas vêm antes da sua, nunca o endereço dos outros.</p>

    <h2>5. Com quem compartilhamos</h2>
    <ul>
      <li>Com a <strong>loja</strong> do pedido (e a equipe dela).</li>
      <li>Com fornecedores que fazem o sistema funcionar: <strong>Google Firebase</strong> (banco de dados e login, com dados guardados em São Paulo), <strong>Cloudflare</strong> (hospedagem, fotos e proteção anti-trote), <strong>Mercado Pago</strong> (quando o pagamento é por Pix automático), <strong>OpenStreetMap</strong> (mapas) e os serviços de notificação do navegador (Google, Apple, Mozilla, Microsoft). Alguns desses fornecedores podem processar dados fora do Brasil, com as garantias previstas na LGPD.</li>
      <li>Com autoridades, quando a lei ou uma ordem judicial exigir.</li>
    </ul>

    <h2>6. Por quanto tempo guardamos</h2>
    <ul>
      <li>Pedidos: enquanto a loja usar a plataforma, para o histórico e as obrigações legais da loja.</li>
      <li>Sacolas abandonadas: até 3 dias.</li>
      <li>Inscrição para notificações: apagada quando o pedido termina.</li>
      <li>Dados da loja: até 30 dias após o pedido de encerramento, salvo obrigação legal.</li>
    </ul>

    <h2>7. Seus direitos (art. 18 da LGPD)</h2>
    <p>Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação sobre compartilhamentos e revisão do consentimento. <strong>Clientes:</strong> o pedido deve ser feito primeiro à loja onde você comprou; também ajudamos pelo contato abaixo. Você pode, a qualquer momento, desligar as notificações e a localização nas configurações do seu celular e apagar os dados salvos limpando os dados do site no navegador.</p>

    <h2>8. Segurança</h2>
    <p>Usamos conexão criptografada (HTTPS), login com senha, separação dos dados por loja, chaves de pagamento guardadas criptografadas e regras de acesso no banco de dados. Nenhum sistema é 100% invulnerável; se houver um incidente relevante, avisaremos os afetados e a ANPD, como manda a lei.</p>

    <h2>9. Crianças</h2>
    <p>A plataforma não é direcionada a menores de 18 anos para cadastro de lojas.</p>

    <h2>10. Alterações</h2>
    <p>Esta Política pode ser atualizada. A versão em vigor fica sempre nesta página, com a data no topo.</p>

    <h2>Contato e encarregado de dados</h2>
    ${blocoContato(cfg)}`;
}

// Página /termos ou /privacidade
export async function renderizarDocumento(root, tipo) {
  root.innerHTML = '<div class="card doc-legal"><p>Carregando...</p></div>';
  const cfg = await dadosResponsavel();
  const voltar = new URLSearchParams(window.location.search).get('loja');
  root.innerHTML = `
    <article class="card doc-legal">
      ${voltar && /^[a-z0-9-]{2,40}$/.test(voltar) ? `<a class="btn-outline-sm" href="/${esc(voltar)}" style="text-decoration:none; display:inline-block; margin-bottom:12px;">← Voltar ao cardápio</a>` : ''}
      ${tipo === 'privacidade' ? privacidadeHtml(cfg) : termosHtml(cfg)}
      <p class="doc-links"><a href="/termos">Termos de Uso</a> · <a href="/privacidade">Política de Privacidade</a></p>
    </article>`;
  document.title = tipo === 'privacidade' ? 'Política de Privacidade — Delivery Pro' : 'Termos de Uso — Delivery Pro';
}

// Lojas que ainda não aceitaram a versão atual: o dono aceita uma vez (não dá para fechar sem aceitar)
export function pedirAceiteTermos() {
  const l = AppState.lojaDados || {};
  if (l.termosVersao === VERSAO_TERMOS) return;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:460px; width:100%; margin:0;">
      <h3>📄 Termos de Uso e Privacidade</h3>
      <p class="gc-dica" style="margin:8px 0 12px;">Para continuar usando o Delivery Pro, leia e aceite os documentos abaixo. Eles explicam as regras da plataforma e como os dados dos seus clientes são protegidos (LGPD).</p>
      <p><a href="/termos" target="_blank" rel="noopener">📘 Ler os Termos de Uso</a><br/><a href="/privacidade" target="_blank" rel="noopener">🔒 Ler a Política de Privacidade</a></p>
      <label class="gc-check"><input type="checkbox" id="aceite-ok" /> Li e aceito os Termos de Uso e a Política de Privacidade</label>
      <button class="btn-primary" type="button" id="aceite-btn" style="margin-top:12px;" disabled>Aceitar e continuar</button>
    </div>`;
  document.body.appendChild(overlay);
  const chk = overlay.querySelector('#aceite-ok');
  const btn = overlay.querySelector('#aceite-btn');
  chk.onchange = () => { btn.disabled = !chk.checked; };
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch('/api/termos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lojaId: AppState.lojaId, versao: VERSAO_TERMOS })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível registrar o aceite.');
      AppState.lojaDados.termosVersao = VERSAO_TERMOS;
      overlay.remove();
      showToast('Obrigado! Aceite registrado.');
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
    }
  };
}
