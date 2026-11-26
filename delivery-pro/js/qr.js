// QR Code sem servidor: biblioteca pequena carregada só quando precisa (qrcode-generator, gratuita).
import { AppState } from './router.js';
import { esc } from './config.js';

const URL_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let carregando = null;
function carregar() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!carregando) carregando = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = URL_LIB; s.async = true;
    s.onload = () => ok(window.qrcode);
    s.onerror = () => { carregando = null; falha(new Error('Não foi possível gerar o QR Code agora (sem internet?).')); };
    document.head.appendChild(s);
  });
  return carregando;
}

// SVG do QR Code (nítido em qualquer tamanho e na impressão)
export async function qrSvg(texto, tamanhoCelula = 6) {
  const qrcode = await carregar();
  const q = qrcode(0, 'M');
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: tamanhoCelula, margin: 2, scalable: true });
}

// Card para imprimir e colar na mesa/balcão: logo, cor e nome da loja + QR do cardápio
export async function abrirQrLoja() {
  const l = AppState.lojaDados || {};
  const link = `${window.location.origin}/${l.slug || AppState.slug || ''}?origem=mesa`;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `<div class="card gc-form" style="max-width:460px; width:100%; margin:0;"><p class="gc-dica">Gerando o QR Code...</p></div>`;
  document.body.appendChild(overlay);
  let svg;
  try { svg = await qrSvg(link, 8); } catch (err) { overlay.querySelector('.card').innerHTML = `<p>${esc(err.message)}</p><button class="btn-outline-sm" data-fechar>Fechar</button>`; overlay.querySelector('[data-fechar]').onclick = () => overlay.remove(); return; }
  overlay.querySelector('.card').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h3>🔳 QR Code para mesa e balcão</h3><button class="btn-outline-sm" type="button" data-fechar>✕</button>
    </div>
    <p class="gc-dica">Imprima e cole no balcão, nas mesas ou na sacola. O cliente aponta a câmera e pede pelo celular (os pedidos chegam marcados como "mesa").</p>
    <div class="qr-cartao" id="qr-cartao" style="--c:${esc(l.corPrimaria || '#ea1d2c')}">
      ${l.logoUrl ? `<img class="qr-logo" src="${esc(l.logoUrl)}" alt="" />` : ''}
      <strong>${esc(l.nome || 'Nossa loja')}</strong>
      <span>Peça pelo celular 📱</span>
      <div class="qr-img">${svg}</div>
      <small>Aponte a câmera do celular</small>
    </div>
    <div style="display:flex; gap:8px; margin-top:12px;">
      <button class="btn-primary" type="button" data-imprimir>🖨 Imprimir</button>
      <button class="btn-outline-sm" type="button" data-copiar>📋 Copiar link</button>
    </div>`;
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();
  overlay.querySelector('[data-copiar]').onclick = async () => { try { await navigator.clipboard.writeText(link); } catch (_) {} };
  overlay.querySelector('[data-imprimir]').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR ${esc(l.nome || '')}</title><style>
      body{font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:24px;margin:0}
      ${document.querySelector('style#qr-estilo') ? '' : ''}
      .qr-cartao{width:320px;border:3px solid ${esc(l.corPrimaria || '#ea1d2c')};border-radius:20px;padding:20px;text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center}
      .qr-logo{width:72px;height:72px;border-radius:50%;object-fit:cover}
      .qr-cartao strong{font-size:22px}.qr-cartao span{font-size:16px}.qr-img svg{width:240px;height:240px}
    </style></head><body>${overlay.querySelector('#qr-cartao').outerHTML}<script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
    w.document.close();
  };
}
