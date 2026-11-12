import { DEFAULT_SKIN, GIFTS, SAVE_KEY, SKINS, UPGRADES } from '../config';
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

export interface SentGift {
  id: string;
  code: string;
  label: string;
  created: number;
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
  /** Gewählter Skin und gekaufte Skins. */
  skin: string;
  skins: string[];
  /** Zuletzt verschenkte Geschenke (damit man den Code erneut kopieren kann). */
  sentGifts: SentGift[];
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
    skin: DEFAULT_SKIN,
    skins: [],
    sentGifts: [],
    daily: { date: '', best: 0, runs: 0 },
  };
}

/** Minimale Storage-Schnittstelle (für Tests ersetzbar). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function defaultStore(): KeyValueStore | null {
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
  // Skins: nur bekannte, gekaufte; der gewählte muss freigeschaltet sein (Erfolge oben bereits eingelesen).
  if (Array.isArray(r.skins)) {
    m.skins = [...new Set(r.skins.filter((x): x is string => typeof x === 'string' && SKINS.some((s) => s.id === x && s.cost > 0)))];
  }
  if (typeof r.skin === 'string') {
    const def = SKINS.find((s) => s.id === r.skin);
    const unlocked =
      def !== undefined && (def.cost === 0 && !def.achievement ? true : m.skins.includes(def.id) || (def.achievement !== undefined && m.achievements[def.achievement] !== undefined));
    if (def && unlocked) m.skin = def.id;
  }
  if (Array.isArray(r.sentGifts)) {
    m.sentGifts = r.sentGifts
      .filter((g): g is SentGift => !!g && typeof g.id === 'string' && typeof g.code === 'string' && typeof g.label === 'string' && g.code.length < 2000)
      .slice(0, GIFTS.keepSent)
      .map((g) => ({ id: g.id.slice(0, 40), code: g.code, label: g.label.slice(0, 80), created: typeof g.created === 'number' ? g.created : 0 }));
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

export function loadMeta(store: KeyValueStore | null = defaultStore(), key: string = SAVE_KEY): Meta {
  if (!store) return defaultMeta();
  try {
    const raw = store.getItem(key);
    if (!raw) return defaultMeta();
    return parseMeta(JSON.parse(raw));
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta: Meta, store: KeyValueStore | null = defaultStore(), key: string = SAVE_KEY): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}
