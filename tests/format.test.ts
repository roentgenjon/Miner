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

import { parseCoins } from '../src/format';

describe('Eingabe mit Kürzeln', () => {
  it('liest Zahlen mit K, M, B, T, QA … (Groß/Klein egal)', () => {
    expect(parseCoins('1000')).toBe(1000);
    expect(parseCoins('5k')).toBe(5000);
    expect(parseCoins('2,5K')).toBe(2500);
    expect(parseCoins('2.5k')).toBe(2500);
    expect(parseCoins('1M')).toBe(1e6);
    expect(parseCoins('1b')).toBe(1e9);
    expect(parseCoins('1T')).toBe(1e12);
    expect(parseCoins('1QA')).toBe(1e15);
    expect(parseCoins('3 qi')).toBe(3e18);
    expect(parseCoins('1ocd')).toBe(1e57);
    expect(parseCoins('1,5 M')).toBe(1.5e6);
  });
  it('versteht Tausenderpunkte und wissenschaftliche Schreibweise', () => {
    expect(parseCoins('1.500.000')).toBe(1_500_000);
    expect(parseCoins('1e12')).toBe(1e12);
    expect(parseCoins('2,5e3')).toBe(2500);
  });
  it('lehnt Unsinn ab', () => {
    for (const bad of ['', 'abc', 'k', '-5', '1x', '1..5', '1,5,5', '1 mm']) expect(parseCoins(bad), bad).toBeNaN();
  });
  it('ist die Umkehrung der Anzeige (auf zwei Nachkommastellen)', () => {
    for (const n of [1500, 2_340_000, 7e9, 1e12, 3.5e18]) expect(parseCoins(fmtCoins(n))).toBe(n);
  });
});
