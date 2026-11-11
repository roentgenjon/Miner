import { describe, expect, it } from 'vitest';
import { HEART_DEPTH, WIDTH, ZONES, zoneAt, zoneValueScale } from '../src/config';
import { dailyKey, dailySeed } from '../src/game/rng';
import { Block } from '../src/game/types';
import { generateWorld, getCell } from '../src/game/world';

describe('Weltgenerierung', () => {
  it('ist bei gleichem Seed identisch (Tagesschacht)', () => {
    const a = generateWorld(dailySeed(new Date(2026, 10, 10)));
    const b = generateWorld(dailySeed(new Date(2026, 10, 10, 23, 59)));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.batSpawns).toEqual(b.batSpawns);
    expect(a.lavaSources).toEqual(b.lavaSources);
  });

  it('unterscheidet sich zwischen Tagen und Seeds', () => {
    const a = generateWorld(dailySeed(new Date(2026, 10, 10)));
    const b = generateWorld(dailySeed(new Date(2026, 10, 11)));
    const c = generateWorld('anderer-seed');
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
    expect(Array.from(a.cells)).not.toEqual(Array.from(c.cells));
  });

  it('formatiert den Tages-Schlüssel', () => {
    expect(dailyKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dailySeed(new Date(2026, 0, 5))).toBe('tag-2026-01-05');
  });

  it('hat die richtige Struktur: 7 Spalten, Luft oben, Herz am Schachtende, Grundgestein unten', () => {
    const w = generateWorld('struktur');
    expect(w.width).toBe(WIDTH);
    expect(getCell(w, 3, 0)).toBe(Block.Air);
    expect(getCell(w, 3, HEART_DEPTH)).toBe(Block.Heart);
    for (let x = 0; x < WIDTH; x++) {
      expect(getCell(w, x, w.height - 1)).toBe(Block.Bedrock);
      if (x !== 3) expect(getCell(w, x, HEART_DEPTH)).toBe(Block.Bedrock);
    }
    expect(getCell(w, -1, 5)).toBe(Block.Bedrock);
    expect(getCell(w, WIDTH, 5)).toBe(Block.Bedrock);
  });

  it('hat 100 gleich lange Zonen mit eindeutigen Namen', () => {
    expect(ZONES).toHaveLength(100);
    expect(HEART_DEPTH).toBe(100_000);
    ZONES.forEach((z, i) => {
      expect(z.from).toBe(i * 1000);
      expect(z.index).toBe(i);
    });
    expect(new Set(ZONES.map((z) => z.name)).size).toBe(100);
    expect(ZONES.slice(0, 4).map((z) => z.name)).toEqual(['Erde I', 'Tiefschiefer I', 'Magmazone I', 'Kristallhöhle I']);
    expect(ZONES[99]?.name).toBe('Kristallhöhle XXV');
  });

  it('findet die richtige Zone an den Grenzen', () => {
    expect(zoneAt(0).index).toBe(0);
    expect(zoneAt(999).index).toBe(0);
    expect(zoneAt(1000).index).toBe(1);
    expect(zoneAt(54_321).index).toBe(54);
    expect(zoneAt(HEART_DEPTH).index).toBe(99);
    expect(zoneAt(HEART_DEPTH * 2).index).toBe(99);
    expect(zoneAt(-5).index).toBe(0);
  });

  it('wird mit der Zonennummer schwieriger und wertvoller', () => {
    for (let i = 4; i < ZONES.length; i++) {
      const z = ZONES[i];
      const prev = ZONES[i - 4]; // gleiche Familie, vorheriger Durchlauf
      expect(z?.darkness ?? 0).toBeGreaterThanOrEqual(prev?.darkness ?? 1);
      expect(z?.drain ?? 0).toBeGreaterThan(prev?.drain ?? 99);
    }
    expect(zoneValueScale(0)).toBe(1);
    expect(zoneValueScale(99_999)).toBeCloseTo(10.9);
    for (const z of ZONES) expect(z.darkness).toBeLessThanOrEqual(0.97);
  });

  it('nutzt je Zone das passende Grundgestein', () => {
    const w = generateWorld('zonen');
    const counts = new Map<number, number>();
    for (let y = 1; y < HEART_DEPTH; y++) {
      const z = zoneAt(y);
      for (let x = 0; x < WIDTH; x++) {
        if (getCell(w, x, y) === z.base) counts.set(z.index, (counts.get(z.index) ?? 0) + 1);
      }
    }
    for (const z of ZONES) expect(counts.get(z.index) ?? 0, z.name).toBeGreaterThan(3000);
  });

  it('platziert zonenspezifische Erze und Gefahren', () => {
    const w = generateWorld('inhalt');
    const has = (b: number, from: number, to: number): boolean => {
      for (let y = from; y < to; y++) for (let x = 0; x < WIDTH; x++) if (getCell(w, x, y) === b) return true;
      return false;
    };
    const kristall = ZONES[3]?.from ?? 0;
    const magma = ZONES[2]?.from ?? 0;
    expect(has(Block.Diamond, 0, kristall)).toBe(false);
    expect(has(Block.Diamond, kristall, HEART_DEPTH)).toBe(true);
    expect(has(Block.LavaSource, 0, magma)).toBe(false);
    expect(w.lavaSources.length).toBeGreaterThan(0);
    expect(w.batSpawns.length).toBeGreaterThan(0);
  });
});
