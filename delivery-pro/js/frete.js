// Cálculo do frete por distância. A MESMA conta existe no Worker (worker/index.js),
// que recalcula no servidor — se mudar aqui, mude lá também.
//
// loja.localizacao = { lat, lng }
// loja.frete = { baseCentavos, kmInclusos, porKmCentavos, raioMaxKm, adicionalAtivo, adicionalCentavos, adicionalTexto }

export const FATOR_RUAS = 1.35; // linha reta x 1,35 ≈ distância real pelas ruas

export function distanciaRetaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function coordsValidas(c) {
  return !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}

// Retorna: { configurado:false } | { precisaLocal:true } | { fora:true, distanciaKm } | { freteCentavos, distanciaKm, adicional }
export function calcularFrete(loja, destino) {
  const f = loja && loja.frete;
  const origem = loja && loja.localizacao;
  if (!f || !coordsValidas(origem)) return { configurado: false, freteCentavos: 0 };
  if (!coordsValidas(destino)) return { configurado: true, precisaLocal: true };

  const km = distanciaRetaKm(origem, destino) * FATOR_RUAS;
  const distanciaKm = Math.round(km * 10) / 10;
  if (Number(f.raioMaxKm) > 0 && km > Number(f.raioMaxKm)) return { configurado: true, fora: true, distanciaKm };

  const excedente = Math.max(0, km - (Number(f.kmInclusos) || 0));
  // arredonda o valor por km para cima, de 50 em 50 centavos
  let freteCentavos = (Number(f.baseCentavos) || 0) + Math.ceil((excedente * (Number(f.porKmCentavos) || 0)) / 50) * 50;
  const adicional = f.adicionalAtivo && Number(f.adicionalCentavos) > 0 ? (f.adicionalTexto || 'Adicional') : null;
  if (adicional) freteCentavos += Number(f.adicionalCentavos);
  return { configurado: true, freteCentavos, distanciaKm, adicional };
}
