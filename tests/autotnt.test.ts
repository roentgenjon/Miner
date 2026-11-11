import { describe, expect, it } from 'vitest';
import { AUTO_TNT, STEP } from '../src/config';
import { step } from '../src/game/game';
import { Block } from '../src/game/types';
import { defaultMeta, parseMeta } from '../src/meta/save';
import { blankGame, cell, put } from './helpers';

function run(s: ReturnType<typeof blankGame>, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
}

describe('Auto-Dynamit', () => {
  it('ist standardmäßig aus und legt dann nichts', () => {
    const s = blankGame();
    s.input.held = 'down';
    run(s, 3);
    expect(s.tnts).toHaveLength(0);
    expect(s.player.tnt).toBe(40);
  });

  it('legt beim Graben in festen Abständen Ladungen voraus und verbraucht Dynamit', () => {
    const s = blankGame();
    s.input.autoTnt = true;
    s.input.held = 'down';
    run(s, 3);
    const used = 40 - s.player.tnt;
    expect(used).toBeGreaterThanOrEqual(1);
    expect(used).toBeLessThanOrEqual(Math.ceil(3 / AUTO_TNT.interval) + 1);
    expect(s.events.filter((e) => e.type === 'tntPlace').length).toBe(used);
  });

  it('legt die Ladung AUTO_TNT.ahead Felder voraus in Grabrichtung', () => {
    const s = blankGame();
    s.input.autoTnt = true;
    s.autoTntT = AUTO_TNT.interval;
    s.player.y = 20;
    for (let y = 1; y <= 20; y++) put(s, 3, y, Block.Air);
    s.input.held = 'right';
    // erst eine Grab-Aktion starten
    step(s, STEP);
    step(s, STEP);
    const t = s.tnts[0];
    expect(t).toBeDefined();
    expect(t?.x).toBe(3 + AUTO_TNT.ahead);
    expect(t?.y).toBe(20);
    expect(t?.safe).toBe(true);
  });

  it('sprengt Blöcke voraus, ohne den Spieler zu verletzen', () => {
    const s = blankGame();
    s.input.autoTnt = true;
    s.input.held = 'down';
    const hp = s.player.hp;
    run(s, 6);
    expect(s.stats.tntBlocks).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === 'explosion')).toBe(true);
    expect(s.player.hp).toBe(hp);
    expect(s.status).toBe('playing');
  });

  it('legt nichts ohne Dynamit, ohne zu graben und gegen Grundgestein/Oberfläche', () => {
    const empty = blankGame();
    empty.input.autoTnt = true;
    empty.player.tnt = 0;
    empty.input.held = 'down';
    run(empty, 3);
    expect(empty.tnts).toHaveLength(0);

    const idle = blankGame();
    idle.input.autoTnt = true;
    run(idle, 3);
    expect(idle.player.tnt).toBe(40);

    const up = blankGame(); // an der Oberfläche nach oben: y < 1
    up.input.autoTnt = true;
    up.input.held = 'up';
    run(up, 2);
    expect(up.player.tnt).toBe(40);
  });

  it('wird im Speicherstand gemerkt', () => {
    expect(defaultMeta().autoTnt).toBe(false);
    expect(parseMeta({ autoTnt: true }).autoTnt).toBe(true);
    expect(parseMeta({ autoTnt: 'ja' }).autoTnt).toBe(false);
    expect(cell(blankGame(), 3, 5)).toBe(Block.Dirt);
  });
});
