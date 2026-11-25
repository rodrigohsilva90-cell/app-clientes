// Regras de preço do cardápio, usadas pela vitrine (cliente) e pelo pedido de balcão.
// Valores sempre em centavos inteiros. A MESMA conta existe no Worker (calcularItemOficial / ofertaDoDia).
import { agoraNoFuso, DIAS } from './horario.js';

// Oferta do dia: prod.oferta = { precoCentavos, dias: ['seg','sex',...] } (dia da semana no fuso da loja)
export function ofertaDoDia(prod, loja, data = new Date()) {
  const o = prod && prod.oferta;
  const de = Number(prod && prod.precoCentavos) || 0;
  if (!o || !Array.isArray(o.dias) || !o.dias.length) return null;
  const por = Number(o.precoCentavos);
  if (!Number.isInteger(por) || por < 0 || por >= de) return null;
  const { dia } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  return o.dias.includes(DIAS[dia]) ? { deCentavos: de, porCentavos: por } : null;
}

// prod: produto do cardápio | selecoes: { indiceDoGrupo: [opcoesEscolhidas] }
// Devolve { item } pronto para a sacola, ou { erro } com a mensagem para o usuário.
export function montarItem(prod, selecoes, loja) {
  const oferta = ofertaDoDia(prod, loja);
  let totalCentavos = oferta ? oferta.porCentavos : Number(prod.precoCentavos) || 0;
  const detalhes = [];
  const indices = {}; // { indiceDoGrupo: [indicesDasOpcoes] } -> enviado ao servidor para recalcular o preço
  const grupos = prod.grupos || [];

  for (let i = 0; i < grupos.length; i++) {
    const grp = grupos[i];
    const escolhidos = selecoes[i] || [];
    if (escolhidos.length < (grp.minimo || 0)) {
      return { erro: `Selecione pelo menos ${grp.minimo} em "${grp.titulo}".` };
    }
    if (escolhidos.length > 0) {
      const precos = escolhidos.map(e => Number(e.precoCentavos) || 0);
      if (grp.regraDePreco === 'MAIOR_VALOR') {
        totalCentavos += Math.max(...precos);
      } else if (grp.regraDePreco === 'MEDIA') {
        totalCentavos += Math.round(precos.reduce((a, b) => a + b, 0) / precos.length);
      } else {
        totalCentavos += precos.reduce((a, b) => a + b, 0);
      }
      detalhes.push(`${grp.titulo}: ${escolhidos.map(e => e.nome).join(' / ')}`);
      indices[i] = escolhidos.map(e => (grp.opcoes || []).indexOf(e));
    }
  }

  return {
    item: { produtoId: prod.id, nome: prod.nome, quantidade: 1, unitarioCentavos: totalCentavos, detalhes: oferta ? ['Oferta do dia', ...detalhes] : detalhes, selecoes: indices }
  };
}
