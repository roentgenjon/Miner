import { describe, expect, it } from 'vitest';
import { BLOCKS, ORE_VALUE_MULT, STEP, zoneValueScale } from '../src/config';
import { step } from '../src/game/game';
import { Block } from '../src/game/types';
import { computeMods, emptyUpgrades } from '../src/meta/shop';
import { blankGame, put } from './helpers';

function mine(block: number, oreLevel = 0): number {
  const s = blankGame();
  s.mods = computeMods({ ...emptyUpgrades(), ore: oreLevel });
  put(s, 3, 1, block);
  s.input.held = 'down';
  for (let t = 0; t < 1.5; t += STEP) step(s, STEP);
  return s.stats.money;
}

describe('Erzwert', () => {
  it('Erze sind das Zehnfache wert', () => {
    expect(ORE_VALUE_MULT).toBe(10);
    expect(mine(Block.Copper)).toBe(60);
    expect(mine(Block.Iron)).toBe(140);
    expect(mine(Block.Gold)).toBe(360);
    expect(mine(Block.Ruby)).toBe(800);
    expect(mine(Block.Amethyst)).toBe(1200);
    expect(mine(Block.Diamond)).toBe(2200);
  });

  it('jedes Erz ist wertvoller als das schlechtere davor', () => {
    const order = [Block.Copper, Block.Iron, Block.Gold, Block.Ruby, Block.Amethyst, Block.Diamond];
    const values = order.map((b) => BLOCKS[b]?.value ?? 0);
    for (let i = 1; i < values.length; i++) expect(values[i] as number).toBeGreaterThan(values[i - 1] as number);
  });

  it('Erzgespür und Zonenwert wirken weiter obendrauf', () => {
    expect(mine(Block.Copper, 200)).toBe(Math.round(6 * ORE_VALUE_MULT * (1 + 0.005 * 200)));
    expect(zoneValueScale(0)).toBe(1);
  });

  it('Kohle gibt weiter Energie statt Münzen', () => {
    expect(mine(Block.Coal)).toBe(0);
  });
});
