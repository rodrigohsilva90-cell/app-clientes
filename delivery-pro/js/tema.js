// Tema da loja: cor principal com texto de contraste automático (WCAG), modo escuro e
// cache local para a cor aparecer na hora (sem piscar o vermelho padrão).
const HEX = /^#[0-9a-f]{6}$/i;

const canais = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function luminancia(hex) {
  const [r, g, b] = canais(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// Texto dos botões: branco ou grafite, o que der mais contraste com a cor escolhida
export const textoSobre = (hex) => (contraste(hex, '#ffffff') >= contraste(hex, '#111827') ? '#ffffff' : '#111827');
function misturar(hex, alvo, t) {
  const a = canais(hex), b = canais(alvo);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
// Modo escuro: clareia a cor até ter contraste 4.5:1 com o fundo escuro (texto/ícones coloridos legíveis)
function ajustarParaEscuro(hex) {
  let c = hex;
  for (let i = 0; i < 10 && contraste(c, '#111827') < 4.5; i++) c = misturar(c, '#ffffff', 0.15);
  return c;
}

export const PALETAS = [
  { nome: 'Pizzaria clássica', cor: '#c0392b', escuro: false },
  { nome: 'Hamburgueria', cor: '#f97316', escuro: true },
  { nome: 'Açaí', cor: '#7e22ce', escuro: false },
  { nome: 'Sushi', cor: '#dc2626', escuro: true },
  { nome: 'Farmácia', cor: '#1d4ed8', escuro: false },
  { nome: 'Adega', cor: '#ca8a04', escuro: true }
];

export function aplicarTema(loja, slug) {
  const cor = HEX.test((loja && loja.corPrimaria) || '') ? loja.corPrimaria : '#ea1d2c';
  const escuro = Boolean(loja && loja.modoEscuro);
  const principal = escuro ? ajustarParaEscuro(cor) : cor;
  const raiz = document.documentElement;
  raiz.style.setProperty('--primary', principal);
  raiz.style.setProperty('--primary-dark', misturar(principal, '#000000', 0.15));
  raiz.style.setProperty('--primary-text', textoSobre(principal));
  raiz.classList.toggle('tema-escuro', escuro);
  document.getElementById('meta-theme-color')?.setAttribute('content', principal);
  if (slug) { try { localStorage.setItem(`tema_${slug}`, JSON.stringify({ c: principal, t: textoSobre(principal), d: misturar(principal, '#000000', 0.15), e: escuro })); } catch (_) {} }
}
