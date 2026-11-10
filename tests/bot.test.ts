import { describe, expect, it } from 'vitest';
import { STEP } from '../src/config';
import { createGame } from '../src/game/game';
import { step } from '../src/game/game';
import { computeMods, emptyUpgrades } from '../src/meta/shop';
import { Block } from '../src/game/types';
import { getCell } from '../src/game/world';

/** Einfacher Bot: gräbt nach unten, weicht seitlich aus, wenn unten Grundgestein/Lava ist. */
function playBot(seed: string, level = 0): { depth: number; status: string; time: number; wallet: number } {
  const u = emptyUpgrades();
  for (const k of Object.keys(u) as (keyof typeof u)[]) u[k] = level;
  const s = createGame({ seed, mods: computeMods(u) });
  for (let i = 0; i < 60 * 60 * 20 && s.status === 'playing'; i++) {
    const below = getCell(s.world, s.player.x, s.player.y + 1);
    s.input.held = below === Block.Lava ? (s.player.x > 3 ? 'left' : 'right') : 'down';
    step(s, STEP);
    s.events.length = 0;
  }
  return { depth: s.stats.depth, status: s.status, time: s.time, wallet: s.wallet };
}

describe('Balancing-Sanity (Bot)', () => {
  it('Grundausstattung kommt tiefer als die Erdzone, aber nicht bis zum Herz', () => {
    const r = [1, 2, 3, 4, 5].map((i) => playBot(`bot-${i}`));
    const avg = r.reduce((a, b) => a + b.depth, 0) / r.length;
    expect(avg).toBeGreaterThan(20);
  });

  it('Voll ausgebauter Charakter ist deutlich weiter', () => {
    const r = [1, 2, 3].map((i) => playBot(`bot-${i}`, 5));
    const base = [1, 2, 3].map((i) => playBot(`bot-${i}`, 0));
    const a = r.reduce((x, y) => x + y.depth, 0);
    const b = base.reduce((x, y) => x + y.depth, 0);
    expect(a).toBeGreaterThanOrEqual(b);
  });
});
