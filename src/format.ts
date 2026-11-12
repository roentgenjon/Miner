/** Kürzel für große Zahlen: k, m, b, t, qa, qi, sx, sp, oc, no, dc, ud, dd, td, qad, qid, sxd, spd, ocd (10^3 … 10^57). */
export const SUFFIXES = ['k', 'm', 'b', 't', 'qa', 'qi', 'sx', 'sp', 'oc', 'no', 'dc', 'ud', 'dd', 'td', 'qad', 'qid', 'sxd', 'spd', 'ocd'] as const;

/** Münzen kurz: 999 → „999“, 1500 → „1,5 k“, 2,35e12 → „2,35 t“. Bis „ocd“, darüber wächst die Zahl davor weiter. */
export function fmtCoins(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  if (abs < 1000) return (neg ? '-' : '') + Math.round(abs).toLocaleString('de-DE');
  let idx = Math.min(SUFFIXES.length, Math.floor(Math.log10(abs) / 3)); // 1 = k
  let mant = abs / Math.pow(10, idx * 3);
  const text = (Math.floor(mant * 100 + 1e-9) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return `${neg ? '-' : ''}${text} ${SUFFIXES[idx - 1]}`;
}
