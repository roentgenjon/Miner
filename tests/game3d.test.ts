import { describe, expect, it } from 'vitest';
import { HEART_DEPTH, LAYER3, STEP } from '../src/config';
import { drainEvents, step } from '../src/game/game';
import { Block } from '../src/game/types';
import { createGame3 } from '../src/game3d/game3';
import { explode3, placeTnt3 } from '../src/game3d/logic3';
import { CELLS_PER_LAYER, D3, W3, createWorld3, getCell3, layerCleared, setCell3 } from '../src/game3d/world3';
import { computeMods, emptyUpgrades } from '../src/meta/shop';

const run = (s: ReturnType<typeof createGame3>, seconds: number): void => {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
};
const game = (fill: number | undefined = Block.Dirt, upgrades = emptyUpgrades()): ReturnType<typeof createGame3> => {
  const s = createGame3({ seed: 'd3', mods: computeMods(upgrades), fill });
  s.player.maxEnergy = s.player.energy = 1e9;
  s.player.hp = 1e6;
  s.fallProtectUntil = 1e9;
  return s;
};

describe('3D-Welt', () => {
  it('ist deterministisch, hat Luft an der Oberfläche, feste Ebenen darunter und das Herz am Ende', () => {
    const a = createWorld3('x');
    const b = createWorld3('x');
    for (let y = 0; y < 40; y++) for (let z = 0; z < D3; z++) for (let x = 0; x < W3; x++) expect(getCell3(a, x, y, z)).toBe(getCell3(b, x, y, z));
    expect(getCell3(a, 3, 0, 3)).toBe(Block.Air);
    let solid = 0;
    for (let z = 0; z < D3; z++) for (let x = 0; x < W3; x++) if (getCell3(a, x, 1, z) !== Block.Air) solid++;
    expect(solid).toBe(CELLS_PER_LAYER);
    expect(getCell3(a, 3, HEART_DEPTH, 3)).toBe(Block.Heart);
    expect(getCell3(a, 0, HEART_DEPTH, 0)).toBe(Block.Bedrock);
    expect(getCell3(a, -1, 5, 0)).toBe(Block.Bedrock);
    expect(getCell3(a, 0, 5, D3)).toBe(Block.Bedrock);
  });

  it('abgebaute Felder werden Luft; Ebenen-Anteil wird gezählt', () => {
    const w = createWorld3('x', Block.Dirt);
    expect(layerCleared(w, 5)).toBe(0);
    setCell3(w, 1, 5, 1, Block.Air);
    expect(layerCleared(w, 5)).toBeCloseTo(1 / CELLS_PER_LAYER);
    expect(layerCleared(w, 0)).toBe(1);
  });
});

describe('Schicht nach Schicht', () => {
  it('man gräbt nach unten, aber nicht tiefer als die freigegebene Ebene', () => {
    const s = game();
    const d = s.d3!;
    expect(d.unlocked).toBe(1);
    s.input.held3 = 'dn';
    run(s, 3);
    expect(s.player.y).toBe(1); // Ebene 1 abgebaut, Spieler steht darin
    expect(getCell3(d.world, 3, 2, 3)).toBe(Block.Dirt); // Ebene 2 noch gesperrt
    expect(drainEvents(s).some((e) => e.type === 'blocked')).toBe(true);
  });

  it('wird mehr als die Hälfte einer Ebene abgeräumt, wird die nächste frei (mit Bonus)', () => {
    const s = game();
    const d = s.d3!;
    s.mods = { ...s.mods, tntRadius: 5 };
    s.player.y = 1;
    setCell3(d.world, 3, 1, 3, Block.Air);
    explode3(s, 3, 1, 3, 5, true);
    // explode3 allein gibt nicht frei – über den Dynamit-Takt:
    s.tnts.push({ id: 99, x: 3, y: 1, z: 3, fuse: 0.01, kind: 'tnt', safe: true });
    run(s, 0.1);
    expect(d.unlocked).toBeGreaterThanOrEqual(2);
    expect(layerCleared(d.world, 1)).toBeGreaterThanOrEqual(LAYER3.clearFraction);
    const ev = drainEvents(s);
    expect(ev.some((e) => e.type === 'layer')).toBe(true);
    expect(s.wallet).toBeGreaterThan(0);
  });

  it('Dynamit wirkt nicht in gesperrten Ebenen', () => {
    const s = game();
    const d = s.d3!;
    explode3(s, 3, 3, 3, 4, true);
    expect(getCell3(d.world, 3, 3, 3)).toBe(Block.Dirt);
    expect(getCell3(d.world, 3, 2, 3)).toBe(Block.Dirt);
  });

  it('Dynamit legen kostet einen Vorrat und lässt sich nicht doppelt auf dasselbe Feld legen', () => {
    const s = game();
    const n = s.player.tnt;
    expect(placeTnt3(s)).toBe(true);
    expect(placeTnt3(s)).toBe(false);
    expect(s.player.tnt).toBe(n - 1);
  });
});

describe('Bewegung in 3D', () => {
  it('läuft in alle vier Richtungen auf der Oberfläche und bleibt in der Fläche', () => {
    const s = game();
    const d = s.d3!;
    for (const [dir, key] of [['xm', 'x'], ['zp', 'z']] as const) {
      s.input.held3 = dir;
      run(s, 3);
      expect(key === 'x' ? s.player.x : d.z).toBeGreaterThanOrEqual(0);
    }
    s.input.held3 = 'xm';
    run(s, 3);
    expect(s.player.x).toBe(0);
    s.input.held3 = 'zm';
    run(s, 3);
    expect(d.z).toBe(0);
    s.input.held3 = 'zp';
    run(s, 4);
    expect(d.z).toBe(D3 - 1);
  });

  it('Erze bringen Münzen (Erzwert × globaler Faktor)', () => {
    const s = game(Block.Dirt);
    const d = s.d3!;
    setCell3(d.world, 3, 1, 3, Block.Gold);
    s.globalOre = 4;
    const before = s.wallet;
    s.input.held3 = 'dn';
    run(s, 2);
    expect(s.wallet - before).toBeGreaterThan(0);
    expect(s.stats.ores).toBe(1);
  });

  it('Bohrer räumt bei hoher Spitzhackenstufe mehrere Felder pro Aktion ab', () => {
    const up = emptyUpgrades();
    up.pick = 10_000_000_000;
    const s = game(Block.Dirt, up);
    expect(s.mods.drill).toBeGreaterThan(1);
    s.input.held3 = 'dn';
    run(s, 0.5);
    expect(layerCleared(s.d3!.world, 1)).toBeGreaterThanOrEqual(LAYER3.clearFraction);
    expect(s.d3!.unlocked).toBeGreaterThan(1);
  });

  it('Runde läuft stabil durch viele Ebenen (Bot mit Bohrer)', () => {
    const up = emptyUpgrades();
    up.pick = 10_000_000_000;
    const s = game(undefined, up);
    s.input.held3 = 'dn';
    run(s, 20);
    expect(s.status === 'playing' || s.status === 'dead').toBe(true);
    expect(s.d3!.unlocked).toBeGreaterThan(20);
    expect(s.player.y).toBeGreaterThan(20);
  });
});
