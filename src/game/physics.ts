import { LAVA, ROCK } from '../config';
import { damagePlayer, emit, type GameState } from './state';
import { Block } from './types';
import { getCell, idx, setCell } from './world';

/** Geröll (Wackeln, Fallen, Landen) und tropfende Lava. */
export function updatePhysics(s: GameState, dt: number): void {
  updateRocks(s, dt);
  updateLava(s, dt);
}

function updateRocks(s: GameState, dt: number): void {
  const w = s.world;
  const p = s.player;

  // 1) Ungestütztes Geröll im Beobachtungsfenster erkennen
  const y0 = Math.max(1, p.y - ROCK.scanUp);
  const y1 = Math.min(w.height - 2, p.y + ROCK.scanDown);
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w.width; x++) {
      if (getCell(w, x, y) !== Block.Boulder) continue;
      const key = idx(w, x, y);
      if (getCell(w, x, y + 1) !== Block.Air) {
        s.wobble.delete(key);
        continue;
      }
      const t = (s.wobble.get(key) ?? 0) + dt;
      if (t >= ROCK.wobble) {
        s.wobble.delete(key);
        setCell(w, x, y, Block.Air);
        s.rocks.push({ x, y, t: 0 });
        emit(s, { type: 'rockFall', x, y });
      } else {
        s.wobble.set(key, t);
      }
    }
  }

  // 2) Fallende Steine bewegen
  const remaining = [];
  for (const r of s.rocks) {
    r.t += dt;
    let alive = true;
    while (alive && r.t >= ROCK.step) {
      r.t -= ROCK.step;
      // Spieler getroffen? (steht im Feld darunter oder im selben Feld)
      if (p.x === r.x && (p.y === r.y || p.y === r.y + 1)) {
        damagePlayer(s, Math.max(0, ROCK.damage - s.mods.rockReduction), 'rock');
        emit(s, { type: 'rockLand', x: r.x, y: r.y });
        alive = false;
        break;
      }
      const below = getCell(w, r.x, r.y + 1);
      if (below === Block.Air) {
        r.y++;
      } else {
        // Landen: Geröll wird wieder zum Block
        if (getCell(w, r.x, r.y) === Block.Air) setCell(w, r.x, r.y, Block.Boulder);
        emit(s, { type: 'rockLand', x: r.x, y: r.y });
        alive = false;
      }
    }
    if (alive) remaining.push(r);
  }
  s.rocks = remaining;
}

function updateLava(s: GameState, dt: number): void {
  const w = s.world;
  const p = s.player;

  for (const l of s.lava) {
    if (l.y < p.y - LAVA.scanUp || l.y > p.y + LAVA.scanDown) continue;
    if (getCell(w, l.x, l.y) !== Block.LavaSource) continue;
    l.next -= dt;
    if (l.next > 0) continue;
    l.next = LAVA.dripMin + s.rng.next() * (LAVA.dripMax - LAVA.dripMin);
    if (getCell(w, l.x, l.y + 1) === Block.Air) {
      s.drops.push({ x: l.x, y: l.y + 1, t: 0 });
      emit(s, { type: 'lavaDrip', x: l.x, y: l.y + 1 });
    }
  }

  const remaining = [];
  for (const d of s.drops) {
    d.t += dt;
    let alive = true;
    while (alive && d.t >= LAVA.dropStep) {
      d.t -= LAVA.dropStep;
      if (p.x === d.x && p.y === d.y) {
        damagePlayer(s, s.mods.lavaReduction >= 2 ? 0 : LAVA.dropDamage, 'lava');
        alive = false;
        break;
      }
      if (getCell(w, d.x, d.y + 1) === Block.Air) d.y++;
      else alive = false;
    }
    if (alive) remaining.push(d);
  }
  s.drops = remaining;
}
