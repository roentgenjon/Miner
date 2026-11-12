import { BAT, CHUNK_ROWS } from '../config';
import { awardBounty } from './loot';
import { damagePlayer, emit, type Bat, type GameState } from './state';
import { Block } from './types';
import { chunkBatSpawns, chunkCount, getCell } from './world';

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

/** Fledermäuse werden nur in dieser Umgebung der Figur (Zeilen) geladen; sie sind sonst ohnehin „eingeschlafen“. */
const BAT_WINDOW = 48;

/** Lädt Fledermäuse der Abschnitte um die Figur und entlädt weit entfernte. */
export function syncBats(s: GameState): void {
  const lo = Math.max(0, Math.floor((s.player.y - BAT_WINDOW) / CHUNK_ROWS));
  const hi = Math.min(chunkCount(s.world) - 1, Math.floor((s.player.y + BAT_WINDOW) / CHUNK_ROWS));
  let changed = false;
  for (const c of s.batChunks) {
    if (c < lo || c > hi) {
      s.batChunks.delete(c);
      changed = true;
    }
  }
  if (changed) s.bats = s.bats.filter((b) => b.chunk === undefined || (b.chunk >= lo && b.chunk <= hi));
  for (let c = lo; c <= hi; c++) {
    if (s.batChunks.has(c)) continue;
    s.batChunks.add(c);
    for (const sp of chunkBatSpawns(s.world, c)) {
      const home = `${sp.x},${sp.y}`;
      if (s.deadBats.has(home)) continue;
      s.bats.push({ id: s.nextId++, home, chunk: c, x: sp.x, y: sp.y, hp: BAT.hp, t: 0.3, cd: 0, awake: false });
    }
  }
}

export function updateBats(s: GameState, dt: number): void {
  const p = s.player;
  syncBats(s);
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
      // Wendigkeit: Chance, dem Biss auszuweichen (nur würfeln, wenn das Upgrade da ist)
      if (!(s.mods.batDodge > 0 && s.rng.next() < s.mods.batDodge)) damagePlayer(s, BAT.damage, 'bat');
    }
  }
}

/** Fledermaus im Feld treffen (Spieler schlägt zu). */
export function hitBat(s: GameState, b: Bat): void {
  b.hp--;
  if (b.hp > 0) return;
  s.bats = s.bats.filter((o) => o !== b);
  if (b.home) s.deadBats.add(b.home);
  s.stats.bats++;
  awardBounty(s, b.y);
  emit(s, { type: 'batDie', x: b.x, y: b.y });
  if (s.rng.next() < BAT.coalDrop) {
    s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 6);
  }
}
