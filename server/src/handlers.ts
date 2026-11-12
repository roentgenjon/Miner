import { GIFTS } from '../../src/config';
import { PBKDF2_ITERATIONS, constantTimeEqual, hashPassword, randomBytes, randomToken, sha256Hex, toHex } from './crypto';
import type { Env } from './db';
import { GIFT_SKINS, MAX_SAVE_BYTES, nameKey, normalizeName, parseGiftInput, validPassword, validateSave } from './validate';

export const SESSION_DAYS = 30;
export const MAX_SESSIONS = 10;
export const MAX_FAILS = 5;
export const LOCK_MS = 60_000;
export const MAX_UNCLAIMED = 100;
export const MAX_SENDS_PER_HOUR = 30;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

interface UserRow {
  id: number;
  name: string;
  salt: string;
  hash: string;
  fails: number;
  locked_until: number;
  save: string | null;
  save_version: number;
  save_updated: number;
}

export interface Auth {
  userId: number;
  name: string;
}

const DUMMY_SALT = '00112233445566778899aabbccddeeff';

/* ---------- Sitzungen ---------- */

async function createSession(env: Env, userId: number, now: number): Promise<string> {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86_400_000)
    .run();
  // Abgelaufene und überzählige Sitzungen entfernen
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires <= ?').bind(userId, now).run();
  await env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created DESC LIMIT ?)',
  )
    .bind(userId, userId, MAX_SESSIONS)
    .run();
  return token;
}

export async function authenticate(request: Request, env: Env, now: number): Promise<Auth> {
  const header = request.headers.get('Authorization') ?? '';
  const m = /^Bearer ([0-9a-f]{64})$/.exec(header);
  if (!m) throw new HttpError(401, 'unauthorized');
  const row = await env.DB.prepare(
    'SELECT u.id AS id, u.name AS name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?',
  )
    .bind(await sha256Hex(m[1] as string), now)
    .first<{ id: number; name: string }>();
  if (!row) throw new HttpError(401, 'unauthorized');
  return { userId: row.id, name: row.name };
}

/* ---------- Konto ---------- */

export async function register(env: Env, body: unknown, now: number): Promise<{ token: string; name: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = normalizeName(b.name);
  if (!name) throw new HttpError(400, 'invalid_name');
  if (!validPassword(b.password)) throw new HttpError(400, 'invalid_password');
  const salt = toHex(randomBytes(16));
  const hash = await hashPassword(b.password, salt);
  try {
    await env.DB.prepare('INSERT INTO users (name, name_lower, salt, hash, created) VALUES (?, ?, ?, ?, ?)')
      .bind(name, nameKey(name), salt, hash, now)
      .run();
  } catch {
    throw new HttpError(409, 'name_taken'); // eindeutiger Index verletzt
  }
  const user = await env.DB.prepare('SELECT id FROM users WHERE name_lower = ?').bind(nameKey(name)).first<{ id: number }>();
  if (!user) throw new HttpError(500, 'internal');
  return { token: await createSession(env, user.id, now), name };
}

export async function login(env: Env, body: unknown, now: number): Promise<{ token: string; name: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = normalizeName(b.name);
  const password = typeof b.password === 'string' ? b.password.slice(0, 128) : '';
  const user = name ? await env.DB.prepare('SELECT * FROM users WHERE name_lower = ?').bind(nameKey(name)).first<UserRow>() : null;
  if (user && user.locked_until > now) throw new HttpError(429, 'locked', { retryAfter: Math.ceil((user.locked_until - now) / 1000) });
  // Immer genauso lange rechnen, auch bei unbekanntem Namen (kein Hinweis, welche Namen es gibt)
  const candidate = await hashPassword(password, user?.salt ?? DUMMY_SALT, PBKDF2_ITERATIONS);
  if (!user || !constantTimeEqual(candidate, user.hash)) {
    if (user) {
      const fails = user.fails + 1;
      await env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE id = ?')
        .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : 0, user.id)
        .run();
    }
    throw new HttpError(401, 'invalid_credentials');
  }
  if (user.fails > 0) await env.DB.prepare('UPDATE users SET fails = 0 WHERE id = ?').bind(user.id).run();
  return { token: await createSession(env, user.id, now), name: user.name };
}

export async function logout(env: Env, request: Request): Promise<void> {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') ?? '');
  if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(m[1] as string)).run();
}

export async function me(env: Env, auth: Auth): Promise<Record<string, unknown>> {
  const u = await env.DB.prepare('SELECT save IS NOT NULL AS has_save, save_version FROM users WHERE id = ?')
    .bind(auth.userId)
    .first<{ has_save: number; save_version: number }>();
  const inbox = await env.DB.prepare('SELECT COUNT(*) AS n FROM gifts WHERE to_user = ? AND claimed IS NULL').bind(auth.userId).first<{ n: number }>();
  return { name: auth.name, hasSave: !!u?.has_save, version: u?.save_version ?? 0, inbox: inbox?.n ?? 0 };
}

/* ---------- Spielstand ---------- */

export async function getSave(env: Env, auth: Auth): Promise<Record<string, unknown>> {
  const u = await env.DB.prepare('SELECT save, save_version, save_updated FROM users WHERE id = ?')
    .bind(auth.userId)
    .first<{ save: string | null; save_version: number; save_updated: number }>();
  return { save: u?.save ? (JSON.parse(u.save) as unknown) : null, version: u?.save_version ?? 0, updated: u?.save_updated ?? 0 };
}

export async function putSave(env: Env, auth: Auth, body: unknown, now: number): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const save = validateSave(b.save);
  if (!save) throw new HttpError(400, 'invalid_save');
  const base = b.baseVersion;
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) throw new HttpError(400, 'invalid_version');
  const json = JSON.stringify(save);
  if (json.length > MAX_SAVE_BYTES) throw new HttpError(413, 'too_large');
  const r = await env.DB.prepare('UPDATE users SET save = ?, save_version = save_version + 1, save_updated = ? WHERE id = ? AND save_version = ?')
    .bind(json, now, auth.userId, base)
    .run();
  if ((r.meta?.changes ?? 0) !== 1) {
    const cur = await getSave(env, auth);
    throw new HttpError(409, 'conflict', cur);
  }
  return { version: base + 1, updated: now };
}

/* ---------- Geschenke ---------- */

function parseStoredSave(json: string | null): Record<string, unknown> {
  if (!json) return { version: 1, money: 0, skins: [] };
  try {
    const p = JSON.parse(json) as unknown;
    return validateSave(p) ?? { version: 1, money: 0, skins: [] };
  } catch {
    return { version: 1, money: 0, skins: [] };
  }
}

export async function sendGift(env: Env, auth: Auth, body: unknown, now: number): Promise<Record<string, unknown>> {
  const b = (body ?? {}) as Record<string, unknown>;
  const toName = normalizeName(b.to);
  const input = parseGiftInput(b);
  if (!toName || !input) throw new HttpError(400, 'invalid_gift');
  const to = await env.DB.prepare('SELECT id, name FROM users WHERE name_lower = ?').bind(nameKey(toName)).first<{ id: number; name: string }>();
  if (!to) throw new HttpError(404, 'unknown_recipient');
  if (to.id === auth.userId) throw new HttpError(400, 'self');

  const hour = await env.DB.prepare('SELECT COUNT(*) AS n FROM gifts WHERE from_user = ? AND created > ?').bind(auth.userId, now - 3_600_000).first<{ n: number }>();
  if ((hour?.n ?? 0) >= MAX_SENDS_PER_HOUR) throw new HttpError(429, 'rate_limited');
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM gifts WHERE to_user = ? AND claimed IS NULL').bind(to.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_UNCLAIMED) throw new HttpError(429, 'inbox_full');

  const sender = await env.DB.prepare('SELECT save, save_version FROM users WHERE id = ?').bind(auth.userId).first<{ save: string | null; save_version: number }>();
  if (!sender?.save) throw new HttpError(409, 'no_cloud_save'); // erst Spielstand hochladen
  const save = parseStoredSave(sender.save);
  if (input.kind === 'coins') {
    const money = typeof save.money === 'number' ? save.money : 0;
    if (input.amount > money) throw new HttpError(400, 'not_enough_money');
    save.money = money - input.amount;
  } else {
    const skins = Array.isArray(save.skins) ? (save.skins as string[]) : [];
    if (!skins.includes(input.skin)) throw new HttpError(400, 'skin_not_owned');
    save.skins = skins.filter((s) => s !== input.skin);
    if (save.skin === input.skin) save.skin = 'miner';
  }

  const id = toHex(randomBytes(8));
  const json = JSON.stringify(save);
  const v = sender.save_version;
  // Beides in EINER Transaktion: Geschenk anlegen (nur wenn der Stand unverändert ist) und abbuchen.
  const [ins, upd] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO gifts (id, from_user, to_user, kind, amount, skin, note, created) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT save_version FROM users WHERE id = ?) = ?',
    ).bind(id, auth.userId, to.id, input.kind, input.kind === 'coins' ? input.amount : null, input.kind === 'skin' ? input.skin : null, input.note ?? null, now, auth.userId, v),
    env.DB.prepare('UPDATE users SET save = ?, save_version = save_version + 1, save_updated = ? WHERE id = ? AND save_version = ?').bind(json, now, auth.userId, v),
  ]);
  if ((ins?.meta?.changes ?? 0) !== 1 || (upd?.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'conflict', await getSave(env, auth));
  return { ok: true, id, to: to.name, version: v + 1, save };
}

export async function inbox(env: Env, auth: Auth): Promise<Record<string, unknown>> {
  const rows = await env.DB.prepare(
    'SELECT g.id, g.kind, g.amount, g.skin, g.note, g.created, u.name AS "from" FROM gifts g JOIN users u ON u.id = g.from_user WHERE g.to_user = ? AND g.claimed IS NULL ORDER BY g.created DESC LIMIT ?',
  )
    .bind(auth.userId, MAX_UNCLAIMED)
    .all();
  return { gifts: rows.results ?? [] };
}

export async function claimGift(env: Env, auth: Auth, body: unknown, now: number): Promise<Record<string, unknown>> {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, 'invalid_gift');
  const g = await env.DB.prepare('SELECT kind, amount, skin FROM gifts WHERE id = ? AND to_user = ? AND claimed IS NULL')
    .bind(id, auth.userId)
    .first<{ kind: string; amount: number | null; skin: string | null }>();
  if (!g) throw new HttpError(404, 'gift_not_found');
  const mine = await env.DB.prepare('SELECT save, save_version FROM users WHERE id = ?').bind(auth.userId).first<{ save: string | null; save_version: number }>();
  const save = parseStoredSave(mine?.save ?? null);
  if (g.kind === 'coins') {
    const money = typeof save.money === 'number' ? save.money : 0;
    save.money = Math.min(1e15, money + (g.amount ?? 0));
  } else {
    const skins = Array.isArray(save.skins) ? (save.skins as string[]) : [];
    if (!g.skin || !GIFT_SKINS.includes(g.skin)) throw new HttpError(400, 'invalid_gift');
    if (skins.includes(g.skin)) throw new HttpError(409, 'skin_already_owned'); // bleibt im Posteingang
    save.skins = [...skins, g.skin];
  }
  const v = mine?.save_version ?? 0;
  // Zwei Schritte in EINER Transaktion, fest über das Geschenk selbst gekoppelt:
  // 1) als abgeholt markieren – nur wenn der Spielstand noch unverändert ist (Version v),
  // 2) gutschreiben – nur wenn Schritt 1 gerade eben gegriffen hat (claimed = now).
  // Greift Schritt 1 nicht (anderes Gerät war schneller), passiert gar nichts: kein Geschenk geht verloren.
  const [mark, upd] = await env.DB.batch([
    env.DB.prepare('UPDATE gifts SET claimed = ? WHERE id = ? AND to_user = ? AND claimed IS NULL AND (SELECT save_version FROM users WHERE id = ?) = ?').bind(
      now,
      id,
      auth.userId,
      auth.userId,
      v,
    ),
    env.DB.prepare(
      'UPDATE users SET save = ?, save_version = save_version + 1, save_updated = ? WHERE id = ? AND save_version = ? AND EXISTS (SELECT 1 FROM gifts WHERE id = ? AND to_user = ? AND claimed = ?)',
    ).bind(JSON.stringify(save), now, auth.userId, v, id, auth.userId, now),
  ]);
  if ((mark?.meta?.changes ?? 0) !== 1 || (upd?.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'conflict', await getSave(env, auth));
  return { ok: true, version: v + 1, save };
}

export { GIFTS };
