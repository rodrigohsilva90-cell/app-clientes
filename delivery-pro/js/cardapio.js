// Regras de preço do cardápio, usadas pela vitrine (cliente) e pelo pedido de balcão.
// Valores sempre em centavos inteiros.

// prod: produto do cardápio | selecoes: { indiceDoGrupo: [opcoesEscolhidas] }
// Devolve { item } pronto para a sacola, ou { erro } com a mensagem para o usuário.
export function montarItem(prod, selecoes) {
  let totalCentavos = Number(prod.precoCentavos) || 0;
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
    item: { produtoId: prod.id, nome: prod.nome, quantidade: 1, unitarioCentavos: totalCentavos, detalhes, selecoes: indices }
  };
}
