import { ACCOUNTS, SAVE_KEY } from '../config';
import { parseMeta, type KeyValueStore, type Meta } from './save';

/**
 * Konten sind lokale Profile auf diesem Gerät (kein Server): jedes hat einen eigenen Spielstand.
 * Das erste Konto („main“) nutzt weiter den Schlüssel `schacht-meta`, damit vorhandene Spielstände
 * unverändert weiterlaufen. Zum Mitnehmen auf ein anderes Gerät gibt es Export/Import als Datei.
 */

export const ACCOUNTS_KEY = 'schacht-accounts';
export const MAIN_ID = 'main';
export const EXPORT_FORMAT = 'schacht-konto';

export interface Account {
  id: string;
  name: string;
  created: number;
}

export interface AccountIndex {
  version: 1;
  active: string;
  accounts: Account[];
}

export function accountKey(id: string): string {
  return id === MAIN_ID ? SAVE_KEY : `${SAVE_KEY}:${id}`;
}

function defaultIndex(now: number): AccountIndex {
  return { version: 1, active: MAIN_ID, accounts: [{ id: MAIN_ID, name: 'Spieler', created: now }] };
}

/** Bereinigt einen Kontonamen: Leerraum zusammenfassen, Steuerzeichen entfernen, auf Maximallänge kürzen. */
export function sanitizeName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ACCOUNTS.nameMax).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function nameTaken(index: AccountIndex, name: string, exceptId?: string): boolean {
  const n = name.toLocaleLowerCase('de-DE');
  return index.accounts.some((a) => a.id !== exceptId && a.name.toLocaleLowerCase('de-DE') === n);
}

/** Liest die Kontenliste; fehlt sie (erster Start oder alter Spielstand), entsteht das Konto „Spieler“. */
export function loadAccounts(store: KeyValueStore | null, now: number = Date.now()): AccountIndex {
  if (!store) return defaultIndex(now);
  try {
    const raw = store.getItem(ACCOUNTS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AccountIndex>;
      const accounts = (Array.isArray(p.accounts) ? p.accounts : [])
        .filter((a): a is Account => !!a && typeof a.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(a.id) && typeof a.name === 'string')
        .map((a) => ({ id: a.id, name: sanitizeName(a.name) ?? 'Spieler', created: typeof a.created === 'number' ? a.created : now }));
      if (accounts.length > 0) {
        const active = accounts.some((a) => a.id === p.active) ? (p.active as string) : (accounts[0] as Account).id;
        return { version: 1, active, accounts };
      }
    }
  } catch {
    /* defekte Liste: neu anlegen */
  }
  return defaultIndex(now);
}

export function saveAccounts(index: AccountIndex, store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.setItem(ACCOUNTS_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function activeAccount(index: AccountIndex): Account {
  return index.accounts.find((a) => a.id === index.active) ?? (index.accounts[0] as Account);
}

function newId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 12);
  return `a${rnd}`;
}

export type AccountError = 'name' | 'duplicate' | 'limit';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: AccountError };

export function createAccount(index: AccountIndex, rawName: string, now: number = Date.now(), id: string = newId()): CreateResult {
  const name = sanitizeName(rawName);
  if (!name) return { ok: false, reason: 'name' };
  if (index.accounts.length >= ACCOUNTS.max) return { ok: false, reason: 'limit' };
  if (nameTaken(index, name)) return { ok: false, reason: 'duplicate' };
  index.accounts.push({ id, name, created: now });
  return { ok: true, id };
}

export function renameAccount(index: AccountIndex, id: string, rawName: string): { ok: true } | { ok: false; reason: AccountError } {
  const acc = index.accounts.find((a) => a.id === id);
  const name = sanitizeName(rawName);
  if (!acc || !name) return { ok: false, reason: 'name' };
  if (nameTaken(index, name, id)) return { ok: false, reason: 'duplicate' };
  acc.name = name;
  return { ok: true };
}

export function switchAccount(index: AccountIndex, id: string): boolean {
  if (!index.accounts.some((a) => a.id === id)) return false;
  index.active = id;
  return true;
}

/** Löscht ein Konto samt Spielstand. Das letzte Konto bleibt immer erhalten. */
export function deleteAccount(index: AccountIndex, id: string, store: KeyValueStore | null): boolean {
  if (index.accounts.length <= 1 || !index.accounts.some((a) => a.id === id)) return false;
  index.accounts = index.accounts.filter((a) => a.id !== id);
  if (index.active === id) index.active = (index.accounts[0] as Account).id;
  try {
    store?.removeItem?.(accountKey(id));
  } catch {
    /* Speicher nicht verfügbar */
  }
  return true;
}

/* ---------- Export / Import (Datei) ---------- */

export function exportAccount(name: string, meta: Meta): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, name, meta }, null, 1);
}

export type ImportParsed = { ok: true; name: string; meta: Meta } | { ok: false; reason: 'format' };

export function parseImport(text: string): ImportParsed {
  if (text.length > 2_000_000) return { ok: false, reason: 'format' };
  try {
    const p = JSON.parse(text) as { format?: unknown; name?: unknown; meta?: unknown };
    if (p.format !== EXPORT_FORMAT || typeof p.meta !== 'object' || p.meta === null) return { ok: false, reason: 'format' };
    const name = sanitizeName(typeof p.name === 'string' ? p.name : '') ?? 'Import';
    return { ok: true, name, meta: parseMeta(p.meta) };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** Legt aus einer Exportdatei ein neues Konto an (bei Namensgleichheit mit „(2)“, „(3)“ …). */
export function importAccount(
  index: AccountIndex,
  store: KeyValueStore | null,
  saveFn: (meta: Meta, store: KeyValueStore | null, key: string) => boolean,
  text: string,
): { ok: true; id: string; name: string } | { ok: false; reason: 'format' | 'limit' } {
  const parsed = parseImport(text);
  if (!parsed.ok) return parsed;
  if (index.accounts.length >= ACCOUNTS.max) return { ok: false, reason: 'limit' };
  let name = parsed.name;
  for (let n = 2; nameTaken(index, name); n++) {
    const suffix = ` (${n})`;
    name = `${parsed.name.slice(0, ACCOUNTS.nameMax - suffix.length)}${suffix}`;
  }
  const created = createAccount(index, name);
  if (!created.ok) return { ok: false, reason: created.reason === 'limit' ? 'limit' : 'format' };
  saveFn(parsed.meta, store, accountKey(created.id));
  return { ok: true, id: created.id, name };
}

