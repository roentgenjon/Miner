/**
 * Zentrale Spielwerte. Alles, was Balancing betrifft, steht hier.
 */
import { Block, type BlockId, type UpgradeId, type ZoneId } from './game/types';

/* ---------- Zeit ---------- */
/** Fester Logikschritt (60 Hz). Rendering läuft unabhängig davon. */
export const STEP = 1 / 60;
/** Maximal verarbeitete Zeit pro Frame (verhindert „Spirale des Todes“). */
export const MAX_FRAME = 0.25;

/* ---------- Schacht ---------- */
export const WIDTH = 7;
export const HEART_DEPTH = 250;
/** Zeilen: 0 = Oberfläche, 250 = Herz, 251 = Grundgestein. */
export const HEIGHT = HEART_DEPTH + 2;
export const START_X = 3;

/* ---------- Zonen ---------- */
export interface RollEntry {
  block: BlockId;
  /** Wahrscheinlichkeit pro Zelle. */
  p: number;
  /** Frühestens ab dieser Tiefe. */
  minDepth?: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** Erste Tiefe (in m) der Zone. */
  from: number;
  base: BlockId;
  /** Grunddunkelheit 0..1 (1 = stockfinster ohne Lampe). */
  darkness: number;
  /** Multiplikator auf den Lampenverbrauch. */
  drain: number;
  /** Wahrscheinlichkeit pro Zeile für eine Höhle. */
  caveChance: number;
  /** Wahrscheinlichkeit, dass eine Höhle eine Fledermaus enthält. */
  batChance: number;
  rolls: RollEntry[];
}

export const ZONES: readonly ZoneDef[] = [
  {
    id: 'erde',
    name: 'Erde',
    from: 0,
    base: Block.Dirt,
    darkness: 0.55,
    drain: 1.0,
    caveChance: 0.05,
    batChance: 0.1,
    rolls: [
      { block: Block.Coal, p: 0.07 },
      { block: Block.Copper, p: 0.06 },
      { block: Block.Iron, p: 0.025, minDepth: 5 },
      { block: Block.Boulder, p: 0.015, minDepth: 6 },
      { block: Block.Chest, p: 0.004, minDepth: 8 },
      { block: Block.Crate, p: 0.004, minDepth: 10 },
    ],
  },
  {
    id: 'schiefer',
    name: 'Tiefschiefer',
    from: 40,
    base: Block.Slate,
    darkness: 0.75,
    drain: 1.1,
    caveChance: 0.06,
    batChance: 0.3,
    rolls: [
      { block: Block.Coal, p: 0.06 },
      { block: Block.Copper, p: 0.04 },
      { block: Block.Iron, p: 0.06 },
      { block: Block.Gold, p: 0.02 },
      { block: Block.Boulder, p: 0.045 },
      { block: Block.Chest, p: 0.006 },
      { block: Block.Crate, p: 0.008 },
    ],
  },
  {
    id: 'magma',
    name: 'Magmazone',
    from: 110,
    base: Block.Basalt,
    darkness: 0.85,
    drain: 1.25,
    caveChance: 0.06,
    batChance: 0.35,
    rolls: [
      { block: Block.Coal, p: 0.05 },
      { block: Block.Iron, p: 0.03 },
      { block: Block.Gold, p: 0.05 },
      { block: Block.Ruby, p: 0.03 },
      { block: Block.Boulder, p: 0.02 },
      { block: Block.Chest, p: 0.007 },
      { block: Block.Crate, p: 0.012 },
      { block: Block.LavaSource, p: 0.02 },
      { block: Block.Lava, p: 0.03 },
    ],
  },
  {
    id: 'kristall',
    name: 'Kristallhöhle',
    from: 200,
    base: Block.CrystalRock,
    darkness: 0.9,
    drain: 1.4,
    caveChance: 0.08,
    batChance: 0.5,
    rolls: [
      { block: Block.Coal, p: 0.04 },
      { block: Block.Gold, p: 0.04 },
      { block: Block.Ruby, p: 0.02 },
      { block: Block.Amethyst, p: 0.05 },
      { block: Block.Diamond, p: 0.025 },
      { block: Block.Boulder, p: 0.02 },
      { block: Block.Chest, p: 0.01 },
      { block: Block.Crate, p: 0.012 },
      { block: Block.Lava, p: 0.01 },
      { block: Block.LavaSource, p: 0.01 },
    ],
  },
];

export function zoneAt(depth: number): ZoneDef {
  let z = ZONES[0] as ZoneDef;
  for (const zone of ZONES) if (depth >= zone.from) z = zone;
  return z;
}

/* ---------- Blöcke ---------- */
export interface BlockDef {
  name: string;
  /** Grundzeit zum Abbauen in Sekunden. */
  dig: number;
  /** Münzwert (nur Erze). */
  value?: number;
  /** Ist der Block abbaubar? */
  breakable: boolean;
}

export const BLOCKS: Record<number, BlockDef> = {
  [Block.Air]: { name: 'Luft', dig: 0, breakable: false },
  [Block.Dirt]: { name: 'Erde', dig: 0.16, breakable: true },
  [Block.Slate]: { name: 'Schiefer', dig: 0.3, breakable: true },
  [Block.Basalt]: { name: 'Basalt', dig: 0.42, breakable: true },
  [Block.CrystalRock]: { name: 'Kristallgestein', dig: 0.5, breakable: true },
  [Block.Bedrock]: { name: 'Grundgestein', dig: 0, breakable: false },
  [Block.Coal]: { name: 'Kohle', dig: 0.2, breakable: true },
  [Block.Copper]: { name: 'Kupfer', dig: 0.24, value: 6, breakable: true },
  [Block.Iron]: { name: 'Eisen', dig: 0.3, value: 14, breakable: true },
  [Block.Gold]: { name: 'Gold', dig: 0.4, value: 36, breakable: true },
  [Block.Ruby]: { name: 'Rubin', dig: 0.5, value: 80, breakable: true },
  [Block.Amethyst]: { name: 'Amethyst', dig: 0.5, value: 120, breakable: true },
  [Block.Diamond]: { name: 'Diamant', dig: 0.6, value: 220, breakable: true },
  [Block.Chest]: { name: 'Truhe', dig: 0.3, breakable: true },
  [Block.Crate]: { name: 'Sprengkiste', dig: 0.2, breakable: true },
  [Block.Boulder]: { name: 'Geröll', dig: 0.35, breakable: true },
  [Block.LavaSource]: { name: 'Lavaquelle', dig: 0.5, breakable: true },
  [Block.Lava]: { name: 'Lava', dig: 0, breakable: false },
  [Block.Heart]: { name: 'Herz des Bergs', dig: 3.0, breakable: true },
};

export function isOre(b: BlockId): boolean {
  return (BLOCKS[b]?.value ?? 0) > 0;
}

/* ---------- Spieler ---------- */
export const PLAYER = {
  baseHp: 3,
  baseEnergy: 100,
  /** Zeit für einen Schritt zur Seite. */
  moveTime: 0.12,
  /** Zeit pro fallendem Feld. */
  fallTime: 0.07,
  /** Zeit für einen Schlag gegen eine Fledermaus. */
  attackTime: 0.18,
  /** Unverwundbarkeit nach Treffer (s). */
  invuln: 0.8,
  /** Ab dieser Fallhöhe (Felder) gibt es Schaden. */
  fallSafe: 3,
  /** Eingabe wird so lange vorgemerkt (s). */
  inputBuffer: 0.25,
};

/* ---------- Lampe / Energie ---------- */
export const ENERGY = {
  /** Verbrauch pro Sekunde unter Tage. */
  drain: 0.85,
  /** Verbrauch pro Abbauvorgang. */
  digCost: 0.3,
  /** Energie pro Kohle. */
  coalGain: 14,
  /** Bei leerer Lampe: Sekunden bis 1 Schaden. */
  darkDamageEvery: 2.5,
  /** Lichtradius in Feldern bei voller / leerer Lampe. */
  lightMax: 4.2,
  lightMin: 1.1,
};

/* ---------- Kombo ---------- */
export const COMBO = {
  window: 3.0,
  stepBonus: 0.25,
  maxMult: 5,
};

/* ---------- Dynamit ---------- */
export const TNT = {
  /** Start-Dynamit = 40 + 3 pro Upgrade-Stufe. */
  baseStart: 40,
  perLevel: 3,
  fuse: 2.0,
  radius: 1.5,
  /** Sprengkisten explodieren größer. */
  crateRadius: 2.3,
  crateFuse: 0.8,
  /** Zündverzögerung bei Kettenreaktion (s) + je Feld Abstand. */
  chainDelay: 0.12,
  chainPerTile: 0.05,
  playerDamage: 2,
  /** Wahrscheinlichkeit, dass ein weggesprengtes Erz eingesammelt wird. */
  blastLoot: 0.6,
};

/* ---------- Gefahren ---------- */
export const ROCK = {
  /** Wackelzeit, bevor Geröll ohne Halt fällt. */
  wobble: 0.45,
  /** Zeit pro fallendem Feld. */
  step: 0.07,
  damage: 2,
  /** Nur Geröll in diesem Fensterbereich um den Spieler wird simuliert. */
  scanUp: 10,
  scanDown: 16,
};

export const LAVA = {
  dripMin: 2.5,
  dripMax: 6,
  dropStep: 0.06,
  dropDamage: 1,
  contactDamage: 2,
  scanUp: 8,
  scanDown: 20,
};

export const BAT = {
  hp: 1,
  moveTime: 0.3,
  wakeDistance: 7,
  damage: 1,
  attackCooldown: 1.0,
  /** Wahrscheinlichkeit, dass sich die Fledermaus Richtung Spieler bewegt. */
  chase: 0.65,
  /** Kohle-Drop beim Töten. */
  coalDrop: 0.15,
};

/* ---------- Truhen ---------- */
export const CHEST = {
  /** Gewichte: Münzen, Kohle, Dynamit, Herz. */
  weights: { money: 55, coal: 22, tnt: 15, heal: 8 },
  moneyBase: 40,
  moneyPerDepth: 0.6,
  coalEnergy: 40,
  tntAmount: 8,
};

/* ---------- Sieg / Niederlage ---------- */
export const RUN = {
  heartBonus: 1000,
  /** Anteil der Münzen, den man bei Tod behält. */
  deathKeep: 0.7,
};

/* ---------- Werkstatt ---------- */
export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  growth: number;
  /** Wirkung pro Stufe (Bedeutung je Upgrade, siehe computeMods). */
  perLevel: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'pick', name: 'Spitzhacke', desc: 'Schneller graben', maxLevel: 10, baseCost: 40, growth: 1.5, perLevel: 0.12 },
  { id: 'lamp', name: 'Grubenlampe', desc: 'Mehr Lampenenergie', maxLevel: 10, baseCost: 35, growth: 1.45, perLevel: 15 },
  { id: 'armor', name: 'Lederwams', desc: '+1 Leben pro Stufe', maxLevel: 5, baseCost: 120, growth: 1.9, perLevel: 1 },
  { id: 'tnt', name: 'Dynamitvorrat', desc: '+3 Dynamit pro Stufe', maxLevel: 10, baseCost: 30, growth: 1.4, perLevel: TNT.perLevel },
  { id: 'coal', name: 'Kohleofen', desc: 'Kohle gibt mehr Energie', maxLevel: 8, baseCost: 50, growth: 1.5, perLevel: 0.1 },
  { id: 'ore', name: 'Erzgespür', desc: 'Erze sind mehr wert', maxLevel: 10, baseCost: 60, growth: 1.55, perLevel: 0.1 },
  { id: 'combo', name: 'Kombo-Kette', desc: 'Kombo-Fenster länger offen', maxLevel: 6, baseCost: 80, growth: 1.6, perLevel: 0.4 },
  { id: 'boots', name: 'Federstiefel', desc: 'Weniger Fallschaden', maxLevel: 3, baseCost: 90, growth: 2.0, perLevel: 1 },
  { id: 'helmet', name: 'Schutzhelm', desc: 'Weniger Steinschlagschaden', maxLevel: 4, baseCost: 100, growth: 1.9, perLevel: 0.5 },
  { id: 'luck', name: 'Glückshände', desc: 'Bessere Beute aus Truhen', maxLevel: 8, baseCost: 70, growth: 1.55, perLevel: 0.08 },
];

/* ---------- Missionen ---------- */
export const MISSION = {
  count: 3,
  /** Wahrscheinlichkeiten für Stufe 1/2/3. */
  tierWeights: [0.5, 0.35, 0.15],
};

/* ---------- Sonstiges ---------- */
export const SAVE_KEY = 'schacht-meta';
