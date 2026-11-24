import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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
export const db = getFirestore(app);

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
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
