import { SAVE_KEY, UPGRADES } from '../config';
import { emptyUpgrades } from './shop';
import type { UpgradeId, Upgrades } from '../game/types';

export interface Totals {
  ores: number;
  tntBlocks: number;
  chests: number;
  bats: number;
  coal: number;
  earned: number;
}

export interface DailyRecord {
  date: string;
  best: number;
  runs: number;
}

export interface Meta {
  version: 1;
  money: number;
  upgrades: Upgrades;
  bestDepth: number;
  runs: number;
  wins: number;
  totals: Totals;
  /** Freigeschaltete Erfolge: id -> Zeitstempel. */
  achievements: Record<string, number>;
  sound: boolean;
  /** Auto-Dynamit beim Rundenstart eingeschaltet. */
  autoTnt: boolean;
  daily: DailyRecord;
}

export function defaultMeta(): Meta {
  return {
    version: 1,
    money: 0,
    upgrades: emptyUpgrades(),
    bestDepth: 0,
    runs: 0,
    wins: 0,
    totals: { ores: 0, tntBlocks: 0, chests: 0, bats: 0, coal: 0, earned: 0 },
    achievements: {},
    sound: true,
    autoTnt: false,
    daily: { date: '', best: 0, runs: 0 },
  };
}

/** Minimale Storage-Schnittstelle (für Tests ersetzbar). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Fehlertolerantes Einlesen: unbekannte/ungültige Felder fallen auf Standardwerte zurück. */
export function parseMeta(raw: unknown): Meta {
  const m = defaultMeta();
  if (typeof raw !== 'object' || raw === null) return m;
  const r = raw as Record<string, unknown>;
  m.money = Math.floor(num(r.money));
  m.bestDepth = Math.floor(num(r.bestDepth));
  m.runs = Math.floor(num(r.runs));
  m.wins = Math.floor(num(r.wins));
  if (typeof r.sound === 'boolean') m.sound = r.sound;
  if (typeof r.autoTnt === 'boolean') m.autoTnt = r.autoTnt;

  const up = r.upgrades;
  if (typeof up === 'object' && up !== null) {
    for (const d of UPGRADES) {
      const lvl = Math.floor(num((up as Record<string, unknown>)[d.id]));
      m.upgrades[d.id as UpgradeId] = Math.min(d.maxLevel, lvl);
    }
  }
  const t = r.totals;
  if (typeof t === 'object' && t !== null) {
    for (const k of Object.keys(m.totals) as (keyof Totals)[]) {
      m.totals[k] = Math.floor(num((t as Record<string, unknown>)[k]));
    }
  }
  const ach = r.achievements;
  if (typeof ach === 'object' && ach !== null) {
    for (const [k, v] of Object.entries(ach)) m.achievements[k] = num(v, 1);
  }
  const d = r.daily;
  if (typeof d === 'object' && d !== null) {
    const dd = d as Record<string, unknown>;
    m.daily = {
      date: typeof dd.date === 'string' ? dd.date : '',
      best: Math.floor(num(dd.best)),
      runs: Math.floor(num(dd.runs)),
    };
  }
  return m;
}

export function loadMeta(store: KeyValueStore | null = defaultStore()): Meta {
  if (!store) return defaultMeta();
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return defaultMeta();
    return parseMeta(JSON.parse(raw));
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta: Meta, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}
