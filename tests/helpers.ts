import { START_X } from '../src/config';
import { createGame, type GameState } from '../src/game/state';
import { Block, type BlockId } from '../src/game/types';
import { idx } from '../src/game/world';
import { computeMods, emptyUpgrades } from '../src/meta/shop';

/** Spielzustand mit komplett ausgefüllter Erde, ohne Gefahren – gut für gezielte Tests. */
export function blankGame(fill: BlockId = Block.Dirt, seed = 'test'): GameState {
  const s = createGame({ seed, mods: computeMods(emptyUpgrades()) });
  const w = s.world;
  for (let y = 1; y < w.height - 1; y++) for (let x = 0; x < w.width; x++) w.cells[idx(w, x, y)] = fill;
  s.bats = [];
  s.lava = [];
  s.rocks = [];
  s.drops = [];
  s.player.x = START_X;
  s.player.y = 0;
  return s;
}

export function put(s: GameState, x: number, y: number, b: BlockId): void {
  s.world.cells[idx(s.world, x, y)] = b;
}

export function cell(s: GameState, x: number, y: number): BlockId {
  return s.world.cells[idx(s.world, x, y)] as BlockId;
}
