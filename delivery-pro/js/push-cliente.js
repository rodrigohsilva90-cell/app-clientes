// Cliente ativa "me avise no celular" na tela de acompanhamento.
// Android/computador: pede permissão e pronto. iPhone: só funciona com o app na Tela de Início
// (iOS 16.4+), então mostramos um guia de 2 passos.
import { AppState } from './router.js';

let publicoCache = null;
export async function configPublica() {
  if (publicoCache) return publicoCache;
  try {
    const r = await fetch('/api/publico');
    publicoCache = r.ok ? await r.json() : {};
  } catch (_) { publicoCache = {}; }
  return publicoCache;
}

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const suportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const chaveLocal = (id) => `push_ok_${id}`;

function chaveParaBytes(b64) {
  const t = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Desenha o cartão dentro de "box" para o pedido (só enquanto ele está em andamento)
export async function cartaoNotificacao(box, pedidoId) {
  if (!box) return;
  const cfg = await configPublica();
  if (!cfg.push) { box.classList.add('hidden'); return; }
  let ativo = false;
  try { ativo = localStorage.getItem(chaveLocal(pedidoId)) === '1'; } catch (_) {}
  if (ativo && suportaPush() && Notification.permission === 'granted') {
    box.className = 'card push-card ok';
    box.innerHTML = '🔔 <strong>Avisos ligados.</strong> Você recebe uma notificação a cada etapa, mesmo com o celular bloqueado.';
    return;
  }

  if (ehIOS() && !instalado()) {
    box.className = 'card push-card';
    box.innerHTML = `
      <strong>🔔 Quer ser avisado no iPhone?</strong>
      <ol class="push-passos">
        <li>Toque em <span class="push-icone">⬆</span> <strong>Compartilhar</strong> (na barra do Safari).</li>
        <li>Escolha <strong>"Adicionar à Tela de Início"</strong>. </li>
        <li>Abra pelo ícone novo: ele já abre neste pedido. Toque em <strong>Ativar avisos</strong>.</li>
      </ol>`;
    return;
  }
  if (!suportaPush()) { box.classList.add('hidden'); return; }
  if (Notification.permission === 'denied') {
    box.className = 'card push-card';
    box.innerHTML = '🔕 As notificações estão bloqueadas para este site. Libere nas configurações do navegador se quiser ser avisado.';
    return;
  }

  box.className = 'card push-card';
  box.innerHTML = `
    <div><strong>🔔 Avisar no celular?</strong><span>Receba uma notificação quando o pedido for aceito, sair para entrega e chegar.</span></div>
    <button class="btn-primary" type="button" id="push-ativar" style="width:auto;">Ativar avisos</button>`;
  box.querySelector('#push-ativar').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Ativando...';
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { cartaoNotificacao(box, pedidoId); return; }
      const reg = await navigator.serviceWorker.ready;
      const inscricao = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(cfg.push) });
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: AppState.slug, pedidoId, inscricao: inscricao.toJSON() })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'falhou');
      try { localStorage.setItem(chaveLocal(pedidoId), '1'); } catch (_) {}
      cartaoNotificacao(box, pedidoId);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Tentar de novo';
    }
  };
}
