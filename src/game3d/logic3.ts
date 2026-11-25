import { AUTO_TNT, BLOCKS, ENERGY, HEART_DEPTH, LAYER3, PICK, PLAYER, RUN, TNT, isOre, zoneValueScale } from '../config';
import { digTime, effSpeed } from '../game/player';
import { collectCoal, collectOre, openChest } from '../game/loot';
import { damagePlayer, emit, type GameState, type Tnt } from '../game/state';
import { Block, type BlockId, type Dir3 } from '../game/types';
import { D3, W3, breakable3, getCell3, layerCleared, setCell3 } from './world3';

/** Verschiebung je Richtung (dx, dy, dz). y wächst nach unten. */
export const VEC3: Record<Dir3, readonly [number, number, number]> = {
  xm: [-1, 0, 0],
  xp: [1, 0, 0],
  zm: [0, 0, -1],
  zp: [0, 0, 1],
  dn: [0, 1, 0],
  up: [0, -1, 0],
};

const MAX_CHAIN = 4096;
let blockBudget = 0;

function d3(s: GameState): NonNullable<GameState['d3']> {
  const d = s.d3;
  if (!d) throw new Error('keine 3D-Runde');
  return d;
}

const canFall = (s: GameState): boolean => {
  const d = d3(s);
  return s.player.y < HEART_DEPTH && getCell3(d.world, s.player.x, s.player.y + 1, d.z) === Block.Air;
};

/** Eine Ebene wurde (teilweise) abgeräumt: ggf. die nächste freigeben. */
function checkLayers(s: GameState): void {
  const d = d3(s);
  let guard = 0;
  while (d.unlocked < HEART_DEPTH && layerCleared(d.world, d.unlocked) >= LAYER3.clearFraction && guard++ < 16) {
    const bonus = Math.round(LAYER3.bonusBase * zoneValueScale(d.unlocked) * s.globalOre);
    s.wallet += bonus;
    s.stats.money += bonus;
    emit(s, { type: 'layer', y: d.unlocked, bonus });
    d.unlocked++;
  }
  d.progress = layerCleared(d.world, d.unlocked);
}

/** Baut einen Block ab und löst seine Wirkung aus. */
function breakBlock3(s: GameState, x: number, y: number, z: number, announce: boolean): boolean {
  const d = d3(s);
  const b = getCell3(d.world, x, y, z);
  if (b === Block.Air || !breakable3(b)) return false;
  blockBudget--;
  setCell3(d.world, x, y, z, Block.Air);
  s.stats.blocks++;
  if (announce) {
    s.player.energy = Math.max(0, s.player.energy - ENERGY.digCost * s.mods.digCostMult);
    emit(s, { type: 'dig', x, y, z, block: b });
  }
  switch (b) {
    case Block.Crate:
      s.tnts.push({ id: s.nextId++, x, y, z, fuse: TNT.crateFuse, kind: 'crate' });
      break;
    case Block.Chest:
      openChest(s, x, y, z);
      break;
    case Block.Coal:
      collectCoal(s, x, y, z);
      break;
    case Block.Heart:
      s.wallet += RUN.heartBonus;
      s.status = 'won';
      emit(s, { type: 'win' });
      break;
    default:
      if (isOre(b)) {
        collectOre(s, b, x, y, z);
        mineNeighborVein3(s, x, y, z);
      }
  }
  return true;
}

/** Aderngespür: ein benachbartes Erz (in der Ebene) gleich mitnehmen. */
function mineNeighborVein3(s: GameState, x: number, y: number, z: number): void {
  if (s.mods.veinChance <= 0 || s.rng.next() >= s.mods.veinChance) return;
  const d = d3(s);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as const) {
    const nb = getCell3(d.world, x + dx, y, z + dz);
    if (!isOre(nb)) continue;
    setCell3(d.world, x + dx, y, z + dz, Block.Air);
    s.stats.blocks++;
    emit(s, { type: 'dig', x: x + dx, y, z: z + dz, block: nb });
    collectOre(s, nb, x + dx, y, z + dz);
    return;
  }
}

export function updatePlayer3(s: GameState, dt: number): void {
  const p = s.player;
  const d = d3(s);
  const inp = s.input;
  p.invuln = Math.max(0, p.invuln - dt);
  p.climb = Math.max(0, p.climb - dt);
  p.digT = Math.max(0, p.digT - dt);

  if (inp.queued3) {
    inp.queuedAge += dt;
    if (inp.queuedAge > PLAYER.inputBuffer) inp.queued3 = null;
  }
  if (inp.tnt) {
    inp.tnt = false;
    placeTnt3(s);
  }

  blockBudget = PICK.blocksPerStep;
  let carry = 0;
  const a = d.action;
  if (a) {
    a.left -= dt;
    if (a.left > 0) return;
    carry = a.left;
    finishAction3(s);
    d.action = null;
    if (s.status !== 'playing') return;
  }
  for (let i = 0; i < MAX_CHAIN; i++) {
    if (!beginAction3(s, carry)) return;
    const next = d.action;
    if (!next || next.left > 0) return;
    carry = next.left;
    finishAction3(s);
    d.action = null;
    if (s.status !== 'playing' || blockBudget <= 0) return;
  }
}

function beginAction3(s: GameState, carry: number): boolean {
  const p = s.player;
  const d = d3(s);
  const inp = s.input;

  // Schwerkraft (beim Klettern kurz ausgesetzt)
  if (p.climb <= 0 && canFall(s)) {
    const fast = d.lastDug !== null && d.lastDug.x === p.x && d.lastDug.y === p.y + 1 && d.lastDug.z === d.z;
    if (!fast) d.lastDug = null;
    const dur = PLAYER.fallTime / (fast ? effSpeed(s) : 1);
    d.pz = d.z;
    p.px = p.x;
    p.py = p.y;
    p.y++;
    p.fallCount++;
    d.action = { kind: 'fall', dur, left: dur + carry };
    return true;
  }
  if (p.fallCount > 0 && p.climb <= 0 && !canFall(s)) {
    const fall = p.fallCount;
    p.fallCount = 0;
    emit(s, { type: 'land', x: p.x, y: p.y, fall });
    const dmg = fall - PLAYER.fallSafe - s.mods.fallReduction;
    if (dmg > 0 && s.time >= s.fallProtectUntil) damagePlayer(s, dmg, 'fall', true);
    if (s.status !== 'playing') return false;
  }

  const dir = inp.queued3 ?? inp.held3;
  if (!dir) return false;
  if (inp.queued3) inp.queued3 = null;
  startAct3(s, dir, carry);
  return d.action !== null;
}

function startAct3(s: GameState, dir: Dir3, carry: number): void {
  const p = s.player;
  const d = d3(s);
  if (dir !== 'up' && dir !== 'dn') d.facing = dir;
  const [dx, dy, dz] = VEC3[dir];
  const tx = p.x + dx;
  const ty = p.y + dy;
  const tz = d.z + dz;
  if (ty < 0) return; // über der Oberfläche geht es nicht weiter
  const cell = getCell3(d.world, tx, ty, tz);

  const afterDig = d.lastDug !== null && d.lastDug.x === tx && d.lastDug.y === ty && d.lastDug.z === tz;
  if (!afterDig) d.lastDug = null;

  if (cell === Block.Air) {
    if (tx < 0 || tx >= W3 || tz < 0 || tz >= D3) return;
    const moveDur = PLAYER.moveTime / s.mods.moveSpeed / (afterDig ? effSpeed(s) : 1);
    p.px = p.x;
    p.py = p.y;
    d.pz = d.z;
    p.x = tx;
    p.y = ty;
    d.z = tz;
    if (dir === 'up') {
      p.climb = moveDur + PLAYER.climbGrace;
      p.fallCount = 0;
    }
    d.action = { kind: 'move', dur: moveDur, left: moveDur + carry };
    return;
  }
  if (!BLOCKS[cell]?.breakable) {
    emit(s, { type: 'blocked' });
    return;
  }
  // Schicht nach Schicht: tiefer als die freigegebene Ebene darf nicht gegraben werden
  if (ty > d.unlocked) {
    emit(s, { type: 'blocked' });
    return;
  }
  const dur = digTime(s, cell);
  p.digT = 0.3;
  d.action = { kind: 'dig', tx, ty, tz, dir, dur, left: dur + carry };
}

function finishAction3(s: GameState): void {
  const d = d3(s);
  const a = d.action;
  if (!a || a.kind !== 'dig') return;
  if (!breakBlock3(s, a.tx, a.ty, a.tz, true)) return;
  // Bohrer: bei sehr hohem Tempo räumt eine Aktion gleich mehrere Felder derselben Ebene ab (nächste zuerst).
  if (s.mods.drill > 1) {
    let extra = s.mods.drill - 1;
    const order: [number, number][] = [];
    for (let z = 0; z < D3; z++) for (let x = 0; x < W3; x++) order.push([x, z]);
    order.sort((u, v) => Math.hypot(u[0] - a.tx, u[1] - a.tz) - Math.hypot(v[0] - a.tx, v[1] - a.tz));
    for (const [x, z] of order) {
      if (extra <= 0 || blockBudget <= 0 || s.status !== 'playing') break;
      if (breakBlock3(s, x, a.ty, z, false)) extra--;
    }
  }
  d.lastDug = { x: a.tx, y: a.ty, z: a.tz };
  checkLayers(s);
}

/* ---------- Dynamit ---------- */

export function placeTnt3(s: GameState): boolean {
  const p = s.player;
  const d = d3(s);
  if (s.status !== 'playing' || p.tnt <= 0) return false;
  if (s.tnts.some((t) => t.x === p.x && t.y === p.y && t.z === d.z)) return false;
  p.tnt--;
  s.tnts.push({ id: s.nextId++, x: p.x, y: p.y, z: d.z, fuse: s.mods.tntFuse, kind: 'tnt' });
  emit(s, { type: 'tntPlace', x: p.x, y: p.y, z: d.z });
  return true;
}

/** Auto-Dynamit: legt in Grabrichtung (ohne Richtung: nach unten) `AUTO_TNT.ahead` Felder voraus eine Ladung. */
export function updateAutoTnt3(s: GameState, dt: number): void {
  s.autoTntT = Math.min(s.autoTntT + dt, AUTO_TNT.interval * 2);
  const p = s.player;
  const d = d3(s);
  if (!s.input.autoTnt || p.tnt <= 0 || s.autoTntT < AUTO_TNT.interval - 1e-9) return;
  const dir: Dir3 | null = s.input.held3 ?? (p.digT > 0 ? (d.action?.kind === 'dig' ? d.action.dir : null) : null);
  if (!dir) return;
  const [dx, dy, dz] = VEC3[dir];
  const x = p.x + dx * AUTO_TNT.ahead;
  const y = p.y + dy * AUTO_TNT.ahead;
  const z = d.z + dz * AUTO_TNT.ahead;
  if (y < 1 || y > d.unlocked || x < 0 || x >= W3 || z < 0 || z >= D3) return;
  p.tnt--;
  s.autoTntT = Math.min(s.autoTntT - AUTO_TNT.interval, AUTO_TNT.interval);
  s.tnts.push({ id: s.nextId++, x, y, z, fuse: AUTO_TNT.fuse, kind: 'tnt', safe: true });
  emit(s, { type: 'tntPlace', x, y, z });
}

export function updateTnt3(s: GameState, dt: number): void {
  if (s.tnts.length === 0) return;
  const due: Tnt[] = [];
  for (const t of s.tnts) {
    t.fuse -= dt;
    if (t.fuse <= 0) due.push(t);
  }
  if (due.length === 0) return;
  s.tnts = s.tnts.filter((t) => t.fuse > 0);
  for (const t of due) explode3(s, t.x, t.y, t.z ?? 0, t.kind === 'crate' ? TNT.crateRadius : s.mods.tntRadius, t.safe === true);
  checkLayers(s);
}

/** Kugelförmige Explosion; tiefer als die freigegebene Ebene wirkt sie nicht. */
export function explode3(s: GameState, cx: number, cy: number, cz: number, radius: number, safe = false): void {
  const d = d3(s);
  if (safe) s.fallProtectUntil = s.time + AUTO_TNT.fallProtect;
  const r2 = radius * radius;
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        const z = cz + dz;
        if (y < 1 || y > d.unlocked) continue;
        const b: BlockId = getCell3(d.world, x, y, z);
        if (b === Block.Air || b === Block.Bedrock || b === Block.Heart) continue;
        setCell3(d.world, x, y, z, Block.Air);
        s.stats.tntBlocks++;
        s.stats.blocks++;
        if (b === Block.Crate) s.tnts.push({ id: s.nextId++, x, y, z, fuse: TNT.chainDelay + Math.sqrt(d2) * TNT.chainPerTile, kind: 'crate' });
        else if (b === Block.Chest) openChest(s, x, y, z);
        else if (b === Block.Coal) collectCoal(s, x, y, z);
        else if (isOre(b) && s.rng.next() < s.mods.blastLoot) collectOre(s, b, x, y, z);
      }
    }
  }
  // Weitere Ladungen im Wirkungsbereich zünden schneller
  for (const t of s.tnts) {
    const dist = Math.hypot(t.x - cx, t.y - cy, (t.z ?? 0) - cz);
    if (dist <= radius + 0.5) t.fuse = Math.min(t.fuse, TNT.chainDelay + dist * TNT.chainPerTile);
  }
  const p = s.player;
  if (!safe && Math.hypot(p.x - cx, p.y - cy, d.z - cz) <= radius) damagePlayer(s, TNT.playerDamage, 'tnt');
  emit(s, { type: 'explosion', x: cx, y: cy, z: cz, radius });
}
