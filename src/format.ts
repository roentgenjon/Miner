/** Kürzel für große Zahlen: K, M, B, T, QA, QI, SX, SP, OC, NO, DC, UD, DD, TD, QAD, QID, SXD, SPD, OCD (10^3 … 10^57). */
export const SUFFIXES = ['K', 'M', 'B', 'T', 'QA', 'QI', 'SX', 'SP', 'OC', 'NO', 'DC', 'UD', 'DD', 'TD', 'QAD', 'QID', 'SXD', 'SPD', 'OCD'] as const;

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

/**
 * Liest eine Münzmenge mit Kürzeln: „5000“, „1.500“, „2,5k“, „1M“, „3 qa“, „1e12“ (Groß/Klein egal, Komma oder Punkt als Dezimalzeichen).
 * Liefert NaN, wenn der Text keine gültige Menge ist; sonst eine ganze Zahl (abgerundet).
 */
export function parseCoins(text: string): number {
  const t = text.trim().replace(/[\s_']/g, '').toLowerCase();
  const sci = /^(\d+(?:[.,]\d+)?)e(\d{1,3})$/.exec(t);
  if (sci) {
    const v = Math.floor(Number((sci[1] ?? '').replace(',', '.')) * Math.pow(10, Number(sci[2])));
    return Number.isFinite(v) ? v : NaN;
  }
  const m = /^(\d[\d.,]*)([a-z]*)$/.exec(t);
  if (!m) return NaN;
  const [, digits = '', suffix = ''] = m;
  let mult = 1;
  if (suffix !== '') {
    const idx = SUFFIXES.findIndex((s) => s.toLowerCase() === suffix);
    if (idx >= 0) mult = Math.pow(10, 3 * (idx + 1));
    else return NaN;
  }
  let num: number;
  if (/^\d{1,3}(\.\d{3})+$/.test(digits) && suffix === '') {
    num = Number(digits.replace(/\./g, '')); // 1.500.000 = Tausenderpunkte
  } else if (/^\d+([.,]\d+)?$/.test(digits)) {
    num = Number(digits.replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(digits)) {
    num = Number(digits.replace(/\./g, '').replace(',', '.'));
  } else return NaN;
  const v = Math.floor(num * mult + 1e-6);
  return Number.isFinite(v) ? v : NaN;
}
