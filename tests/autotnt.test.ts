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

  it('legt beim Graben alle 25 ms eine Ladung (≈ 40 pro Sekunde) und verbraucht Dynamit', () => {
    expect(AUTO_TNT.interval).toBe(0.025);
    const s = blankGame();
    s.player.tnt = 10_000;
    s.input.autoTnt = true;
    s.input.held = 'down';
    run(s, 1);
    const used = 10_000 - s.player.tnt;
    // 1 s / 25 ms = 40 Ladungen; ± Anlaufzeit des ersten Grabens
    expect(used).toBeGreaterThanOrEqual(38);
    expect(used).toBeLessThanOrEqual(41);
    expect(s.events.filter((e) => e.type === 'tntPlace').length).toBe(used);
  });

  it('die Rate hängt nicht von der Logikschritt-Länge ab (30 Hz und 60 Hz liefern gleich viele)', () => {
    const count = (dt: number): number => {
      const s = blankGame();
      s.player.tnt = 10_000;
      s.input.autoTnt = true;
      s.input.held = 'down';
      for (let t = 0; t < 2; t += dt) step(s, dt);
      return 10_000 - s.player.tnt;
    };
    const a = count(1 / 60);
    const b = count(1 / 120);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.ceil(a * 0.4)); // bei 60 Hz höchstens 1 pro Schritt
    expect(a).toBeGreaterThan(60);
  });

  it('verbraucht den Vorrat von 40 Dynamit in etwa einer Sekunde', () => {
    const s = blankGame();
    s.input.autoTnt = true;
    s.input.held = 'down';
    run(s, 2);
    expect(s.player.tnt).toBe(0);
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

  it('legt nichts ohne Dynamit, ohne zu graben und außerhalb des Schachts', () => {
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

    const up = blankGame(); // an der Oberfläche nach oben: y < 1 (außerhalb des Schachts)
    up.input.autoTnt = true;
    up.input.held = 'up';
    run(up, 2);
    expect(up.player.tnt).toBe(40);
  });

  it('schützt vor Fallschaden in die selbst aufgerissenen Schächte', () => {
    const s = blankGame();
    s.input.autoTnt = true;
    s.player.tnt = 10_000;
    s.input.held = 'down';
    run(s, 4);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.status).toBe('playing');
    expect(s.player.y).toBeGreaterThan(8);
    // ohne Auto-Sprengung bleibt der Fallschaden normal (hier: Sturz aus großer Höhe)
    const f = blankGame();
    for (let y = 1; y <= 15; y++) put(f, 3, y, Block.Air);
    f.player.y = 1;
    run(f, 2);
    expect(f.player.hp).toBeLessThan(f.player.maxHp);
  });

  it('wird im Speicherstand gemerkt', () => {
    expect(defaultMeta().autoTnt).toBe(false);
    expect(parseMeta({ autoTnt: true }).autoTnt).toBe(true);
    expect(parseMeta({ autoTnt: 'ja' }).autoTnt).toBe(false);
    expect(cell(blankGame(), 3, 5)).toBe(Block.Dirt);
  });
});
