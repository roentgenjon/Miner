import { BLOCKS, HEART_DEPTH, zoneAt } from '../config';
import { createRng } from '../game/rng';
import { Block, type BlockId } from '../game/types';

/** Breite (x) und Tiefe (z) jeder Ebene. Jede Ebene (y) ist eine Fläche aus W3 × D3 Blöcken. */
export const W3 = 7;
export const D3 = 7;
export const LAYERS_PER_CHUNK = 16;
export const CELLS_PER_LAYER = W3 * D3;
/** Das Herz liegt in der Mitte der letzten Ebene. */
export const HEART_X = 3;
export const HEART_Z = 3;

/** Welt in drei Dimensionen: x (Breite), z (Tiefe) und y (Ebene, 0 = Oberfläche, nach unten wachsend). */
export interface World3 {
  seed: string;
  chunks: Map<number, Uint8Array>;
  live: Set<number>;
  /** Wird bei jeder Änderung erhöht (die Darstellung baut dann neu auf). */
  version: number;
  /** Nur Tests: alle Ebenen 1..HEART_DEPTH-1 mit diesem Block füllen (keine Erze/Höhlen). */
  fill?: BlockId;
}

export function createWorld3(seed: string, fill?: BlockId): World3 {
  return { seed, chunks: new Map(), live: new Set(), version: 0, fill };
}

const idx = (x: number, y: number, z: number): number => (y % LAYERS_PER_CHUNK) * CELLS_PER_LAYER + z * W3 + x;

function buildChunk(w: World3, ci: number): Uint8Array {
  const cells = new Uint8Array(LAYERS_PER_CHUNK * CELLS_PER_LAYER);
  const rng = createRng(`w3:${w.seed}:c${ci}`);
  for (let r = 0; r < LAYERS_PER_CHUNK; r++) {
    const y = ci * LAYERS_PER_CHUNK + r;
    if (y < 1) continue; // Oberfläche: Luft
    for (let z = 0; z < D3; z++) {
      for (let x = 0; x < W3; x++) {
        const i = r * CELLS_PER_LAYER + z * W3 + x;
        if (y > HEART_DEPTH) {
          cells[i] = Block.Bedrock;
          continue;
        }
        if (y === HEART_DEPTH) {
          cells[i] = x === HEART_X && z === HEART_Z ? Block.Heart : Block.Bedrock;
          continue;
        }
        if (w.fill !== undefined) {
          cells[i] = w.fill;
          continue;
        }
        const zone = zoneAt(y);
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
        cells[i] = block;
      }
    }
    // Kleine Hohlräume (nicht in den ersten Ebenen und nicht kurz vor dem Herzen)
    if (w.fill === undefined && y >= 4 && y < HEART_DEPTH - 3) {
      const zone = zoneAt(y);
      if (rng.next() < Math.min(0.9, zone.caveChance * 3)) {
        const cx = rng.int(0, W3 - 2);
        const cz = rng.int(0, D3 - 2);
        const sx = rng.int(1, 2);
        const sz = rng.int(1, 2);
        for (let dz = 0; dz < sz; dz++) for (let dx = 0; dx < sx; dx++) cells[r * CELLS_PER_LAYER + (cz + dz) * W3 + cx + dx] = Block.Air;
      }
    }
  }
  return cells;
}

function chunkAt(w: World3, ci: number): Uint8Array {
  const hit = w.chunks.get(ci);
  if (hit) return hit;
  const c = buildChunk(w, ci);
  w.chunks.set(ci, c);
  w.live.add(ci);
  return c;
}

export function getCell3(w: World3, x: number, y: number, z: number): BlockId {
  if (x < 0 || x >= W3 || z < 0 || z >= D3) return Block.Bedrock;
  if (y < 1) return y < 0 ? Block.Bedrock : Block.Air; // über der Oberfläche: Luft (y = 0), darüber nichts
  if (y > HEART_DEPTH) return Block.Bedrock;
  const ci = Math.floor(y / LAYERS_PER_CHUNK);
  return ((w.chunks.get(ci) ?? chunkAt(w, ci))[idx(x, y - ci * LAYERS_PER_CHUNK, z)] ?? Block.Bedrock) as BlockId;
}

export function setCell3(w: World3, x: number, y: number, z: number, b: BlockId): void {
  if (x < 0 || x >= W3 || z < 0 || z >= D3 || y < 1 || y > HEART_DEPTH) return;
  const ci = Math.floor(y / LAYERS_PER_CHUNK);
  (w.chunks.get(ci) ?? chunkAt(w, ci))[idx(x, y - ci * LAYERS_PER_CHUNK, z)] = b;
  w.version++;
}

export const isSolid3 = (b: BlockId): boolean => b !== Block.Air;

/** Anteil der abgebauten (freien) Felder in Ebene y (0..1). */
export function layerCleared(w: World3, y: number): number {
  if (y < 1) return 1;
  let air = 0;
  for (let z = 0; z < D3; z++) for (let x = 0; x < W3; x++) if (getCell3(w, x, y, z) === Block.Air) air++;
  return air / CELLS_PER_LAYER;
}

/** Gibt weit entfernte Abschnitte frei (sie werden bei Bedarf neu erzeugt; Gegrabenes dort geht verloren). */
export function trimWorld3(w: World3, centerY: number, behind: number, ahead: number): void {
  const c = Math.floor(centerY / LAYERS_PER_CHUNK);
  for (const ci of w.live) {
    if (ci < c - behind || ci > c + ahead) {
      w.chunks.delete(ci);
      w.live.delete(ci);
    }
  }
}

export const breakable3 = (b: BlockId): boolean => BLOCKS[b]?.breakable === true;
