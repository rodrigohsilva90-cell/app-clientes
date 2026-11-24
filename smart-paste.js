// ============================================================
// SMART-PASTE.JS - COLAGEM INTELIGENTE & OCR DE FOTO DA TV
// ============================================================

window.toggleSmartPasteBox = function() {
  const content = document.getElementById('smartPasteContent');
  if (!content) return;
  const isHidden = content.style.display === 'none' || content.style.display === '';
  content.style.display = isHidden ? 'block' : 'none';
};

// Cadastro por texto livre. Aceita o texto que o servidor manda OU uma frase sua, separada por vírgula ou linha.
// Ex.: "João Silva, usuário joao1, senha 123, vence dia 15, R$ 35, (11) 91234-5678, servidor Alpha, app Quick Player"
// Tudo roda no aparelho. Nada disso vai para a IA.
const spNorm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

window.parseSmartText = function(raw, opts) {
  const o = opts || {};
  const text = String(raw || '').replace(/\r/g, '');
  const out = { name: '', username: '', password: '', dueDate: '', price: '', phone: '', server: '', app: '' };
  const segs = text.split(/[\n;|]+|,(?!\d)/).map(s => s.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
  const now = o.today instanceof Date ? o.today : new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  segs.forEach(seg => {
    let m;
    if (!out.username && (m = seg.match(/(?:usu[aá]rio|login|user)\s*[:=\-]?\s*(\S+)/i))) out.username = m[1].replace(/[.,;:!]+$/, '');
    if (!out.password && (m = seg.match(/(?:senha|password|pass)\s*[:=\-]?\s*(\S+)/i))) out.password = m[1].replace(/[.,;:!]+$/, '');
    if (!out.name && (m = seg.match(/^(?:cliente|nome|name)\s*[:=\-]?\s*(.+)$/i))) out.name = m[1].trim();
    if (!out.server && (m = seg.match(/^(?:servidor|server|provedor)\s*[:=\-]?\s*(.+)$/i))) out.server = m[1].trim();
    if (!out.app && (m = seg.match(/^(?:app|aplicativo)\s*[:=\-]?\s*(.+)$/i))) out.app = m[1].trim();
    const pm = seg.match(/R\$\s*(\d+(?:[.,]\d{1,2})?)/i) || seg.match(/(\d+(?:[.,]\d{1,2})?)\s*reais?/i) || seg.match(/(?:valor|pre[cç]o|mensalidade)\s*[:=]?\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (!out.price && pm) out.price = pm[1].replace(',', '.');
    if (!out.phone && !/senha|password|\bpass\b/i.test(seg)) {
      const ph = seg.match(/(?:\+?55\s?)?\(?(\d{2})\)?\s?(9?\d{4})[\s-]?(\d{4})\b/);
      if (ph) out.phone = ph[1] + ph[2] + ph[3];
    }
  });

  // Vencimento: data completa, data ISO, "em N dias" ou "dia N" (próximo dia N, no mês atual ou no seguinte)
  let due = null;
  let dm = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dm) due = new Date(+dm[3], +dm[2] - 1, +dm[1]);
  if (!due && (dm = text.match(/(\d{4})-(\d{2})-(\d{2})/))) due = new Date(+dm[1], +dm[2] - 1, +dm[3]);
  if (!due && (dm = text.match(/(?:em|daqui a)\s*(\d{1,3})\s*dias?/i))) due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (+dm[1]));
  if (!due && (dm = text.match(/\b(?:dia|vence|vencimento)\s+(?:dia\s+)?(\d{1,2})\b/i))) {
    const d = +dm[1];
    if (d >= 1 && d <= 31) {
      const y = now.getFullYear(), mo = now.getMonth();
      const lastThis = new Date(y, mo + 1, 0).getDate();
      due = d >= now.getDate() ? new Date(y, mo, Math.min(d, lastThis)) : new Date(y, mo + 1, Math.min(d, new Date(y, mo + 2, 0).getDate()));
    }
  }
  if (due && !isNaN(due.getTime())) out.dueDate = ymd(due);

  // Nome sem rótulo: primeiro trecho curto, só letras, sem palavras do cadastro
  if (!out.name) {
    const cand = segs.find(s => /^[\p{L}][\p{L} .'-]{2,60}$/u.test(s) && s.split(/\s+/).length <= 5 && !/\b(usuario|login|senha|pass|vence|vencimento|valor|preco|servidor|server|app|aplicativo|dia|reais|mac|cliente|nome)\b/.test(spNorm(s)));
    if (cand) out.name = cand;
  }

  // Servidor e aplicativo por nome conhecido no texto (o nome mais longo ganha)
  const lower = spNorm(text);
  if (!out.server && o.servers) {
    const hit = o.servers.filter(s => s && lower.includes(spNorm(s))).sort((a, b) => b.length - a.length)[0];
    if (hit) out.server = hit;
  }
  if (!out.app && o.apps) {
    const hit = o.apps.filter(s => s && lower.includes(spNorm(s))).sort((a, b) => b.length - a.length)[0];
    if (hit) out.app = hit;
  }
  return out;
};

window.applySmartPaste = function() {
  const inputEl = document.getElementById('smartPasteInput');
  if (!inputEl) return;
  const text = inputEl.value;
  if (!text.trim()) return alert("Escreva ou cole os dados do cliente antes de continuar.");

  const serverOpts = Array.from(document.querySelectorAll('#clientAssignedServer option')).map(o => o.textContent.trim()).filter(Boolean);
  // #clientMacApp é campo de texto (sem <option>): a lista vem dos portais conhecidos + apps personalizados
  const appOpts = (typeof appPortalsList === 'function')
    ? appPortalsList().map(p => p.name).filter(Boolean)
    : Array.from(document.querySelectorAll('#clientMacApp option')).map(o => (o.value || '').trim()).filter(Boolean);
  const r = window.parseSmartText(text, { servers: serverOpts, apps: appOpts });
  const filled = [];
  const set = (id, val, label) => { const el = document.getElementById(id); if (el && val) { el.value = val; filled.push(label); } };

  if (r.name) { const nField = document.getElementById('name'); if (nField && !nField.value) { nField.value = r.name; filled.push('nome'); } }
  set('username', r.username, 'usuário');
  set('serverPassword', r.password, 'senha');
  set('dueDate', r.dueDate, 'vencimento');
  set('price', r.price, 'valor');
  if (r.phone) {
    const pf = document.getElementById('phone');
    if (pf) { pf.value = window.formatBrPhoneLocal ? window.formatBrPhoneLocal(r.phone) : r.phone; filled.push('WhatsApp'); }
  }
  const macMatch = text.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
  if (macMatch) set('clientMacAddress', macMatch[0].toUpperCase(), 'MAC');
  if (r.server) {
    const sel = document.getElementById('clientAssignedServer');
    const opt = sel && Array.from(sel.options).find(o => spNorm(o.textContent) === spNorm(r.server));
    if (opt) { sel.value = opt.value; filled.push('servidor'); }
  }
  set('clientMacApp', r.app, 'aplicativo');

  if (!filled.length) return alert("Não achei dados de cadastro no texto. Tente assim: João Silva, usuário joao1, senha 123, vence dia 15, R$ 35, WhatsApp (11) 91234-5678.");
  alert(`🪄 Preenchi ${filled.length} campo(s): ${filled.join(', ')}. Confira antes de salvar.`);
  inputEl.value = '';
  toggleSmartPasteBox();
};

window.handleTvPhotoOcr = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusMsg = document.getElementById('ocrStatusMsg');
  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.textContent = '🔍 Lendo foto com OCR, aguarde...';
  }

  try {
    if (typeof Tesseract === 'undefined') {
      // Carrega o OCR só quando alguém usa a foto (economiza dados no app inteiro)
      await new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js';
        sc.crossOrigin = 'anonymous';
        sc.onload = resolve;
        sc.onerror = () => reject(new Error('Não foi possível baixar o leitor de fotos. Verifique a internet.'));
        document.head.appendChild(sc);
      });
    }

    const result = await Tesseract.recognize(file, 'eng');
    const extractedText = result.data.text;

    const macMatch = extractedText.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
    const macInput = document.getElementById('clientMacAddress');

    if (macMatch && macInput) {
      // O OCR confunde 0/O e 8/B: o usuário confere e corrige antes de gravar
      const typed = prompt('MAC lido da foto. Confira com atenção (0 e O, 8 e B se confundem) e corrija se precisar:', macMatch[0].toUpperCase());
      if (typed && typed.trim()) macInput.value = typed.trim().toUpperCase();
    } else {
      alert("Não foi possível identificar o endereço MAC nitidamente na foto. Tente tirar uma foto mais aproximada e iluminada.");
    }
  } catch (err) {
    alert("Erro na leitura OCR: " + err.message);
  } finally {
    if (statusMsg) statusMsg.style.display = 'none';
    event.target.value = '';
  }
};