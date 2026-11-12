import { describe, expect, it } from 'vitest';
import { LEVEL_SCALE, UPGRADES } from '../src/config';
import { createGame } from '../src/game/state';
import { batSpawnsIn, generateWorld, getCell } from '../src/game/world';
import { computeMods, describeLevel, emptyUpgrades } from '../src/meta/shop';

const RANGE = 300_000; // Zeilen, die für Zählungen untersucht werden

function world(seed: string, batReduction: number): ReturnType<typeof generateWorld> {
  return generateWorld(seed, { batReduction });
}

describe('Bannzeichen: weniger Fledermäuse', () => {
  it('ist ein Upgrade mit vielen Stufen und Obergrenze 90 %', () => {
    const def = UPGRADES.find((u) => u.id === 'ward');
    expect(def?.maxLevel).toBe(900 * LEVEL_SCALE);
    expect(computeMods({ ...emptyUpgrades(), ward: 100 }).hazardReduction).toBeCloseTo(0.1);
    expect(computeMods({ ...emptyUpgrades(), ward: 900 }).hazardReduction).toBeCloseTo(0.9);
    expect(computeMods(emptyUpgrades()).hazardReduction).toBe(0);
    expect(describeLevel('ward', 500)).toContain('50');
    expect(describeLevel('ward', 500)).not.toContain('Lava');
  });

  it('ohne Upgrade bleibt die Welt unverändert', () => {
    const a = generateWorld('ward-1');
    const b = world('ward-1', 0);
    expect(batSpawnsIn(b, 0, RANGE)).toEqual(batSpawnsIn(a, 0, RANGE));
  });

  it('entfernt ungefähr den eingestellten Anteil an Fledermäusen', () => {
    const all = batSpawnsIn(world('ward-2', 0), 0, RANGE).length;
    const half = batSpawnsIn(world('ward-2', 0.5), 0, RANGE).length;
    expect(all).toBeGreaterThan(1000);
    expect(half / all).toBeGreaterThan(0.45);
    expect(half / all).toBeLessThan(0.55);
  });

  it('verändert sonst nichts und ist deterministisch (Tagesschacht bleibt für alle gleich)', () => {
    const base = generateWorld('ward-3');
    const a = world('ward-3', 0.4);
    const b = world('ward-3', 0.4);
    expect(batSpawnsIn(a, 0, 50_000)).toEqual(batSpawnsIn(b, 0, 50_000));
    for (let y = 0; y < 2000; y++) for (let x = 0; x < 7; x++) expect(getCell(a, x, y)).toBe(getCell(base, x, y));
  });

  it('höhere Stufe entfernt stets eine Obermenge der niedrigeren', () => {
    const low = batSpawnsIn(world('ward-4', 0.2), 0, 100_000);
    const high = batSpawnsIn(world('ward-4', 0.6), 0, 100_000);
    const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
    const lowSet = new Set(low.map(key));
    for (const p of high) expect(lowSet.has(key(p))).toBe(true);
    expect(high.length).toBeLessThan(low.length);
  });

  it('wirkt im Spiel: weniger Fledermäuse in der Welt', () => {
    const plain = createGame({ seed: 'ward-5', mods: computeMods(emptyUpgrades()) });
    const warded = createGame({ seed: 'ward-5', mods: computeMods({ ...emptyUpgrades(), ward: 900 }) });
    const n = (s: typeof plain): number => batSpawnsIn(s.world, 0, 100_000).length;
    expect(n(warded)).toBeLessThan(n(plain) * 0.2);
    expect(n(plain)).toBeGreaterThan(300);
  });
});
