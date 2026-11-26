// Painel do dono: conectar a conta Mercado Pago da loja para o Pix automático.
// O Access Token vai direto para o Worker (guardado criptografado); o navegador nunca o lê de volta.
import { auth, db, showToast, esc } from './config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { AppState } from './router.js';

async function chamar(corpo) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch('/api/mp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lojaId: AppState.lojaId, ...corpo })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Não foi possível concluir.');
  return d;
}

export async function abrirConfigPix() {
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:560px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>💳 Pix automático (Mercado Pago)</h3>
        <button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <div id="pix-conteudo"><p>Carregando...</p></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  const box = overlay.querySelector('#pix-conteudo');

  const desenhar = (st) => {
    const at = AppState.lojaDados.antiTrote || { ativo: false, limiteCentavos: 8000 };
    if (st.conectado) {
      box.innerHTML = `
        <div class="pix-ok">✅ <strong>Pix automático ligado</strong><span>Conta: ${esc(st.conta || 'Mercado Pago')}</span></div>
        <p class="gc-dica">O cliente que escolhe Pix recebe o QR Code na hora. O pedido só aparece no balcão (com campainha) <strong>depois de pago</strong>, e o dinheiro cai na sua conta Mercado Pago. Se o cliente não pagar em 30 minutos, o pedido é cancelado sozinho.</p>
        <div class="pix-trote">
          <h4 class="gc-subtitulo">🛡️ Proteção contra trote</h4>
          <label style="display:flex; gap:8px; align-items:flex-start;"><input type="checkbox" id="at-ativo" ${at.ativo ? 'checked' : ''}/>
            <span>Na <strong>primeira compra</strong> de um WhatsApp novo, pedidos de entrega a partir do valor abaixo só podem ser pagos <strong>pelo Pix antes</strong>.</span></label>
          <label style="display:block; margin-top:6px;">A partir de (R$)<input type="text" inputmode="decimal" id="at-limite" value="${((Number(at.limiteCentavos) || 8000) / 100).toFixed(2).replace('.', ',')}" style="width:120px; margin-left:6px;"/></label>
          <p class="gc-dica">Cliente que já comprou antes continua podendo pagar na entrega. Retirada no balcão não é afetada.</p>
          <button class="btn-outline-sm" type="button" id="at-salvar">Salvar proteção</button>
        </div>
        <button class="btn-outline-sm" type="button" id="pix-trocar">🔁 Trocar conta / token</button>
        <button class="btn-outline-sm gc-perigo" type="button" id="pix-desligar" style="margin-left:6px;">Desligar Pix automático</button>`;
      box.querySelector('#at-salvar').onclick = async (e) => {
        const n = Number(String(box.querySelector('#at-limite').value).replace(/R\$|\s/g, '').replace(/\./g, '').replace(',', '.'));
        if (!Number.isFinite(n) || n < 1 || n > 100000) { showToast('Valor inválido. Ex.: 80,00'); return; }
        const antiTrote = { ativo: box.querySelector('#at-ativo').checked, limiteCentavos: Math.round(n * 100) };
        e.target.disabled = true;
        try { await updateDoc(doc(db, 'lojas', AppState.lojaId), { antiTrote }); AppState.lojaDados.antiTrote = antiTrote; showToast(antiTrote.ativo ? '🛡️ Proteção contra trote ligada.' : 'Proteção contra trote desligada.'); }
        catch (err) { console.error(err); showToast('Não foi possível salvar.'); }
        e.target.disabled = false;
      };
      box.querySelector('#pix-trocar').onclick = () => desenhar({ conectado: false, trocando: true });
      box.querySelector('#pix-desligar').onclick = async () => {
        if (!confirm('Desligar o Pix automático? O Pix volta a ser combinado na entrega.')) return;
        try { await chamar({ acao: 'desligar' }); AppState.lojaDados.pixOnline = false; showToast('Pix automático desligado.'); desenhar({ conectado: false }); }
        catch (err) { showToast(err.message); }
      };
      return;
    }
    box.innerHTML = `
      <p class="gc-dica">Com o Pix automático, o cliente paga pelo QR Code na hora do pedido e o dinheiro cai <strong>direto na sua conta Mercado Pago</strong>. Sem conferir comprovante: o sistema confirma sozinho. A taxa é a do Mercado Pago para Pix (veja no app deles).</p>
      <ol class="pix-passos">
        <li>Entre em <strong>mercadopago.com.br/developers</strong> com a conta que vai receber (pelo computador é mais fácil).</li>
        <li>Toque em <strong>"Suas integrações"</strong> → <strong>"Criar aplicação"</strong>. Dê um nome (ex: Delivery da loja) e escolha <strong>"Pagamentos online"</strong> / <strong>Checkout Transparente</strong>.</li>
        <li>Dentro da aplicação, abra <strong>"Credenciais de produção"</strong> (pode pedir para ativar: preencha o ramo da loja e confirme).</li>
        <li>Copie o <strong>Access Token</strong> (começa com <code>APP_USR-</code>) e cole aqui embaixo.</li>
      </ol>
      <label style="display:block; font-size:13px; font-weight:600; margin-top:10px;">Access Token de produção</label>
      <input id="pix-token" type="password" autocomplete="off" placeholder="APP_USR-..." style="width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px; font-size:15px;" />
      <p class="gc-dica">🔒 O token fica guardado criptografado no servidor e nunca mais aparece na tela. Não mande esse código para ninguém.</p>
      <button class="btn-primary" type="button" id="pix-salvar">Conectar Mercado Pago</button>`;
    box.querySelector('#pix-salvar').onclick = async (e) => {
      const btn = e.currentTarget;
      const token = box.querySelector('#pix-token').value.trim();
      if (!token) { showToast('Cole o Access Token.'); return; }
      btn.disabled = true; btn.textContent = 'Conferindo com o Mercado Pago...';
      try {
        const r = await chamar({ acao: 'salvar', token });
        AppState.lojaDados.pixOnline = true;
        showToast('Pix automático ligado! 🎉');
        desenhar({ conectado: true, conta: r.conta });
      } catch (err) {
        showToast(err.message, 6000);
        btn.disabled = false; btn.textContent = 'Conectar Mercado Pago';
      }
    };
  };

  try { desenhar(await chamar({ acao: 'status' })); }
  catch (err) { box.innerHTML = `<p>${esc(err.message)}</p>`; }
}
