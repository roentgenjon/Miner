import { CHUNK_ROWS, HEART_DEPTH, HEIGHT, START_X, WIDTH, zoneAt } from '../config';
import { createRng } from './rng';
import { Block, type BlockId, type Chunk, type Point, type World, type WorldOptions } from './types';

/**
 * Die Welt ist sehr tief (HEART_DEPTH Zeilen) und wird deshalb abschnittsweise erzeugt, sobald
 * jemand hinsieht. Jeder Abschnitt wird nur aus Seed und Abschnittsnummer berechnet, nicht aus
 * früheren Abschnitten: Die Welt ist unabhängig von der Reihenfolge des Erzeugens identisch
 * (wichtig für den Tagesschacht).
 */

export function idx(w: World, x: number, y: number): number {
  return y * w.width + x;
}

export function inBounds(w: World, x: number, y: number): boolean {
  return x >= 0 && x < w.width && y >= 0 && y < w.height;
}

export function generateWorld(seed: string, options: WorldOptions = {}): World {
  return {
    seed,
    width: WIDTH,
    height: HEIGHT,
    chunks: new Array<Chunk | undefined>(Math.ceil(HEIGHT / CHUNK_ROWS)),
    live: new Set<number>(),
    options,
    shaftDepth: 0,
  };
}

/** Gesamtzahl der Abschnitte. */
export function chunkCount(w: World): number {
  return w.chunks.length;
}

/** Liefert den Abschnitt mit Nummer `ci` und erzeugt ihn bei Bedarf. */
export function chunkAt(w: World, ci: number): Chunk {
  const hit = w.chunks[ci];
  if (hit) return hit;
  const c = buildChunk(w, ci);
  w.chunks[ci] = c;
  w.live.add(ci);
  return c;
}

/**
 * Gibt Abschnitte frei, die weit vom Spieler entfernt sind (sie werden bei Bedarf wieder neu erzeugt;
 * dort Gegrabenes geht dabei verloren). Hält den Speicher auch in 10 Millionen Metern Tiefe klein.
 */
export function trimChunks(w: World, centerCi: number, behind: number, ahead: number): void {
  for (const ci of w.live) {
    if (ci < centerCi - behind || ci > centerCi + ahead) {
      w.chunks[ci] = undefined;
      w.live.delete(ci);
    }
  }
}

function buildChunk(w: World, ci: number): Chunk {
  const width = w.width;
  const cells = new Uint8Array(CHUNK_ROWS * width);
  const bats: Point[] = [];
  const y0 = ci * CHUNK_ROWS;
  const fill = w.options.fill;

  // Test-Welt: einfarbig, ohne Zufall
  if (fill !== undefined) {
    for (let r = 0; r < CHUNK_ROWS; r++) {
      const y = y0 + r;
      if (y < 1 || y >= HEIGHT) continue;
      const block = y < HEIGHT - 1 ? fill : Block.Bedrock;
      for (let x = 0; x < width; x++) cells[r * width + x] = block;
    }
    return { cells, bats };
  }

  const rng = createRng(`world:${w.seed}:c${ci}`);

  for (let r = 0; r < CHUNK_ROWS; r++) {
    const y = y0 + r;
    if (y < 1 || y >= HEART_DEPTH) continue;
    const zone = zoneAt(y);
    for (let x = 0; x < width; x++) {
      let block: BlockId = zone.base;
      const roll = rng.next();
      let acc = 0;
      for (const entry of zone.rolls) {
        if (entry.minDepth !== undefined && y < entry.minDepth) continue;
        acc += entry.p;
        if (roll < acc) {
          block = entry.block;
          break;
        }
      }
      cells[r * width + x] = block;
    }
  }

  // Höhlen (nicht direkt unter der Oberfläche, nicht kurz vor dem Herzen), innerhalb des Abschnitts
  const batRng = createRng(`thin-bats:${w.seed}:c${ci}`);
  const reduction = w.options.batReduction ?? 0;
  for (let r = 0; r < CHUNK_ROWS; r++) {
    const y = y0 + r;
    if (y < 4 || y >= HEART_DEPTH - 3) continue;
    const zone = zoneAt(y);
    if (rng.next() >= zone.caveChance) continue;
    const cw = rng.int(1, 2);
    const ch = rng.int(1, 2);
    const cx = rng.int(0, width - cw);
    const cavity: Point[] = [];
    for (let dy = 0; dy < ch && r + dy < CHUNK_ROWS; dy++) {
      for (let dx = 0; dx < cw; dx++) {
        cells[(r + dy) * width + cx + dx] = Block.Air;
        cavity.push({ x: cx + dx, y: y + dy });
      }
    }
    if (rng.next() < zone.batChance) {
      const c = cavity[rng.int(0, cavity.length - 1)];
      // Eigener Zufallsstrom für die Ausdünnung: höhere Stufen entfernen stets eine Obermenge.
      const drop = batRng.next() < reduction;
      if (c && !drop) bats.push({ x: c.x, y: c.y });
    }
  }

  // Herz des Bergs: Grundgestein-Zeile mit dem Herz in der Mitte, darunter Grundgestein
  for (const y of [HEART_DEPTH, HEART_DEPTH + 1]) {
    const r = y - y0;
    if (r < 0 || r >= CHUNK_ROWS) continue;
    for (let x = 0; x < width; x++) cells[r * width + x] = Block.Bedrock;
    if (y === HEART_DEPTH) cells[r * width + START_X] = Block.Heart;
  }

  // Die Startzelle und ihr Umfeld bleibt Gestein (Oberfläche = Zeile 0 ist Luft)
  for (let y = 1; y <= 2; y++) {
    const r = y - y0;
    if (r >= 0 && r < CHUNK_ROWS) cells[r * width + START_X] = zoneAt(y).base;
  }

  return { cells, bats };
}

/** Außerhalb des Schachts ist Grundgestein. */
export function getCell(w: World, x: number, y: number): BlockId {
  if (x < 0 || x >= w.width || y >= w.height) return Block.Bedrock;
  if (y < 0) return Block.Air;
  if (x === START_X && y <= w.shaftDepth) return Block.Air;
  const ci = Math.floor(y / CHUNK_ROWS);
  const chunk = w.chunks[ci] ?? chunkAt(w, ci);
  return chunk.cells[(y - ci * CHUNK_ROWS) * w.width + x] ?? Block.Bedrock;
}

export function setCell(w: World, x: number, y: number, b: BlockId): void {
  if (!inBounds(w, x, y)) return;
  const ci = Math.floor(y / CHUNK_ROWS);
  const chunk = w.chunks[ci] ?? chunkAt(w, ci);
  chunk.cells[(y - ci * CHUNK_ROWS) * w.width + x] = b;
}

export function isSolid(b: BlockId): boolean {
  return b !== Block.Air;
}

/** Fledermaus-Startpunkte eines Abschnitts. */
export function chunkBatSpawns(w: World, ci: number): readonly Point[] {
  return chunkAt(w, ci).bats;
}

/** Alle Fledermaus-Startpunkte in den Zeilen [y0, y1] (erzeugt die betroffenen Abschnitte). */
export function batSpawnsIn(w: World, y0: number, y1: number): Point[] {
  const out: Point[] = [];
  const first = Math.max(0, Math.floor(y0 / CHUNK_ROWS));
  const last = Math.min(w.chunks.length - 1, Math.floor(y1 / CHUNK_ROWS));
  for (let ci = first; ci <= last; ci++) for (const p of chunkBatSpawns(w, ci)) if (p.y >= y0 && p.y <= y1) out.push(p);
  return out;
}
