/** Blocktypen. Als Zahlen gespeichert (Uint8Array), daher kein enum. */
export const Block = {
  Air: 0,
  Dirt: 1,
  Slate: 2,
  Basalt: 3,
  CrystalRock: 4,
  Bedrock: 5,
  Coal: 6,
  Copper: 7,
  Iron: 8,
  Gold: 9,
  Ruby: 10,
  Amethyst: 11,
  Diamond: 12,
  Chest: 13,
  Crate: 14,
  Boulder: 15,
  Heart: 18,
} as const;

export type BlockId = number;

export type Dir = 'left' | 'right' | 'down' | 'up';

export const DIRS: Record<Dir, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  down: [0, 1],
  up: [0, -1],
};

export type ZoneId = string;

export interface Point {
  x: number;
  y: number;
}

/** Ein Abschnitt des Schachts (CHUNK_ROWS Zeilen), bei Bedarf deterministisch erzeugt. */
export interface Chunk {
  cells: Uint8Array;
  /** Fledermaus-Startpunkte dieses Abschnitts (nach Anwendung von Bannzeichen). */
  bats: Point[];
}

export interface WorldOptions {
  /** Nur Tests: alle Zeilen 1..HEART_DEPTH mit diesem Block füllen (keine Erze, Höhlen, Fledermäuse). */
  fill?: BlockId;
  /** Anteil der Fledermäuse, der entfällt (Bannzeichen, 0..0,9). */
  batReduction?: number;
}

export interface World {
  seed: string;
  width: number;
  height: number;
  /** Bereits erzeugte Abschnitte (Index = Zeile / CHUNK_ROWS). */
  chunks: (Chunk | undefined)[];
  /** Nummern der gerade im Speicher gehaltenen Abschnitte (für das Aufräumen weit entfernter). */
  live: Set<number>;
  options: WorldOptions;
  /** Fahrstuhl: In der Startspalte gilt alles bis zu dieser Zeile als freier Schacht. */
  shaftDepth: number;
}

export type UpgradeId =
  | 'pick'
  | 'lamp'
  | 'armor'
  | 'tnt'
  | 'coal'
  | 'ore'
  | 'combo'
  | 'boots'
  | 'helmet'
  | 'luck'
  | 'power'
  | 'blast'
  | 'saver'
  | 'light'
  | 'legs'
  | 'master'
  | 'revive'
  | 'lift'
  | 'gentle'
  | 'ward'
  | 'regen'
  | 'vein'
  | 'crit'
  | 'fuse'
  | 'shield'
  | 'bounty'
  | 'tntregen'
  | 'dodge';

export type Upgrades = Record<UpgradeId, number>;

/** Aus Upgrades abgeleitete Spielwerte für eine Runde. */
export interface Mods {
  digSpeed: number;
  /** Blöcke pro Abbau-Aktion in einer Linie (Bohrer, ab sehr hohem Grabtempo). */
  drill: number;
  maxEnergy: number;
  maxHp: number;
  startTnt: number;
  coalMult: number;
  oreMult: number;
  comboWindow: number;
  fallReduction: number;
  rockReduction: number;
  lootMult: number;
  /** Explosionsradius von Dynamit (Felder). */
  tntRadius: number;
  /** Wahrscheinlichkeit, dass weggesprengtes Erz eingesammelt wird. */
  blastLoot: number;
  /** Multiplikator auf den Lampenverbrauch (<1 = sparsamer). */
  drainMult: number;
  /** Zusätzlicher Lichtradius in Feldern. */
  lightBonus: number;
  /** Multiplikator auf die Laufgeschwindigkeit. */
  moveSpeed: number;
  /** Obergrenze des Kombo-Multiplikators. */
  comboMax: number;
  /** Wiederbelebungen pro Runde. */
  revives: number;
  /** Starttiefe in m (Fahrstuhl). */
  startDepth: number;
  /** Multiplikator auf den Energieverbrauch beim Graben. */
  digCostMult: number;
  /** Anteil der Fledermäuse, der beim Rundenstart entfernt wird (0..0,9). */
  hazardReduction: number;
  /** Sekunden bis zu 1 Leben Selbstheilung (0 = aus). */
  regenSeconds: number;
  /** Chance, beim Abbauen eines Erzes ein benachbartes Erz gleich mitzunehmen. */
  veinChance: number;
  /** Chance auf einen Doppelfund (Erzwert ×2). */
  critChance: number;
  /** Zündzeit von Dynamit (s). */
  tntFuse: number;
  /** Zusätzliche Unverwundbarkeit nach einem Treffer (s). */
  invulnBonus: number;
  /** Münzen pro erledigter Fledermaus (vor Zonenwert). */
  bounty: number;
  /** Sekunden bis zu 1 nachwachsendem Dynamit (0 = aus). */
  tntRegenSeconds: number;
  /** Chance, einem Fledermausbiss auszuweichen. */
  batDodge: number;
}

export interface RunStats {
  depth: number;
  ores: number;
  money: number;
  comboMax: number;
  tntBlocks: number;
  chests: number;
  bats: number;
  coal: number;
  blocks: number;
  damage: number;
}

export type GameEvent =
  | { type: 'dig'; x: number; y: number; block: BlockId }
  | { type: 'ore'; x: number; y: number; block: BlockId; value: number; mult: number }
  | { type: 'coal'; x: number; y: number; energy: number }
  | { type: 'chest'; x: number; y: number; text: string }
  | { type: 'tntPlace'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'hurt'; amount: number; source: string }
  | { type: 'heal'; amount: number }
  | { type: 'revive' }
  | { type: 'land'; x: number; y: number; fall: number }
  | { type: 'rockFall'; x: number; y: number }
  | { type: 'rockLand'; x: number; y: number }
  | { type: 'batHit'; x: number; y: number }
  | { type: 'batDie'; x: number; y: number }
  | { type: 'zone'; zone: ZoneId; name: string }
  | { type: 'mission'; id: string; text: string; reward: number }
  | { type: 'win' }
  | { type: 'death' }
  | { type: 'blocked' };
