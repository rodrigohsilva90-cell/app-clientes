// ============================================================
// UTILS.JS - UTILITÁRIOS, MÁSCARAS, PRIVACIDADE & ATALHOS
// ============================================================

// ------------------------------------------------------------
// 1. DATA E HORA LOCAL SEGURA
// ------------------------------------------------------------
function getTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDate(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setDate(target.getDate() + days);
  const resY = target.getFullYear();
  const resM = String(target.getMonth() + 1).padStart(2, '0');
  const resD = String(target.getDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

// Soma meses mantendo o dia de cobrança: 31/01 + 1 mês = 28/02 (ou 29), e não 03/03.
// fixedDay (opcional) é o dia de cobrança do cliente, para não "escorregar" para o dia 28 para sempre.
function addMonthsToDate(dateString, months, fixedDay) {
  const [y, m, d] = dateString.split('-').map(Number);
  const day = parseInt(fixedDay, 10) || d;
  const total = (m - 1) + (months || 0);
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
window.addMonthsToDate = addMonthsToDate;

// ------------------------------------------------------------
// 2. ESCAPE DE TEXTO (SEGURANÇA XSS)
// ------------------------------------------------------------
// Aceita só links http(s); devolve a URL normalizada ou '' (bloqueia javascript:, data:, etc.)
window.safeHttpUrl = function(value) {
  const v = String(value || '').trim();
  if (!/^https?:\/\//i.test(v)) return '';
  try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : ''; } catch (e) { return ''; }
};

function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ------------------------------------------------------------
// 3. FORMATAÇÃO MONETÁRIA COM SUPORTE A MODO DE PRIVACIDADE
// ------------------------------------------------------------
function formatCurrency(val, privacy) {
  if (privacy) return 'R$ ••••';
  return 'R$ ' + Number(val || 0).toFixed(2).replace('.', ',');
}

// ------------------------------------------------------------
// 4. MÁSCARAS E FORMATAÇÃO DE TELEFONE
// ------------------------------------------------------------
function applyPhoneMask(input) {
  const ev = window.event || {};
  const type = ev.inputType || '';
  const prevDigits = input.dataset.pmDigits || '';
  let raw = input.value;
  let caret = input.selectionStart == null ? raw.length : input.selectionStart;
  let digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;
  let d = raw.replace(/\D/g, '');

  if (type.indexOf('delete') === 0 && d.length && window.formatBrPhoneLocal(d).length > raw.length) {
    // Apagou só um caractere de formatação (-, espaço, parêntese): apaga o número vizinho
    if (type === 'deleteContentForward') {
      d = d.slice(0, digitsBeforeCaret) + d.slice(digitsBeforeCaret + 1);
    } else {
      const k = Math.max(0, digitsBeforeCaret - 1);
      d = d.slice(0, k) + d.slice(k + 1);
      digitsBeforeCaret = k;
    }
  } else if (type === 'insertText' && d.length > 11 && prevDigits.length <= 11) {
    d = prevDigits; digitsBeforeCaret = Math.min(digitsBeforeCaret, d.length); // digitando além do limite
  } else {
    // Colagem (ou autopreenchimento): tira zeros à esquerda e o 55 do Brasil
    const before = d.length;
    d = d.replace(/^0+/, '');
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length > 11) d = d.slice(0, 11);
    if (d.length < before) digitsBeforeCaret = d.length;
  }
  d = d.slice(0, 11);
  digitsBeforeCaret = Math.min(digitsBeforeCaret, d.length);

  const out = window.formatBrPhoneLocal(d);
  input.value = out;
  input.dataset.pmDigits = d;
  // devolve o cursor para depois do mesmo número de dígitos
  let pos = 0, seen = 0;
  while (pos < out.length && seen < digitsBeforeCaret) { if (/\d/.test(out[pos])) seen++; pos++; }
  if (digitsBeforeCaret === d.length) pos = out.length;
  try { input.setSelectionRange(pos, pos); } catch (e) {}
}

function maskPhoneDisplay(phone, privacy) {
  if (!phone) return 'Não informado';
  if (privacy) return '(••) •••••-••••';
  return phone;
}

// ------------------------------------------------------------
// 5. CÓPIA SEGURA PARA A ÁREA DE TRANSFERÊNCIA
// ------------------------------------------------------------
function copyTextSafe(textToCopy, buttonEl, successLabel = "Copiado! ✓") {
  if (!textToCopy) return;
  buzz(25);

  function setTemporaryLabel() {
    if (!buttonEl) return;
    const originalText = buttonEl.textContent;
    buttonEl.textContent = successLabel;
    buttonEl.disabled = true;
    setTimeout(() => {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }, 1800);
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(textToCopy)
      .then(() => setTemporaryLabel())
      .catch(() => fallbackCopy(textToCopy, setTemporaryLabel));
  } else {
    fallbackCopy(textToCopy, setTemporaryLabel);
  }
}

function fallbackCopy(text, callback) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    if (callback) callback();
  } catch (err) {
    console.error("Falha ao copiar:", err);
  }
  document.body.removeChild(textArea);
}

function copyUsernameToClipboard(username, buttonEl) {
  copyTextSafe(username, buttonEl, "Copiado! ✓");
}

// ------------------------------------------------------------
// 6. MODO DE PRIVACIDADE (OCULTAR VALORES E TELEFONES)
// ------------------------------------------------------------
window.togglePrivacyMode = function() {
  isPrivacyMode = !isPrivacyMode;
  localStorage.setItem('user_privacy_mode', isPrivacyMode ? 'true' : 'false');

  const btn = document.getElementById('privacyBtn');
  if (btn) {
    btn.textContent = isPrivacyMode ? '🙈' : '👁️';
    btn.title = isPrivacyMode ? 'Mostrar dados sensíveis' : 'Ocultar dados sensíveis';
  }

  if (typeof renderClients === 'function') renderClients();
  if (typeof updateDashboard === 'function') updateDashboard();
};

// ------------------------------------------------------------
// 7. ABERTURA DIRETA DE WHATSAPP
// ------------------------------------------------------------
// Telefone brasileiro: aceita (11) 91234-5678, 11 91234-5678, 11912345678, +55 11 91234-5678...
// Devolve {ok, full: '5511912345678', local: '11912345678'}
window.normalizeBrPhone = function(input) {
  let d = String(input || '').replace(/\D/g, '').replace(/^0+/, '');
  let local = d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) local = d.slice(2);
  if (local.length !== 10 && local.length !== 11) return { ok: false, full: '', local: '' };
  if (Number(local.slice(0, 2)) < 11) return { ok: false, full: '', local: '' };
  if (local.length === 11 && local[2] !== '9') return { ok: false, full: '', local: '' };
  return { ok: true, full: '55' + local, local };
};

// Formata enquanto digita: (11) 91234-5678
window.formatBrPhoneLocal = function(input) {
  let d = String(input || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? '(' + d : '';
  const rest = d.slice(2);
  const cut = d.length > 10 ? 5 : 4;
  return '(' + d.slice(0, 2) + ') ' + (rest.length > cut ? rest.slice(0, cut) + '-' + rest.slice(cut) : rest);
};

function openWhatsAppDirect(phone, message) {
  if (!phone) return alert("Cliente não possui número de WhatsApp informado.");
  const cleanPhone = phone.replace(/\D/g, '');
  const br = normalizeBrPhone(phone);
  const finalPhone = br.ok ? br.full : (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`);
  const encodedMsg = encodeURIComponent(message);
  const waUrl = `https://api.whatsapp.com/send?phone=${finalPhone}&text=${encodedMsg}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

// ------------------------------------------------------------
// 8. GERADOR DA MENSAGEM DE COBRANÇA
// ------------------------------------------------------------
// ------------------------------------------------------------
// PIX COPIA E COLA (BR Code estático, com valor)
// Só gera quando o tipo da chave é inequívoco (e-mail, chave aleatória, CNPJ ou +55...).
// CPF e celular têm 11 dígitos e se confundem: nesses casos devolve '' e a mensagem usa só a chave.
// ------------------------------------------------------------
window.crc16Pix = function(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};
window.pixKeyForBrCode = function(raw, type) {
  const k = String(raw || '').trim();
  if (!k) return '';
  const digits = k.replace(/\D/g, '');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);
  switch (type) {
    case 'email': return isEmail ? k.toLowerCase() : '';
    case 'random': return isUuid ? k.toLowerCase() : '';
    case 'cpf': return digits.length === 11 ? digits : '';
    case 'cnpj': return digits.length === 14 ? digits : '';
    case 'phone': {
      let d = digits;
      if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
      return (d.length === 10 || d.length === 11) ? '+55' + d : '';
    }
    default:
      if (isEmail) return k.toLowerCase();
      if (isUuid) return k.toLowerCase();
      if (/^\+55\d{10,11}$/.test(k.replace(/[\s().-]/g, ''))) return k.replace(/[\s().-]/g, '');
      if (/^[\d./-]+$/.test(k) && digits.length === 14) return digits;
      return '';
  }
};
window.buildPixBrCode = function(rawKey, amount, merchantName, keyType) {
  const key = pixKeyForBrCode(rawKey, keyType || window.myPixKeyType || 'auto');
  const value = Number(amount);
  if (!key || !(value > 0)) return '';
  const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const clean = (t, n) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, n);
  const account = f('00', 'br.gov.bcb.pix') + f('01', key);
  const body = f('00', '01') + f('01', '11') + f('26', account) + f('52', '0000') + f('53', '986')
    + f('54', value.toFixed(2)) + f('58', 'BR') + f('59', clean(merchantName, 25) || 'RECEBEDOR') + f('60', 'BRASIL')
    + f('62', f('05', '***')) + '6304';
  return body + crc16Pix(body);
};

// Mensagem para o cliente que está testando: pergunta se gostou e já manda o valor e o Pix
function buildTrialMessage(client, pixKey, firstDiscount) {
  const end = Date.parse(client.trialEndsAt || '');
  const over = end && end <= Date.now();
  const d = end ? new Date(end) : null;
  const hm = d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
  const price = Number(client.price || 0);
  const disc = (client.referredBy && firstDiscount > 0 && !client.firstDiscountGiven) ? Math.min(price, firstDiscount) : Math.min(price, Math.max(0, Number(client.pendingDiscount) || 0));
  const total = Math.max(0, price - disc);
  let msg = `Olá, *${client.name}*! Tudo bem? 😊\n\n`;
  msg += hm ? (over ? `Seu teste terminou às *${hm}*. ` : `Seu teste termina às *${hm}*. `) : `Passando para saber do seu teste. `;
  msg += `Deu tudo certo com a imagem e os canais?\n\nSe gostou e quer continuar, a mensalidade é:\n\n`;
  msg += `💵 *Valor:* ${money(price)}\n`;
  if (disc > 0) {
    msg += `🎁 *Desconto de boas-vindas${client.referredBy ? ' (você veio por indicação)' : ''}:* -${money(disc)}\n`;
    msg += `✅ *Na 1ª mensalidade:* ${money(total)}\n`;
  }
  if (pixKey) {
    msg += `\n💳 *Chave Pix:*\n${pixKey}\n`;
    try {
      const code = buildPixBrCode(pixKey, total, (window.currentResellerData || {}).name);
      if (code) msg += `\n📋 *Pix copia e cola (já com o valor):*\n${code}\n`;
    } catch (e) {}
  }
  msg += `\nPagou? Me envie o comprovante por aqui que eu libero na hora! 👍`;
  return msg;
}

// Tom da cobrança pelo que já está no app (histórico de pagamentos e dias de atraso).
// 'ultimo' = vencido há mais de 7 dias; 'firme' = vencido ou 2+ pagamentos atrasados;
// 'fiel' = 6+ pagamentos e nenhum atrasado; 'normal' = o resto.
function chargeToneFor(client, status) {
  const hist = (Array.isArray(client.paymentHistory) ? client.paymentHistory : []).filter(h => h && h.date);
  const late = hist.filter(h => {
    const a = Date.parse(h.date), b = Date.parse(h.prevDueDate || '');
    return a && b && (a - b) / 864e5 > 2;
  }).length;
  if (status.diffDays < -7) return 'ultimo';
  if (status.diffDays < 0 || late >= 2) return 'firme';
  if (hist.length >= 6 && late === 0) return 'fiel';
  return 'normal';
}

function buildChargeMessage(client, dueDateFormatted, status, pixKey, refProgress, introOverride) {
  const isExpired = status.diffDays < 0;
  const tone = chargeToneFor(client, status);
  let msg = '';

  // introOverride: abertura escrita pela IA (só saudação e uma frase). Valor, Pix e portal continuam montados aqui.
  if (introOverride) {
    msg += `${String(introOverride).trim()}\n\n`;
    msg += `📅 *Vencimento:* ${dueDateFormatted} (${status.label})\n\n`;
  } else if (tone === 'ultimo') {
    msg += `⚠️ *ÚLTIMO AVISO DE VENCIMENTO*\n\n`;
    msg += `Olá, *${client.name}*. Tudo bem?\n`;
    msg += `Sua assinatura referente ao login *${client.username}* está vencida desde *${dueDateFormatted}*. Para manter o acesso, pedimos a regularização assim que possível.\n\n`;
  } else if (isExpired) {
    msg += `⚠️ *AVISO DE VENCIMENTO*\n\n`;
    msg += `Olá, *${client.name}*! Tudo bem?\n`;
    msg += `Notamos que sua assinatura referente ao login *${client.username}* venceu em *${dueDateFormatted}* (${status.label}).\n\n`;
  } else if (status.diffDays === 0) {
    msg += `🔔 *LEMBRETE DE VENCIMENTO*\n\n`;
    msg += `Olá, *${client.name}*! Tudo bem?\n`;
    msg += `Passando para lembrar que sua assinatura referente ao login *${client.username}* vence *HOJE* (*${dueDateFormatted}*).\n\n`;
  } else {
    msg += `📅 *LEMBRETE DE ASSINATURA*\n\n`;
    msg += `Olá, *${client.name}*! Tudo bem?\n`;
    msg += `Passando para avisar que sua assinatura referente ao login *${client.username}* vence em *${dueDateFormatted}* (${status.label}).\n\n`;
  }

  if (tone === 'fiel') msg += `💙 Obrigado por estar com a gente há tanto tempo!\n\n`;
  const basePrice = Number(client.price || 0);
  msg += `💵 *Valor da Mensalidade:* R$ ${basePrice.toFixed(2).replace('.', ',')}\n`;

  const credit = Math.min(basePrice, Math.max(0, Number(client.pendingDiscount) || 0));
  if (credit > 0) {
    msg += `🏷️ *Desconto por indicações:* -R$ ${credit.toFixed(2).replace('.', ',')}\n`;
    msg += `✅ *Valor com desconto:* R$ ${Math.max(0, basePrice - credit).toFixed(2).replace('.', ',')}\n`;
  }
  if (refProgress && refProgress.isGoalReached) {
    msg += `🎁 *Meta de indicações atingida!* Você pode escolher *1 MÊS GRÁTIS* ou um *desconto* na mensalidade! 🎉\n`;
  }

  if (refProgress && refProgress.count > 0 && !refProgress.isGoalReached) {
    msg += `🎁 *Indique e Ganhe:* Você tem *${refProgress.count}* amigo(s) indicado(s). Faltam apenas *${Math.max(1, refProgress.goal - refProgress.count)}* para ganhar *1 Mês Grátis*!\n\n`;
  }

  if (pixKey) {
    msg += `\n💳 *Chave Pix:*\n${pixKey}\n`;
    try {
      const code = buildPixBrCode(pixKey, Math.max(0, basePrice - credit), (window.currentResellerData || {}).name);
      if (code) msg += `\n📋 *Pix copia e cola (já com o valor):*\n${code}\n`;
    } catch (e) {}
  }
  try {
    if (client.portalToken && client.portalEnabled !== false && typeof portalLinkFor === 'function') {
      msg += `\n🔗 *Seu portal (vencimento, dados e Pix):*\n${portalLinkFor(client)}\n`;
    }
  } catch (e) {}

  let closing = `Após realizar o pagamento, por favor envie o comprovante por aqui para mantermos seu sinal sempre ativo! 👍`;
  if (tone === 'firme' || tone === 'ultimo') closing = `Depois do pagamento, envie o comprovante por aqui para confirmarmos sua regularização. 👍`;
  if (tone === 'fiel') closing = `Após o pagamento, envie o comprovante por aqui. Obrigado por confiar no nosso serviço! 👍`;
  msg += `\n${closing}`;
  return msg;
}


// ------------------------------------------------------------
// ABRIR LINK EXTERNO (painel do servidor) — funciona em navegador e em PWA/app instalado
// ------------------------------------------------------------
window.normalizePanelUrl = function(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : 'http://' + v.replace(/^\/+/, '');
};

// Deve ser chamada direto de um clique (gesto do usuário). Usa um <a target=_blank>,
// que o Chrome e os apps instalados tratam melhor que window.open com "noopener".
window.openExternalUrl = function(url) {
  const href = window.normalizePanelUrl(url);
  if (!href) return false;
  try {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 300);
    return true;
  } catch (e) {
    try { return !!window.open(href, '_blank'); } catch (e2) { return false; }
  }
};

// ------------------------------------------------------------
// 9. ATALHO: ABRIR PAINEL DO SERVIDOR (MODAL 2)
// ------------------------------------------------------------
window.handleQuickServerClick = function() {
  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];

  if (servers.length === 0) {
    alert("Nenhum servidor cadastrado. Acesse a aba Ajustes para adicionar os seus servidores e URLs de painel.");
    if (typeof switchAppTab === 'function') switchAppTab('settings');
    return;
  }

  // Se houver apenas 1 servidor configurado com URL, abre diretamente
  if (servers.length === 1) {
    const single = servers[0];
    if (single.panelUrl) {
      window.openExternalUrl(single.panelUrl);
      return;
    }
  }

  // Se houver múltiplos servidores (ou se faltar painel no único), abre o modal de escolha
  openQuickPanelsModal();
};

window.openQuickPanelsModal = function() {
  const modal = document.getElementById('quickPanelsModal');
  const listEl = document.getElementById('quickPanelsButtonsList');
  if (!modal || !listEl) return;

  listEl.innerHTML = '';
  const servers = (typeof userServers !== 'undefined' && Array.isArray(userServers)) ? userServers : [];

  servers.forEach(srv => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-tool';
    btn.style.cssText = 'background: #2563eb; padding: 10px; font-size: 0.8rem; text-align: left; font-weight: 700;';
    btn.textContent = `🖥️ Abrir: ${srv.name}`;
    btn.onclick = () => {
      if (!srv.panelUrl) {
        alert(`O servidor "${srv.name}" não possui URL do painel cadastrada na aba Ajustes.`);
        return;
      }
      window.openExternalUrl(srv.panelUrl);
      closeQuickPanelsModal();
    };
    listEl.appendChild(btn);
  });

  modal.style.display = 'flex';
};

window.closeQuickPanelsModal = function() {
  const modal = document.getElementById('quickPanelsModal');
  if (modal) modal.style.display = 'none';
};

// ------------------------------------------------------------
// 11. INICIALIZAÇÃO DE ESTADO LOCAL
// ------------------------------------------------------------
(function initUtilsState() {
  isPrivacyMode = localStorage.getItem('user_privacy_mode') === 'true';
  const privBtn = document.getElementById('privacyBtn');
  if (privBtn) {
    privBtn.textContent = isPrivacyMode ? '🙈' : '👁️';
    privBtn.title = isPrivacyMode ? 'Mostrar dados sensíveis' : 'Ocultar dados sensíveis';
  }

  const savedPix = localStorage.getItem('user_pix_key');
  if (savedPix) myPixKey = savedPix;
})();

// ------------------------------------------------------------
// SERVIDORES: modelo {id, name, dnsIp, dnsUrl, dns, panelUrl, notes, active}
// `dns` é mantido sincronizado (DNS URL, senão DNS IP com http://) para o
// código existente que monta o M3U continuar funcionando.
// ------------------------------------------------------------
window.IPV4_HOST_RE = /^(?:https?:\/\/)?((?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?(?:\/.*)?$/i;

window.isValidIpv4Dns = function(value) {
  const m = String(value || '').trim().match(window.IPV4_HOST_RE);
  if (!m) return false;
  if (!m[1].split('.').every(o => Number(o) >= 0 && Number(o) <= 255)) return false;
  return !m[2] || Number(m[2]) <= 65535;
};

window.isValidUrlDns = function(value) {
  const v = String(value || '').trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    if (!u.hostname || window.isValidIpv4Dns(u.hostname)) return false; // IP vai no campo numérico
    return u.hostname.includes('.') || u.hostname === 'localhost';
  } catch (e) { return false; }
};

window.generateServerId = function() {
  const rnd = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2, 14);
  return 'srv_' + rnd;
};

window.serverDnsLists = function(srv) {
  const ips = Array.isArray(srv && srv.dnsIps) ? srv.dnsIps : (srv && srv.dnsIp ? [srv.dnsIp] : []);
  const urls = Array.isArray(srv && srv.dnsUrls) ? srv.dnsUrls : (srv && srv.dnsUrl ? [srv.dnsUrl] : []);
  return { ips: ips.map(v => String(v).trim()).filter(Boolean), urls: urls.map(v => String(v).trim()).filter(Boolean) };
};

// DNS usado pelo M3U atual (o primeiro URL; senão o primeiro IP com http://)
window.serverDnsForM3u = function(srv) {
  if (!srv) return '';
  const { ips, urls } = window.serverDnsLists(srv);
  if (urls[0]) return urls[0];
  if (ips[0]) return /^https?:\/\//i.test(ips[0]) ? ips[0] : 'http://' + ips[0];
  return (srv.dns || '').trim();
};

// Garante id/campos novos nos servidores antigos ({name, dns, panelUrl}). Não perde nada.
window.normalizeServersList = function(list) {
  let changed = false;
  const out = (Array.isArray(list) ? list : []).map(s => {
    const r = { ...s };
    if (!r.id) { r.id = window.generateServerId(); changed = true; }
    if (!Array.isArray(r.dnsIps) || !Array.isArray(r.dnsUrls)) {
      let ips = r.dnsIp ? [r.dnsIp] : [];
      let urls = r.dnsUrl ? [r.dnsUrl] : [];
      const legacy = (r.dns || '').trim();
      if (!ips.length && !urls.length && legacy) { if (window.isValidIpv4Dns(legacy)) ips = [legacy]; else urls = [legacy]; }
      r.dnsIps = ips; r.dnsUrls = urls; changed = true;
    }
    const first = { ip: r.dnsIps[0] || '', url: r.dnsUrls[0] || '' };
    if ((r.dnsIp || '') !== first.ip) { r.dnsIp = first.ip; changed = true; }
    if ((r.dnsUrl || '') !== first.url) { r.dnsUrl = first.url; changed = true; }
    if (r.active === undefined) { r.active = true; changed = true; }
    if (r.notes === undefined) { r.notes = ''; changed = true; }
    const dns = window.serverDnsForM3u(r);
    if ((r.dns || '') !== dns) { r.dns = dns; changed = true; }
    return r;
  });
  return { list: out, changed };
};

window.findServerForClient = function(client, servers) {
  const list = Array.isArray(servers) ? servers : [];
  const norm = v => String(v || '').trim().toLowerCase();
  return list.find(s => client.serverId && s.id === client.serverId)
    || list.find(s => s.name === client.assignedServer)
    || list.find(s => norm(s.name) && norm(s.name) === norm(client.assignedServer))
    || null;
};


// ------------------------------------------------------------
// COLAR DADOS DO SERVIDOR: extrai nome, IPs, URLs e painel de um texto livre
// ------------------------------------------------------------
window.parseServerPaste = function(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const out = { name: '', ips: [], urls: [], panelUrl: '' };
  const push = (arr, v) => { v = v.trim(); if (v && !arr.includes(v)) arr.push(v); };
  const IPV4 = '(?:\\d{1,3}\\.){3}\\d{1,3}';
  const PANEL_HINT = /(painel|panel|admin|reseller|revend|gerenc|manager|login)/i;
  const cleanUrl = u => u.replace(/[)\].,;:!?'"»]+$/, '');

  const lines = text.split('\n');
  const rest = [];

  lines.forEach(line => {
    let work = line;

    // nome do servidor: "Servidor: X", "Nome: X", "Provedor: X"
    const nm = line.match(/^\s*[\-•*]?\s*(?:servidor|server|nome|name|provedor|provider)\s*[:=\-–]\s*([^\n]+?)\s*$/i);
    if (nm && !out.name && !/https?:\/\//i.test(nm[1]) && !new RegExp('^' + IPV4).test(nm[1])) {
      out.name = nm[1].trim();
      return;
    }

    // URLs completas na linha
    const urls = work.match(/https?:\/\/[^\s<>"'`,;]+/gi) || [];
    urls.forEach(raw => {
      const url = cleanUrl(raw);
      let host = '';
      try { host = new URL(url).hostname; } catch (e) { return; }
      const isIp = new RegExp('^' + IPV4 + '$').test(host);
      if (!isIp && PANEL_HINT.test(line) && !/dns/i.test(line)) { if (!out.panelUrl) out.panelUrl = url; }
      else if (isIp) push(out.ips, url);
      else push(out.urls, url);
      work = work.replace(raw, ' ');
    });

    // IPs soltos (com porta opcional)
    const ipRe = new RegExp('(?<![\\d.])(' + IPV4 + '(?::\\d{2,5})?)(?![\\d.])', 'g');
    let m;
    while ((m = ipRe.exec(work)) !== null) {
      if (window.isValidIpv4Dns(m[1])) push(out.ips, m[1]);
    }
    work = work.replace(ipRe, ' ');

    // domínio solto só quando a linha tem rótulo (dns/url/host/link): "DNS: dns.link.tv:80"
    const lab = work.match(/(?:dns|url|host|link|dominio|domínio)\s*\d*\s*[:=\-–]\s*([a-z0-9][a-z0-9.\-]*\.[a-z]{2,}(?::\d{2,5})?(?:\/\S*)?)/i);
    if (lab) push(out.urls, 'http://' + cleanUrl(lab[1]));
  });

  return out;
};


// Um link M3U para CADA DNS do servidor (URLs primeiro, depois IPs numéricos)
window.buildM3uLinks = function(client, srv) {
  if (!client || !client.username || !srv) return [];
  const { ips, urls } = window.serverDnsLists(srv);
  const out = [], seen = new Set();
  const add = (raw, kind) => {
    const base = (/^https?:\/\//i.test(raw) ? raw : 'http://' + raw).trim().replace(/\/+$/, '');
    if (!base || seen.has(base)) return;
    seen.add(base);
    out.push({
      kind, base,
      url: `${base}/get.php?username=${encodeURIComponent(client.username)}&password=${encodeURIComponent(client.serverPassword || '')}&type=m3u_plus&output=ts`
    });
  };
  urls.forEach(v => add(v, 'URL'));
  ips.forEach(v => add(v, 'IP'));
  if (!out.length && srv.dns) add(srv.dns, 'DNS');
  return out;
};


// ------------------------------------------------------------
// Salvar arquivo: no celular abre o menu de compartilhar (Arquivos/Drive/WhatsApp); no computador baixa direto.
// Evita o "trava" de abrir o blob na mesma tela (PWA instalado).
// ------------------------------------------------------------
window.saveFileSmart = async function(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type });
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
  } catch (e) { /* cai no download normal */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
  return 'download';
};

// Planilha .xlsx de verdade (sem biblioteca): ZIP sem compressão + XML mínimo. rows = array de arrays (texto ou número).
window.buildXlsxBlob = function(rows, sheetName) {
  const enc = new TextEncoder();
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const col = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    const ref = col(ci) + (ri + 1);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (v === '' || v == null) return '';
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const cols = '<cols>' + Array.from({ length: nCols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 28 : 18}" customWidth="1"/>`).join('') + '</cols>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc((sheetName || 'Clientes').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`
  };
  const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  Object.keys(files).forEach(name => {
    const nb = enc.encode(name), data = enc.encode(files[name]), crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0]);
    parts.push(local, nb, data);
    central.push(new Uint8Array([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  });
  const cdSize = central.reduce((n, p) => n + p.length, 0), count = Object.keys(files).length;
  const end = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(count), ...u16(count), ...u32(cdSize), ...u32(offset), 0, 0]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};


// ------------------------------------------------------------
// Aviso rápido que não bloqueia (substitui alert() em copiar/confirmar), vibração e tela ligada
// ------------------------------------------------------------
window.buzz = function(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 25); } catch (e) {} };

window.showToast = function(text, ms) {
  buzz(25);
  const old = document.getElementById('quickToast'); if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'quickToast';
  t.setAttribute('role', 'status');
  t.style.cssText = 'position:fixed; left:50%; transform:translateX(-50%); bottom:calc(84px + env(safe-area-inset-bottom, 0px)); z-index:10070; max-width:86vw; background:#0f172a; color:#f8fafc; border:1px solid #334155; border-radius:999px; padding:9px 16px; font-size:0.82rem; font-weight:600; box-shadow:0 6px 20px rgba(0,0,0,.35); pointer-events:none;';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { if (t.isConnected) t.remove(); }, ms || 2000);
};

// Mantém a tela acesa (fila de cobrança, ativar no aplicativo). Libera ao fechar.
let _wakeLock = null, _wakeWanted = false;
window.wakeLockOn = async function() {
  _wakeWanted = true;
  try { if ('wakeLock' in navigator && !_wakeLock) { _wakeLock = await navigator.wakeLock.request('screen'); _wakeLock.addEventListener('release', () => { _wakeLock = null; }); } } catch (e) {}
};
window.wakeLockOff = function() {
  _wakeWanted = false;
  try { if (_wakeLock) _wakeLock.release(); } catch (e) {}
  _wakeLock = null;
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _wakeWanted && !_wakeLock) wakeLockOn(); });