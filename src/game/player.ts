import { BLOCKS, ENERGY, LAVA, PLAYER, RUN, TNT } from '../config';
import { batAt, hitBat } from './bats';
import { collectCoal, collectOre, openChest } from './loot';
import { damagePlayer, emit, type GameState } from './state';
import { placeTnt, lightCrate } from './tnt';
import { Block, DIRS, type Dir } from './types';
import { getCell, setCell } from './world';
import { isOre } from '../config';

/** Zeit zum Abbauen eines Blocks in Sekunden (inkl. Spitzhacken-Upgrade). */
export function digTime(s: GameState, block: number): number {
  return (BLOCKS[block]?.dig ?? 0.3) / s.mods.digSpeed;
}

function canFall(s: GameState): boolean {
  const p = s.player;
  return p.y + 1 < s.world.height && getCell(s.world, p.x, p.y + 1) === Block.Air;
}

export function updatePlayer(s: GameState, dt: number): void {
  const p = s.player;
  const inp = s.input;
  p.invuln = Math.max(0, p.invuln - dt);
  p.climb = Math.max(0, p.climb - dt);

  if (inp.queued) {
    inp.queuedAge += dt;
    if (inp.queuedAge > PLAYER.inputBuffer) inp.queued = null;
  }
  if (inp.tnt) {
    inp.tnt = false;
    placeTnt(s);
  }

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

  // Schwerkraft (beim Klettern kurz ausgesetzt)
  if (p.climb <= 0 && canFall(s)) {
    p.px = p.x;
    p.py = p.y;
    p.y++;
    p.fallCount++;
    p.action = { kind: 'fall', dur: PLAYER.fallTime, left: PLAYER.fallTime + carry };
    return;
  }
  if (p.fallCount > 0 && p.climb <= 0 && !canFall(s)) {
    const fall = p.fallCount;
    p.fallCount = 0;
    emit(s, { type: 'land', x: p.x, y: p.y, fall });
    const dmg = fall - PLAYER.fallSafe - s.mods.fallReduction;
    if (dmg > 0) damagePlayer(s, dmg, 'fall', true);
    if (s.status !== 'playing') return;
  }

  const dir = inp.queued ?? inp.held;
  if (dir) {
    if (inp.queued) inp.queued = null;
    startAct(s, dir, carry);
  }
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

  if (cell === Block.Air) {
    const moveDur = PLAYER.moveTime / s.mods.moveSpeed;
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

  if (cell === Block.Lava) {
    // Lava berührt: Schaden, Block kühlt zu Basalt ab.
    damagePlayer(s, Math.max(0, LAVA.contactDamage - s.mods.lavaReduction), 'lava');
    setCell(s.world, tx, ty, Block.Basalt);
    emit(s, { type: 'lava', x: tx, y: ty });
    p.action = { kind: 'attack', dur: 0.3, left: 0.3 + carry };
    return;
  }

  if (!BLOCKS[cell]?.breakable) {
    emit(s, { type: 'blocked' });
    return;
  }

  const dur = digTime(s, cell);
  p.action = { kind: 'dig', tx, ty, dir, dur, left: dur + carry };
}

function finishAction(s: GameState): void {
  const p = s.player;
  const a = p.action;
  if (!a || a.kind !== 'dig') return;
  const b = getCell(s.world, a.tx, a.ty);
  if (b === Block.Air || !BLOCKS[b]?.breakable) return;

  setCell(s.world, a.tx, a.ty, Block.Air);
  s.stats.blocks++;
  p.energy = Math.max(0, p.energy - ENERGY.digCost * s.mods.digCostMult);
  emit(s, { type: 'dig', x: a.tx, y: a.ty, block: b });

  switch (b) {
    case Block.Crate:
      lightCrate(s, a.tx, a.ty, TNT.crateFuse);
      break;
    case Block.Chest:
      openChest(s, a.tx, a.ty);
      break;
    case Block.Coal:
      collectCoal(s, a.tx, a.ty);
      break;
    case Block.Heart:
      s.wallet += RUN.heartBonus;
      s.status = 'won';
      emit(s, { type: 'win' });
      break;
    default:
      if (isOre(b)) collectOre(s, b, a.tx, a.ty);
  }
}
