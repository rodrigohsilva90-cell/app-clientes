// Cadastro do dono da loja (teste grátis de 7 dias).
// 1) cria o login (e-mail e senha escolhidos pelo dono) no Firebase Auth
// 2) o Worker confere o login e cria loja, link (slug), equipe e perfil de uma vez só
import { auth, showToast, esc } from './config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { VERSAO_TERMOS } from './termos.js';

// "Pizzaria do Zé!" -> "pizzaria-do-ze"
export function sugerirSlug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

const MENSAGENS_AUTH = {
  'auth/email-already-in-use': 'Esse e-mail já tem conta. Use "Entrar" ou outro e-mail.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/operation-not-allowed': 'Cadastro por e-mail desativado no Firebase (Authentication → E-mail/senha).',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.'
};

// Representante comercial que indicou (link ?ref=..., válido por 30 dias)
function parceiroIndicacao() {
  try {
    const r = JSON.parse(localStorage.getItem('saas_parceiro_ref') || 'null');
    return r && r.expiraEm > Date.now() ? String(r.parceiroId).slice(0, 40) : null;
  } catch (_) { return null; }
}

export function abrirCadastroLoja() {
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px; font-size:15px;';
  const rotulo = 'display:block; font-size:13px; font-weight:600;';
  const origem = window.location.origin;
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card" style="max-width:440px; width:100%; max-height:94vh; overflow-y:auto; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>🚀 Criar minha loja</h3>
        <button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>
      <p class="gc-dica" style="margin-bottom:12px;">7 dias grátis com tudo liberado. Sem cartão de crédito.</p>

      <label style="${rotulo}">Seu nome</label>
      <input name="nomeDono" maxlength="60" required placeholder="Ex: José da Silva" style="${campo}" />

      <label style="${rotulo}">O que você vende?</label>
      <div class="cad-tipos">
        <label class="cad-tipo"><input type="radio" name="tipo" value="gastronomia" checked /><span><strong>🍕 Comida</strong><small>Restaurante, lanchonete, pizzaria, açaí, marmita</small></span></label>
        <label class="cad-tipo"><input type="radio" name="tipo" value="varejo" /><span><strong>🛍️ Loja</strong><small>Roupa, sapato, mercadinho, farmácia, pet shop, presentes</small></span></label>
      </div>

      <label style="${rotulo}">Nome da loja</label>
      <input name="nomeLoja" maxlength="60" required placeholder="Ex: Pizzaria do Zé" style="${campo}" />

      <label style="${rotulo}">Endereço do seu cardápio</label>
      <div class="cad-slug">
        <span>${esc(origem.replace(/^https?:\/\//, ''))}/</span>
        <input name="slug" maxlength="30" required placeholder="pizzaria-do-ze" />
      </div>
      <p class="gc-dica">Só letras minúsculas, números e traço. É o link que você vai mandar para os clientes.</p>

      <label style="${rotulo}">WhatsApp da loja (com DDD)</label>
      <input name="whatsapp" type="tel" required placeholder="11999999999" style="${campo}" />

      <label style="${rotulo}">Seu e-mail (para entrar no painel)</label>
      <input name="email" type="email" required autocomplete="username" placeholder="voce@email.com" style="${campo}" />

      <label style="${rotulo}">Crie uma senha</label>
      <input name="senha" type="password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 caracteres" style="${campo}" />

      <label style="${rotulo}">Repita a senha</label>
      <input name="senha2" type="password" required autocomplete="new-password" style="${campo}" />

      <label class="gc-check cad-aceite"><input type="checkbox" name="aceite" required /> <span>Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>
      <button class="btn-primary" type="submit" style="margin-top:10px;">Criar loja grátis</button>
      <p class="gc-dica" style="text-align:center; margin-top:10px;">A plataforma é apenas a tecnologia; as vendas, a entrega e a equipe são da sua loja.</p>
    </form>
  `;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();

  // Sugere o link a partir do nome da loja (até o dono mexer no campo)
  let slugEditado = false;
  form.nomeLoja.oninput = () => { if (!slugEditado) form.slug.value = sugerirSlug(form.nomeLoja.value); };
  form.slug.oninput = () => { slugEditado = true; form.slug.value = sugerirSlug(form.slug.value); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
      nomeDono: form.nomeDono.value.trim(),
      nomeLoja: form.nomeLoja.value.trim(),
      slug: sugerirSlug(form.slug.value),
      whatsapp: form.whatsapp.value.replace(/\D/g, ''),
      tipo: form.tipo.value === 'varejo' ? 'varejo' : 'gastronomia',
      parceiroRef: parceiroIndicacao(),
      aceiteTermos: form.aceite.checked ? VERSAO_TERMOS : null
    };
    const email = form.email.value.trim();
    const senha = form.senha.value;

    if (dados.nomeDono.length < 2) return showToast('Informe seu nome.');
    if (dados.nomeLoja.length < 2) return showToast('Informe o nome da loja.');
    if (dados.slug.length < 3) return showToast('O endereço do cardápio precisa ter pelo menos 3 letras.');
    if (dados.whatsapp.length < 10) return showToast('Informe o WhatsApp com DDD.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return showToast('Informe um e-mail válido.');
    if (senha.length < 6) return showToast('A senha precisa ter pelo menos 6 caracteres.');
    if (senha !== form.senha2.value) return showToast('As senhas não são iguais.');
    if (!form.aceite.checked) return showToast('Para criar a loja, marque que leu e aceita os Termos de Uso e a Política de Privacidade.', 5000);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Criando sua loja...';
    try {
      // Se uma tentativa anterior já criou o login (ex.: link já usado), reaproveita
      if (!auth.currentUser || auth.currentUser.email !== email) {
        try {
          await createUserWithEmailAndPassword(auth, email, senha);
        } catch (err) {
          if (err.code === 'auth/email-already-in-use') {
            // Pode ser o próprio dono tentando de novo: entra com a senha informada
            await signInWithEmailAndPassword(auth, email, senha);
          } else throw err;
        }
      }
      const token = await auth.currentUser.getIdToken();
      const resp = await fetch('/api/lojas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(dados)
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(r.erro || 'Não foi possível criar a loja. Tente novamente.', 6000);
        if (r.campo === 'slug') form.slug.focus();
        return;
      }
      showToast(r.jaExistia ? 'Você já tem uma loja. Abrindo o painel...' : '🎉 Loja criada! Abrindo seu painel...');
      window.location.href = `/${r.slug}/painel`;
    } catch (err) {
      console.error(err);
      showToast(MENSAGENS_AUTH[err.code] || 'Erro ao criar a conta. Tente novamente.', 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Criar loja grátis';
    }
  };
}
