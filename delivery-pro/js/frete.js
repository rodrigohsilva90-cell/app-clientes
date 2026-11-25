// Cálculo do frete por distância. A MESMA conta existe no Worker (worker/index.js),
// que recalcula no servidor — se mudar aqui, mude lá também.
//
// loja.localizacao = { lat, lng }
// loja.frete = { baseCentavos, kmInclusos, porKmCentavos, raioMaxKm, adicionalAtivo, adicionalCentavos, adicionalTexto,
//   noturnoAtivo, noturnoCentavos, noturnoInicio: '22:00', noturnoFim: '06:00',
//   areas: [{ nome, pontos: [{lat,lng},...], sempre: bool, inicio: '20:00', fim: '06:00' }] }  (áreas sem entrega)
import { agoraNoFuso } from './horario.js';

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

const paraMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// Está dentro da faixa de horário (no fuso da loja)? Faixa que "termina" antes de "começar" atravessa a meia-noite.
export function dentroDoHorario(inicio, fim, loja, data = new Date()) {
  const a = paraMin(inicio), b = paraMin(fim);
  if (a === null || b === null || a === b) return false;
  const { min } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  return b > a ? (min >= a && min < b) : (min >= a || min < b);
}

// Ponto dentro do polígono (contorno desenhado no mapa)
export function pontoNaArea(p, pontos) {
  if (!Array.isArray(pontos) || pontos.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i], b = pontos[j];
    if (((a.lat > p.lat) !== (b.lat > p.lat)) && (p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng)) dentro = !dentro;
  }
  return dentro;
}

// Área sem entrega que vale agora para esse destino (ou null)
export function areaBloqueada(loja, destino, data = new Date()) {
  const areas = (loja && loja.frete && Array.isArray(loja.frete.areas)) ? loja.frete.areas : [];
  return areas.find(a => pontoNaArea(destino, a.pontos) && (a.sempre || dentroDoHorario(a.inicio, a.fim, loja, data))) || null;
}

// Adicionais valendo agora: chuva (ligado à mão) + noturno (automático pelo horário)
export function adicionaisAgora(loja, data = new Date()) {
  const f = (loja && loja.frete) || {};
  let centavos = 0;
  const textos = [];
  if (f.adicionalAtivo && Number(f.adicionalCentavos) > 0) { centavos += Number(f.adicionalCentavos); textos.push(f.adicionalTexto || 'Adicional'); }
  if (f.noturnoAtivo && Number(f.noturnoCentavos) > 0 && dentroDoHorario(f.noturnoInicio, f.noturnoFim, loja, data)) { centavos += Number(f.noturnoCentavos); textos.push('Adicional noturno'); }
  return { centavos, texto: textos.length ? textos.join(' + ') : null };
}

// Retorna: { configurado:false } | { precisaLocal:true } | { fora:true, distanciaKm } | { bloqueado:true, area, distanciaKm } | { freteCentavos, distanciaKm, adicional }
export function calcularFrete(loja, destino, data = new Date()) {
  const f = loja && loja.frete;
  const origem = loja && loja.localizacao;
  if (!f || !coordsValidas(origem)) return { configurado: false, freteCentavos: 0 };
  if (!coordsValidas(destino)) return { configurado: true, precisaLocal: true };

  const km = distanciaRetaKm(origem, destino) * FATOR_RUAS;
  const distanciaKm = Math.round(km * 10) / 10;
  if (Number(f.raioMaxKm) > 0 && km > Number(f.raioMaxKm)) return { configurado: true, fora: true, distanciaKm };
  const area = areaBloqueada(loja, destino, data);
  if (area) return { configurado: true, bloqueado: true, distanciaKm, area: { nome: area.nome || 'esta região', sempre: !!area.sempre, inicio: area.inicio, fim: area.fim } };

  const excedente = Math.max(0, km - (Number(f.kmInclusos) || 0));
  // arredonda o valor por km para cima, de 50 em 50 centavos
  let freteCentavos = (Number(f.baseCentavos) || 0) + Math.ceil((excedente * (Number(f.porKmCentavos) || 0)) / 50) * 50;
  const extra = adicionaisAgora(loja, data);
  freteCentavos += extra.centavos;
  const adicional = extra.texto;
  return { configurado: true, freteCentavos, distanciaKm, adicional };
}
