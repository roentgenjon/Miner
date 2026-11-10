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
  LavaSource: 16,
  Lava: 17,
  Heart: 18,
} as const;

export type BlockId = number;

export type Dir = 'left' | 'right' | 'down';

export const DIRS: Record<Dir, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  down: [0, 1],
};

export type ZoneId = 'erde' | 'schiefer' | 'magma' | 'kristall';

export interface Point {
  x: number;
  y: number;
}

export interface World {
  seed: string;
  width: number;
  height: number;
  cells: Uint8Array;
  batSpawns: Point[];
  lavaSources: Point[];
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
  | 'luck';

export type Upgrades = Record<UpgradeId, number>;

/** Aus Upgrades abgeleitete Spielwerte für eine Runde. */
export interface Mods {
  digSpeed: number;
  maxEnergy: number;
  maxHp: number;
  startTnt: number;
  coalMult: number;
  oreMult: number;
  comboWindow: number;
  fallReduction: number;
  rockReduction: number;
  lootMult: number;
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
  | { type: 'land'; x: number; y: number; fall: number }
  | { type: 'rockFall'; x: number; y: number }
  | { type: 'rockLand'; x: number; y: number }
  | { type: 'lavaDrip'; x: number; y: number }
  | { type: 'lava'; x: number; y: number }
  | { type: 'batHit'; x: number; y: number }
  | { type: 'batDie'; x: number; y: number }
  | { type: 'zone'; zone: ZoneId; name: string }
  | { type: 'mission'; id: string; text: string; reward: number }
  | { type: 'win' }
  | { type: 'death' }
  | { type: 'blocked' };
