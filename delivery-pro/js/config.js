import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getDoc, getDocFromCache } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Projeto Firebase delivery-pro-38f75 (Firestore em southamerica-east1)
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCTvLJxBS8qXw5krZpXh5TL-VsV5tDgRws",
  authDomain: "delivery-pro-38f75.firebaseapp.com",
  projectId: "delivery-pro-38f75",
  storageBucket: "delivery-pro-38f75.firebasestorage.app",
  messagingSenderId: "185334892887",
  appId: "1:185334892887:web:985baa10a159a6caa61612"
};

// URL do seu Cloudflare Worker
export const WORKER_API_URL = "https://api.seudominio.com.br";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
// No painel da loja e no app do motoboy, os pedidos ficam guardados no aparelho: se a internet da loja
// cair, a tela continua mostrando os pedidos e as mudanças sincronizam sozinhas quando a conexão voltar.
function criarBanco() {
  if (/^\/[^/]+\/(painel|motoboy)(\/|$)/.test(window.location.pathname)) {
    try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); } catch (_) {}
  }
  return getFirestore(app);
}
export const db = criarBanco();

// Painel e motoboy abrem na hora com a cópia guardada no aparelho; a versão nova chega por trás
// (aoAtualizar recebe os dados novos). Na primeira vez (sem cópia), espera o servidor normalmente.
export async function lerRapido(ref, aoAtualizar) {
  try {
    const local = await getDocFromCache(ref);
    if (local.exists()) {
      getDoc(ref).then(novo => { if (aoAtualizar) aoAtualizar(novo); }).catch(() => {});
      return local;
    }
  } catch (_) {}
  return getDoc(ref);
}

// Formatação monetária segura (sempre trabalhando com centavos inteiros no banco)
export function formatarCentavos(centavos) {
  const valor = (Number(centavos) || 0) / 100;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Toast visual global
export function showToast(mensagem, duracao = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = mensagem;
  container.appendChild(el);
  setTimeout(() => el.remove(), duracao);
}

// Escapa texto antes de colocar em innerHTML (impede que um pedido injete código no painel)
// Saudação com o nome da pessoa (só o primeiro nome) e a hora do dia
export function saudacao(nome, papel) {
  const h = new Date().getHours();
  const [ola, icone] = h >= 5 && h < 12 ? ['Bom dia', '☀️'] : h >= 12 && h < 18 ? ['Boa tarde', '🌤️'] : ['Boa noite', '🌙'];
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const frase = { dono: 'Bora vender! 🚀', balcao: 'Bom trabalho no balcão! 💪', cozinha: 'Bom preparo hoje! 👨‍🍳', motoboy: 'Boas entregas e cuidado no trânsito! 🛵' }[papel] || 'Bom trabalho! 💪';
  return `<div class="saudacao"><span class="saudacao-ola">${icone} ${ola}${primeiro ? `, <strong>${esc(primeiro)}</strong>` : ''}!</span> <span class="saudacao-frase">${frase}</span></div>`;
}

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
