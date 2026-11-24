// ============================================================
// FIREBASE-CONFIG.JS - INICIALIZAÇÃO E VARIÁVEIS GLOBAIS
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCJa_EL7sljAIgf1dO3hWIxiWI8-hjHcZY",
  authDomain: "gestao-clientes-2355c.firebaseapp.com",
  projectId: "gestao-clientes-2355c",
  storageBucket: "gestao-clientes-2355c.firebasestorage.app",
  messagingSenderId: "979751049541",
  appId: "1:979751049541:web:1900c445eaee6d442d862c"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Inicializações de Instâncias
var auth = firebase.auth();
var db = firebase.firestore();
// Cache local do Firestore: o app abre e lê os clientes mesmo sem internet (várias abas)
try { db.enablePersistence({ synchronizeTabs: true }).catch(function (e) { console.warn('Persistência offline indisponível:', e && e.code); }); } catch (e) {}

// Estado Global Compartilhado
var currentUser = null;
var activeOwnerId = null;
var currentResellerData = null;
var isPrivacyMode = false;
var myPixKey = "";
var userServers = [];      // [{ name, dns, panelUrl, costPerCredit }]
var userExpenses = [];     // [{ id, desc, amount, type: 'fixed'|'variable', from|month }]

var MASTER_ADMIN_EMAIL = "rodrigo.h.silva90@gmail.com";
var MASTER_ADMIN_PHONE = "5511978095442";