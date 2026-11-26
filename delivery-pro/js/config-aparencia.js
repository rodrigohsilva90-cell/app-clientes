// Painel do dono: nome, descrição, cor, logo, capa, tempo estimado e pedido mínimo da loja.
// Esses dados aparecem no cardápio, na prévia do WhatsApp e no ícone do app instalado.
import { db, showToast, esc, formatarCentavos } from './config.js';
import { AppState } from './router.js';
import { enviarFoto } from './fotos.js';
import { PALETAS, textoSobre, contraste, aplicarTema } from './tema.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const urlOk = (u) => !u || /^https:\/\/\S+$/i.test(u);
const reaisParaCentavos = (t) => {
  let s = String(t ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function abrirConfigAparencia() {
  const l = AppState.lojaDados || {};
  const campo = 'width:100%; padding:10px; margin:4px 0 10px; border:1px solid var(--border); border-radius:8px; font-size:15px;';
  const rotulo = 'display:block; font-size:13px; font-weight:600;';
  const overlay = document.createElement('div');
  overlay.className = 'gc-overlay';
  overlay.innerHTML = `
    <form class="card" style="max-width:520px; width:100%; max-height:94vh; overflow-y:auto; margin:0;" novalidate>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h3>🎨 Aparência da loja</h3>
        <button class="btn-outline-sm" type="button" data-fechar>✕</button>
      </div>

      <div class="ap-previa" id="ap-previa"></div>
      <p class="gc-dica">Assim o link aparece quando alguém compartilha no WhatsApp (o WhatsApp pode levar algumas horas para atualizar uma prévia antiga).</p>

      <label style="${rotulo}">Tipo de cardápio</label>
      <div class="ap-layouts">
        <label class="ap-layout"><input type="radio" name="layout" value="gastronomia" ${l.layoutVitrine !== 'varejo' ? 'checked' : ''} />
          <strong>🍕 Gastronomia</strong><small>Lista com foto grande. Ideal para pizzaria, lanchonete, restaurante.</small></label>
        <label class="ap-layout"><input type="radio" name="layout" value="varejo" ${l.layoutVitrine === 'varejo' ? 'checked' : ''} />
          <strong>🛒 Varejo</strong><small>Grade em 2 colunas com "+ Adicionar". Ideal para adega, farmácia, mercadinho, pet shop.</small></label>
      </div>

      <label style="${rotulo}">Nome da loja</label>
      <input name="nome" maxlength="60" value="${esc(l.nome || '')}" style="${campo}" />

      <label style="${rotulo}">Descrição curta (aparece no WhatsApp)</label>
      <textarea name="descricao" maxlength="160" rows="2" placeholder="Ex: Pizzas artesanais no forno a lenha. Entrega rápida no Centro e região." style="${campo}">${esc(l.descricao || '')}</textarea>

      <label style="${rotulo}">Paletas prontas (1 toque)</label>
      <div class="ap-paletas">
        ${PALETAS.map((p, i) => `<button type="button" class="ap-paleta" data-paleta="${i}" style="--c:${p.cor}; ${p.escuro ? 'background:#111827; color:#e5e7eb;' : ''}"><span></span>${esc(p.nome)}${p.escuro ? ' 🌙' : ''}</button>`).join('')}
      </div>
      <label class="chk-lembrar"><input type="checkbox" name="escuro" ${l.modoEscuro ? 'checked' : ''} /> <span>🌙 Modo escuro no cardápio <small>Fica bonito em hamburgueria, adega e lojas noturnas.</small></span></label>
      <div class="gc-linha">
        <div>
          <label style="${rotulo}">Cor da loja</label>
          <input name="cor" type="color" value="${/^#[0-9a-f]{6}$/i.test(l.corPrimaria || '') ? l.corPrimaria : '#ea1d2c'}" style="${campo} height:44px; padding:4px;" />
        </div>
        <div>
          <label style="${rotulo}">Tempo de entrega</label>
          <input name="tempo" maxlength="20" value="${esc(l.tempoEstimado || '30-45 min')}" style="${campo}" />
        </div>
      </div>

      <div class="ap-botao-previa" id="ap-botao-previa"></div>

      <label style="${rotulo}">Faixa de aviso no topo (opcional, até 80 letras)</label>
      <input name="aviso" maxlength="80" placeholder="Ex: Frete grátis acima de R$ 60 🎉" value="${esc(l.avisoTopo || '')}" style="${campo}" />

      <label style="${rotulo}">Instagram da loja (opcional)</label>
      <input name="instagram" maxlength="40" placeholder="@sualoja" value="${esc(l.instagram ? '@' + l.instagram : '')}" style="${campo}" />

      <label style="${rotulo}">Pedido mínimo (R$, 0 = sem mínimo)</label>
      <input name="minimo" inputmode="decimal" value="${((Number(l.pedidoMinimoCentavos) || 0) / 100).toFixed(2).replace('.', ',')}" style="${campo}" />

      <label style="${rotulo}">Logo (quadrado)</label>
      <div class="foto-campo">
        <button type="button" class="btn-outline-sm" data-foto="logo">📷 Enviar foto</button>
        <input name="logo" value="${esc(l.logoUrl || '')}" placeholder="ou cole um link https://..." style="${campo}" />
      </div>

      <label style="${rotulo}">Foto de capa (horizontal)</label>
      <div class="foto-campo">
        <button type="button" class="btn-outline-sm" data-foto="capa">📷 Enviar foto</button>
        <input name="banner" value="${esc(l.bannerUrl || '')}" placeholder="ou cole um link https://..." style="${campo}" />
      </div>

      <button class="btn-primary" type="submit">💾 Salvar aparência</button>
    </form>
  `;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  overlay.querySelector('[data-fechar]').onclick = () => overlay.remove();

  const desenharPrevia = () => {
    const nome = form.nome.value.trim() || 'Minha loja';
    const img = (form.banner.value.trim() || form.logo.value.trim());
    const desc = form.descricao.value.trim() || `Faça seu pedido na ${nome} · entrega em ${form.tempo.value.trim() || '30-45 min'}. Acompanhe a entrega ao vivo.`;
    overlay.querySelector('#ap-previa').innerHTML = `
      ${img && urlOk(img) ? `<div class="ap-img" style="background-image:url('${esc(img)}')"></div>` : `<div class="ap-img ap-sem" style="background:${esc(form.cor.value)}">${esc(nome.slice(0, 1).toUpperCase())}</div>`}
      <div class="ap-txt">
        <strong>${esc(nome)} — Peça online</strong>
        <span>${esc(desc)}</span>
        <small>${esc(window.location.host)}</small>
      </div>`;
  };
  // Prévia do botão com o texto de contraste automático (branco ou grafite)
  const desenharBotao = () => {
    const cor = form.cor.value;
    const txt = textoSobre(cor);
    const fraco = contraste(cor, form.escuro.checked ? '#111827' : '#ffffff') < 3;
    overlay.querySelector('#ap-botao-previa').innerHTML = `
      <span class="ap-botao-amostra" style="background:${esc(cor)}; color:${txt};">Finalizar pedido</span>
      <small>${fraco ? '⚠ Cor muito parecida com o fundo: textos coloridos podem ficar fracos. O texto dos botões é ajustado sozinho.' : '✅ Boa leitura: o texto dos botões fica ' + (txt === '#ffffff' ? 'branco' : 'escuro') + ' automaticamente.'}</small>`;
  };
  form.oninput = () => { desenharPrevia(); desenharBotao(); };
  desenharPrevia();
  desenharBotao();
  overlay.querySelectorAll('[data-paleta]').forEach(b => {
    b.onclick = () => {
      const pl = PALETAS[Number(b.dataset.paleta)];
      form.cor.value = pl.cor;
      form.escuro.checked = pl.escuro;
      desenharPrevia(); desenharBotao();
    };
  });

  overlay.querySelectorAll('[data-foto]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      const url = await enviarFoto(btn.dataset.foto);
      btn.disabled = false;
      if (!url) return;
      (btn.dataset.foto === 'logo' ? form.logo : form.banner).value = url;
      desenharPrevia();
      showToast('Foto pronta! Toque em 💾 Salvar aparência.');
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
      nome: form.nome.value.trim().slice(0, 60),
      descricao: form.descricao.value.trim().slice(0, 160) || null,
      corPrimaria: form.cor.value,
      tempoEstimado: form.tempo.value.trim().slice(0, 20) || '30-45 min',
      pedidoMinimoCentavos: reaisParaCentavos(form.minimo.value),
      logoUrl: form.logo.value.trim() || null,
      bannerUrl: form.banner.value.trim() || null,
      layoutVitrine: form.layout.value === 'varejo' ? 'varejo' : 'gastronomia',
      modoEscuro: form.escuro.checked,
      avisoTopo: form.aviso.value.trim().slice(0, 80) || null,
      instagram: form.instagram.value.trim().replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30) || null,
      temaVersao: Date.now()
    };
    if (dados.nome.length < 2) return showToast('Informe o nome da loja.');
    if (dados.pedidoMinimoCentavos === null) return showToast('Pedido mínimo inválido. Use o formato 20,00.');
    if (!urlOk(dados.logoUrl) || !urlOk(dados.bannerUrl)) return showToast('Os links de imagem precisam começar com https://');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await updateDoc(doc(db, 'lojas', AppState.lojaId), dados);
      AppState.lojaDados = { ...AppState.lojaDados, ...dados };
      aplicarTema({ ...AppState.lojaDados, modoEscuro: false }); // no painel fica sempre claro
      showToast(`Aparência salva!${dados.pedidoMinimoCentavos ? ` Pedido mínimo: ${formatarCentavos(dados.pedidoMinimoCentavos)}.` : ''}`);
      overlay.remove();
    } catch (err) {
      console.error(err);
      showToast(err.code === 'permission-denied' ? 'Só o dono pode alterar a aparência.' : 'Erro ao salvar.');
      btn.disabled = false;
    }
  };
}
