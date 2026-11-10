import { describe, expect, it } from 'vitest';
import { STEP, TNT } from '../src/config';
import { step } from '../src/game/game';
import { explode, lightCrate, placeTnt } from '../src/game/tnt';
import { Block } from '../src/game/types';
import { blankGame, cell, put } from './helpers';

function run(s: ReturnType<typeof blankGame>, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
}

describe('Dynamit', () => {
  it('startet mit 40 Dynamit plus 3 pro Stufe', () => {
    const s = blankGame();
    expect(s.player.tnt).toBe(40);
  });

  it('wird platziert, verbraucht Vorrat und zündet nach der Lunte', () => {
    const s = blankGame();
    s.player.y = 10;
    for (let y = 1; y <= 10; y++) put(s, 3, y, Block.Air);
    s.player.hp = 3;
    expect(placeTnt(s)).toBe(true);
    expect(s.player.tnt).toBe(39);
    expect(placeTnt(s)).toBe(false); // gleiche Zelle
    run(s, TNT.fuse - 0.1);
    expect(s.tnts).toHaveLength(1);
    run(s, 0.3);
    expect(s.tnts).toHaveLength(0);
  });

  it('sprengt einen 3x3-Bereich, schont Grundgestein und Herz', () => {
    const s = blankGame();
    put(s, 2, 21, Block.Bedrock);
    put(s, 4, 19, Block.Heart);
    explode(s, 3, 20, TNT.radius);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const expected = dx === -1 && dy === 1 ? Block.Bedrock : dx === 1 && dy === -1 ? Block.Heart : Block.Air;
        expect(cell(s, 3 + dx, 20 + dy)).toBe(expected);
      }
    }
    expect(cell(s, 3, 22)).toBe(Block.Dirt);
    expect(s.stats.tntBlocks).toBe(7);
  });

  it('verletzt den Spieler im Radius, nicht außerhalb', () => {
    const s = blankGame();
    s.player.x = 3;
    s.player.y = 20;
    explode(s, 3, 22, TNT.radius);
    expect(s.player.hp).toBe(3);
    explode(s, 3, 21, TNT.radius);
    expect(s.player.hp).toBe(3 - TNT.playerDamage);
  });

  it('tötet Fledermäuse im Radius', () => {
    const s = blankGame();
    s.bats.push({ id: 99, x: 4, y: 20, hp: 1, t: 1, cd: 0, awake: false });
    explode(s, 3, 20, TNT.radius);
    expect(s.bats).toHaveLength(0);
    expect(s.stats.bats).toBe(1);
  });

  it('löst Kettenreaktion zwischen Dynamit-Ladungen aus', () => {
    const s = blankGame();
    s.player.y = 0;
    for (const x of [0, 1, 2]) {
      put(s, x, 30, Block.Air);
      s.tnts.push({ id: 100 + x, x, y: 30, fuse: x === 0 ? 0.05 : 5, kind: 'tnt' });
    }
    run(s, 0.1);
    expect(s.tnts.length).toBeLessThan(3);
    run(s, 0.6);
    expect(s.tnts).toHaveLength(0);
    // Alle drei haben explodiert, obwohl ihre Lunte 5 s lang war.
    expect(s.events.filter((e) => e.type === 'explosion')).toHaveLength(3);
  });

  it('zündet Sprengkisten in der Nähe einer Explosion (Kette über mehrere Kisten)', () => {
    const s = blankGame();
    const ys = [40, 42, 44, 46];
    for (const y of ys) put(s, 3, y, Block.Crate);
    explode(s, 3, 39, TNT.radius); // trifft nur die erste Kiste
    expect(s.tnts.filter((t) => t.kind === 'crate')).toHaveLength(1);
    run(s, 3);
    expect(s.tnts).toHaveLength(0);
    for (const y of ys) expect(cell(s, 3, y)).toBe(Block.Air);
    expect(s.events.filter((e) => e.type === 'explosion')).toHaveLength(1 + ys.length);
  });

  it('zündet angebaute Sprengkisten nach kurzer Lunte', () => {
    const s = blankGame();
    lightCrate(s, 3, 50);
    expect(s.tnts[0]?.fuse).toBe(TNT.crateFuse);
  });
});
