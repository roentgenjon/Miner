import { describe, expect, it } from 'vitest';
import { STEP } from '../src/config';
import { step } from '../src/game/game';
import { computeMods, emptyUpgrades } from '../src/meta/shop';
import { blankGame } from './helpers';

/** Wie viele Felder gräbt man in 3 s senkrecht durch reine Erde? */
function depthAfter3s(pick: number): number {
  const s = blankGame();
  s.mods = computeMods({ ...emptyUpgrades(), pick });
  s.player.maxEnergy = s.player.energy = 1e9;
  s.input.held = 'down';
  for (let i = 0; i < 180; i++) step(s, STEP);
  return s.player.y;
}

describe('Spitzhacke: Grabtempo skaliert über alle Stufen', () => {
  it('jede Stufenmarke ist spürbar schneller als die vorige (auch über Stufe 25 hinaus)', () => {
    const marks = [0, 10, 25, 50, 100, 1000, 10000];
    const depths = marks.map(depthAfter3s);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i] as number, `Stufe ${marks[i]}`).toBeGreaterThan(depths[i - 1] as number);
    }
  });

  it('das echte Tempo folgt dem angezeigten Faktor (nicht nur der Blockabbau-Zeit)', () => {
    const base = depthAfter3s(0);
    expect(depthAfter3s(25) / base).toBeGreaterThan(2.2); // angezeigt ×2,5
    expect(depthAfter3s(50) / base).toBeGreaterThan(3.5); // ×4
    expect(depthAfter3s(100) / base).toBeGreaterThan(6); // ×7
  });

  it('Grundtempo ohne Upgrade bleibt unverändert', () => {
    expect(depthAfter3s(0)).toBe(13);
  });
});
