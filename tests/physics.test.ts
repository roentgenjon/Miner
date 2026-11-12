import { describe, expect, it } from 'vitest';
import { HEART_DEPTH, ORE_VALUE_MULT, ROCK, STEP } from '../src/config';
import { step } from '../src/game/game';
import { Block } from '../src/game/types';
import { blankGame, cell, put } from './helpers';

function run(s: ReturnType<typeof blankGame>, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
}

describe('Geröll', () => {
  it('fällt, sobald der Halt darunter fehlt, und landet wieder als Block', () => {
    const s = blankGame();
    s.player.x = 0;
    s.player.y = 18;
    put(s, 0, 18, Block.Air);
    put(s, 0, 19, Block.Air);
    s.player.y = 18;
    s.player.px = 0;
    s.player.py = 18;
    // Spieler außerhalb der Fallbahn
    s.player.x = 6;
    put(s, 6, 18, Block.Air);
    put(s, 3, 20, Block.Boulder);
    put(s, 3, 21, Block.Air);
    put(s, 3, 22, Block.Air);
    put(s, 3, 23, Block.Air);
    run(s, ROCK.wobble - 0.1);
    expect(cell(s, 3, 20)).toBe(Block.Boulder);
    run(s, 1.5);
    expect(cell(s, 3, 20)).toBe(Block.Air);
    expect(cell(s, 3, 23)).toBe(Block.Boulder);
  });

  it('verletzt den Spieler beim Treffer', () => {
    const s = blankGame();
    s.player.x = 3;
    s.player.y = 20;
    put(s, 3, 20, Block.Air);
    put(s, 3, 21, Block.Dirt);
    s.rocks.push({ x: 3, y: 17, t: 0 });
    for (let y = 17; y <= 19; y++) put(s, 3, y, Block.Air);
    const hp = s.player.hp;
    run(s, 1);
    expect(s.player.hp).toBe(hp - ROCK.damage);
  });
});

describe('Spieler', () => {
  it('gräbt nach unten, fällt durch freie Schächte und nimmt Fallschaden', () => {
    const s = blankGame();
    for (let y = 1; y <= 12; y++) put(s, 3, y, Block.Air);
    s.player.hp = 3;
    run(s, 2);
    expect(s.player.y).toBe(12);
    expect(s.player.hp).toBeLessThan(3);
  });

  it('sammelt Erz mit Kombo-Multiplikator', () => {
    const s = blankGame();
    put(s, 3, 1, Block.Copper);
    put(s, 3, 2, Block.Copper);
    put(s, 3, 3, Block.Copper);
    s.input.held = 'down';
    run(s, 2);
    expect(s.stats.ores).toBe(3);
    expect(s.combo.count).toBe(3);
    // Kupfer-Grundwert 6 × Erzfaktor, Kombo ×1 / ×1,25 / ×1,5
    const base = 6 * ORE_VALUE_MULT;
    expect(s.stats.money).toBe(Math.round(base) + Math.round(base * 1.25) + Math.round(base * 1.5));
  });

  it('Sieg beim Abbauen des Herzens', () => {
    const s = blankGame();
    put(s, 3, HEART_DEPTH - 1, Block.Air);
    s.player.y = HEART_DEPTH - 1;
    s.player.px = 3;
    s.player.py = HEART_DEPTH - 1;
    put(s, 3, HEART_DEPTH, Block.Heart);
    s.input.held = 'down';
    run(s, 4);
    expect(s.status).toBe('won');
  });
});

describe('Klettern', () => {
  function shaft(): ReturnType<typeof blankGame> {
    const s = blankGame();
    for (let y = 1; y <= 20; y++) put(s, 3, y, Block.Air);
    s.player.y = 20;
    s.player.py = 20;
    return s;
  }

  it('klettert mit gedrückter Hoch-Taste durch einen freien Schacht', () => {
    const s = shaft();
    s.input.held = 'up';
    run(s, 1);
    expect(s.player.y).toBeLessThan(15);
    expect(s.player.hp).toBe(3);
  });

  it('fällt erst mit Verzögerung zurück, wenn man loslässt', () => {
    const s = shaft();
    s.input.held = 'up';
    run(s, 0.5);
    const y = s.player.y;
    s.input.held = null;
    run(s, 0.1);
    expect(s.player.y).toBeLessThanOrEqual(y); // noch festgehalten
    run(s, 1.5);
    expect(s.player.y).toBe(20);
  });

  it('gräbt sich nach oben durch Erde', () => {
    const s = blankGame();
    put(s, 3, 20, Block.Air);
    s.player.y = 20;
    s.player.py = 20;
    s.input.held = 'up';
    run(s, 1.5);
    expect(s.player.y).toBeLessThan(18);
    expect(cell(s, 3, 19)).toBe(Block.Air);
  });

  it('kommt an der Oberfläche nicht höher als 0', () => {
    const s = blankGame();
    s.input.held = 'up';
    run(s, 1);
    expect(s.player.y).toBe(0);
  });
});
