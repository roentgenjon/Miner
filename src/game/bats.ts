import { BAT } from '../config';
import { damagePlayer, emit, type Bat, type GameState } from './state';
import { Block } from './types';
import { getCell } from './world';

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function batAt(s: GameState, x: number, y: number): Bat | undefined {
  return s.bats.find((b) => b.x === x && b.y === y);
}

export function updateBats(s: GameState, dt: number): void {
  const p = s.player;
  for (const b of s.bats) {
    b.cd = Math.max(0, b.cd - dt);
    const dist = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
    b.awake = dist <= BAT.wakeDistance;
    if (!b.awake) continue;

    b.t -= dt;
    if (b.t <= 0) {
      b.t = BAT.moveTime * (0.8 + s.rng.next() * 0.4);
      const options = NEIGHBORS.map(([dx, dy]) => ({ x: b.x + (dx as number), y: b.y + (dy as number) })).filter(
        (c) => getCell(s.world, c.x, c.y) === Block.Air && c.y >= 1 && !s.bats.some((o) => o !== b && o.x === c.x && o.y === c.y),
      );
      if (options.length > 0) {
        let next = options[s.rng.int(0, options.length - 1)] as { x: number; y: number };
        if (s.rng.next() < BAT.chase) {
          let best = Infinity;
          for (const c of options) {
            const d = Math.abs(c.x - p.x) + Math.abs(c.y - p.y) + s.rng.next() * 0.5;
            if (d < best) {
              best = d;
              next = c;
            }
          }
        }
        b.x = next.x;
        b.y = next.y;
      }
    }

    if (b.cd <= 0 && Math.abs(b.x - p.x) + Math.abs(b.y - p.y) <= 1) {
      b.cd = BAT.attackCooldown;
      emit(s, { type: 'batHit', x: b.x, y: b.y });
      damagePlayer(s, BAT.damage, 'bat');
    }
  }
}

/** Fledermaus im Feld treffen (Spieler schlägt zu). */
export function hitBat(s: GameState, b: Bat): void {
  b.hp--;
  if (b.hp > 0) return;
  s.bats = s.bats.filter((o) => o !== b);
  s.stats.bats++;
  emit(s, { type: 'batDie', x: b.x, y: b.y });
  if (s.rng.next() < BAT.coalDrop) {
    s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 6);
  }
}
