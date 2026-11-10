import { describe, expect, it } from 'vitest';
import { START_X, STEP, TNT, UPGRADES } from '../src/config';
import { step } from '../src/game/game';
import { comboMult } from '../src/game/loot';
import { createGame, damagePlayer } from '../src/game/state';
import { explode } from '../src/game/tnt';
import { Block } from '../src/game/types';
import { getCell } from '../src/game/world';
import { computeMods, describeLevel, emptyUpgrades } from '../src/meta/shop';
import { blankGame, cell } from './helpers';

function gameWith(levels: Partial<ReturnType<typeof emptyUpgrades>>) {
  const u = { ...emptyUpgrades(), ...levels };
  return createGame({ seed: 'upg', mods: computeMods(u) });
}

describe('Neue Upgrades', () => {
  it('jedes Upgrade verändert auf Stufe 1 mindestens einen Spielwert', () => {
    const base = computeMods(emptyUpgrades());
    for (const d of UPGRADES) {
      const m = computeMods({ ...emptyUpgrades(), [d.id]: 1 });
      expect(JSON.stringify(m), d.id).not.toBe(JSON.stringify(base));
      expect(describeLevel(d.id, 1).length).toBeGreaterThan(0);
    }
  });

  it('Sprengkraft vergrößert den Dynamit-Radius', () => {
    const s = blankGame();
    s.mods = computeMods({ ...emptyUpgrades(), power: 2 });
    expect(s.mods.tntRadius).toBe(TNT.radius + 1);
    explode(s, 3, 30, s.mods.tntRadius);
    expect(cell(s, 3, 32)).toBe(Block.Air); // 2 Felder entfernt
    expect(cell(s, 3, 34)).toBe(Block.Dirt);
  });

  it('Zweites Leben belebt einmal pro Stufe wieder', () => {
    const s = gameWith({ revive: 1 });
    expect(s.revives).toBe(1);
    damagePlayer(s, 99, 'test', true);
    expect(s.status).toBe('playing');
    expect(s.player.hp).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === 'revive')).toBe(true);
    damagePlayer(s, 99, 'test', true);
    expect(s.status).toBe('dead');
  });

  it('Fahrstuhl startet tiefer in einem freigeräumten Schacht', () => {
    const s = gameWith({ lift: 4 });
    expect(s.player.y).toBe(200);
    expect(s.stats.depth).toBe(200);
    for (const y of [1, 100, 200]) expect(getCell(s.world, START_X, y)).toBe(Block.Air);
    const hp = s.player.hp;
    for (let i = 0; i < 120; i++) step(s, STEP);
    expect(s.player.hp).toBe(hp); // kein Fallschaden beim Start
  });

  it('Kombo-Meister erhöht die Multiplikator-Obergrenze', () => {
    const base = computeMods(emptyUpgrades());
    const m = computeMods({ ...emptyUpgrades(), master: 2 });
    expect(comboMult(100, base.comboMax)).toBe(5);
    expect(comboMult(100, m.comboMax)).toBe(6);
  });

  it('Hitzeschutz reduziert Lavaschaden', () => {
    const s = gameWith({ heat: 2 });
    expect(s.mods.lavaReduction).toBe(2);
  });

  it('Sparlampe und Schonende Hacke senken den Verbrauch', () => {
    const m = computeMods({ ...emptyUpgrades(), saver: 5, gentle: 5 });
    expect(m.drainMult).toBeCloseTo(0.7);
    expect(m.digCostMult).toBeCloseTo(0.4);
  });
});
