// ============================================================
// WORKER DO PORTAL DO ASSINANTE — GestãoPro
// Cole este arquivo inteiro no editor de um Worker no Cloudflare.
//
// Secrets / variáveis (Settings → Variables and Secrets):
//   FIREBASE_SERVICE_ACCOUNT  (Secret)  JSON completo da conta de serviço do Firebase
//   ALLOWED_ORIGIN            (Texto)   https://muddy-cake-74a0.rodrigo-h-silva90.workers.dev
//   TZ_NAME                   (Texto, opcional) padrão: America/Sao_Paulo
//   PIN_KV                    (KV Namespace, opcional, recomendado) guarda as tentativas
//                             erradas de PIN entre todas as instâncias do Worker.
//                             Settings → Bindings → KV Namespace → nome da variável: PIN_KV
//
// O navegador do cliente nunca fala com o Firestore: este Worker valida o
// token (comparando o hash SHA-256), lê os dados ATUAIS e devolve só o que
// o administrador liberou em Ajustes → Portal do Assinante.
// ============================================================

let tokenCache = { value: null, exp: 0 };
let saCache = { raw: null, value: null };

// Lê a conta de serviço uma vez só (antes era feito o JSON.parse a cada consulta)
function serviceAccount(env) {
  if (saCache.raw !== env.FIREBASE_SERVICE_ACCOUNT) {
    saCache = { raw: env.FIREBASE_SERVICE_ACCOUNT, value: JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) };
  }
  return saCache.value;
}

const enc = new TextEncoder();
const b64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const strB64url = (s) => b64url(enc.encode(s));

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && tokenCache.exp - 60 > now) return tokenCache.value;

  const sa = serviceAccount(env);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = strB64url(JSON.stringify(header)) + '.' + strB64url(JSON.stringify(claim));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const assertion = unsigned + '.' + b64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error('oauth_failed');
  const data = await res.json();
  tokenCache = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.value;
}

function decodeValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decodeValue(fields[k]);
  return out;
}

async function getDoc(env, path) {
  const sa = serviceAccount(env);
  const token = await getAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore_' + res.status);
  const doc = await res.json();
  return decodeFields(doc.fields || {});
}

// Clientes indicados por este cliente (gravados por id no cadastro). Consulta só pelo dono + id do indicador.
async function countReferred(env, ownerId, clientId) {
  const sa = serviceAccount(env);
  const token = await getAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'clients' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'ownerId' }, op: 'EQUAL', value: { stringValue: ownerId } } },
        { fieldFilter: { field: { fieldPath: 'referredById' }, op: 'EQUAL', value: { stringValue: clientId } } },
      ] } },
      limit: 200,
    } }),
  });
  if (!res.ok) throw new Error('firestore_query_' + res.status);
  const rows = await res.json();
  let n = 0;
  for (const r of rows) {
    if (!r.document) continue;
    const f = decodeFields(r.document.fields || {});
    if (f.isArchived === true || f.isDeleted === true) continue; // mesma regra do app: arquivado/excluído não conta
    n++;
  }
  return n;
}

// Garante o 55 na frente (números salvos antes só com DDD + número)
function brFull(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

function todayInTz(tz) {
  // YYYY-MM-DD no fuso do negócio
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function diffDaysFrom(today, due) {
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = due.split('-').map(Number);
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

// Tentativas erradas de PIN por link. Com o KV (PIN_KV) o limite vale para todas as instâncias do Worker;
// sem o KV fica só na memória da instância (mais fraco: some quando o Worker reinicia).
const PIN_FAILS = new Map();
const PIN_MAX_FAILS = 5;
const PIN_WINDOW_S = 30 * 60; // 30 minutos

async function pinFailsGet(env, hash) {
  if (env.PIN_KV) {
    try { const v = await env.PIN_KV.get('pin:' + hash, 'json'); if (v) return v; } catch (e) {}
    return { n: 0, at: Date.now() };
  }
  const f = PIN_FAILS.get(hash) || { n: 0, at: Date.now() };
  if (Date.now() - f.at > PIN_WINDOW_S * 1000) return { n: 0, at: Date.now() };
  return f;
}
async function pinFailsSet(env, hash, f) {
  if (env.PIN_KV) {
    try { await env.PIN_KV.put('pin:' + hash, JSON.stringify(f), { expirationTtl: PIN_WINDOW_S }); } catch (e) {}
    return;
  }
  PIN_FAILS.set(hash, f);
}
async function pinFailsClear(env, hash) {
  if (env.PIN_KV) { try { await env.PIN_KV.delete('pin:' + hash); } catch (e) {} return; }
  PIN_FAILS.delete(hash);
}


// ---------- Pix copia e cola (BR Code estático com valor) ----------
function crc16Pix(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
// type: auto | phone | cpf | cnpj | email | random. Em "auto" só aceita o que não gera dúvida (CPF e celular de 11 dígitos ficam de fora).
function pixKeyNormalized(raw, type) {
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
}
function buildPixPayload(rawKey, type, amount, merchantName) {
  const key = pixKeyNormalized(rawKey, type);
  const value = Number(amount);
  if (!key || !(value > 0)) return '';
  const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const clean = (t, n) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, n);
  const account = f('00', 'br.gov.bcb.pix') + f('01', key);
  const body = f('00', '01') + f('01', '11') + f('26', account) + f('52', '0000') + f('53', '986')
    + f('54', value.toFixed(2)) + f('58', 'BR') + f('59', clean(merchantName, 25) || 'RECEBEDOR') + f('60', 'BRASIL')
    + f('62', f('05', '***')) + '6304';
  return body + crc16Pix(body);
}

const DEFAULT_PORTAL = {
  showUser: true, showPassword: true, showMac: true, showDnsIp: true, showDnsUrl: true,
  showM3u: true, showFinance: true, showTutorials: true, showWhatsapp: true, showReferral: true, brandName: '',
};

function json(env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Vary': 'Origin',
    },
  });
}

// Registra que o cliente abriu o portal (último acesso + contador).
// Não conta recarregamentos seguidos: ignora < 5 min e só soma 1 visita a cada 30 min.
async function recordAccess(env, clientId, prevIso) {
  const sa = serviceAccount(env);
  const token = await getAccessToken(env);
  const now = Date.now();
  const prev = prevIso ? Date.parse(prevIso) : 0;
  const gap = prev ? now - prev : Infinity;
  if (gap < 5 * 60 * 1000) return;
  const name = `projects/${sa.project_id}/databases/(default)/documents/clients/${clientId}`;
  const write = {
    update: { name, fields: { portalLastAccess: { timestampValue: new Date(now).toISOString() } } },
    updateMask: { fieldPaths: ['portalLastAccess'] },
    currentDocument: { exists: true },
  };
  if (gap >= 30 * 60 * 1000) write.updateTransforms = [{ fieldPath: 'portalAccessCount', increment: { integerValue: '1' } }];
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [write] }),
  });
  if (!res.ok) console.warn('recordAccess falhou', res.status);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Portal-Pin',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'GET') return json(env, { error: 'method' }, 405);

    const url = new URL(request.url);
    const t = url.searchParams.get('t') || '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(t)) return json(env, { error: 'not_found' }, 404);

    try {
      const hash = await sha256Hex(t);
      const tdoc = await getDoc(env, `portal_tokens/${hash}`);
      if (!tdoc) return json(env, { error: 'not_found' }, 404);
      if (tdoc.active !== true) return json(env, { error: 'disabled' }, 403);

      // cliente e configurações em paralelo (menos espera)
      const [client, settingsDoc, referredCount] = await Promise.all([
        getDoc(env, `clients/${tdoc.clientId}`),
        getDoc(env, `settings/${tdoc.ownerId}`),
        countReferred(env, tdoc.ownerId, tdoc.clientId).catch(() => 0),
      ]);
      // o cliente precisa pertencer ao mesmo dono do token (impede cruzar dados); excluído = link morto
      if (!client || client.ownerId !== tdoc.ownerId || client.isDeleted === true) return json(env, { error: 'not_found' }, 404);

      const settings = settingsDoc || {};
      const ps = { ...DEFAULT_PORTAL, ...(settings.portalSettings || {}) };

      // PIN opcional: últimos 4 dígitos do telefone do cliente
      if (ps.requirePin === true) {
        const phoneDigits = String(client.phone || '').replace(/\D/g, '');
        if (phoneDigits.length < 4) return json(env, { error: 'pin_unavailable' }, 403);
        const fails = await pinFailsGet(env, hash);
        if (fails.n >= PIN_MAX_FAILS) return json(env, { error: 'too_many' }, 429);
        const given = String(request.headers.get('x-portal-pin') || '').replace(/\D/g, '');
        if (!given) return json(env, { error: 'pin_required' }, 401);
        if (given !== phoneDigits.slice(-4)) {
          await pinFailsSet(env, hash, { n: fails.n + 1, at: fails.at || Date.now() });
          return json(env, { error: 'pin_wrong' }, 401);
        }
        if (fails.n) await pinFailsClear(env, hash);
      }

      // visita do próprio administrador (a=1) não conta como acesso do cliente
      if (url.searchParams.get('a') !== '1') {
        const rec = recordAccess(env, tdoc.clientId, client.portalLastAccess).catch(() => {});
        if (ctx && ctx.waitUntil) ctx.waitUntil(rec);
      }

      const servers = Array.isArray(settings.servers) ? settings.servers : [];
      const srv = servers.find((s) => client.serverId && s.id === client.serverId)
        || servers.find((s) => s.name === client.assignedServer) || null;

      const tz = env.TZ_NAME || 'America/Sao_Paulo';
      const diffDays = client.dueDate ? diffDaysFrom(todayInTz(tz), client.dueDate) : null;

      // Estados: bloqueado ≠ atrasado ≠ arquivado
      let state = 'ok';
      let label = 'Ativo';
      if (client.isBlocked) { state = 'blocked'; label = 'Bloqueado'; }
      else if (client.isArchived) { state = 'inactive'; label = 'Inativo'; }
      else if (diffDays === null) { state = 'expired'; label = 'Sem vencimento'; }
      else if (diffDays < 0) { state = 'expired'; label = `Vencido há ${Math.abs(diffDays)} dia(s)`; }
      else if (diffDays <= 3) { state = 'warning'; label = diffDays === 0 ? 'Vence hoje' : (diffDays === 1 ? 'Vence amanhã' : `Vence em ${diffDays} dias`); }

      const digits = brFull(settings.supportWhatsapp);
      const body = {
        ok: true,
        updatedAt: new Date().toISOString(),
        brand: ps.brandName || 'Portal do Assinante',
        client: { name: client.name || '' },
        subscription: {
          state, label,
          price: Number(client.price) || 0,
          dueDate: client.dueDate || '',
          diffDays,
          hasPending: Boolean(client.hasPending),
        },
        support: (ps.showWhatsapp && digits) ? { whatsapp: digits } : null,
        access: null, server: null, dns: null, m3u: [], finance: null, tutorials: null,
      };

      // Cliente bloqueado: nada de credenciais, DNS ou M3U
      if (state !== 'blocked') {
        const access = { app: client.macApp || '' };
        if (ps.showUser) access.username = client.username || '';
        if (ps.showPassword && client.serverPassword) access.password = client.serverPassword;
        if (ps.showMac && client.macAddress) access.mac = client.macAddress;
        body.access = access;

        if (!srv) {
          body.server = { name: '', active: false, message: 'Seu servidor ainda não foi configurado. Fale com o suporte.' };
        } else if (srv.active === false) {
          body.server = { name: srv.name, active: false, message: 'Este servidor está temporariamente indisponível. Fale com o suporte.' };
        } else {
          body.server = { name: srv.name, active: true, message: '' };
          // Junta tudo que o servidor tem e separa pelo tipo REAL do endereço
          // (IP numérico x nome de domínio), mesmo que esteja no campo errado.
          const raw = [
            ...(Array.isArray(srv.dnsIps) ? srv.dnsIps : (srv.dnsIp ? [srv.dnsIp] : [])),
            ...(Array.isArray(srv.dnsUrls) ? srv.dnsUrls : (srv.dnsUrl ? [srv.dnsUrl] : [])),
          ];
          if (!raw.length && srv.dns) raw.push(srv.dns);
          const withScheme = (v) => (/^https?:\/\//i.test(v) ? v : 'http://' + v);
          const isIpHost = (v) => /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[\/?#]|$)/i.test(withScheme(v));
          const seen = new Set();
          const ips = [], urls = [];
          raw.map((v) => String(v || '').trim()).filter(Boolean).forEach((v) => {
            const key = withScheme(v).replace(/\/+$/, '').toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            (isIpHost(v) ? ips : urls).push(v);
          });
          body.dns = { ips: ps.showDnsIp ? ips : [], urls: ps.showDnsUrl ? urls : [] };

          // Um link M3U para CADA DNS (numérico e por URL).
          // O link carrega usuário E senha: só sai se os dois estiverem liberados no portal,
          // senão a senha escondida apareceria dentro do link.
          if (ps.showM3u && ps.showUser && ps.showPassword && client.username && client.serverPassword) {
            const mk = (v, kind) => {
              const base = withScheme(v).replace(/\/+$/, '');
              return {
                kind,
                host: base.replace(/^https?:\/\//i, ''),
                base,
                url: `${base}/get.php?username=${encodeURIComponent(client.username)}&password=${encodeURIComponent(client.serverPassword)}&type=m3u_plus&output=ts`,
              };
            };
            body.m3u = [...urls.map((v) => mk(v, 'url')), ...ips.map((v) => mk(v, 'ip'))];
          }
        }

        if (ps.showFinance) {
          // valor do Pix = mensalidade menos o desconto de indicações acumulado (igual à mensagem de cobrança)
          const price = Number(client.price) || 0;
          const discount = Math.min(price, Math.max(0, Number(client.pendingDiscount) || 0));
          const amount = Math.round((price - discount) * 100) / 100;
          const payload = buildPixPayload(settings.pixKey, settings.pixKeyType || 'auto', amount, ps.brandName || '');
          body.finance = { pixKey: settings.pixKey || '', pixPayload: payload, pixAmount: payload ? amount : 0 };
        }
        const goal = parseInt(settings.referralGoal, 10) || 0;
        if (ps.showReferral !== false && goal > 0 && client.isBlocked !== true && client.referralOptOut !== true) {
          const redeemed = parseInt(client.referralsRedeemed || 0, 10) || 0;
          const available = Math.max(0, referredCount - redeemed);
          body.referral = {
            count: available,
            goal,
            goalReached: available >= goal,
            discountValue: Number(settings.referralDiscount) || 0,
            firstDiscount: Math.max(0, Number(settings.referralFirstDiscount) || 0),
            pendingDiscount: Math.max(0, Number(client.pendingDiscount) || 0),
          };
        }
        if (ps.showTutorials) {
          const all = Array.isArray(settings.portalTutorials) ? settings.portalTutorials : [];
          const app = String(client.macApp || '').toLowerCase();
          body.tutorials = all.filter((x) => x && (!x.app || (app && app.includes(String(x.app).toLowerCase()))));
        }
      } else if (ps.showFinance) {
        body.finance = null;
      }

      return json(env, body);
    } catch (e) {
      console.error('portal', e && e.message);
      return json(env, { error: 'unavailable' }, 502);
    }
  },
};