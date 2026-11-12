import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import { LOCK_MS, MAX_FAILS, MAX_SENDS_PER_HOUR, MAX_SESSIONS, MAX_UNCLAIMED, SESSION_DAYS } from '../server/src/handlers';
import { PBKDF2_ITERATIONS, hashPassword } from '../server/src/crypto';
import { normalizeName, validateSave } from '../server/src/validate';
import { createTestDb } from './d1-sqlite';

const ORIGIN = 'https://roentgenjon.github.io';
let env: { DB: ReturnType<typeof createTestDb>['db'] };
let raw: ReturnType<typeof createTestDb>['raw'];
let clock = 1_800_000_000_000;

beforeEach(() => {
  const t = createTestDb();
  env = { DB: t.db };
  raw = t.raw;
  clock = 1_800_000_000_000;
});

async function api(method: string, path: string, body?: unknown, token?: string, origin?: string): Promise<{ status: number; json: Record<string, any>; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, clock);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {}, headers: res.headers };
}

async function signup(name: string, password = 'geheim1234'): Promise<string> {
  const r = await api('POST', '/api/register', { name, password });
  expect(r.status).toBe(201);
  return r.json.token as string;
}

async function withSave(token: string, save: Record<string, unknown>): Promise<number> {
  const cur = await api('GET', '/api/save', undefined, token);
  const r = await api('PUT', '/api/save', { save: { version: 1, ...save }, baseVersion: cur.json.version }, token);
  expect(r.status).toBe(200);
  return r.json.version as number;
}

describe('Server: Grundlagen und CORS', () => {
  it('antwortet auf /api/health und kennt unbekannte Pfade nicht', async () => {
    expect((await api('GET', '/api/health')).json).toEqual({ ok: true });
    expect((await api('GET', '/api/gibtsnicht')).status).toBe(401); // erst Anmeldung, dann Pfad
    const t = await signup('Anna');
    expect((await api('GET', '/api/gibtsnicht', undefined, t)).status).toBe(404);
  });

  it('erlaubt nur bekannte Herkunftsadressen (CORS)', async () => {
    const ok = await api('GET', '/api/health', undefined, undefined, ORIGIN);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const bad = await api('GET', '/api/health', undefined, undefined, 'https://boese.example');
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const pre = await handle(new Request('https://api.test/api/save', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, clock);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('lehnt kaputtes JSON und zu große Bodys ab', async () => {
    const r = await handle(new Request('https://api.test/api/register', { method: 'POST', body: '{kaputt' }), env, clock);
    expect(r.status).toBe(400);
    const big = await handle(new Request('https://api.test/api/register', { method: 'POST', body: 'x'.repeat(300_000) }), env, clock);
    expect(big.status).toBe(413);
  });
});

describe('Server: Konten und Anmeldung', () => {
  it('registriert und meldet an; Passwort wird nur gehasht gespeichert', async () => {
    const r = await api('POST', '/api/register', { name: 'Anna', password: 'geheim1234' });
    expect(r.status).toBe(201);
    expect(r.json.token).toMatch(/^[0-9a-f]{64}$/);
    const row = raw.prepare('SELECT salt, hash FROM users').get() as { salt: string; hash: string };
    expect(row.hash).not.toContain('geheim');
    expect(row.hash).toBe(await hashPassword('geheim1234', row.salt, PBKDF2_ITERATIONS));
    const l = await api('POST', '/api/login', { name: 'anna', password: 'geheim1234' }); // Groß/Klein egal
    expect(l.status).toBe(200);
    expect(l.json.name).toBe('Anna');
    // das Token liegt nicht im Klartext in der Datenbank
    expect((raw.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[]).some((s) => s.token_hash === r.json.token)).toBe(false);
  });

  it('jedes Konto bekommt ein eigenes Salz', async () => {
    await signup('Anna');
    await signup('Berta');
    const salts = (raw.prepare('SELECT salt FROM users').all() as { salt: string }[]).map((r) => r.salt);
    expect(new Set(salts).size).toBe(2);
  });

  it('prüft Namen und Passwörter und verhindert doppelte Namen (ohne Groß/Klein)', async () => {
    await signup('Anna');
    expect((await api('POST', '/api/register', { name: 'ANNA', password: 'geheim1234' })).json.error).toBe('name_taken');
    for (const name of ['ab', 'x'.repeat(17), '<script>', ' ', '', 'a;b', 5, null]) {
      expect((await api('POST', '/api/register', { name, password: 'geheim1234' })).json.error, String(name)).toBe('invalid_name');
    }
    for (const password of ['kurz', '', 'x'.repeat(129), 12345678, null]) {
      expect((await api('POST', '/api/register', { name: 'Berta', password })).json.error).toBe('invalid_password');
    }
    expect(normalizeName('  Jörg   Öl ')).toBe('Jörg Öl');
    expect(normalizeName('Anna_B-2')).toBe('Anna_B-2');
  });

  it('falsches Passwort und unbekannter Name geben dieselbe Antwort', async () => {
    await signup('Anna');
    const a = await api('POST', '/api/login', { name: 'Anna', password: 'falsch12345' });
    const b = await api('POST', '/api/login', { name: 'Niemand', password: 'falsch12345' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.json).toEqual(b.json);
  });

  it('sperrt nach zu vielen Fehlversuchen kurz und gibt danach wieder frei', async () => {
    await signup('Anna');
    for (let i = 0; i < MAX_FAILS; i++) expect((await api('POST', '/api/login', { name: 'Anna', password: 'falsch12345' })).status).toBe(401);
    const locked = await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' }); // sogar das richtige Passwort wird abgelehnt
    expect(locked.status).toBe(429);
    expect(locked.json.retryAfter).toBeGreaterThan(0);
    clock += LOCK_MS + 1000;
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' })).status).toBe(200);
  });

  it('Fehlversuche zählen nur bis zum Erfolg', async () => {
    await signup('Anna');
    for (let i = 0; i < MAX_FAILS - 1; i++) await api('POST', '/api/login', { name: 'Anna', password: 'falsch12345' });
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' })).status).toBe(200);
    for (let i = 0; i < MAX_FAILS - 1; i++) await api('POST', '/api/login', { name: 'Anna', password: 'falsch12345' });
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' })).status).toBe(200); // nicht gesperrt
  });

  it('geschützte Pfade brauchen ein gültiges Token', async () => {
    for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/save'], ['PUT', '/api/save'], ['POST', '/api/send'], ['GET', '/api/inbox'], ['POST', '/api/inbox/claim'], ['POST', '/api/logout']] as const) {
      expect((await api(m, p)).status, `${m} ${p}`).toBe(401);
      expect((await api(m, p, undefined, 'a'.repeat(64))).status).toBe(401);
      expect((await api(m, p, undefined, 'zu-kurz')).status).toBe(401);
    }
  });

  it('Sitzungen laufen ab, Abmelden beendet sie, und es gibt höchstens 10 pro Konto', async () => {
    const t = await signup('Anna');
    expect((await api('GET', '/api/me', undefined, t)).status).toBe(200);
    clock += (SESSION_DAYS + 1) * 86_400_000;
    expect((await api('GET', '/api/me', undefined, t)).status).toBe(401);

    clock = 1_800_000_000_000;
    const t2 = (await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' })).json.token as string;
    expect((await api('POST', '/api/logout', undefined, t2)).status).toBe(200);
    expect((await api('GET', '/api/me', undefined, t2)).status).toBe(401);

    for (let i = 0; i < MAX_SESSIONS + 3; i++) {
      clock += 1000;
      await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' });
    }
    expect((raw.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n).toBeLessThanOrEqual(MAX_SESSIONS);
  });
});

describe('Server: Cloud-Spielstand', () => {
  it('speichert, liest und zählt die Version hoch', async () => {
    const t = await signup('Anna');
    expect((await api('GET', '/api/save', undefined, t)).json).toMatchObject({ save: null, version: 0 });
    const p1 = await api('PUT', '/api/save', { save: { version: 1, money: 500, skins: ['rot'] }, baseVersion: 0 }, t);
    expect(p1.json.version).toBe(1);
    const g = await api('GET', '/api/save', undefined, t);
    expect(g.json.save).toMatchObject({ money: 500, skins: ['rot'] });
    expect(g.json.version).toBe(1);
    expect((await api('GET', '/api/me', undefined, t)).json).toMatchObject({ name: 'Anna', hasSave: true, version: 1, inbox: 0 });
  });

  it('erkennt Konflikte (zwei Geräte) und liefert den Stand der Gegenseite mit', async () => {
    const t = await signup('Anna');
    await withSave(t, { money: 1 });
    const stale = await api('PUT', '/api/save', { save: { version: 1, money: 999 }, baseVersion: 0 }, t);
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('conflict');
    expect(stale.json.save.money).toBe(1);
    expect(stale.json.version).toBe(1);
    expect((await api('GET', '/api/save', undefined, t)).json.save.money).toBe(1); // nicht überschrieben
  });

  it('lehnt ungültige Spielstände ab', async () => {
    const t = await signup('Anna');
    const bad = [
      { version: 2 },
      { version: 1, money: -5 },
      { version: 1, money: 1e16 },
      { version: 1, money: 'viel' },
      { version: 1, skins: 'rot' },
      { version: 1, skins: Array(60).fill('x') },
      { version: 1, junk: 'x'.repeat(120_000) },
      [],
      'text',
      null,
    ];
    for (const save of bad) expect((await api('PUT', '/api/save', { save, baseVersion: 0 }, t)).json.error, JSON.stringify(save).slice(0, 40)).toBe('invalid_save');
    expect((await api('PUT', '/api/save', { save: { version: 1 }, baseVersion: -1 }, t)).json.error).toBe('invalid_version');
    expect((await api('PUT', '/api/save', { save: { version: 1 }, baseVersion: 'x' }, t)).json.error).toBe('invalid_version');
    expect(validateSave({ version: 1, money: 0 })).not.toBeNull();
  });

  it('Spielstände verschiedener Konten sind getrennt', async () => {
    const a = await signup('Anna');
    const b = await signup('Berta');
    await withSave(a, { money: 111 });
    await withSave(b, { money: 222 });
    expect((await api('GET', '/api/save', undefined, a)).json.save.money).toBe(111);
    expect((await api('GET', '/api/save', undefined, b)).json.save.money).toBe(222);
  });
});

describe('Server: Geschenke an andere Spieler', () => {
  let anna: string;
  let berta: string;
  beforeEach(async () => {
    anna = await signup('Anna');
    berta = await signup('Berta');
    await withSave(anna, { money: 1000, skins: ['rot', 'gold'], skin: 'gold' });
  });

  it('verschenkt Münzen: Absender wird sofort belastet, Empfänger sieht es im Posteingang und nimmt an', async () => {
    const r = await api('POST', '/api/send', { to: 'berta', kind: 'coins', amount: 400, note: 'Hi!' }, anna);
    expect(r.status).toBe(200);
    expect(r.json.save.money).toBe(600);
    expect((await api('GET', '/api/save', undefined, anna)).json.save.money).toBe(600);

    const box = await api('GET', '/api/inbox', undefined, berta);
    expect(box.json.gifts).toHaveLength(1);
    expect(box.json.gifts[0]).toMatchObject({ kind: 'coins', amount: 400, from: 'Anna', note: 'Hi!' });
    expect((await api('GET', '/api/me', undefined, berta)).json.inbox).toBe(1);

    const c = await api('POST', '/api/inbox/claim', { id: box.json.gifts[0].id }, berta);
    expect(c.status).toBe(200);
    expect(c.json.save.money).toBe(400); // Berta hatte noch keinen Spielstand -> wird angelegt
    expect((await api('GET', '/api/inbox', undefined, berta)).json.gifts).toHaveLength(0);
    expect((await api('POST', '/api/inbox/claim', { id: box.json.gifts[0].id }, berta)).status).toBe(404); // nur einmal
  });

  it('Münzen gehen weder verloren noch entstehen neue (Summe bleibt gleich)', async () => {
    await withSave(berta, { money: 50 });
    for (const amount of [1, 399, 100]) {
      const r = await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount }, anna);
      expect(r.status).toBe(200);
    }
    for (const g of (await api('GET', '/api/inbox', undefined, berta)).json.gifts) await api('POST', '/api/inbox/claim', { id: g.id }, berta);
    const a = (await api('GET', '/api/save', undefined, anna)).json.save.money as number;
    const b = (await api('GET', '/api/save', undefined, berta)).json.save.money as number;
    expect(a + b).toBe(1000 + 50);
  });

  it('verschenkt Skins (weg beim Absender, Auswahl fällt zurück) und lehnt Doppelbesitz ab', async () => {
    const r = await api('POST', '/api/send', { to: 'Berta', kind: 'skin', skin: 'gold' }, anna);
    expect(r.json.save.skins).toEqual(['rot']);
    expect(r.json.save.skin).toBe('miner');
    const id = (await api('GET', '/api/inbox', undefined, berta)).json.gifts[0].id as string;
    await withSave(berta, { skins: ['gold'] }); // besitzt ihn schon
    const dup = await api('POST', '/api/inbox/claim', { id }, berta);
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe('skin_already_owned');
    expect((await api('GET', '/api/inbox', undefined, berta)).json.gifts).toHaveLength(1); // bleibt liegen
  });

  it('neue Kaufskins sind verschenkbar, Erfolgs-Skins nicht', async () => {
    await withSave(anna, { money: 1000, skins: ['diamant', 'steinmetz'] });
    expect((await api('POST', '/api/send', { to: 'Berta', kind: 'skin', skin: 'diamant' }, anna)).status).toBe(200);
    expect((await api('POST', '/api/send', { to: 'Berta', kind: 'skin', skin: 'steinmetz' }, anna)).json.error).toBe('invalid_gift');
  });

  it('weist ungültige Geschenke ab, ohne etwas zu ändern', async () => {
    const before = (await api('GET', '/api/save', undefined, anna)).json;
    const cases: [unknown, number, string][] = [
      [{ to: 'Berta', kind: 'coins', amount: 0 }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'coins', amount: -5 }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'coins', amount: 1.5 }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'coins', amount: '100' }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'coins', amount: 1e30 }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'coins', amount: 1001 }, 400, 'not_enough_money'],
      [{ to: 'Berta', kind: 'skin', skin: 'violett' }, 400, 'skin_not_owned'],
      [{ to: 'Berta', kind: 'skin', skin: 'miner' }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'skin', skin: 'geist' }, 400, 'invalid_gift'],
      [{ to: 'Berta', kind: 'dynamit', amount: 5 }, 400, 'invalid_gift'],
      [{ to: 'Niemand', kind: 'coins', amount: 5 }, 404, 'unknown_recipient'],
      [{ to: 'Anna', kind: 'coins', amount: 5 }, 400, 'self'],
      [{ to: '', kind: 'coins', amount: 5 }, 400, 'invalid_gift'],
      [{ kind: 'coins', amount: 5 }, 400, 'invalid_gift'],
    ];
    for (const [body, status, error] of cases) {
      const r = await api('POST', '/api/send', body, anna);
      expect([r.status, r.json.error], JSON.stringify(body)).toEqual([status, error]);
    }
    expect((await api('GET', '/api/save', undefined, anna)).json).toEqual(before);
    expect((await api('GET', '/api/inbox', undefined, berta)).json.gifts).toHaveLength(0);
  });

  it('ohne Cloud-Spielstand kann man nichts verschenken', async () => {
    const r = await api('POST', '/api/send', { to: 'Anna', kind: 'coins', amount: 1 }, berta);
    expect(r.json.error).toBe('no_cloud_save');
  });

  it('zwei gleichzeitige Verschenk-Anfragen können dasselbe Geld nicht doppelt ausgeben', async () => {
    const [x, y] = await Promise.all([
      api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 900 }, anna),
      api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 900 }, anna),
    ]);
    expect([x.status === 200, y.status === 200].filter(Boolean)).toHaveLength(1); // genau eine gelingt
    expect((await api('GET', '/api/save', undefined, anna)).json.save.money).toBe(100);
    expect((await api('GET', '/api/inbox', undefined, berta)).json.gifts).toHaveLength(1);
  });

  it('Rennen: Ändert ein anderes Gerät den Stand zwischen Lesen und Abbuchen, wird NICHTS gebucht', async () => {
    const real = env.DB;
    let tampered = false;
    env.DB = {
      prepare: (sql) => real.prepare(sql),
      batch: async (stmts) => {
        if (!tampered) {
          tampered = true;
          raw.prepare("UPDATE users SET save_version = save_version + 1 WHERE name = 'Anna'").run(); // „anderes Gerät“ speichert gerade
        }
        return real.batch(stmts);
      },
    };
    const r = await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 500 }, anna);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('conflict');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM gifts').get()).toEqual({ n: 0 }); // kein Geschenk ohne Abbuchung
    expect(JSON.parse((raw.prepare("SELECT save FROM users WHERE name = 'Anna'").get() as { save: string }).save).money).toBe(1000); // nichts abgebucht
    env.DB = real;
  });

  it('Rennen beim Annehmen: Ändert sich der Stand zwischendurch, bleibt das Geschenk liegen', async () => {
    await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 300 }, anna);
    const id = (await api('GET', '/api/inbox', undefined, berta)).json.gifts[0].id as string;
    await withSave(berta, { money: 5 });
    const real = env.DB;
    let tampered = false;
    env.DB = {
      prepare: (sql) => real.prepare(sql),
      batch: async (stmts) => {
        if (!tampered) {
          tampered = true;
          raw.prepare("UPDATE users SET save_version = save_version + 1 WHERE name = 'Berta'").run();
        }
        return real.batch(stmts);
      },
    };
    const r = await api('POST', '/api/inbox/claim', { id }, berta);
    expect(r.status).toBe(409);
    env.DB = real;
    expect((raw.prepare('SELECT claimed FROM gifts WHERE id = ?').get(id) as { claimed: number | null }).claimed).toBeNull(); // nicht als abgeholt markiert
    expect((await api('GET', '/api/save', undefined, berta)).json.save.money).toBe(5); // nichts gutgeschrieben
    // erneut versuchen klappt
    expect((await api('POST', '/api/inbox/claim', { id }, berta)).status).toBe(200);
    expect((await api('GET', '/api/save', undefined, berta)).json.save.money).toBe(305);
  });

  it('dasselbe Geschenk lässt sich nicht gleichzeitig zweimal annehmen', async () => {
    await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 300 }, anna);
    const id = (await api('GET', '/api/inbox', undefined, berta)).json.gifts[0].id as string;
    const [x, y] = await Promise.all([api('POST', '/api/inbox/claim', { id }, berta), api('POST', '/api/inbox/claim', { id }, berta)]);
    expect([x.status === 200, y.status === 200].filter(Boolean)).toHaveLength(1);
    expect((await api('GET', '/api/save', undefined, berta)).json.save.money).toBe(300);
  });

  it('Fremde können ein Geschenk nicht abholen', async () => {
    const carl = await signup('Carl');
    await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 100 }, anna);
    const id = (await api('GET', '/api/inbox', undefined, berta)).json.gifts[0].id as string;
    expect((await api('POST', '/api/inbox/claim', { id }, carl)).status).toBe(404);
    expect((await api('POST', '/api/inbox/claim', { id }, anna)).status).toBe(404);
    expect((await api('GET', '/api/inbox', undefined, carl)).json.gifts).toHaveLength(0);
    for (const bad of ['', 'x', '../..', 123, null]) expect((await api('POST', '/api/inbox/claim', { id: bad }, berta)).status).toBe(400);
  });

  it('begrenzt Verschenken pro Stunde und die Größe des Posteingangs', async () => {
    await withSave(anna, { money: 1e6 });
    for (let i = 0; i < MAX_SENDS_PER_HOUR; i++) expect((await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 1 }, anna)).status).toBe(200);
    expect((await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 1 }, anna)).json.error).toBe('rate_limited');
    clock += 3_700_000;
    expect((await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 1 }, anna)).status).toBe(200);

    const carl = await signup('Carl');
    const idB = (raw.prepare('SELECT id FROM users WHERE name = ?').get('Berta') as { id: number }).id;
    const idC = (raw.prepare('SELECT id FROM users WHERE name = ?').get('Carl') as { id: number }).id;
    const ins = raw.prepare("INSERT INTO gifts (id, from_user, to_user, kind, amount, created) VALUES (?, ?, ?, 'coins', 1, ?)");
    for (let i = 0; i < MAX_UNCLAIMED; i++) ins.run(`${String(i).padStart(16, '0')}`, idB, idC, clock); // von Berta, damit Annas Stundenlimit unberührt bleibt
    expect((await api('POST', '/api/send', { to: 'Carl', kind: 'coins', amount: 1 }, anna)).json.error).toBe('inbox_full');
    expect(carl).toBeTruthy();
  });

  it('bereinigt die Nachricht', async () => {
    await api('POST', '/api/send', { to: 'Berta', kind: 'coins', amount: 1, note: `${'n'.repeat(100)}\u0000\u0007` }, anna);
    const note = (await api('GET', '/api/inbox', undefined, berta)).json.gifts[0].note as string;
    expect(note.length).toBeLessThanOrEqual(40);
    expect(note).not.toMatch(/[\u0000-\u001f]/);
  });
});
