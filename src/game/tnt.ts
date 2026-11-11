import { AUTO_TNT, TNT } from '../config';
import { collectCoal, collectOre, openChest } from './loot';
import { damagePlayer, emit, type GameState } from './state';
import { Block, DIRS } from './types';
import { getCell, setCell } from './world';
import { isOre } from '../config';

/** Dynamit an der Spielerposition platzieren. */
export function placeTnt(s: GameState): boolean {
  const p = s.player;
  if (s.status !== 'playing' || p.tnt <= 0) return false;
  if (s.tnts.some((t) => t.x === p.x && t.y === p.y)) return false;
  p.tnt--;
  s.tnts.push({ id: s.nextId++, x: p.x, y: p.y, fuse: TNT.fuse, kind: 'tnt' });
  emit(s, { type: 'tntPlace', x: p.x, y: p.y });
  return true;
}

/** Sprengkiste anzünden (durch Abbauen oder Kettenreaktion). */
export function lightCrate(s: GameState, x: number, y: number, fuse: number = TNT.crateFuse): void {
  s.tnts.push({ id: s.nextId++, x, y, fuse, kind: 'crate' });
}

/**
 * Auto-Dynamit: Beim Graben wird in festen Abständen eine Ladung `AUTO_TNT.ahead` Felder voraus
 * in Grabrichtung gelegt, sofern dort Gestein ist. Die Ladung verletzt den Spieler nicht.
 */
export function updateAutoTnt(s: GameState, dt: number): void {
  s.autoTntT += dt;
  const p = s.player;
  if (!s.input.autoTnt || p.tnt <= 0 || s.autoTntT < AUTO_TNT.interval) return;
  if (p.digT <= 0 || !p.digDir) return; // nur während des Grabens
  const [dx, dy] = DIRS[p.digDir];
  const x = p.x + dx * AUTO_TNT.ahead;
  const y = p.y + dy * AUTO_TNT.ahead;
  if (y < 1) return;
  // Nur sprengen, wenn dort (oder davor) Gestein ist – nicht in Höhlen oder gegen Grundgestein.
  const target = getCell(s.world, x, y);
  const before = getCell(s.world, p.x + dx * (AUTO_TNT.ahead - 1), p.y + dy * (AUTO_TNT.ahead - 1));
  const solid = (b: number): boolean => b !== Block.Air && b !== Block.Bedrock;
  if (!solid(target) && !solid(before)) return;
  if (s.tnts.some((t) => Math.hypot(t.x - x, t.y - y) < 2.5)) return;
  p.tnt--;
  s.autoTntT = 0;
  s.tnts.push({ id: s.nextId++, x, y, fuse: AUTO_TNT.fuse, kind: 'tnt', safe: true });
  emit(s, { type: 'tntPlace', x, y });
}

/** Zündschnüre herunterzählen und fällige Ladungen zünden. */
export function updateTnt(s: GameState, dt: number): void {
  if (s.tnts.length === 0) return;
  const due = [];
  for (const t of s.tnts) {
    t.fuse -= dt;
    if (t.fuse <= 0) due.push(t);
  }
  if (due.length === 0) return;
  s.tnts = s.tnts.filter((t) => t.fuse > 0);
  for (const t of due) {
    explode(s, t.x, t.y, t.kind === 'crate' ? TNT.crateRadius : s.mods.tntRadius, t.safe === true);
  }
}

/**
 * Explosion bei (cx, cy): zerstört Blöcke, löst Sprengkisten und weiteres
 * Dynamit im Radius aus (Kettenreaktion), verletzt Spieler, tötet Fledermäuse.
 */
export function explode(s: GameState, cx: number, cy: number, radius: number, safe = false): void {
  const r2 = radius * radius;
  const reach = Math.ceil(radius);
  const w = s.world;

  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (y < 1) continue;
      const b = getCell(w, x, y);
      if (b === Block.Air || b === Block.Bedrock || b === Block.Heart) continue;

      setCell(w, x, y, Block.Air);
      s.stats.tntBlocks++;
      s.stats.blocks++;
      if (b === Block.Crate) {
        lightCrate(s, x, y, TNT.chainDelay + Math.sqrt(d2) * TNT.chainPerTile);
      } else if (b === Block.Chest) {
        openChest(s, x, y);
      } else if (b === Block.Coal) {
        collectCoal(s, x, y);
      } else if (isOre(b) && s.rng.next() < s.mods.blastLoot) {
        collectOre(s, b, x, y);
      }
    }
  }

  // Weitere Ladungen im Wirkungsbereich zünden schneller.
  for (const t of s.tnts) {
    const d = Math.hypot(t.x - cx, t.y - cy);
    if (d <= radius + 0.5) {
      t.fuse = Math.min(t.fuse, TNT.chainDelay + d * TNT.chainPerTile);
    }
  }

  // Fledermäuse
  s.bats = s.bats.filter((b) => {
    if (Math.hypot(b.x - cx, b.y - cy) > radius) return true;
    if (b.home) s.deadBats.add(b.home);
    s.stats.bats++;
    emit(s, { type: 'batDie', x: b.x, y: b.y });
    return false;
  });

  // Fallendes Geröll im Radius vernichten
  s.rocks = s.rocks.filter((r) => Math.hypot(r.x - cx, r.y - cy) > radius);

  // Spieler
  const p = s.player;
  if (!safe && Math.hypot(p.x - cx, p.y - cy) <= radius) {
    damagePlayer(s, TNT.playerDamage, 'tnt');
  }

  emit(s, { type: 'explosion', x: cx, y: cy, radius });
}
