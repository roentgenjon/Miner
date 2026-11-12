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
export const HEART_DEPTH = 10_000_000;
/** Anzahl der Zonen; sie sind gleich lang (hier 10 m). Sie werden bei Bedarf berechnet, nicht gespeichert. */
export const ZONE_COUNT = 1_000_000;
export const ZONE_LENGTH = HEART_DEPTH / ZONE_COUNT;
/** Zeilen: 0 = Oberfläche, HEART_DEPTH = Herz, danach Grundgestein. */
export const HEIGHT = HEART_DEPTH + 2;
export const START_X = 3;
/** Zeilen pro Welt-Abschnitt (die Welt wird abschnittsweise bei Bedarf erzeugt). */
export const CHUNK_ROWS = 256;

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
  /** Laufende Nummer 0..ZONE_COUNT-1. */
  index: number;
  /** Gesteinsfamilie 0..3 (Erde, Schiefer, Magma, Kristall) – bestimmt Aussehen und Erze. */
  family: number;
  /** Durchlauf der Familien (0..24), verschiebt Farbton und Schwierigkeit. */
  ring: number;
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

/** Die vier Gesteinsfamilien. Jede Zone nutzt eine davon (reihum), mit wachsender Schwierigkeit. */
interface Family {
  name: string;
  base: BlockId;
  darkness: number;
  drain: number;
  caveChance: number;
  batChance: number;
  rolls: RollEntry[];
}

const FAMILIES: readonly Family[] = [
  {
    name: 'Erde',
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
    name: 'Tiefschiefer',
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
    name: 'Magmazone',
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
    ],
  },
  {
    name: 'Kristallhöhle',
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
    ],
  },
];

function roman(n: number): string {
  // Ab 4000 gibt es keine römische Zahl mehr sinnvoll: dann arabisch.
  if (n >= 4000) return String(n);
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/** Gefahren (Geröll, Kisten) werden mit der Zonennummer häufiger, bis zu ×2,2. */
const HAZARDS: readonly BlockId[] = [Block.Boulder, Block.Crate];

/**
 * Schwierigkeit wächst mit dem Fortschritt durch den Schacht. Die Werte sind so geeicht, dass die letzte
 * Zone dem früheren „Zone 99“ von 100 entspricht – unabhängig von der Zonenzahl.
 */
const MAX_SCALE_STEPS = 99;
function progressSteps(index: number): number {
  return (MAX_SCALE_STEPS * index) / (ZONE_COUNT - 1);
}

function buildZone(index: number): ZoneDef {
  const family = index % FAMILIES.length;
  const ring = Math.floor(index / FAMILIES.length);
  const f = FAMILIES[family] as Family;
  const steps = progressSteps(index);
  const hazard = 1 + 0.012 * steps;
  return {
    id: `z${index}`,
    index,
    family,
    ring,
    name: `${f.name} ${roman(ring + 1)}`,
    from: index * ZONE_LENGTH,
    base: f.base,
    darkness: Math.min(0.97, f.darkness + 0.0007 * steps),
    drain: f.drain * (1 + 0.015 * steps),
    caveChance: f.caveChance,
    batChance: f.batChance,
    rolls: f.rolls.map((r) => (HAZARDS.includes(r.block) ? { ...r, p: r.p * hazard } : r)),
  };
}

/** Zwischenspeicher: In einem Bild/Abschnitt werden nur wenige Zonen gebraucht. */
const zoneCache = new Map<number, ZoneDef>();

export function zoneIndexAt(depth: number): number {
  return Math.min(ZONE_COUNT - 1, Math.max(0, Math.floor(depth / ZONE_LENGTH)));
}

export function zoneByIndex(index: number): ZoneDef {
  const hit = zoneCache.get(index);
  if (hit) return hit;
  if (zoneCache.size > 4096) zoneCache.clear();
  const z = buildZone(index);
  zoneCache.set(index, z);
  return z;
}

export function zoneAt(depth: number): ZoneDef {
  return zoneByIndex(zoneIndexAt(depth));
}

/** Eine Zonen-Meldung („Neue Zone“) gibt es nur alle so viele Zonen, sonst wäre es Dauerfeuer. */
export const ZONE_TOAST_EVERY = 1000;

/** Erze sind in tieferen Zonen mehr wert (am Schachtende ×10,9). */
export function zoneValueScale(depth: number): number {
  return 1 + 0.1 * progressSteps(zoneIndexAt(depth));
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
  /** So lange hält sich die Figur nach einer Aufwärtsbewegung fest, bevor sie fällt (s). */
  climbGrace: 0.35,
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

/** Auto-Dynamit: wirft beim Graben selbstständig Ladungen voraus (verletzt den Spieler nicht). */
export const AUTO_TNT = {
  /** Abstand zwischen zwei automatischen Ladungen (s): alle 25 ms eine. */
  interval: 0.025,
  /** So viele Felder voraus in Grabrichtung wird die Ladung gelegt. */
  ahead: 3,
  fuse: 0.5,
  /** So lange nach einer Auto-Sprengung gibt es keinen Fallschaden (s). */
  fallProtect: 2.5,
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
  /** Münzen aus einer Truhe: (moneyBase + moneyDeep) × Zonenwert-Faktor × Zufall. */
  moneyBase: 40,
  moneyDeep: 150,
  coalEnergy: 40,
  tntAmount: 8,
};

/* ---------- Sieg / Niederlage ---------- */
export const RUN = {
  heartBonus: 200000,
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
  /** Ab dieser Stufe wächst der Preis nur noch linear (statt exponentiell). */
  tailFrom?: number;
  /** Preisanstieg pro Stufe im linearen Bereich. */
  tailStep?: number;
}

/** Spitzhacke: bis `softCap` +0,6/Stufe (→ ×6001), danach +0,01/Stufe weiter (→ ×15 901 bei Stufe 1 000 000). */
export const PICK = { softCap: 10_000, tailPerLevel: 0.01 };

/** Die ersten `EXP_LEVELS` Stufen wachsen exponentiell im Preis, danach linear bis zum Endpreis. */
const EXP_LEVELS = 100;
const EXP_GROWTH = 1.045;

/**
 * Upgrade mit sehr vielen Stufen: Preis steigt in den ersten 100 Stufen um 4,5 % je Stufe,
 * danach linear, sodass die letzte Stufe `endCost` kostet.
 */
function longUpgrade(
  id: UpgradeId,
  name: string,
  desc: string,
  maxLevel: number,
  baseCost: number,
  perLevel: number,
  endCost: number,
): UpgradeDef {
  const expEnd = baseCost * Math.pow(EXP_GROWTH, EXP_LEVELS - 1);
  const tailStep = Math.max(0, (endCost - expEnd) / (maxLevel - EXP_LEVELS));
  return { id, name, desc, maxLevel, baseCost, growth: EXP_GROWTH, perLevel, tailFrom: EXP_LEVELS, tailStep };
}

/**
 * Stufenzahlen: 100 × so viele Stufen wie zuvor für alle Upgrades mit stetiger Wirkung.
 * Die Wirkung pro Stufe ist entsprechend kleiner (Gesamtwirkung auf Höchststufe ≈ 2–5 × früher),
 * ausgenommen Dynamit (Vorgabe: +3 pro Stufe).
 */
export const UPGRADES: readonly UpgradeDef[] = [
  longUpgrade('pick', 'Spitzhacke', 'Schneller graben', 1_000_000, 40, 0.6, 300_000),
  longUpgrade('lamp', 'Grubenlampe', 'Mehr Lampenenergie', 2500, 35, 0.75, 200_000),
  { id: 'armor', name: 'Lederwams', desc: '+1 Leben pro Stufe', maxLevel: 10, baseCost: 120, growth: 1.6, perLevel: 1 },
  longUpgrade('tnt', 'Dynamitvorrat', '+3 Dynamit pro Stufe', 3000, 30, TNT.perLevel, 150_000),
  longUpgrade('coal', 'Kohleofen', 'Kohle gibt mehr Energie', 2000, 50, 0.005, 150_000),
  longUpgrade('ore', 'Erzgespür', 'Erze sind mehr wert', 3000, 60, 0.005, 400_000),
  longUpgrade('combo', 'Kombo-Kette', 'Kombo-Fenster länger offen', 1500, 80, 0.02, 150_000),
  { id: 'boots', name: 'Federstiefel', desc: 'Weniger Fallschaden', maxLevel: 8, baseCost: 90, growth: 1.7, perLevel: 1 },
  { id: 'helmet', name: 'Schutzhelm', desc: 'Weniger Steinschlagschaden', maxLevel: 2, baseCost: 100, growth: 2.2, perLevel: 1 },
  longUpgrade('luck', 'Glückshände', 'Bessere Beute aus Truhen', 2000, 70, 0.004, 200_000),
  longUpgrade('power', 'Sprengkraft', 'Dynamit sprengt größere Bereiche', 600, 150, 0.0125, 400_000),
  { id: 'blast', name: 'Schürfsprengstoff', desc: 'Mehr Erz aus Sprengungen', maxLevel: 5, baseCost: 90, growth: 1.6, perLevel: 0.08 },
  longUpgrade('saver', 'Sparlampe', 'Lampe verbraucht weniger', 1200, 60, 0.0006, 150_000),
  longUpgrade('light', 'Scheinwerfer', 'Größerer Lichtkegel', 1500, 55, 0.009, 100_000),
  longUpgrade('legs', 'Laufschuhe', 'Schneller zur Seite laufen', 1500, 45, 0.002, 100_000),
  longUpgrade('master', 'Kombo-Meister', 'Höherer Kombo-Multiplikator', 1400, 120, 0.025, 400_000),
  { id: 'revive', name: 'Zweites Leben', desc: 'Einmal pro Stufe wiederbeleben', maxLevel: 5, baseCost: 800, growth: 2.0, perLevel: 1 },
  longUpgrade('lift', 'Fahrstuhl', 'Start in größerer Tiefe (+2000 m pro Stufe)', 4000, 100, 2000, 500_000),
  longUpgrade('gentle', 'Schonende Hacke', 'Graben kostet weniger Lampenenergie', 700, 50, 0.0012, 100_000),
  longUpgrade('ward', 'Bannzeichen', 'Weniger Fledermäuse', 900, 80, 0.001, 300_000),
];

/* ---------- Missionen ---------- */
export const MISSION = {
  count: 3,
  /** Wahrscheinlichkeiten für Stufe 1/2/3. */
  tierWeights: [0.5, 0.35, 0.15],
};

/* ---------- Skins ---------- */
export interface SkinDef {
  id: string;
  name: string;
  desc: string;
  /** Preis in Münzen; 0 = von Anfang an frei. */
  cost: number;
  /** Alternativ: wird durch diesen Erfolg freigeschaltet (nicht kaufbar). */
  achievement?: string;
  /** Farben, die in der Spielfigur ersetzt werden (Buchstaben siehe render/sprites.ts: PLAYER). */
  palette: Record<string, string>;
  /** Sondereffekt: Geist (durchscheinend), Regenbogen (wechselnde Farben). */
  effect?: 'ghost' | 'rainbow';
}

export const DEFAULT_SKIN = 'miner';

export const SKINS: readonly SkinDef[] = [
  { id: 'miner', name: 'Bergmann', desc: 'Der Klassiker mit gelbem Helm.', cost: 0, palette: {} },
  { id: 'rot', name: 'Rotkittel', desc: 'Roter Overall.', cost: 300, palette: { b: '#c8372d', B: '#8f241d', p: '#4a2c2c' } },
  { id: 'gruen', name: 'Moosgrün', desc: 'Grüner Overall, grüner Helm.', cost: 300, palette: { b: '#3f9a4a', B: '#2a6b33', y: '#8bd16a', Y: '#4f9a3a' } },
  { id: 'violett', name: 'Amethyst', desc: 'Violetter Overall und Helm.', cost: 600, palette: { b: '#7a4ac8', B: '#52309a', y: '#b074ff', Y: '#7a3fc0' } },
  { id: 'nacht', name: 'Nachtschicht', desc: 'Dunkle Kluft, kaltes Licht.', cost: 2000, palette: { b: '#2a2f45', B: '#1b1f30', p: '#1b1b26', y: '#2b3a55', Y: '#1c2740', w: '#6df0ff' } },
  { id: 'gold', name: 'Goldhelm', desc: 'Glänzender Helm und Gürtel.', cost: 5000, palette: { y: '#ffe066', Y: '#d9a521', w: '#ffffff', g: '#ffd23a' } },
  { id: 'geist', name: 'Bergbaugeist', desc: 'Durchscheinend. Freigeschaltet durch „Herz des Bergs“.', cost: 0, achievement: 'herz', palette: { b: '#cfe8ff', B: '#9cc4ee', y: '#e8f4ff', Y: '#b7d6f5', p: '#9cc4ee', o: '#7aa6d8', s: '#f0f7ff' }, effect: 'ghost' },
  { id: 'regenbogen', name: 'Regenbogen', desc: 'Farben wechseln ständig.', cost: 100_000, palette: {}, effect: 'rainbow' },
];

/* ---------- Konten (lokal auf dem Gerät) ---------- */
export const ACCOUNTS = {
  /** Maximale Anzahl Konten pro Gerät. */
  max: 12,
  /** Maximale Länge des Kontonamens. */
  nameMax: 16,
};

/* ---------- Geschenke ---------- */
export const GIFTS = {
  /** Größte erlaubte Münzmenge in einem Geschenk. */
  maxCoins: 1_000_000_000_000,
  /** So viele zuletzt verschenkte Geschenke bleiben im Konto sichtbar (zum erneuten Kopieren). */
  keepSent: 20,
  /** Länge der Nachricht. */
  noteMax: 40,
  /** Pro Gerät merken wir so viele eingelöste/gesendete Geschenk-Kennungen. */
  ledgerMax: 500,
};

/* ---------- Sonstiges ---------- */
export const SAVE_KEY = 'schacht-meta';
