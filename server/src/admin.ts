import { SKINS } from '../../src/config';
import { hashPassword, randomBytes, toHex } from './crypto';
import type { Env } from './db';
import { HttpError, isAdmin, parseStoredSave, type Auth } from './handlers';
import { nameKey, normalizeName, validPassword } from './validate';

/* ---------- Globale Einstellungen ---------- */

export interface GlobalEvent {
  id: string;
  name: string;
  /** 'ore' = Erzwert, 'speed' = Grabtempo */
  kind: 'ore' | 'speed';
  mult: number;
  endsAt: number;
}

export interface GlobalMessage {
  id: number;
  text: string;
  created: number;
  from: string;
}

export interface GlobalState {
  oreMult: number;
  speedMult: number;
  events: GlobalEvent[];
  messages: GlobalMessage[];
  lastMsgId: number;
}

export const MAX_MULT = 1e12;
export const MAX_EVENTS = 20;
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_LEN = 300;
export const MAX_EVENT_MINUTES = 60 * 24 * 14;

const EMPTY: GlobalState = { oreMult: 1, speedMult: 1, events: [], messages: [], lastMsgId: 0 };

function mult(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_MULT ? v : fallback;
}

export async function loadGlobal(env: Env): Promise<GlobalState> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('global').first<{ value: string }>();
  if (!row) return { ...EMPTY, events: [], messages: [] };
  try {
    const g = JSON.parse(row.value) as Partial<GlobalState>;
    return {
      oreMult: mult(g.oreMult, 1),
      speedMult: mult(g.speedMult, 1),
      events: Array.isArray(g.events) ? g.events.filter((e) => e && typeof e.id === 'string' && (e.kind === 'ore' || e.kind === 'speed')) : [],
      messages: Array.isArray(g.messages) ? g.messages.filter((m) => m && typeof m.id === 'number' && typeof m.text === 'string') : [],
      lastMsgId: typeof g.lastMsgId === 'number' ? g.lastMsgId : 0,
    };
  } catch {
    return { ...EMPTY, events: [], messages: [] };
  }
}

async function saveGlobal(env: Env, g: GlobalState): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind('global', JSON.stringify(g))
    .run();
}

/** Öffentlich für alle Spieler: aktive Multiplikatoren und die neueste Nachricht. */
export async function publicGlobal(env: Env, now: number): Promise<Record<string, unknown>> {
  const g = await loadGlobal(env);
  const last = g.messages[g.messages.length - 1] ?? null;
  return {
    now,
    oreMult: g.oreMult,
    speedMult: g.speedMult,
    events: g.events.filter((e) => e.endsAt > now),
    message: last ? { id: last.id, text: last.text, created: last.created } : null,
  };
}

/* ---------- Admin ---------- */

export function requireAdmin(env: Env, auth: Auth): void {
  if (!isAdmin(env, auth.name)) throw new HttpError(403, 'forbidden');
}

interface UserListRow {
  id: number;
  name: string;
  created: number;
  save_updated: number;
  save: string | null;
}

export async function adminOverview(env: Env, now: number): Promise<Record<string, unknown>> {
  const g = await loadGlobal(env);
  const users = await env.DB.prepare('SELECT id, name, created, save_updated, save FROM users ORDER BY save_updated DESC, id DESC LIMIT 200').all<UserListRow>();
  const nUsers = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const nGifts = await env.DB.prepare('SELECT COUNT(*) AS n FROM gifts').first<{ n: number }>();
  return {
    now,
    users: nUsers?.n ?? 0,
    gifts: nGifts?.n ?? 0,
    global: { ...g, events: g.events.filter((e) => e.endsAt > now) },
    players: (users.results ?? []).map((u) => {
      const s = u.save ? parseStoredSave(u.save) : null;
      return {
        name: u.name,
        created: u.created,
        updated: u.save_updated,
        money: typeof s?.money === 'number' ? s.money : 0,
        bestDepth: typeof s?.bestDepth === 'number' ? s.bestDepth : 0,
        runs: typeof s?.runs === 'number' ? s.runs : 0,
      };
    }),
  };
}

export async function adminSetGlobal(env: Env, body: unknown): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const g = await loadGlobal(env);
  if (b.oreMult !== undefined) {
    if (typeof b.oreMult !== 'number' || !Number.isFinite(b.oreMult) || b.oreMult < 0 || b.oreMult > MAX_MULT) throw new HttpError(400, 'invalid_mult');
    g.oreMult = b.oreMult;
  }
  if (b.speedMult !== undefined) {
    if (typeof b.speedMult !== 'number' || !Number.isFinite(b.speedMult) || b.speedMult < 0 || b.speedMult > MAX_MULT) throw new HttpError(400, 'invalid_mult');
    g.speedMult = b.speedMult;
  }
  await saveGlobal(env, g);
  return { ok: true, oreMult: g.oreMult, speedMult: g.speedMult };
}

export async function adminStartEvent(env: Env, body: unknown, now: number): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const kind = b.kind;
  const m = b.mult;
  const minutes = b.minutes;
  if (!name || (kind !== 'ore' && kind !== 'speed')) throw new HttpError(400, 'invalid_event');
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > MAX_MULT) throw new HttpError(400, 'invalid_mult');
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1 || minutes > MAX_EVENT_MINUTES) throw new HttpError(400, 'invalid_minutes');
  const g = await loadGlobal(env);
  g.events = g.events.filter((e) => e.endsAt > now);
  if (g.events.length >= MAX_EVENTS) throw new HttpError(409, 'too_many_events');
  const ev: GlobalEvent = { id: toHex(randomBytes(4)), name, kind, mult: m, endsAt: now + Math.round(minutes * 60_000) };
  g.events.push(ev);
  await saveGlobal(env, g);
  return { ok: true, event: ev };
}

export async function adminStopEvent(env: Env, body: unknown, now: number): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const g = await loadGlobal(env);
  if (b.all === true) g.events = [];
  else if (typeof b.id === 'string') g.events = g.events.filter((e) => e.id !== b.id);
  else throw new HttpError(400, 'invalid_event');
  g.events = g.events.filter((e) => e.endsAt > now);
  await saveGlobal(env, g);
  return { ok: true, events: g.events };
}

export async function adminBroadcast(env: Env, auth: Auth, body: unknown, now: number): Promise<Record<string, unknown>> {
  const text = typeof (body as { text?: unknown } | null)?.text === 'string' ? ((body as { text: string }).text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : '';
  if (!text) throw new HttpError(400, 'invalid_message');
  if (text.length > MAX_MESSAGE_LEN) throw new HttpError(400, 'message_too_long');
  const g = await loadGlobal(env);
  g.lastMsgId += 1;
  g.messages.push({ id: g.lastMsgId, text, created: now, from: auth.name });
  if (g.messages.length > MAX_MESSAGES) g.messages = g.messages.slice(-MAX_MESSAGES);
  await saveGlobal(env, g);
  return { ok: true, id: g.lastMsgId };
}

/** Nachricht(en) löschen: danach zeigt sich bei den Spielern die vorherige (oder keine) als neueste. */
export async function adminDeleteMessage(env: Env, body: unknown): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const g = await loadGlobal(env);
  if (b.all === true) g.messages = [];
  else if (typeof b.id === 'number') g.messages = g.messages.filter((m) => m.id !== b.id);
  else throw new HttpError(400, 'invalid_message');
  await saveGlobal(env, g);
  return { ok: true };
}

/** Aktionen an einem Spieler. */
export async function adminUserAction(env: Env, auth: Auth, body: unknown, now: number): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = normalizeName(b.name);
  const action = b.action;
  if (!name || typeof action !== 'string') throw new HttpError(400, 'invalid_action');
  const user = await env.DB.prepare('SELECT id, name, save, save_version FROM users WHERE name_lower = ?')
    .bind(nameKey(name))
    .first<{ id: number; name: string; save: string | null; save_version: number }>();
  if (!user) throw new HttpError(404, 'unknown_recipient');
  const isSelf = user.id === auth.userId;

  const writeSave = async (save: Record<string, unknown>): Promise<void> => {
    await env.DB.prepare('UPDATE users SET save = ?, save_version = save_version + 1, save_updated = ? WHERE id = ?').bind(JSON.stringify(save), now, user.id).run();
  };

  switch (action) {
    case 'giveCoins':
    case 'setCoins': {
      const a = b.amount;
      if (typeof a !== 'number' || !Number.isFinite(a) || a < 0 || a > 1e60) throw new HttpError(400, 'invalid_amount');
      const save = parseStoredSave(user.save);
      const cur = typeof save.money === 'number' ? save.money : 0;
      save.money = Math.min(1e60, Math.floor(action === 'giveCoins' ? cur + a : a));
      await writeSave(save);
      return { ok: true, money: save.money };
    }
    case 'giveSkin': {
      const skin = b.skin;
      if (typeof skin !== 'string' || !SKINS.some((s) => s.id === skin)) throw new HttpError(400, 'invalid_skin');
      const save = parseStoredSave(user.save);
      const skins = Array.isArray(save.skins) ? (save.skins as string[]) : [];
      if (!skins.includes(skin)) save.skins = [...skins, skin];
      await writeSave(save);
      return { ok: true };
    }
    case 'resetPassword': {
      if (!validPassword(b.password)) throw new HttpError(400, 'invalid_password');
      const salt = toHex(randomBytes(16));
      const hash = await hashPassword(b.password, salt);
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET salt = ?, hash = ?, fails = 0, locked_until = 0 WHERE id = ?').bind(salt, hash, user.id),
        // alle Sitzungen beenden (außer der eigenen, falls der Admin sich selbst ändert)
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      ]);
      return { ok: true };
    }
    case 'logout': {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
      return { ok: true };
    }
    case 'delete': {
      if (isSelf) throw new HttpError(400, 'self');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM gifts WHERE from_user = ? OR to_user = ?').bind(user.id, user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      ]);
      return { ok: true };
    }
    default:
      throw new HttpError(400, 'invalid_action');
  }
}
