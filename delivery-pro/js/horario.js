// Horário de funcionamento. A MESMA conta existe no Worker (worker/index.js) — se mudar aqui, mude lá.
// loja.horarios = { dom: [{ abre: '18:00', fecha: '23:30' }], seg: [...], ... }  (até 2 faixas por dia)
// Faixa que "fecha" antes de "abrir" atravessa a meia-noite (ex.: 18:00 → 02:00).
// estado (publico/estado).pausada = true fecha a loja na hora.

export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
export const NOMES_DIA = { dom: 'domingo', seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado' };
const DIA_INGLES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function agoraNoFuso(fuso, data) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(data);
  const v = (t) => partes.find(p => p.type === t)?.value;
  return { dia: DIA_INGLES[v('weekday')], min: Number(v('hour')) * 60 + Number(v('minute')) };
}

const paraMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const paraHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function situacaoLoja(loja, estado, data = new Date()) {
  if (estado && estado.pausada) return { aberta: false, pausada: true, texto: 'Pausada no momento' };
  const h = loja && loja.horarios;
  if (!h) return { aberta: true, semHorario: true, texto: 'Aberto' };
  const { dia, min } = agoraNoFuso((loja && loja.fusoHorario) || 'America/Sao_Paulo', data);
  const hoje = h[DIAS[dia]] || [];
  const ontem = h[DIAS[(dia + 6) % 7]] || [];

  for (const faixa of hoje) {
    const a = paraMin(faixa.abre), f = paraMin(faixa.fecha);
    if (a === null || f === null) continue;
    if (f > a ? (min >= a && min < f) : min >= a) return { aberta: true, texto: `Aberto · fecha às ${paraHora(f)}` };
  }
  for (const faixa of ontem) {
    const a = paraMin(faixa.abre), f = paraMin(faixa.fecha);
    if (a === null || f === null) continue;
    if (f <= a && min < f) return { aberta: true, texto: `Aberto · fecha às ${paraHora(f)}` };
  }

  // Próxima abertura (até 7 dias à frente)
  for (let d = 0; d < 8; d++) {
    const chave = DIAS[(dia + d) % 7];
    const aberturas = (h[chave] || []).map(x => paraMin(x.abre)).filter(x => x !== null).sort((x, y) => x - y);
    const proxima = aberturas.find(a => d > 0 || a > min);
    if (proxima !== undefined) {
      const quando = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : NOMES_DIA[chave];
      return { aberta: false, texto: `Fechado · abre ${quando} às ${paraHora(proxima)}` };
    }
  }
  return { aberta: false, texto: 'Fechado' };
}
