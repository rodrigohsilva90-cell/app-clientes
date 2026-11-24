import { auth, db, showToast } from './config.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { iniciarVitrine } from './vitrine.js';
import { iniciarBalcao } from './balcao.js';
import { iniciarMotoboy } from './motoboy.js';

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
const NOMES_MODO = { cliente: 'Modo Cliente', balcao: 'Modo Balcão', motoboy: 'Modo Entregador', master: 'Modo Master' };
function modoDaUrl() {
  const partes = window.location.pathname.split('/').filter(Boolean);
  if (partes[0] === 'master') return 'master';
  if (partes[1] === 'painel') return 'balcao';
  if (partes[1] === 'motoboy') return 'motoboy';
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

  // Rota Master SaaS
  if (pathParts[0] === 'master') {
    AppState.modoAtual = 'master';
    return renderizarPlaceholder('Painel Master SaaS', 'Gerenciamento de assinaturas, planos e lojas parceiras.');
  }

  // Landing Page SaaS (sem slug na URL)
  if (pathParts.length === 0) {
    return renderizarLandingSaaS(root);
  }

  // Vitrine ou Painel de uma Loja específica
  const slug = pathParts[0].toLowerCase();
  const subRota = pathParts[1] || 'vitrine';
  AppState.slug = slug;

  // Atualiza manifest dinâmico por loja
  const manifestLink = document.getElementById('pwa-manifest');
  if (manifestLink) manifestLink.href = `/${slug}/manifest.webmanifest`;

  try {
    const slugSnap = await getDoc(doc(db, 'slugs', slug));
    if (!slugSnap.exists() || !slugSnap.data().ativo) {
      root.innerHTML = `<div class="card"><h2>Loja não encontrada ou temporariamente indisponível.</h2></div>`;
      return;
    }

    AppState.lojaId = slugSnap.data().lojaId;
    const lojaSnap = await getDoc(doc(db, 'lojas', AppState.lojaId));
    AppState.lojaDados = { id: AppState.lojaId, ...lojaSnap.data() };

    // Aplica White-Label (Cor e Título da Loja)
    if (AppState.lojaDados.corPrimaria) {
      document.documentElement.style.setProperty('--primary', AppState.lojaDados.corPrimaria);
      document.getElementById('meta-theme-color')?.setAttribute('content', AppState.lojaDados.corPrimaria);
    }
    document.getElementById('page-title').textContent = AppState.lojaDados.nome;
    document.getElementById('topbar-store-name').textContent = AppState.lojaDados.nome;
    document.getElementById('global-topbar').classList.remove('hidden');

    if (subRota === 'painel') {
      AppState.modoAtual = 'balcao';
      iniciarBalcao();
    } else if (subRota === 'motoboy') {
      AppState.modoAtual = 'motoboy';
      iniciarMotoboy();
    } else {
      AppState.modoAtual = 'cliente';
      iniciarVitrine();
    }
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados da loja.');
  }
}

function renderizarLandingSaaS(root) {
  root.innerHTML = `
    <div class="card" style="text-align:center; padding: 40px 20px;">
      <h1>Seu Delivery Próprio com Mapa ao Vivo</h1>
      <p style="margin: 12px 0 24px; color: var(--text-muted);">
        Zero comissão por pedido. Cardápio personalizado, Pix automático e rastreamento em tempo real.
      </p>
      <button class="btn-primary" style="max-width: 300px;" onclick="alert('Fluxo de cadastro Trial 7 dias')">
        Testar Grátis por 7 Dias
      </button>
    </div>
  `;
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
  const papeis = profile.roles || [profile.role || 'cliente'];
  if (papeis.length <= 1) return;

  selectEl.innerHTML = papeis.map(r => `<option value="${r}">${NOMES_MODO[r] || r}</option>`).join('');
  selectEl.value = AppState.modoAtual;
  selectEl.classList.remove('hidden');

  selectEl.onchange = (e) => {
    if (AppState.entregaAtiva) {
      showToast('Conclua sua entrega ativa antes de trocar de perfil!');
      e.target.value = AppState.modoAtual;
      return;
    }
    const novoModo = e.target.value;
    if (novoModo === 'balcao') window.location.pathname = `/${AppState.slug}/painel`;
    if (novoModo === 'motoboy') window.location.pathname = `/${AppState.slug}/motoboy`;
    if (novoModo === 'cliente') window.location.pathname = `/${AppState.slug}`;
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
    </form>
  `;
  document.body.appendChild(modal);
  modal.querySelector('[data-fechar]').onclick = () => modal.remove();
  modal.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      await signInWithEmailAndPassword(auth, e.target.email.value.trim(), e.target.senha.value);
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
