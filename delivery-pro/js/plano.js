// Situação da assinatura da loja. A MESMA conta existe no Worker — se mudar aqui, mude lá.
// loja.plano: 'teste' (até loja.trialAte) | 'essencial' | 'pro' (até loja.pagoAte + 48h de tolerância) | 'bloqueada'
// Lojas sem o campo "plano" (antigas) ficam liberadas.
export const CARENCIA_MS = 48 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

const emMs = (v) => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export function statusAssinatura(loja, agora = Date.now()) {
  const plano = loja && loja.plano;
  if (!plano) return { ativa: true, plano: 'livre' };
  if (plano === 'bloqueada') return { ativa: false, plano, motivo: 'bloqueada' };
  if (plano === 'teste') {
    const fim = emMs(loja.trialAte);
    if (!fim) return { ativa: true, plano, emTeste: true };
    return fim > agora
      ? { ativa: true, plano, emTeste: true, fim, diasRestantes: Math.ceil((fim - agora) / DIA_MS) }
      : { ativa: false, plano, motivo: 'teste_vencido', fim };
  }
  const fim = emMs(loja.pagoAte);
  if (!fim) return { ativa: true, plano };
  if (fim > agora) return { ativa: true, plano, fim, diasRestantes: Math.ceil((fim - agora) / DIA_MS) };
  if (fim + CARENCIA_MS > agora) return { ativa: true, plano, fim, emCarencia: true };
  return { ativa: false, plano, motivo: 'pagamento_vencido', fim };
}
