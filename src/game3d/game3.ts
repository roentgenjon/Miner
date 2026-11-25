import { HEART_DEPTH } from '../config';
import { createGame, type CreateGameOptions, type GameState } from '../game/state';
import { createRng } from '../game/rng';
import { Block } from '../game/types';
import { createMissions, MISSION_DEFS_3D } from '../meta/missions';
import { createWorld3, setCell3, W3, D3 } from './world3';

export interface CreateGame3Options extends Omit<CreateGameOptions, 'world'> {
  /** Nur Tests: einfarbige 3D-Welt. */
  fill?: number;
}

/** Neue Runde in der 3D-Welt: der Spieler steht in der Mitte der Fläche; Ebene 1 ist als erste freigegeben. */
export function createGame3(opts: CreateGame3Options): GameState {
  const s = createGame(opts);
  const world = createWorld3(opts.seed, opts.fill);
  const startY = Math.max(0, Math.min(opts.mods.startDepth, HEART_DEPTH - 10));
  // Fahrstuhl: Startpunkt tiefer; die Zelle selbst wird frei gemacht
  if (startY > 0) setCell3(world, Math.floor(W3 / 2), startY, Math.floor(D3 / 2), Block.Air);
  const x = Math.floor(W3 / 2);
  s.player.x = x;
  s.player.px = x;
  s.player.y = startY;
  s.player.py = startY;
  s.stats.depth = startY;
  s.bats = [];
  s.missions = createMissions(createRng(`missions3:${opts.seed}`), undefined, MISSION_DEFS_3D);
  s.d3 = { world, z: Math.floor(D3 / 2), pz: Math.floor(D3 / 2), unlocked: startY + 1, progress: 0, action: null, facing: 'zp', lastDug: null };
  return s;
}
