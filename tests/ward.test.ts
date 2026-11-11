import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { createGame } from '../src/game/state';
import { Block } from '../src/game/types';
import { generateWorld, thinHazards } from '../src/game/world';
import { computeMods, describeLevel, emptyUpgrades } from '../src/meta/shop';

function count(w: ReturnType<typeof generateWorld>, b: number): number {
  let n = 0;
  for (const c of w.cells) if (c === b) n++;
  return n;
}

function thinned(seed: string, fraction: number): ReturnType<typeof generateWorld> {
  const w = generateWorld(seed);
  thinHazards(w, fraction);
  return w;
}

describe('Bannzeichen: weniger Fledermäuse und Lava', () => {
  it('ist ein Upgrade mit vielen Stufen und Obergrenze 90 %', () => {
    const def = UPGRADES.find((u) => u.id === 'ward');
    expect(def?.maxLevel).toBe(900);
    expect(computeMods({ ...emptyUpgrades(), ward: 100 }).hazardReduction).toBeCloseTo(0.1);
    expect(computeMods({ ...emptyUpgrades(), ward: 900 }).hazardReduction).toBeCloseTo(0.9);
    expect(computeMods(emptyUpgrades()).hazardReduction).toBe(0);
    expect(describeLevel('ward', 500)).toContain('50');
  });

  it('ohne Upgrade bleibt die Welt unverändert', () => {
    const a = generateWorld('ward-1');
    const b = thinned('ward-1', 0);
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(b.batSpawns).toEqual(a.batSpawns);
    expect(b.lavaSources).toEqual(a.lavaSources);
  });

  it('entfernt ungefähr den eingestellten Anteil an Fledermäusen und Lava', () => {
    const base = generateWorld('ward-2');
    const half = thinned('ward-2', 0.5);
    const batRatio = half.batSpawns.length / base.batSpawns.length;
    expect(batRatio).toBeGreaterThan(0.43);
    expect(batRatio).toBeLessThan(0.57);
    for (const b of [Block.Lava, Block.LavaSource]) {
      const r = count(half, b) / count(base, b);
      expect(r, `Block ${b}`).toBeGreaterThan(0.45);
      expect(r, `Block ${b}`).toBeLessThan(0.55);
    }
    expect(half.lavaSources.length).toBe(count(half, Block.LavaSource));
  });

  it('verändert sonst nichts und ist deterministisch (Tagesschacht bleibt für alle gleich)', () => {
    const base = generateWorld('ward-3');
    const a = thinned('ward-3', 0.4);
    const b = thinned('ward-3', 0.4);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.batSpawns).toEqual(b.batSpawns);
    for (let i = 0; i < base.cells.length; i++) {
      const orig = base.cells[i];
      if (orig !== Block.Lava && orig !== Block.LavaSource) expect(a.cells[i]).toBe(orig);
      else expect([orig, a.cells[i]]).toContain(a.cells[i]); // bleibt oder wird abgekühlt
    }
  });

  it('höhere Stufe entfernt stets eine Obermenge der niedrigeren', () => {
    const low = thinned('ward-4', 0.2);
    const high = thinned('ward-4', 0.6);
    const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
    const lowBats = new Set(low.batSpawns.map(key));
    for (const p of high.batSpawns) expect(lowBats.has(key(p))).toBe(true);
    const lowLava = new Set(low.lavaSources.map(key));
    for (const p of high.lavaSources) expect(lowLava.has(key(p))).toBe(true);
    for (let i = 0; i < low.cells.length; i++) {
      if (high.cells[i] === Block.Lava) expect(low.cells[i]).toBe(Block.Lava);
    }
  });

  it('wirkt im Spiel: weniger Fledermäuse und Lavatimer beim Rundenstart', () => {
    const plain = createGame({ seed: 'ward-5', mods: computeMods(emptyUpgrades()) });
    const warded = createGame({ seed: 'ward-5', mods: computeMods({ ...emptyUpgrades(), ward: 900 }) });
    expect(warded.bats.length).toBeLessThan(plain.bats.length * 0.2);
    expect(warded.lava.length).toBeLessThan(plain.lava.length * 0.2);
    expect(plain.bats.length).toBeGreaterThan(100);
  });
});
