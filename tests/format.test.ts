import { describe, expect, it } from 'vitest';
import { fmtCoins, SUFFIXES } from '../src/format';

describe('Kurzschreibweise für Münzen', () => {
  it('kleine Zahlen bleiben ausgeschrieben', () => {
    expect(fmtCoins(0)).toBe('0');
    expect(fmtCoins(999)).toBe('999');
    expect(fmtCoins(-5)).toBe('-5');
  });
  it('kürzt mit k m b t qa qi …', () => {
    expect(fmtCoins(1000)).toBe('1 k');
    expect(fmtCoins(1500)).toBe('1,5 k');
    expect(fmtCoins(2_340_000)).toBe('2,34 m');
    expect(fmtCoins(7e9)).toBe('7 b');
    expect(fmtCoins(1e12)).toBe('1 t');
    expect(fmtCoins(1e15)).toBe('1 qa');
    expect(fmtCoins(3.5e18)).toBe('3,5 qi');
  });
  it('rundet nie auf „1000 k“', () => {
    expect(fmtCoins(999_999)).toBe('999,99 k');
    expect(fmtCoins(999_999_999)).toBe('999,99 m');
  });
  it('geht bis ocd und wächst danach in der Zahl davor weiter', () => {
    expect(SUFFIXES[SUFFIXES.length - 1]).toBe('ocd');
    expect(fmtCoins(1e57)).toBe('1 ocd');
    expect(fmtCoins(5e60)).toBe('5.000 ocd');
    expect(fmtCoins(Infinity)).toBe('∞');
  });
});
