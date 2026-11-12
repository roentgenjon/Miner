import { DEFAULT_SKIN, HEART_DEPTH, PLAYER, START_X, ZONE_TOAST_EVERY, zoneAt } from '../config';
import { createMissions, type MissionState } from '../meta/missions';
import { createRng, type Rng } from './rng';
import { type Dir, type GameEvent, type Mods, type RunStats, type World, type ZoneId } from './types';
import { syncBats } from './bats';
import { generateWorld } from './world';

export type PlayerAction =
  | { kind: 'dig'; tx: number; ty: number; dir: Dir; dur: number; left: number }
  | { kind: 'move' | 'fall' | 'attack'; dur: number; left: number };

export interface Player {
  x: number;
  y: number;
  /** Vorherige Zelle (für die Bewegungsanimation). */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  tnt: number;
  facing: Dir;
  action: PlayerAction | null;
  invuln: number;
  /** Zusammenhängend gefallene Felder. */
  fallCount: number;
  darkT: number;
  /** Restzeit, in der die Figur beim Klettern festhängt (keine Schwerkraft). */
  climb: number;
  /** Zuletzt abgebautes Feld (für das schnellere Nachrücken). */
  lastDug: { x: number; y: number } | null;
  /** Richtung des letzten Grabens und wie lange das noch als „gräbt gerade“ gilt (s). */
  digDir: Dir | null;
  digT: number;
}

export interface Bat {
  id: number;
  /** Startpunkt „x,y“ (damit erledigte Fledermäuse nicht wiederkehren) – fehlt bei manuell erzeugten. */
  home?: string;
  /** Abschnitt, aus dem sie stammt; sie verschwindet, wenn dieser weit weg ist. */
  chunk?: number;
  x: number;
  y: number;
  hp: number;
  /** Zeit bis zur nächsten Bewegung. */
  t: number;
  /** Abklingzeit des Angriffs. */
  cd: number;
  awake: boolean;
}

export interface Tnt {
  id: number;
  x: number;
  y: number;
  fuse: number;
  kind: 'tnt' | 'crate';
  /** Automatisch gelegte Ladung: verletzt den Spieler nicht. */
  safe?: boolean;
}

export interface Rock {
  x: number;
  y: number;
  t: number;
}

export interface Input {
  held: Dir | null;
  queued: Dir | null;
  queuedAge: number;
  tnt: boolean;
  /** Auto-Dynamit eingeschaltet. */
  autoTnt: boolean;
}

export type GameStatus = 'playing' | 'won' | 'dead' | 'ended';

export interface GameState {
  seed: string;
  daily: boolean;
  world: World;
  mods: Mods;
  player: Player;
  bats: Bat[];
  /** Abschnitte, deren Fledermäuse gerade geladen sind. */
  batChunks: Set<number>;
  /** Erledigte Fledermäuse (Startpunkt-Schlüssel). */
  deadBats: Set<string>;
  tnts: Tnt[];
  rocks: Rock[];
  /** Wackelzeit von Geröll ohne Halt (Schlüssel = Zellindex). */
  wobble: Map<number, number>;
  rng: Rng;
  time: number;
  tick: number;
  stats: RunStats;
  missions: MissionState[];
  combo: { count: number; timer: number };
  /** In dieser Runde verdiente Münzen (inkl. Boni). */
  wallet: number;
  status: GameStatus;
  events: GameEvent[];
  input: Input;
  /** Bis zu diesem Zeitpunkt (Spielzeit) gibt es keinen Fallschaden (nach eigenen Auto-Sprengungen). */
  fallProtectUntil: number;
  /** Zeit seit der letzten automatischen Ladung. */
  autoTntT: number;
  /** Verbleibende Wiederbelebungen. */
  revives: number;
  /** Rekordtiefe zu Rundenbeginn. */
  record: number;
  /** Gewählter Skin der Spielfigur (nur Darstellung). */
  skin: string;
  zone: ZoneId;
  /** Nummer des zuletzt gemeldeten Zonen-Meilensteins. */
  zoneMilestone: number;
  nextId: number;
}

export interface CreateGameOptions {
  seed: string;
  daily?: boolean;
  mods: Mods;
  record?: number;
  skin?: string;
  /** Nur Tests: vorgefertigte Welt statt generierter. */
  world?: World;
}

export function emptyStats(): RunStats {
  return { depth: 0, ores: 0, money: 0, comboMax: 0, tntBlocks: 0, chests: 0, bats: 0, coal: 0, blocks: 0, damage: 0 };
}

export function createGame(opts: CreateGameOptions): GameState {
  const world = opts.world ?? generateWorld(opts.seed, { batReduction: opts.mods.hazardReduction });
  // Fahrstuhl: Schacht in der Startspalte bis zur Starttiefe gilt als frei (ohne ihn zu erzeugen).
  const startY = Math.min(opts.mods.startDepth, HEART_DEPTH - 10);
  world.shaftDepth = startY;
  const rng = createRng(`run:${opts.seed}`);
  let nextId = 1;
  const state: GameState = {
    seed: opts.seed,
    daily: opts.daily ?? false,
    world,
    mods: opts.mods,
    player: {
      x: START_X,
      y: startY,
      px: START_X,
      py: startY,
      hp: opts.mods.maxHp,
      maxHp: opts.mods.maxHp,
      energy: opts.mods.maxEnergy,
      maxEnergy: opts.mods.maxEnergy,
      tnt: opts.mods.startTnt,
      facing: 'right',
      action: null,
      invuln: 0,
      fallCount: 0,
      darkT: 0,
      climb: 0,
      lastDug: null,
      digDir: null,
      digT: 0,
    },
    bats: [],
    batChunks: new Set(),
    deadBats: new Set(),
    tnts: [],
    rocks: [],
    wobble: new Map(),
    rng,
    time: 0,
    tick: 0,
    stats: { ...emptyStats(), depth: startY },
    missions: createMissions(createRng(`missions:${opts.seed}`)),
    combo: { count: 0, timer: 0 },
    wallet: 0,
    status: 'playing',
    events: [],
    input: { held: null, queued: null, queuedAge: 0, tnt: false, autoTnt: false },
    fallProtectUntil: 0,
    autoTntT: 0,
    revives: opts.mods.revives,
    record: opts.record ?? 0,
    skin: opts.skin ?? DEFAULT_SKIN,
    zone: zoneAt(startY).id,
    zoneMilestone: Math.floor(zoneAt(startY).index / ZONE_TOAST_EVERY),
    nextId,
  };
  syncBats(state);
  return state;
}

export function emit(s: GameState, e: GameEvent): void {
  s.events.push(e);
}

export function drainEvents(s: GameState): GameEvent[] {
  const e = s.events;
  s.events = [];
  return e;
}

export function damagePlayer(s: GameState, amount: number, source: string, force = false): void {
  if (s.status !== 'playing' || amount <= 0) return;
  const p = s.player;
  if (!force && p.invuln > 0) return;
  p.hp = Math.max(0, p.hp - amount);
  p.invuln = PLAYER.invuln;
  s.stats.damage += amount;
  emit(s, { type: 'hurt', amount, source });
  if (p.hp <= 0) {
    if (s.revives > 0) {
      s.revives--;
      p.hp = Math.max(1, Math.ceil(p.maxHp / 2));
      p.invuln = 2;
      emit(s, { type: 'revive' });
      return;
    }
    s.status = 'dead';
    emit(s, { type: 'death' });
  }
}
