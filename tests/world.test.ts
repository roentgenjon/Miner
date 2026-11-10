import { describe, expect, it } from 'vitest';
import { HEART_DEPTH, WIDTH, ZONES, zoneAt } from '../src/config';
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

  it('hat die richtige Struktur: 7 Spalten, Luft oben, Herz bei 250 m, Grundgestein unten', () => {
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

  it('nutzt je Zone das passende Grundgestein', () => {
    expect(ZONES.map((z) => z.from)).toEqual([0, 40, 110, 200]);
    expect(zoneAt(39).id).toBe('erde');
    expect(zoneAt(40).id).toBe('schiefer');
    expect(zoneAt(110).id).toBe('magma');
    expect(zoneAt(200).id).toBe('kristall');
    const w = generateWorld('zonen');
    const counts: Record<string, number> = {};
    for (let y = 1; y < HEART_DEPTH; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const b = getCell(w, x, y);
        const z = zoneAt(y);
        if (b === z.base) counts[z.id] = (counts[z.id] ?? 0) + 1;
      }
    }
    for (const z of ZONES) expect(counts[z.id] ?? 0).toBeGreaterThan(50);
  });

  it('platziert zonenspezifische Erze und Gefahren', () => {
    const w = generateWorld('inhalt');
    const has = (b: number, from: number, to: number): boolean => {
      for (let y = from; y < to; y++) for (let x = 0; x < WIDTH; x++) if (getCell(w, x, y) === b) return true;
      return false;
    };
    expect(has(Block.Diamond, 0, 200)).toBe(false);
    expect(has(Block.Diamond, 200, HEART_DEPTH)).toBe(true);
    expect(has(Block.LavaSource, 0, 110)).toBe(false);
    expect(w.lavaSources.length).toBeGreaterThan(0);
    expect(w.batSpawns.length).toBeGreaterThan(0);
  });
});
