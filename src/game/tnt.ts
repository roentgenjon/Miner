import { AUTO_TNT, TNT } from '../config';
import { awardBounty, collectCoal, collectOre, openChest } from './loot';
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
  s.tnts.push({ id: s.nextId++, x: p.x, y: p.y, fuse: s.mods.tntFuse, kind: 'tnt' });
  emit(s, { type: 'tntPlace', x: p.x, y: p.y });
  return true;
}

/** Sprengkiste anzünden (durch Abbauen oder Kettenreaktion). */
export function lightCrate(s: GameState, x: number, y: number, fuse: number = TNT.crateFuse): void {
  s.tnts.push({ id: s.nextId++, x, y, fuse, kind: 'crate' });
}

/**
 * Auto-Dynamit: Solange man eine Richtung hält (oder gräbt), wird alle `AUTO_TNT.interval` Sekunden eine Ladung `AUTO_TNT.ahead` Felder
 * voraus in Grabrichtung gelegt. Die Ladung verletzt den Spieler nicht.
 * Der Zeitzähler behält den Rest (kein Zurücksetzen auf 0), damit die Rate auch dann stimmt, wenn der
 * Intervall kürzer als ein Logikschritt ist; pro Schritt wird höchstens eine Ladung gelegt.
 */
export function updateAutoTnt(s: GameState, dt: number): void {
  // nie mehr als zwei Intervalle ansammeln (z. B. nach einer Pause ohne Graben)
  s.autoTntT = Math.min(s.autoTntT + dt, AUTO_TNT.interval * 2);
  const p = s.player;
  if (!s.input.autoTnt || p.tnt <= 0 || s.autoTntT < AUTO_TNT.interval - 1e-9) return; // Toleranz gegen Gleitkomma-Rundung
  // Solange eine Richtung gedrückt ist (oder gerade gegraben wurde), auch beim Fallen durch die eigenen Sprengungen.
  const dir = s.input.held ?? (p.digT > 0 ? p.digDir : null);
  if (!dir) return;
  const [dx, dy] = DIRS[dir];
  const x = p.x + dx * AUTO_TNT.ahead;
  const y = p.y + dy * AUTO_TNT.ahead;
  // Immer legen (alle AUTO_TNT.interval s), nur nicht außerhalb des Schachts.
  if (y < 1 || y >= s.world.height || x < 0 || x >= s.world.width) return;
  p.tnt--;
  s.autoTntT = Math.min(s.autoTntT - AUTO_TNT.interval, AUTO_TNT.interval);
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
  // Eigene Auto-Sprengungen reißen lange Schächte auf: Fall in diese Schächte verletzt nicht.
  if (safe) s.fallProtectUntil = s.time + AUTO_TNT.fallProtect;
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
    awardBounty(s, b.y);
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
