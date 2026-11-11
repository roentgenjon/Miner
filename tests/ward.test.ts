import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { createGame } from '../src/game/state';
import { generateWorld, thinHazards } from '../src/game/world';
import { computeMods, describeLevel, emptyUpgrades } from '../src/meta/shop';

function thinned(seed: string, fraction: number): ReturnType<typeof generateWorld> {
  const w = generateWorld(seed);
  thinHazards(w, fraction);
  return w;
}

describe('Bannzeichen: weniger Fledermäuse', () => {
  it('ist ein Upgrade mit vielen Stufen und Obergrenze 90 %', () => {
    const def = UPGRADES.find((u) => u.id === 'ward');
    expect(def?.maxLevel).toBe(900);
    expect(computeMods({ ...emptyUpgrades(), ward: 100 }).hazardReduction).toBeCloseTo(0.1);
    expect(computeMods({ ...emptyUpgrades(), ward: 900 }).hazardReduction).toBeCloseTo(0.9);
    expect(computeMods(emptyUpgrades()).hazardReduction).toBe(0);
    expect(describeLevel('ward', 500)).toContain('50');
    expect(describeLevel('ward', 500)).not.toContain('Lava');
  });

  it('ohne Upgrade bleibt die Welt unverändert', () => {
    const a = generateWorld('ward-1');
    const b = thinned('ward-1', 0);
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(b.batSpawns).toEqual(a.batSpawns);
  });

  it('entfernt ungefähr den eingestellten Anteil an Fledermäusen', () => {
    const base = generateWorld('ward-2');
    const half = thinned('ward-2', 0.5);
    const ratio = half.batSpawns.length / base.batSpawns.length;
    expect(ratio).toBeGreaterThan(0.43);
    expect(ratio).toBeLessThan(0.57);
  });

  it('verändert sonst nichts und ist deterministisch (Tagesschacht bleibt für alle gleich)', () => {
    const base = generateWorld('ward-3');
    const a = thinned('ward-3', 0.4);
    const b = thinned('ward-3', 0.4);
    expect(a.batSpawns).toEqual(b.batSpawns);
    expect(Array.from(a.cells)).toEqual(Array.from(base.cells));
  });

  it('höhere Stufe entfernt stets eine Obermenge der niedrigeren', () => {
    const low = thinned('ward-4', 0.2);
    const high = thinned('ward-4', 0.6);
    const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
    const lowBats = new Set(low.batSpawns.map(key));
    for (const p of high.batSpawns) expect(lowBats.has(key(p))).toBe(true);
  });

  it('wirkt im Spiel: weniger Fledermäuse beim Rundenstart', () => {
    const plain = createGame({ seed: 'ward-5', mods: computeMods(emptyUpgrades()) });
    const warded = createGame({ seed: 'ward-5', mods: computeMods({ ...emptyUpgrades(), ward: 900 }) });
    expect(warded.bats.length).toBeLessThan(plain.bats.length * 0.2);
    expect(plain.bats.length).toBeGreaterThan(100);
  });
});
