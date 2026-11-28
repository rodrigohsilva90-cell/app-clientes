import { auth, db, showToast, lerRapido } from './config.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
// Cada tela baixa só o código dela (o cliente não precisa baixar o painel do balcão, do motoboy ou do Master)
const telas = {
  vitrine: () => import('./vitrine.js'),
  balcao: () => import('./balcao.js'),
  motoboy: () => import('./motoboy.js'),
  acompanhar: () => import('./acompanhar.js'),
  cadastro: () => import('./cadastro.js'),
  master: () => import('./master.js')
};
const iniciarVitrine = async (...a) => (await telas.vitrine()).iniciarVitrine(...a);
const iniciarBalcao = async (...a) => (await telas.balcao()).iniciarBalcao(...a);
const iniciarMotoboy = async (...a) => (await telas.motoboy()).iniciarMotoboy(...a);
const iniciarAcompanhamento = async (...a) => (await telas.acompanhar()).iniciarAcompanhamento(...a);
const abrirCadastroLoja = async (...a) => (await telas.cadastro()).abrirCadastroLoja(...a);
const iniciarMaster = async (...a) => (await telas.master()).iniciarMaster(...a);
import { aplicarTema } from './tema.js';

// 1. Registro do Service Worker com aviso de atualização
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            document.getElementById('sw-update-banner').classList.remove('hidden');
          }
        });
      });
    } catch (err) {
      console.warn('SW falhou:', err);
    }
  });

  document.getElementById('btn-sw-reload')?.addEventListener('click', () => {
    window.location.reload();
  });
}

// 2. Estado Global da Sessão
export const AppState = {
  user: null,
  userProfile: null,
  slug: null,
  lojaId: null,
  lojaDados: null,
  modoAtual: 'cliente', // 'cliente' | 'balcao' | 'motoboy' | 'master'
  entregaAtiva: false   // Trava troca de perfil enquanto motoboy está em rota
};

// Descobre o modo pela URL logo no início (antes do login responder), para o topo já nascer certo
const NOMES_MODO = { cliente: 'Modo Cliente', balcao: 'Modo Balcão', cozinha: 'Modo Cozinha', motoboy: 'Modo Entregador', master: 'Modo Master' };
function modoDaUrl() {
  const partes = window.location.pathname.split('/').filter(Boolean);
  if (partes[0] === 'master') return 'master';
  if (partes[1] === 'painel') return 'balcao';
  if (partes[1] === 'motoboy') return 'motoboy';
  if (partes[1] === 'cozinha') return 'cozinha';
  return 'cliente';
}
AppState.modoAtual = modoDaUrl();
const badgeModo = document.getElementById('topbar-badge');
if (badgeModo) badgeModo.textContent = NOMES_MODO[AppState.modoAtual];

// 3. Captura parâmetro ?ref= de parceiros comerciais por 30 dias
function capturarIndicacaoParceiro() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    localStorage.setItem('saas_parceiro_ref', JSON.stringify({
      parceiroId: ref,
      expiraEm: Date.now() + 30 * 24 * 60 * 60 * 1000
    }));
  }
}

// 4. Resolve a rota atual pela URL (ex: /, /master, /pizzariadoze, /pizzariadoze/painel)
async function resolverRota() {
  capturarIndicacaoParceiro();
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const root = document.getElementById('app-root');

  // Termos de Uso e Política de Privacidade
  if (pathParts.length === 1 && (pathParts[0] === 'termos' || pathParts[0] === 'privacidade')) {
    const { renderizarDocumento } = await import('./termos.js');
    return renderizarDocumento(root, pathParts[0]);
  }

  // Simulador de rota (só Master)
  if (pathParts.length === 1 && pathParts[0] === 'demo') {
    const { iniciarDemo } = await import('./demo.js');
    return iniciarDemo(root);
  }

  // Rota Master SaaS
  if (pathParts[0] === 'master') {
    AppState.modoAtual = 'master';
    return iniciarMaster();
  }

  // Landing Page SaaS (sem slug na URL)
  if (pathParts.length === 0) {
    return renderizarLandingSaaS(root);
  }

  // Vitrine ou Painel de uma Loja específica
  const slug = pathParts[0].toLowerCase();
  const subRota = pathParts[1] || 'vitrine';
  AppState.slug = slug;
  // Começa a baixar o código da tela já, junto com os dados da loja (não um depois do outro)
  (['painel', 'cozinha'].includes(subRota) ? telas.balcao() : subRota === 'motoboy' ? telas.motoboy() : subRota === 'pedido' ? telas.acompanhar() : telas.vitrine()).catch(() => {});

  // Atualiza manifest dinâmico por loja
  const manifestLink = document.getElementById('pwa-manifest');
  // Na tela de um pedido, o app instalado (iPhone) já abre nesse pedido
  const pedidoNaUrl = subRota === 'pedido' && /^[A-Za-z0-9_]{8,100}$/.test(pathParts[2] || '') ? pathParts[2] : null;
  if (manifestLink) manifestLink.href = `/${slug}/manifest.webmanifest${pedidoNaUrl ? `?pedido=${pedidoNaUrl}` : ''}`;

  try {
    // O servidor já manda o código da loja junto com a página: economiza uma ida ao banco
    const meta = document.querySelector('meta[name="loja-id"]');
    if (meta && meta.dataset.slug === slug && /^[A-Za-z0-9_-]{2,80}$/.test(meta.content)) {
      AppState.lojaId = meta.content;
    } else {
      const slugSnap = await getDoc(doc(db, 'slugs', slug));
      if (!slugSnap.exists() || !slugSnap.data().ativo) {
        root.innerHTML = `<div class="card"><h2>Loja não encontrada ou temporariamente indisponível.</h2></div>`;
        return;
      }
      AppState.lojaId = slugSnap.data().lojaId;
    }
    const equipeRapido = ['painel', 'cozinha', 'motoboy'].includes(subRota);
    const lojaSnap = equipeRapido
      ? await lerRapido(doc(db, 'lojas', AppState.lojaId), (novo) => setTimeout(() => {
          if (!novo.exists() || !AppState.lojaDados || AppState.lojaDados.id !== AppState.lojaId) return;
          const antes = AppState.lojaDados;
          const dados = novo.data();
          // Mudou o plano (pagou/venceu): recarrega para mostrar a tela certa; o resto atualiza sem piscar
          const chavePlano = (l) => JSON.stringify([l.plano || null, l.pagoAte && l.pagoAte.seconds || null, l.trialAte && l.trialAte.seconds || null]);
          if (chavePlano(antes) !== chavePlano(dados)) { location.reload(); return; }
          Object.assign(AppState.lojaDados, dados);
        }, 0))
      : await getDoc(doc(db, 'lojas', AppState.lojaId));
    if (!lojaSnap.exists()) {
      root.innerHTML = `<div class="card"><h2>Loja não encontrada ou temporariamente indisponível.</h2></div>`;
      return;
    }
    AppState.lojaDados = { id: AppState.lojaId, ...lojaSnap.data() };

    // Aplica White-Label (cor com texto de contraste automático; modo escuro só nas telas do cliente)
    const telaDoCliente = !['painel', 'cozinha', 'motoboy'].includes(subRota);
    aplicarTema({ ...AppState.lojaDados, modoEscuro: telaDoCliente && AppState.lojaDados.modoEscuro }, telaDoCliente ? slug : null);
    document.getElementById('page-title').textContent = AppState.lojaDados.nome;
    document.getElementById('topbar-store-name').textContent = AppState.lojaDados.nome;
    document.getElementById('global-topbar').classList.remove('hidden');

    if (subRota === 'painel') {
      AppState.modoAtual = 'balcao';
      iniciarBalcao();
    } else if (subRota === 'cozinha') {
      AppState.modoAtual = 'cozinha';
      iniciarBalcao({ cozinha: true });
    } else if (subRota === 'motoboy') {
      AppState.modoAtual = 'motoboy';
      iniciarMotoboy();
    } else if (subRota === 'pedido') {
      AppState.modoAtual = 'cliente';
      iniciarAcompanhamento(pathParts[2]);
    } else {
      AppState.modoAtual = 'cliente';
      iniciarVitrine();
    }
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados da loja.');
  }
}

async function renderizarLandingSaaS(root) {
  root.innerHTML = `
    <div class="card landing">
      <h1>Seu Delivery Próprio com Mapa ao Vivo</h1>
      <p class="landing-sub">
        Zero comissão por pedido. Cardápio personalizado, frete por distância e rastreamento do motoboy em tempo real.
      </p>
      <div id="landing-acoes" class="landing-acoes">
        <button class="btn-primary" id="btn-teste-gratis">🚀 Testar grátis por 7 dias</button>
        <button class="btn-outline-sm" id="btn-landing-entrar">Já tenho conta — Entrar</button>
      </div>
    </div>
  `;
  document.getElementById('btn-teste-gratis').onclick = abrirCadastroLoja;
  document.getElementById('btn-landing-entrar').onclick = abrirModalLogin;

  // Já logado e com loja: atalho para o painel
  if (auth.currentUser) {
    try {
      const perfil = await getDoc(doc(db, 'usuarios', auth.currentUser.uid));
      const slug = perfil.exists() ? perfil.data().slug : null;
      const entregador = perfil.exists() && perfil.data().inicio === 'motoboy';
      if (slug) {
        document.getElementById('landing-acoes').innerHTML = `
          <a class="btn-primary" style="text-decoration:none; display:block;" href="/${encodeURIComponent(slug)}/${entregador ? 'motoboy' : 'painel'}">${entregador ? '🛵 Abrir app do entregador' : '📋 Abrir o painel da minha loja'}</a>
          <a class="btn-outline-sm" style="text-decoration:none; display:block; text-align:center;" href="/${encodeURIComponent(slug)}">👀 Ver meu cardápio</a>
          <button class="btn-outline-sm" id="btn-landing-sair">Sair</button>
        `;
        document.getElementById('btn-landing-sair').onclick = () => signOut(auth).then(() => window.location.reload());
      }
    } catch (_) {}
  }
}

function renderizarPlaceholder(titulo, descricao) {
  document.getElementById('app-root').innerHTML = `
    <div class="card">
      <h2>${titulo}</h2>
      <p style="color: var(--text-muted); margin-top: 8px;">${descricao}</p>
    </div>
  `;
}

// 5. Monitoramento de Autenticação e Alternador de Perfil
onAuthStateChanged(auth, async (user) => {
  AppState.user = user;
  const switcher = document.getElementById('profile-switcher');
  const authBtn = document.getElementById('btn-auth-action');

  authBtn.onclick = () => (user ? signOut(auth).then(() => window.location.reload()) : abrirModalLogin());

  if (user) {
    authBtn.textContent = 'Sair';
    const userSnap = await getDoc(doc(db, 'usuarios', user.uid));
    if (userSnap.exists()) {
      AppState.userProfile = userSnap.data();
      configurarAlternadorPerfil(switcher, AppState.userProfile);
    }
  } else {
    authBtn.textContent = 'Entrar';
    switcher.classList.add('hidden');
  }
});

function configurarAlternadorPerfil(selectEl, profile) {
  const papeis = [...new Set(profile.roles || [profile.role || 'cliente'])];
  // Dono/balcão também pode abrir a tela do entregador (e precisa conseguir voltar dela)
  if (papeis.includes('balcao') && !papeis.includes('cozinha')) papeis.push('cozinha');
  if (papeis.includes('balcao') && !papeis.includes('motoboy')) papeis.push('motoboy');
  const partes = window.location.pathname.split('/').filter(Boolean);
  const slugLoja = AppState.slug || (partes[0] && !['master', 'demo', 'termos', 'privacidade'].includes(partes[0]) ? partes[0].toLowerCase() : null);
  if (!slugLoja) return; // fora de uma loja não há para onde trocar
  if (!papeis.includes(AppState.modoAtual) && NOMES_MODO[AppState.modoAtual]) papeis.push(AppState.modoAtual);
  if (papeis.length <= 1) return;

  selectEl.innerHTML = papeis.map(r => `<option value="${r}">${NOMES_MODO[r] || r}</option>`).join('');
  selectEl.value = AppState.modoAtual;
  selectEl.classList.remove('hidden');

  selectEl.onchange = (e) => {
    // Entregador não larga a rota no meio; o dono pode sair (as entregas continuam com ele)
    if (AppState.entregaAtiva && papeis.includes('balcao') && confirm('Você tem entrega em andamento. Sair desta tela mesmo assim? (as entregas continuam com você)')) AppState.entregaAtiva = false;
    if (AppState.entregaAtiva) {
      showToast('Conclua sua entrega ativa antes de trocar de perfil!');
      e.target.value = AppState.modoAtual;
      return;
    }
    const novoModo = e.target.value;
    if (novoModo === 'balcao') window.location.pathname = `/${slugLoja}/painel`;
    if (novoModo === 'motoboy') window.location.pathname = `/${slugLoja}/motoboy`;
    if (novoModo === 'cozinha') window.location.pathname = `/${slugLoja}/cozinha`;
    if (novoModo === 'cliente') window.location.pathname = `/${slugLoja}`;
    if (novoModo === 'master') window.location.pathname = '/master';
  };
}

// Login simples (e-mail e senha) para equipe da loja e entregadores
function abrirModalLogin() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <form class="card" style="max-width:360px; width:100%;">
      <h3 style="margin-bottom:12px;">Entrar</h3>
      <input name="email" type="email" placeholder="E-mail" required autocomplete="username" style="width:100%; padding:10px; margin-bottom:8px; border:1px solid var(--border); border-radius:8px;" />
      <input name="senha" type="password" placeholder="Senha" required autocomplete="current-password" style="width:100%; padding:10px; margin-bottom:12px; border:1px solid var(--border); border-radius:8px;" />
      <button class="btn-primary" type="submit">Entrar</button>
      <button class="btn-outline-sm" type="button" data-fechar style="width:100%; margin-top:8px;">Cancelar</button>
      <p style="text-align:center; font-size:14px; margin-top:12px;"><a href="#" data-esqueci style="color:var(--text-muted);">Esqueci minha senha</a></p>
      <p style="text-align:center; font-size:14px; margin-top:8px;">Ainda não tem loja? <a href="#" data-criar style="color:var(--primary); font-weight:700;">Criar conta grátis</a></p>
    </form>
  `;
  document.body.appendChild(modal);
  modal.querySelector('[data-fechar]').onclick = () => modal.remove();
  modal.querySelector('[data-criar]').onclick = (e) => { e.preventDefault(); modal.remove(); abrirCadastroLoja(); };
  modal.querySelector('[data-esqueci]').onclick = async (e) => {
    e.preventDefault();
    const email = modal.querySelector('input[name="email"]').value.trim() || prompt('Digite seu e-mail para receber o link de nova senha:') || '';
    if (!/^\S+@\S+\.\S+$/.test(email)) { showToast('Digite seu e-mail no campo acima.'); return; }
    try {
      auth.languageCode = 'pt-BR';
      await sendPasswordResetEmail(auth, email);
      showToast('Enviamos um link para criar nova senha. Veja seu e-mail (e a caixa de spam).', 7000);
    } catch (_) {
      showToast('Não foi possível enviar. Confira o e-mail digitado.');
    }
  };
  modal.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      const cred = await signInWithEmailAndPassword(auth, e.target.email.value.trim(), e.target.senha.value);
      // Na página inicial, o dono vai direto para o painel da loja dele
      if (window.location.pathname === '/') {
        try {
          const perfil = await getDoc(doc(db, 'usuarios', cred.user.uid));
          if (perfil.exists() && perfil.data().slug) {
            window.location.href = `/${perfil.data().slug}/${perfil.data().inicio === 'motoboy' ? 'motoboy' : 'painel'}`;
            return;
          }
        } catch (_) {}
      }
      window.location.reload();
    } catch (err) {
      showToast('E-mail ou senha incorretos.');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };
}

// Espera o Firebase dizer se há alguém logado antes de abrir a tela (o motoboy precisa disso)
auth.authStateReady().then(resolverRota);
