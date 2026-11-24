import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Substitua pelos dados do seu projeto Firebase (Região: southamerica-east1)
export const FIREBASE_CONFIG = {
  apiKey: "SUA_API_KEY",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:000000000000"
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
