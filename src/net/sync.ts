import { GIFTS } from '../config';
import type { Api, GiftBody, InboxGift } from './api';
import { describeApiError } from './api';
import { parseMeta, type KeyValueStore, type Meta } from '../meta/save';

/**
 * Verbindet ein lokales Konto mit einem Online-Konto: Anmelden, Spielstand sichern und laden,
 * Geschenke an Spieler. Der Server hält den Spielstand mit einer Versionsnummer; wer mit einer
 * veralteten Version speichern will, bekommt einen Konflikt und entscheidet (Online- oder Gerätestand).
 */

export const CLOUD_KEY = 'schacht-cloud';

export interface CloudLink {
  name: string;
  token: string;
  /** Lokales Konto, dessen Spielstand synchronisiert wird. */
  accountId: string;
  /** Version des Online-Spielstands, die dieses Gerät zuletzt gesehen hat. */
  version: number;
  /** Lokal gibt es Änderungen, die noch nicht online sind. */
  dirty: boolean;
  /** Online- und Gerätestand weichen ab, und der Nutzer muss entscheiden. */
  conflict: boolean;
  /** Die Sitzung ist abgelaufen (neu anmelden). */
  expired: boolean;
}

export function loadLink(store: KeyValueStore | null): CloudLink | null {
  try {
    const p = JSON.parse(store?.getItem(CLOUD_KEY) ?? 'null') as Partial<CloudLink> | null;
    if (!p || typeof p.token !== 'string' || !/^[0-9a-f]{64}$/.test(p.token) || typeof p.name !== 'string' || typeof p.accountId !== 'string') return null;
    return {
      name: p.name,
      token: p.token,
      accountId: p.accountId,
      version: typeof p.version === 'number' && p.version >= 0 ? p.version : 0,
      dirty: p.dirty === true,
      conflict: p.conflict === true,
      expired: p.expired === true,
    };
  } catch {
    return null;
  }
}

export function saveLink(link: CloudLink | null, store: KeyValueStore | null): void {
  try {
    if (!store) return;
    if (link) store.setItem(CLOUD_KEY, JSON.stringify(link));
    else (store as { removeItem?: (k: string) => void }).removeItem?.(CLOUD_KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Gibt es auf diesem Stand schon etwas, das man ungern überschreiben würde? */
export function hasProgress(m: Meta): boolean {
  return m.money > 0 || m.runs > 0 || m.bestDepth > 0 || m.skins.length > 0 || Object.values(m.upgrades).some((v) => v > 0);
}

export type SyncState = 'off' | 'other-account' | 'synced' | 'dirty' | 'conflict' | 'expired';

export interface SyncDeps {
  api: Api;
  store: KeyValueStore | null;
  /** Aktueller Spielstand des aktiven lokalen Kontos. */
  getMeta(): Meta;
  /** Übernimmt einen Spielstand (aus der Cloud) – speichert lokal, ohne ihn als „geändert“ zu markieren. */
  applyMeta(meta: Meta): void;
  accountId(): string;
}

export type SignInOutcome =
  | { ok: false; message: string }
  | { ok: true; plan: 'upload' | 'adopt' | 'ask'; cloudMeta: Meta | null; cloudVersion: number };

export class CloudSync {
  link: CloudLink | null;
  /** Online-Stand, der bei einem Konflikt oder einer Auswahl vorliegt. */
  pending: { meta: Meta; version: number } | null = null;

  constructor(private readonly d: SyncDeps) {
    this.link = loadLink(d.store);
  }

  private persist(): void {
    saveLink(this.link, this.d.store);
  }

  /** Ist ein Online-Konto mit dem aktuell aktiven lokalen Konto verbunden? */
  get active(): boolean {
    return this.link !== null && this.link.accountId === this.d.accountId();
  }

  state(): SyncState {
    const l = this.link;
    if (!l) return 'off';
    if (l.accountId !== this.d.accountId()) return 'other-account';
    if (l.expired) return 'expired';
    if (l.conflict) return 'conflict';
    return l.dirty ? 'dirty' : 'synced';
  }

  markDirty(): void {
    if (this.link && this.active && !this.link.conflict && !this.link.dirty) {
      this.link.dirty = true;
      this.persist();
    }
  }

  async signIn(mode: 'login' | 'register', name: string, password: string): Promise<SignInOutcome> {
    const r = mode === 'login' ? await this.d.api.login(name, password) : await this.d.api.register(name, password);
    if (!r.ok) {
      let message = describeApiError(r.status, r.error, r.data);
      // Falscher Name und falsches Passwort sehen aus Sicherheitsgründen gleich aus – darum der Hinweis auf das Registrieren.
      if (mode === 'login' && r.error === 'invalid_credentials') message += ' Noch kein Online-Konto? Dann „Neu registrieren“ drücken.';
      return { ok: false, message };
    }
    const link: CloudLink = { name: r.data.name, token: r.data.token, accountId: this.d.accountId(), version: 0, dirty: false, conflict: false, expired: false };
    const s = await this.d.api.getSave(link.token);
    if (!s.ok) return { ok: false, message: describeApiError(s.status, s.error, s.data) };
    link.version = s.data.version;
    this.link = link;
    this.persist();
    if (s.data.save === null || s.data.save === undefined) {
      this.pending = null;
      return { ok: true, plan: 'upload', cloudMeta: null, cloudVersion: s.data.version };
    }
    const cloudMeta = parseMeta(s.data.save);
    this.pending = { meta: cloudMeta, version: s.data.version };
    return { ok: true, plan: hasProgress(this.d.getMeta()) ? 'ask' : 'adopt', cloudMeta, cloudVersion: s.data.version };
  }

  /** Online-Stand übernehmen (ersetzt den Gerätestand). */
  adoptPending(): string | null {
    if (!this.link || !this.pending) return 'Kein Online-Stand vorhanden.';
    this.d.applyMeta(this.pending.meta);
    this.link.version = this.pending.version;
    this.link.dirty = false;
    this.link.conflict = false;
    this.pending = null;
    this.persist();
    return null;
  }

  private fail(status: number, error: string, data?: Record<string, unknown>): string {
    if (this.link && (status === 401 || error === 'unauthorized')) {
      this.link.expired = true;
      this.persist();
    }
    return describeApiError(status, error, data);
  }

  /** Gerätestand hochladen. `baseVersion` ist die Version, auf die sich das Hochladen bezieht. */
  async push(baseVersion?: number): Promise<string | null> {
    const l = this.link;
    if (!l || !this.active) return 'Kein Online-Konto verbunden.';
    if (l.expired) return describeApiError(401, 'unauthorized');
    if (l.conflict && baseVersion === undefined) return describeApiError(409, 'conflict');
    const base = baseVersion ?? l.version;
    const r = await this.d.api.putSave(l.token, this.d.getMeta(), base);
    if (r.ok) {
      l.version = r.data.version;
      l.dirty = false;
      l.conflict = false;
      this.pending = null;
      this.persist();
      return null;
    }
    if (r.error === 'conflict') {
      const cur = r.data as { save?: unknown; version?: number } | undefined;
      l.conflict = true;
      this.pending = cur && cur.save ? { meta: parseMeta(cur.save), version: cur.version ?? 0 } : null;
      this.persist();
      return describeApiError(409, 'conflict');
    }
    return this.fail(r.status, r.error, r.data);
  }

  /** Beim Start und beim Öffnen des Menüs: Online-Stand prüfen. */
  async pull(): Promise<string | null> {
    const l = this.link;
    if (!l || !this.active || l.expired) return null;
    const r = await this.d.api.getSave(l.token);
    if (!r.ok) return r.status === 0 ? null : this.fail(r.status, r.error, r.data);
    if (r.data.version === l.version) return l.dirty ? this.push() : null;
    // Der Online-Stand ist neuer (z. B. Geschenk angekommen oder anderes Gerät)
    if (r.data.save) this.pending = { meta: parseMeta(r.data.save), version: r.data.version };
    if (!l.dirty && this.pending) {
      this.adoptPending();
      return 'Neuer Online-Stand geladen.';
    }
    l.conflict = true;
    this.persist();
    return describeApiError(409, 'conflict');
  }

  /** Auflösung eines Konflikts: 'cloud' = Online-Stand laden, 'local' = Gerätestand hochladen. */
  async resolve(choice: 'cloud' | 'local'): Promise<string | null> {
    const l = this.link;
    if (!l) return 'Kein Online-Konto verbunden.';
    if (choice === 'cloud') return this.adoptPending();
    if (!this.pending) {
      const r = await this.d.api.getSave(l.token);
      if (!r.ok) return this.fail(r.status, r.error, r.data);
      l.version = r.data.version;
      l.conflict = false;
      return this.push(r.data.version);
    }
    return this.push(this.pending.version);
  }

  async signOut(): Promise<void> {
    const l = this.link;
    if (l) await this.d.api.logout(l.token); // Fehler egal: lokal wird in jedem Fall abgemeldet
    this.link = null;
    this.pending = null;
    this.persist();
  }

  /** Geschenk an einen Spieler: erst sichern, dann senden; der Server liefert den neuen Stand zurück. */
  async send(body: GiftBody): Promise<{ error: string } | { message: string }> {
    const l = this.link;
    if (!l || !this.active) return { error: 'Verbinde zuerst ein Online-Konto.' };
    if (l.conflict) return { error: describeApiError(409, 'conflict') };
    if (l.dirty) {
      const e = await this.push();
      if (e) return { error: e };
    }
    const r = await this.d.api.send(l.token, body);
    if (!r.ok) return { error: this.fail(r.status, r.error, r.data) };
    this.d.applyMeta(parseMeta(r.data.save));
    l.version = r.data.version;
    l.dirty = false;
    this.persist();
    return { message: `Geschenk an ${r.data.to} geschickt.` };
  }

  async inbox(): Promise<{ error: string } | { gifts: InboxGift[] }> {
    const l = this.link;
    if (!l || !this.active) return { gifts: [] };
    const r = await this.d.api.inbox(l.token);
    if (!r.ok) return { error: this.fail(r.status, r.error, r.data) };
    return { gifts: r.data.gifts.slice(0, GIFTS.keepSent * 5) };
  }

  async claim(id: string): Promise<{ error: string } | { message: string }> {
    const l = this.link;
    if (!l || !this.active) return { error: 'Verbinde zuerst ein Online-Konto.' };
    if (l.conflict) return { error: describeApiError(409, 'conflict') };
    if (l.dirty) {
      const e = await this.push();
      if (e) return { error: e };
    }
    const r = await this.d.api.claim(l.token, id);
    if (!r.ok) return { error: this.fail(r.status, r.error, r.data) };
    this.d.applyMeta(parseMeta(r.data.save));
    l.version = r.data.version;
    l.dirty = false;
    this.persist();
    return { message: 'Geschenk angenommen.' };
  }
}
