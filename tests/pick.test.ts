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
  it('jede Stufenmarke ist spürbar schneller als die vorige (auch bei sehr hohen Stufen)', () => {
    const marks = [0, 1, 3, 5, 10, 100, 1000];
    const depths = marks.map(depthAfter3s);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i] as number, `Stufe ${marks[i]}`).toBeGreaterThan(depths[i - 1] as number);
    }
  });

  it('das echte Tempo folgt dem angezeigten Faktor (nicht nur der Blockabbau-Zeit)', () => {
    const base = depthAfter3s(0);
    expect(depthAfter3s(3) / base).toBeGreaterThan(2.2); // angezeigt ×2,8
    expect(depthAfter3s(5) / base).toBeGreaterThan(3.5); // ×4
    expect(depthAfter3s(10) / base).toBeGreaterThan(6); // ×7
    expect(depthAfter3s(100) / base).toBeGreaterThan(40); // ×61 (kein Abschneiden durch feste Zeiten)
    expect(depthAfter3s(1000) / base).toBeGreaterThan(400); // ×601
  });

  it('Grundtempo ohne Upgrade bleibt unverändert', () => {
    expect(depthAfter3s(0)).toBe(13);
  });
});
