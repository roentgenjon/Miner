import { BLOCKS, ENERGY, PICK, PLAYER, RUN, TNT } from '../config';
import { batAt, hitBat } from './bats';
import { collectCoal, collectOre, openChest } from './loot';
import { damagePlayer, emit, type GameState } from './state';
import { placeTnt, lightCrate } from './tnt';
import { Block, DIRS, type Dir } from './types';
import { getCell, setCell } from './world';
import { isOre } from '../config';

/** Zeit zum Abbauen eines Blocks in Sekunden (inkl. Spitzhacken-Upgrade). */
export function digTime(s: GameState, block: number): number {
  return (BLOCKS[block]?.dig ?? 0.3) / effSpeed(s);
}

/** Wirksames Grabtempo (über PICK.speedCap hinaus wirkt der Bohrer statt kürzerer Zeiten). */
function effSpeed(s: GameState): number {
  return Math.min(s.mods.digSpeed, PICK.speedCap);
}

function inSeg(d: { x: number; y: number; x2: number; y2: number } | null, x: number, y: number): boolean {
  return d !== null && x >= Math.min(d.x, d.x2) && x <= Math.max(d.x, d.x2) && y >= Math.min(d.y, d.y2) && y <= Math.max(d.y, d.y2);
}

/** Wie viele Blöcke der aktuelle Logikschritt noch abbauen darf. */
let blockBudget = 0;

function canFall(s: GameState): boolean {
  const p = s.player;
  return p.y + 1 < s.world.height && getCell(s.world, p.x, p.y + 1) === Block.Air;
}

/** Höchstzahl kurzer Aktionen, die in einem Logikschritt nacheinander ablaufen dürfen. */
const MAX_CHAIN = 4096;

export function updatePlayer(s: GameState, dt: number): void {
  const p = s.player;
  const inp = s.input;
  p.invuln = Math.max(0, p.invuln - dt);
  p.climb = Math.max(0, p.climb - dt);
  p.digT = Math.max(0, p.digT - dt);

  if (inp.queued) {
    inp.queuedAge += dt;
    if (inp.queuedAge > PLAYER.inputBuffer) inp.queued = null;
  }
  if (inp.tnt) {
    inp.tnt = false;
    placeTnt(s);
  }

  blockBudget = PICK.blocksPerStep;
  let carry = 0;
  const a = p.action;
  if (a) {
    a.left -= dt;
    if (a.left > 0) return;
    carry = a.left;
    finishAction(s);
    p.action = null;
    if (s.status !== 'playing') return;
  }

  // Bei hoher Spitzhackenstufe sind Abbauen und Nachrücken so kurz, dass mehrere
  // Aktionen in einen Logikschritt passen. Der Übertrag (carry) bleibt dabei erhalten.
  for (let i = 0; i < MAX_CHAIN; i++) {
    if (!beginAction(s, carry)) return;
    const next = p.action;
    if (!next || next.left > 0) return;
    carry = next.left;
    finishAction(s);
    p.action = null;
    if (s.status !== 'playing' || blockBudget <= 0) return;
  }
}

/** Startet die nächste Aktion (Fallen, Landen, Graben, Laufen). Liefert false, wenn nichts zu tun ist. */
function beginAction(s: GameState, carry: number): boolean {
  const p = s.player;
  const inp = s.input;

  // Schwerkraft (beim Klettern kurz ausgesetzt)
  if (p.climb <= 0 && canFall(s)) {
    // Ins gerade gegrabene Feld darunter rutscht man schneller (Spitzhacke), nicht aber in freie Schächte.
    const dug = p.lastDug;
    const fast = inSeg(dug, p.x, p.y + 1);
    if (!fast) p.lastDug = null;
    const dur = PLAYER.fallTime / (fast ? effSpeed(s) : 1);
    p.px = p.x;
    p.py = p.y;
    p.y++;
    p.fallCount++;
    p.action = { kind: 'fall', dur, left: dur + carry };
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

  const dir = inp.queued ?? inp.held;
  if (!dir) return false;
  if (inp.queued) inp.queued = null;
  startAct(s, dir, carry);
  return p.action !== null;
}

function startAct(s: GameState, dir: Dir, carry: number): void {
  const p = s.player;
  const [dx, dy] = DIRS[dir];
  if (dir === 'left' || dir === 'right') p.facing = dir;
  // An der Oberfläche geht es nicht weiter nach oben.
  if (dir === 'up' && p.y <= 0) return;
  const tx = p.x + dx;
  const ty = p.y + dy;
  const cell = getCell(s.world, tx, ty);

  const bat = batAt(s, tx, ty);
  if (bat) {
    hitBat(s, bat);
    p.action = { kind: 'attack', dur: PLAYER.attackTime, left: PLAYER.attackTime + carry };
    return;
  }

  // Nachrücken in ein gerade freigegrabenes Feld wird von der Spitzhacke beschleunigt,
  // sonst würde die feste Laufzeit das Graben ab etwa Stufe 25 ausbremsen.
  const afterDig = inSeg(p.lastDug, tx, ty);
  if (!afterDig) p.lastDug = null;

  if (cell === Block.Air) {
    const moveDur = PLAYER.moveTime / s.mods.moveSpeed / (afterDig ? effSpeed(s) : 1);
    p.px = p.x;
    p.py = p.y;
    p.x = tx;
    p.y = ty;
    if (dir === 'up') {
      // Klettern: kurz festhalten, damit man nicht sofort zurückfällt.
      p.climb = moveDur + PLAYER.climbGrace;
      p.fallCount = 0;
    }
    p.action = { kind: 'move', dur: moveDur, left: moveDur + carry };
    return;
  }

  if (!BLOCKS[cell]?.breakable) {
    emit(s, { type: 'blocked' });
    return;
  }

  const dur = digTime(s, cell);
  p.digDir = dir;
  p.digT = 0.3;
  p.action = { kind: 'dig', tx, ty, dir, dur, left: dur + carry };
}

function finishAction(s: GameState): void {
  const p = s.player;
  const a = p.action;
  if (!a || a.kind !== 'dig') return;
  if (!breakBlock(s, a.tx, a.ty, true)) return;
  let lx = a.tx;
  let ly = a.ty;
  // Bohrer: bei sehr hohem Tempo gleich mehrere Blöcke in dieser Richtung abbauen.
  const [dx, dy] = DIRS[a.dir];
  for (let k = 1; k < s.mods.drill && s.status === 'playing' && blockBudget > 0; k++) {
    const x = a.tx + dx * k;
    const y = a.ty + dy * k;
    const c = getCell(s.world, x, y);
    if (c !== Block.Air && !BLOCKS[c]?.breakable) break;
    if (c !== Block.Air) breakBlock(s, x, y, false);
    lx = x;
    ly = y;
  }
  p.lastDug = { x: a.tx, y: a.ty, x2: lx, y2: ly };
}

/** Baut einen Block ab und löst seine Wirkung aus. Liefert false, wenn dort nichts abbaubar ist. */
function breakBlock(s: GameState, x: number, y: number, announce: boolean): boolean {
  const b = getCell(s.world, x, y);
  if (b === Block.Air || !BLOCKS[b]?.breakable) return false;
  blockBudget--;
  setCell(s.world, x, y, Block.Air);
  s.stats.blocks++;
  // Mitgebohrte Blöcke kosten keine Lampenenergie.
  if (announce) s.player.energy = Math.max(0, s.player.energy - ENERGY.digCost * s.mods.digCostMult);
  if (announce) emit(s, { type: 'dig', x, y, block: b });

  switch (b) {
    case Block.Crate:
      lightCrate(s, x, y, TNT.crateFuse);
      break;
    case Block.Chest:
      openChest(s, x, y);
      break;
    case Block.Coal:
      collectCoal(s, x, y);
      break;
    case Block.Heart:
      s.wallet += RUN.heartBonus;
      s.status = 'won';
      emit(s, { type: 'win' });
      break;
    default:
      if (isOre(b)) {
        collectOre(s, b, x, y);
        mineNeighborVein(s, x, y);
      }
  }
  return true;
}

/** Aderngespür: Mit einer Chance wird ein benachbartes Erz gleich mit abgebaut und eingesammelt. */
function mineNeighborVein(s: GameState, x: number, y: number): void {
  if (s.mods.veinChance <= 0 || s.rng.next() >= s.mods.veinChance) return;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    const nb = getCell(s.world, nx, ny);
    if (!isOre(nb)) continue;
    setCell(s.world, nx, ny, Block.Air);
    s.stats.blocks++;
    emit(s, { type: 'dig', x: nx, y: ny, block: nb });
    collectOre(s, nb, nx, ny);
    return;
  }
}
