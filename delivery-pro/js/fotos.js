// Envio de fotos do celular/computador do dono: escolhe a imagem, diminui e converte
// para WebP no próprio aparelho (JPEG se o navegador não souber gerar WebP) e manda para o Worker.
import { auth, showToast } from './config.js';
import { AppState } from './router.js';

const LIMITE_BYTES = 440 * 1024;

function escolherArquivo() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files && input.files[0] ? input.files[0] : null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

const paraBlob = (canvas, tipo, qualidade) => new Promise((r) => canvas.toBlob(r, tipo, qualidade));

async function comprimir(arquivo, ladoMax, quadrada) {
  const bmp = await createImageBitmap(arquivo);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (quadrada) { // recorta o centro (logo)
    const lado = Math.min(sw, sh);
    sx = (sw - lado) / 2; sy = (sh - lado) / 2; sw = sh = lado;
  }
  const escala = Math.min(1, ladoMax / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * escala);
  canvas.height = Math.round(sh * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fundo branco para PNG transparente virar JPEG sem ficar preto
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();

  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    let blob = await paraBlob(canvas, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await paraBlob(canvas, 'image/jpeg', q);
    if (blob && blob.size <= LIMITE_BYTES) return blob;
  }
  throw new Error('grande');
}

// Abre a galeria/câmera e devolve o link https da foto enviada (ou null se cancelou/deu erro)
// tipo: 'logo' (quadrada, 512 px) | 'capa' (1600 px) | 'produto' (1000 px)
export async function enviarFoto(tipo = 'produto') {
  const arquivo = await escolherArquivo();
  if (!arquivo) return null;
  if (!/^image\//.test(arquivo.type)) { showToast('Escolha um arquivo de imagem (foto).'); return null; }
  showToast('Preparando a foto...');
  let blob;
  try {
    blob = await comprimir(arquivo, tipo === 'logo' ? 512 : tipo === 'capa' ? 1600 : 1000, tipo === 'logo');
  } catch (err) {
    console.error(err);
    showToast('Não deu para ler essa foto. Tente outra (JPG ou PNG).');
    return null;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(`/api/foto?loja=${encodeURIComponent(AppState.lojaId)}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type, Authorization: `Bearer ${token}` },
      body: blob
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok || !resp.url) { showToast(resp.erro || 'Não foi possível enviar a foto.'); return null; }
    showToast(`Foto enviada (${Math.round(blob.size / 1024)} KB)!`);
    return resp.url;
  } catch (err) {
    console.error(err);
    showToast('Sem conexão para enviar a foto. Tente de novo.');
    return null;
  }
}
