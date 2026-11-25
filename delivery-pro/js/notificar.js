// Depois que a equipe muda o status de um pedido, pede ao Worker para avisar o
// celular do cliente (se ele ativou as notificações). Não trava a tela se falhar.
import { auth } from './config.js';
import { AppState } from './router.js';

export function avisarCliente(pedidoId) {
  try {
    const u = auth.currentUser;
    if (!u || !pedidoId || !AppState.lojaId) return;
    u.getIdToken().then(token => fetch('/api/notificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lojaId: AppState.lojaId, pedidoId }),
      keepalive: true
    })).catch(() => {});
  } catch (_) {}
}
