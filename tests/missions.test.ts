import { describe, expect, it } from 'vitest';
import { createRng } from '../src/game/rng';
import { emptyStats } from '../src/game/state';
import { createMissions, updateMissions } from '../src/meta/missions';

describe('Missionen', () => {
  it('zieht 3 verschiedene Missionen, deterministisch pro Seed', () => {
    const a = createMissions(createRng('m1'));
    const b = createMissions(createRng('m1'));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.id)).size).toBe(3);
    expect(a).toEqual(b);
  });

  it('verfolgt Fortschritt und meldet Abschluss genau einmal', () => {
    const [m] = createMissions(createRng('m2'));
    expect(m).toBeDefined();
    if (!m) return;
    const list = [m];
    const stats = emptyStats();

    stats[m.stat] = m.target - 1;
    expect(updateMissions(list, stats)).toHaveLength(0);
    expect(m.progress).toBe(m.target - 1);
    expect(m.done).toBe(false);

    stats[m.stat] = m.target + 5;
    const done = updateMissions(list, stats);
    expect(done).toEqual([m]);
    expect(m.done).toBe(true);
    expect(m.progress).toBe(m.target);

    expect(updateMissions(list, stats)).toHaveLength(0);
  });

  it('schließt Missionen im laufenden Spiel ab und zahlt Belohnung', async () => {
    const { blankGame } = await import('./helpers');
    const { step } = await import('../src/game/game');
    const s = blankGame();
    s.missions = [{ id: 'x', text: 'Test', stat: 'ores', target: 2, reward: 77, tier: 0, progress: 0, done: false }];
    s.stats.ores = 2;
    step(s, 1 / 60);
    expect(s.missions[0]?.done).toBe(true);
    expect(s.wallet).toBe(77);
    expect(s.events.some((e) => e.type === 'mission')).toBe(true);
  });
});
