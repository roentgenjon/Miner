import { DEFAULT_SKIN, GIFTS, SKINS } from '../config';
import { skinDef } from './skins';
import type { KeyValueStore, Meta } from './save';

/**
 * Geschenke zwischen Spielern, ohne Server: Man erzeugt einen Code (oder Link), schickt ihn selbst
 * (Chat, Mail …) und der Empfänger löst ihn auf seinem Gerät ein.
 *
 * Grenzen ohne Server (bewusst offen): Der Code lässt sich nicht an eine Person binden. Wer ihn
 * kennt, kann ihn einlösen; pro Gerät funktioniert jeder Code nur einmal. Die Prüfsumme erkennt
 * Tippfehler und beschädigte Links, ist aber kein Schutz gegen absichtlich gefälschte Codes.
 */

export const GIFT_PREFIX = 'gift1.';
export const GIFT_LEDGER_KEY = 'schacht-gifts';

export type GiftKind = 'coins' | 'skin';

export interface Gift {
  id: string;
  from: string;
  kind: GiftKind;
  amount?: number;
  skin?: string;
  note?: string;
  created: number;
}

export type GiftSpec = { kind: 'coins'; amount: number; note?: string } | { kind: 'skin'; skin: string; note?: string };

/* ---------- Kodierung ---------- */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Kleine Prüfsumme (FNV-1a), nur gegen Tippfehler. */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  const input = `schacht:${text}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

export function encodeGift(g: Gift): string {
  const body = toBase64Url(JSON.stringify(g));
  return `${GIFT_PREFIX}${body}.${checksum(body)}`;
}

export type DecodeResult = { ok: true; gift: Gift } | { ok: false; reason: 'format' | 'checksum' | 'invalid' };

function cleanText(raw: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Prüft alle Felder streng: Ein Geschenk ist nur gültig, wenn Art, Menge und Skin plausibel sind. */
export function validateGift(raw: unknown): Gift | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const id = typeof g.id === 'string' && /^[a-z0-9]{6,40}$/i.test(g.id) ? g.id : null;
  if (!id) return null;
  const base = { id, from: cleanText(g.from, 16) || 'Unbekannt', note: cleanText(g.note, GIFTS.noteMax) || undefined, created: typeof g.created === 'number' && Number.isFinite(g.created) ? g.created : 0 };
  if (g.kind === 'coins') {
    const a = g.amount;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > GIFTS.maxCoins) return null;
    return { ...base, kind: 'coins', amount: a };
  }
  if (g.kind === 'skin') {
    const def = SKINS.find((s) => s.id === g.skin);
    // Nur gekaufte Skins sind verschenkbar (nicht der Standard, nicht Erfolgs-Skins).
    if (!def || def.cost <= 0 || def.achievement) return null;
    return { ...base, kind: 'skin', skin: def.id };
  }
  return null;
}

/** Nimmt einen Code oder einen ganzen Link (…#gift=CODE) entgegen. */
export function extractCode(text: string): string | null {
  const t = text.trim();
  const fromLink = /[#?&]gift=([A-Za-z0-9._-]+)/.exec(t);
  const code = fromLink?.[1] ?? (t.startsWith(GIFT_PREFIX) ? t.split(/\s+/)[0] : undefined);
  return code && code.startsWith(GIFT_PREFIX) ? code : null;
}

export function decodeGift(codeOrLink: string): DecodeResult {
  const code = extractCode(codeOrLink);
  if (!code) return { ok: false, reason: 'format' };
  const rest = code.slice(GIFT_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'format' };
  const body = rest.slice(0, dot);
  if (checksum(body) !== rest.slice(dot + 1)) return { ok: false, reason: 'checksum' };
  const json = fromBase64Url(body);
  if (json === null) return { ok: false, reason: 'format' };
  try {
    const gift = validateGift(JSON.parse(json));
    return gift ? { ok: true, gift } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

export function giftLink(code: string, base: string): string {
  return `${base.split('#')[0]}#gift=${code}`;
}

export function describeGift(g: Gift): string {
  return g.kind === 'coins' ? `● ${(g.amount ?? 0).toLocaleString('de-DE')} Münzen` : `Skin „${skinDef(g.skin ?? '').name}“`;
}

/* ---------- Gerätebuch: pro Gerät nur einmal einlösen ---------- */

export interface GiftLedger {
  redeemed: string[];
  sent: string[];
}

export function loadLedger(store: KeyValueStore | null): GiftLedger {
  try {
    const p = JSON.parse(store?.getItem(GIFT_LEDGER_KEY) ?? 'null') as Partial<GiftLedger> | null;
    const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').slice(-GIFTS.ledgerMax) : []);
    return { redeemed: list(p?.redeemed), sent: list(p?.sent) };
  } catch {
    return { redeemed: [], sent: [] };
  }
}

export function saveLedger(ledger: GiftLedger, store: KeyValueStore | null): boolean {
  try {
    store?.setItem(GIFT_LEDGER_KEY, JSON.stringify({ redeemed: ledger.redeemed.slice(-GIFTS.ledgerMax), sent: ledger.sent.slice(-GIFTS.ledgerMax) }));
    return !!store;
  } catch {
    return false;
  }
}

/* ---------- Verschenken ---------- */

export type CreateGiftResult =
  | { ok: true; gift: Gift; code: string; label: string }
  | { ok: false; reason: 'amount' | 'money' | 'skin' };

function newGiftId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return rnd.length >= 6 ? rnd : `${rnd}abcdef`;
}

/** Erzeugt ein Geschenk und zieht es sofort vom Konto ab (Münzen bzw. der Skin). */
export function createGift(meta: Meta, fromName: string, spec: GiftSpec, ledger: GiftLedger, now: number = Date.now(), id: string = newGiftId()): CreateGiftResult {
  const note = cleanText(spec.note, GIFTS.noteMax) || undefined;
  let gift: Gift;
  if (spec.kind === 'coins') {
    const a = spec.amount;
    if (!Number.isInteger(a) || a < 1 || a > GIFTS.maxCoins) return { ok: false, reason: 'amount' };
    if (a > meta.money) return { ok: false, reason: 'money' };
    gift = { id, from: cleanText(fromName, 16) || 'Spieler', kind: 'coins', amount: a, note, created: now };
    meta.money -= a;
  } else {
    const def = SKINS.find((s) => s.id === spec.skin);
    if (!def || def.cost <= 0 || def.achievement || !meta.skins.includes(def.id)) return { ok: false, reason: 'skin' };
    gift = { id, from: cleanText(fromName, 16) || 'Spieler', kind: 'skin', skin: def.id, note, created: now };
    meta.skins = meta.skins.filter((s) => s !== def.id);
    if (meta.skin === def.id) meta.skin = DEFAULT_SKIN;
  }
  const code = encodeGift(gift);
  const label = describeGift(gift);
  meta.sentGifts = [{ id, code, label, created: now }, ...meta.sentGifts].slice(0, GIFTS.keepSent);
  ledger.sent = [...ledger.sent, id].slice(-GIFTS.ledgerMax);
  return { ok: true, gift, code, label };
}

/* ---------- Einlösen ---------- */

export type RedeemResult = { ok: true; label: string } | { ok: false; reason: 'used' | 'own' | 'owned' };

/**
 * Löst ein (bereits geprüftes) Geschenk ein. Ein Code zählt pro Gerät einmal – auch über Konten hinweg.
 * Eigene Geschenke lassen sich nicht selbst einlösen. Ein Skin, den man schon hat, wird abgelehnt,
 * ohne den Code zu verbrauchen (er lässt sich weiterreichen).
 */
export function redeemGift(meta: Meta, gift: Gift, ledger: GiftLedger): RedeemResult {
  if (ledger.sent.includes(gift.id) || meta.sentGifts.some((g) => g.id === gift.id)) return { ok: false, reason: 'own' };
  if (ledger.redeemed.includes(gift.id)) return { ok: false, reason: 'used' };
  if (gift.kind === 'coins') {
    meta.money += gift.amount ?? 0;
  } else {
    const id = gift.skin ?? '';
    if (meta.skins.includes(id)) return { ok: false, reason: 'owned' };
    meta.skins.push(id);
  }
  ledger.redeemed = [...ledger.redeemed, gift.id].slice(-GIFTS.ledgerMax);
  return { ok: true, label: describeGift(gift) };
}
