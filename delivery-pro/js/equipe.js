// Tela "Equipe" do dono: lista, adiciona e remove balcão, cozinha e entregadores.
// Quem cria os logins é o Worker (/api/equipe), depois de conferir que o pedido vem do dono.
import { db, auth, showToast, esc } from './config.js';
import { AppState } from './router.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FUNCOES = {
  balcao: { nome: 'Balcão', icone: '🧾', dica: 'Pedidos, caixa e pedido de balcão' },
  cozinha: { nome: 'Cozinha', icone: '🍳', dica: 'Só a tela da cozinha, sem valores' },
  entregador: { nome: 'Entregador', icone: '🛵', dica: 'App do motoboy com GPS' },
  dono: { nome: 'Dono', icone: '👑', dica: 'Acesso completo' }
};

async function chamarApi(corpo) {
  const token = await auth.currentUser.getIdToken();
  const resp = await fetch('/api/equipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ lojaId: AppState.lojaId, slug: AppState.slug, ...corpo })
  });
  const r = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(r.erro || 'Não foi possível concluir. Tente novamente.');
  return r;
}

export function abrirEquipe() {
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px; font-size:15px;';
  const rotulo = 'display:block; font-size:13px; font-weight:600;';
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <div class="card" style="max-width:520px; width:100%; max-height:94vh; overflow-y:auto; margin:0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3>👥 Equipe da loja</h3>
        <button class="btn-outline-sm" data-fechar>✕</button>
      </div>
      <div id="eq-lista"><p class="gc-dica">Carregando...</p></div>

      <h4 style="margin:18px 0 6px;">➕ Adicionar pessoa</h4>
      <form id="eq-form" novalidate>
        <label style="${rotulo}">Função</label>
        <div class="eq-funcoes">
          ${['balcao', 'cozinha', 'entregador'].map((f, i) => `
            <label><input type="radio" name="papel" value="${f}" ${i === 0 ? 'checked' : ''} />
              <span>${FUNCOES[f].icone} <strong>${FUNCOES[f].nome}</strong><small>${FUNCOES[f].dica}</small></span>
            </label>`).join('')}
        </div>
        <label style="${rotulo}">Nome</label>
        <input name="nome" maxlength="60" placeholder="Ex: Maria" style="${campo}" />
        <label style="${rotulo}">E-mail da pessoa</label>
        <input name="email" type="email" placeholder="maria@email.com" autocomplete="off" style="${campo}" />
        <label style="${rotulo}">Senha inicial (mínimo 6)</label>
        <input name="senha" type="text" placeholder="A pessoa pode trocar depois" autocomplete="off" style="${campo}" />
        <button class="btn-primary" type="submit">Adicionar à equipe</button>
      </form>
      <div id="eq-resultado"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  const $ = (s) => overlay.querySelector(s);
  $('[data-fechar]').onclick = () => overlay.remove();

  async function carregarLista() {
    const lista = $('#eq-lista');
    try {
      const [eq, ent] = await Promise.all([
        getDocs(collection(db, 'lojas', AppState.lojaId, 'equipe')),
        getDocs(collection(db, 'lojas', AppState.lojaId, 'entregadores'))
      ]);
      const pessoas = [
        ...eq.docs.map(d => ({ uid: d.id, tipo: 'equipe', papel: d.data().papel || 'balcao', ...d.data() })),
        ...ent.docs.map(d => ({ uid: d.id, tipo: 'entregadores', papel: 'entregador', ...d.data() }))
      ];
      lista.innerHTML = pessoas.length ? pessoas.map(p => {
        const f = FUNCOES[p.papel] || FUNCOES.balcao;
        const souEu = p.uid === auth.currentUser?.uid;
        return `
          <div class="eq-pessoa">
            <div>
              <strong>${f.icone} ${esc(p.nome || 'Sem nome')}</strong>${souEu ? ' <small>(você)</small>' : ''}
              <div class="gc-dica" style="margin:2px 0 0;">${esc(f.nome)}${p.email ? ` · ${esc(p.email)}` : ''}</div>
            </div>
            ${souEu || p.papel === 'dono' ? '' : `<button class="btn-outline-sm gc-perigo" data-remover="${esc(p.uid)}" data-tipo="${p.tipo}" data-nome="${esc(p.nome || '')}">Remover</button>`}
          </div>`;
      }).join('') : '<p class="gc-dica">Ninguém cadastrado ainda.</p>';

      lista.querySelectorAll('[data-remover]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm(`Remover ${btn.dataset.nome || 'esta pessoa'} da equipe? Ela perde o acesso ao painel desta loja.`)) return;
          btn.disabled = true;
          try {
            await chamarApi({ acao: 'remover', uid: btn.dataset.remover, tipo: btn.dataset.tipo });
            showToast('Removido da equipe.');
            carregarLista();
          } catch (err) {
            showToast(err.message);
            btn.disabled = false;
          }
        };
      });
    } catch (err) {
      console.error(err);
      lista.innerHTML = '<p class="gc-dica">Não foi possível carregar a equipe.</p>';
    }
  }

  $('#eq-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const dados = {
      acao: 'adicionar',
      papel: form.papel.value,
      nome: form.nome.value.trim(),
      email: form.email.value.trim().toLowerCase(),
      senha: form.senha.value
    };
    if (dados.nome.length < 2) return showToast('Informe o nome.');
    if (!/^\S+@\S+\.\S+$/.test(dados.email)) return showToast('Informe um e-mail válido.');
    if (dados.senha.length < 6) return showToast('A senha inicial precisa ter pelo menos 6 caracteres.');

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Cadastrando...';
    try {
      const r = await chamarApi(dados);
      const caminho = dados.papel === 'entregador' ? 'motoboy' : 'painel';
      const link = `${window.location.origin}/${AppState.slug}/${caminho}`;
      const mensagem = `Olá ${dados.nome}! Seu acesso à ${AppState.lojaDados.nome} (${FUNCOES[dados.papel].nome}):\n` +
        `👉 ${link}\nE-mail: ${dados.email}\n` +
        (r.contaExistente ? 'Use a senha que você já tem.' : 'Senha: a que eu te passei (você pode trocar em "Esqueci minha senha").');
      $('#eq-resultado').innerHTML = `
        <div class="eq-ok">
          ✅ <strong>${esc(dados.nome)}</strong> agora faz parte da equipe como <strong>${FUNCOES[dados.papel].nome}</strong>.
          ${r.contaExistente ? '<br/><small>Esse e-mail já tinha conta: a senha dele não foi alterada.</small>' : ''}
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <a class="btn-outline-sm" style="text-decoration:none;" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(mensagem)}">📲 Enviar acesso no WhatsApp</a>
            <button class="btn-outline-sm" type="button" data-copiar>📋 Copiar link</button>
          </div>
        </div>`;
      $('[data-copiar]').onclick = () => navigator.clipboard?.writeText(link).then(() => showToast('Link copiado!'));
      form.reset();
      form.papel.value = dados.papel;
      carregarLista();
    } catch (err) {
      showToast(err.message, 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Adicionar à equipe';
    }
  };

  carregarLista();
}
