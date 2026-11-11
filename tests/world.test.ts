import { describe, expect, it } from 'vitest';
import { CHUNK_ROWS, HEART_DEPTH, WIDTH, ZONE_LENGTH, ZONES, zoneAt, zoneValueScale } from '../src/config';
import { dailyKey, dailySeed } from '../src/game/rng';
import { Block } from '../src/game/types';
import { batSpawnsIn, generateWorld, getCell } from '../src/game/world';

/** Zeilen [y0, y1) als Text – zum Vergleichen von Welten. */
function snapshot(w: ReturnType<typeof generateWorld>, y0: number, y1: number): string {
  let s = '';
  for (let y = y0; y < y1; y++) for (let x = 0; x < WIDTH; x++) s += String.fromCharCode(48 + getCell(w, x, y));
  return s;
}

describe('Weltgenerierung', () => {
  it('ist bei gleichem Seed identisch (Tagesschacht)', () => {
    const a = generateWorld(dailySeed(new Date(2026, 10, 10)));
    const b = generateWorld(dailySeed(new Date(2026, 10, 10, 23, 59)));
    expect(snapshot(a, 0, 3000)).toBe(snapshot(b, 0, 3000));
    expect(batSpawnsIn(a, 0, 50_000)).toEqual(batSpawnsIn(b, 0, 50_000));
  });

  it('ist unabhängig von der Reihenfolge, in der Abschnitte erzeugt werden', () => {
    const far = 4_000_000;
    const a = generateWorld('reihenfolge');
    const b = generateWorld('reihenfolge');
    // a: erst weit unten, dann oben – b: erst oben, dann unten
    const aFar = snapshot(a, far, far + 2 * CHUNK_ROWS);
    const aNear = snapshot(a, 0, 2 * CHUNK_ROWS);
    const bNear = snapshot(b, 0, 2 * CHUNK_ROWS);
    const bFar = snapshot(b, far, far + 2 * CHUNK_ROWS);
    expect(aNear).toBe(bNear);
    expect(aFar).toBe(bFar);
  });

  it('unterscheidet sich zwischen Tagen und Seeds', () => {
    const a = generateWorld(dailySeed(new Date(2026, 10, 10)));
    const b = generateWorld(dailySeed(new Date(2026, 10, 11)));
    const c = generateWorld('anderer-seed');
    expect(snapshot(a, 0, 2000)).not.toBe(snapshot(b, 0, 2000));
    expect(snapshot(a, 0, 2000)).not.toBe(snapshot(c, 0, 2000));
  });

  it('formatiert den Tages-Schlüssel', () => {
    expect(dailyKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dailySeed(new Date(2026, 0, 5))).toBe('tag-2026-01-05');
  });

  it('hat die richtige Struktur: 7 Spalten, Luft oben, Herz am Schachtende, Grundgestein unten', () => {
    const w = generateWorld('struktur');
    expect(w.width).toBe(WIDTH);
    expect(HEART_DEPTH).toBe(10_000_000);
    expect(getCell(w, 3, 0)).toBe(Block.Air);
    expect(getCell(w, 3, HEART_DEPTH)).toBe(Block.Heart);
    for (let x = 0; x < WIDTH; x++) {
      expect(getCell(w, x, w.height - 1)).toBe(Block.Bedrock);
      if (x !== 3) expect(getCell(w, x, HEART_DEPTH)).toBe(Block.Bedrock);
    }
    expect(getCell(w, -1, 5)).toBe(Block.Bedrock);
    expect(getCell(w, WIDTH, 5)).toBe(Block.Bedrock);
  });

  it('wird nur bei Bedarf erzeugt (Speicher bleibt klein)', () => {
    const w = generateWorld('lazy');
    expect(w.chunks.filter(Boolean)).toHaveLength(0);
    getCell(w, 3, 5);
    getCell(w, 3, 5_000_000);
    expect(w.chunks.filter(Boolean)).toHaveLength(2);
  });

  it('hat 100 gleich lange Zonen mit eindeutigen Namen', () => {
    expect(ZONES).toHaveLength(100);
    expect(ZONE_LENGTH).toBe(HEART_DEPTH / 100);
    ZONES.forEach((z, i) => {
      expect(z.from).toBe(i * ZONE_LENGTH);
      expect(z.index).toBe(i);
    });
    expect(new Set(ZONES.map((z) => z.name)).size).toBe(100);
    expect(ZONES.slice(0, 4).map((z) => z.name)).toEqual(['Erde I', 'Tiefschiefer I', 'Magmazone I', 'Kristallhöhle I']);
    expect(ZONES[99]?.name).toBe('Kristallhöhle XXV');
  });

  it('findet die richtige Zone an den Grenzen', () => {
    expect(zoneAt(0).index).toBe(0);
    expect(zoneAt(ZONE_LENGTH - 1).index).toBe(0);
    expect(zoneAt(ZONE_LENGTH).index).toBe(1);
    expect(zoneAt(54 * ZONE_LENGTH + 321).index).toBe(54);
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
    expect(zoneValueScale(HEART_DEPTH - 1)).toBeCloseTo(10.9);
    for (const z of ZONES) expect(z.darkness).toBeLessThanOrEqual(0.97);
  });

  it('nutzt je Zone das passende Grundgestein (Stichproben je Zone)', () => {
    const w = generateWorld('zonen');
    for (const z of ZONES) {
      let base = 0;
      let total = 0;
      for (let k = 0; k < 30; k++) {
        const y = z.from + 5 + k * 997;
        for (let x = 0; x < WIDTH; x++) {
          total++;
          if (getCell(w, x, y) === z.base) base++;
        }
      }
      expect(base / total, z.name).toBeGreaterThan(0.6);
    }
  });

  it('enthält keine Lava mehr, aber Fledermäuse, Geröll, Sprengkisten und Truhen', () => {
    const w = generateWorld('keine-lava');
    const kinds = new Set<number>();
    for (let y = 1; y < 20_000; y++) for (let x = 0; x < WIDTH; x++) kinds.add(getCell(w, x, y));
    expect(Object.keys(Block)).not.toContain('Lava');
    expect(Object.keys(Block)).not.toContain('LavaSource');
    expect(kinds.has(Block.Boulder)).toBe(true);
    expect(kinds.has(Block.Crate)).toBe(true);
    expect(kinds.has(Block.Chest)).toBe(true);
    expect(batSpawnsIn(w, 0, 20_000).length).toBeGreaterThan(0);
  });

  it('platziert zonenspezifische Erze', () => {
    const w = generateWorld('inhalt');
    const has = (b: number, from: number, to: number): boolean => {
      for (let y = from; y < to; y++) for (let x = 0; x < WIDTH; x++) if (getCell(w, x, y) === b) return true;
      return false;
    };
    const kristall = ZONES[3]?.from ?? 0;
    expect(has(Block.Diamond, 0, 20_000)).toBe(false); // Erde I
    expect(has(Block.Diamond, kristall, kristall + 20_000)).toBe(true); // Kristallhöhle I
  });
});
