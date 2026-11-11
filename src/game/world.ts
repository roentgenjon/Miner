import { HEART_DEPTH, HEIGHT, START_X, WIDTH, ZONES, zoneAt } from '../config';
import { createRng } from './rng';
import { Block, type BlockId, type World } from './types';

export function idx(w: World, x: number, y: number): number {
  return y * w.width + x;
}

export function inBounds(w: World, x: number, y: number): boolean {
  return x >= 0 && x < w.width && y >= 0 && y < w.height;
}

/** Außerhalb des Schachts ist Grundgestein. */
export function getCell(w: World, x: number, y: number): BlockId {
  if (x < 0 || x >= w.width || y >= w.height) return Block.Bedrock;
  if (y < 0) return Block.Air;
  return w.cells[idx(w, x, y)] ?? Block.Bedrock;
}

export function setCell(w: World, x: number, y: number, b: BlockId): void {
  if (!inBounds(w, x, y)) return;
  w.cells[idx(w, x, y)] = b;
}

export function isSolid(b: BlockId): boolean {
  return b !== Block.Air;
}

/**
 * Erzeugt den Schacht deterministisch aus dem Seed.
 * Gleicher Seed => exakt gleiche Welt (Tagesschacht).
 */
export function generateWorld(seed: string): World {
  const rng = createRng(`world:${seed}`);
  const width = WIDTH;
  const height = HEIGHT;
  const cells = new Uint8Array(width * height);
  const world: World = { seed, width, height, cells, batSpawns: [], lavaSources: [] };

  for (let y = 1; y < HEART_DEPTH; y++) {
    const zone = zoneAt(y);
    for (let x = 0; x < width; x++) {
      let block: BlockId = zone.base;
      const r = rng.next();
      let acc = 0;
      for (const roll of zone.rolls) {
        if (roll.minDepth !== undefined && y < roll.minDepth) continue;
        acc += roll.p;
        if (r < acc) {
          block = roll.block;
          break;
        }
      }
      cells[idx(world, x, y)] = block;
    }
  }

  // Höhlen (nicht direkt unter der Oberfläche, nicht kurz vor dem Herzen)
  for (let y = 4; y < HEART_DEPTH - 3; y++) {
    const zone = zoneAt(y);
    if (rng.next() >= zone.caveChance) continue;
    const cw = rng.int(1, 2);
    const ch = rng.int(1, 2);
    const cx = rng.int(0, width - cw);
    const cavity: { x: number; y: number }[] = [];
    for (let dy = 0; dy < ch; dy++) {
      for (let dx = 0; dx < cw; dx++) {
        cells[idx(world, cx + dx, y + dy)] = Block.Air;
        cavity.push({ x: cx + dx, y: y + dy });
      }
    }
    if (rng.next() < zone.batChance) {
      const c = cavity[rng.int(0, cavity.length - 1)];
      if (c) world.batSpawns.push({ x: c.x, y: c.y });
    }
  }

  // Herz des Bergs: Grundgestein-Zeile mit dem Herz in der Mitte
  for (let x = 0; x < width; x++) cells[idx(world, x, HEART_DEPTH)] = Block.Bedrock;
  cells[idx(world, START_X, HEART_DEPTH)] = Block.Heart;
  for (let x = 0; x < width; x++) cells[idx(world, x, HEART_DEPTH + 1)] = Block.Bedrock;

  // Die Startzelle und ihr Umfeld frei halten (Oberfläche = Zeile 0 ist Luft)
  for (let y = 1; y <= 2; y++) {
    cells[idx(world, START_X, y)] = zoneAt(y).base;
  }

  // Lavaquellen einsammeln
  for (let y = 1; y < HEART_DEPTH; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[idx(world, x, y)] === Block.LavaSource) world.lavaSources.push({ x, y });
    }
  }
  return world;
}

/** Zonenname-Hilfe für Tests / UI. */
export function zoneBoundaries(): number[] {
  return ZONES.map((z) => z.from);
}

/**
 * Entfernt einen Anteil der Fledermäuse und Lava (Quellen und Lavafelder) – für das Upgrade „Bannzeichen“.
 * Deterministisch aus dem Seed: Die Welt bleibt für alle gleich (Tagesschacht), höhere Anteile
 * entfernen stets eine Obermenge dessen, was niedrigere entfernen.
 * Lava wird zum Gestein der jeweiligen Zone abgekühlt.
 */
export function thinHazards(world: World, fraction: number): void {
  if (fraction <= 0) return;
  const batRng = createRng(`thin-bats:${world.seed}`);
  world.batSpawns = world.batSpawns.filter(() => batRng.next() >= fraction);

  const lavaRng = createRng(`thin-lava:${world.seed}`);
  const cells = world.cells;
  for (let i = 0; i < cells.length; i++) {
    const b = cells[i];
    if (b !== Block.LavaSource && b !== Block.Lava) continue;
    if (lavaRng.next() < fraction) cells[i] = zoneAt(Math.floor(i / world.width)).base;
  }
  world.lavaSources = world.lavaSources.filter((p) => cells[idx(world, p.x, p.y)] === Block.LavaSource);
}
