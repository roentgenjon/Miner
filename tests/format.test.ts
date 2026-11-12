import { describe, expect, it } from 'vitest';
import { fmtCoins, SUFFIXES } from '../src/format';

describe('Kurzschreibweise für Münzen', () => {
  it('kleine Zahlen bleiben ausgeschrieben', () => {
    expect(fmtCoins(0)).toBe('0');
    expect(fmtCoins(999)).toBe('999');
    expect(fmtCoins(-5)).toBe('-5');
  });
  it('kürzt mit K M B T QA QI …', () => {
    expect(fmtCoins(1000)).toBe('1 K');
    expect(fmtCoins(1500)).toBe('1,5 K');
    expect(fmtCoins(2_340_000)).toBe('2,34 M');
    expect(fmtCoins(7e9)).toBe('7 B');
    expect(fmtCoins(1e12)).toBe('1 T');
    expect(fmtCoins(1e15)).toBe('1 QA');
    expect(fmtCoins(3.5e18)).toBe('3,5 QI');
  });
  it('rundet nie auf „1000 k“', () => {
    expect(fmtCoins(999_999)).toBe('999,99 K');
    expect(fmtCoins(999_999_999)).toBe('999,99 M');
  });
  it('geht bis ocd und wächst danach in der Zahl davor weiter', () => {
    expect(SUFFIXES[SUFFIXES.length - 1]).toBe('OCD');
    expect(fmtCoins(1e57)).toBe('1 OCD');
    expect(fmtCoins(5e60)).toBe('5.000 OCD');
    expect(fmtCoins(Infinity)).toBe('∞');
  });
});
