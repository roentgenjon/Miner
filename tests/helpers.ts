import { START_X } from '../src/config';
import { createGame, type GameState } from '../src/game/state';
import { Block, type BlockId } from '../src/game/types';
import { generateWorld, getCell, setCell } from '../src/game/world';
import { computeMods, emptyUpgrades } from '../src/meta/shop';

/** Spielzustand mit einfarbiger Welt (Erde bis zum Schachtende), ohne Erze, Höhlen und Fledermäuse. */
export function blankGame(fill: BlockId = Block.Dirt, seed = 'test'): GameState {
  const world = generateWorld(seed, { fill });
  const s = createGame({ seed, mods: computeMods(emptyUpgrades()), world });
  s.bats = [];
  s.rocks = [];
  s.player.x = START_X;
  s.player.y = 0;
  return s;
}

export function put(s: GameState, x: number, y: number, b: BlockId): void {
  setCell(s.world, x, y, b);
}

export function cell(s: GameState, x: number, y: number): BlockId {
  return getCell(s.world, x, y);
}
