import { GIFTS, SKINS } from '../../src/config';

/** Kontoname: 3–16 Zeichen, Buchstaben (auch ä ö ü ß), Ziffern, Leerzeichen, _ und -; ohne Rand-Leerzeichen. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(name)) return null;
  return name;
}

export function nameKey(name: string): string {
  return name.toLocaleLowerCase('de-DE');
}

export function validPassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128;
}

/** Skins, die man verschenken darf: gekaufte (Preis > 0), keine Erfolgs-Skins. */
export const GIFT_SKINS: readonly string[] = SKINS.filter((s) => s.cost > 0 && !s.achievement).map((s) => s.id);

export const MAX_SAVE_BYTES = 100_000;
export const MAX_MONEY = 1e15;

/**
 * Prüft einen Spielstand vor dem Speichern. Der Server kann Spielregeln nicht nachrechnen
 * (das Spiel läuft im Browser), schützt sich aber vor Müll und Überlauf.
 */
export function validateSave(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return null;
  const money = s.money;
  if (money !== undefined && (typeof money !== 'number' || !Number.isFinite(money) || money < 0 || money > MAX_MONEY)) return null;
  if (s.skins !== undefined && (!Array.isArray(s.skins) || s.skins.length > 50 || s.skins.some((x) => typeof x !== 'string' || x.length > 40))) return null;
  if (JSON.stringify(s).length > MAX_SAVE_BYTES) return null;
  return s;
}

export type GiftInput = { kind: 'coins'; amount: number; note?: string } | { kind: 'skin'; skin: string; note?: string };

export function parseGiftInput(raw: unknown): GiftInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  // eslint-disable-next-line no-control-regex
  const note = typeof g.note === 'string' ? g.note.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GIFTS.noteMax) : undefined;
  if (g.kind === 'coins') {
    const a = g.amount;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > GIFTS.maxCoins) return null;
    return { kind: 'coins', amount: a, note: note || undefined };
  }
  if (g.kind === 'skin' && typeof g.skin === 'string' && GIFT_SKINS.includes(g.skin)) return { kind: 'skin', skin: g.skin, note: note || undefined };
  return null;
}
