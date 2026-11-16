import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import { createTestDb } from './d1-sqlite';

let env: { DB: ReturnType<typeof createTestDb>['db'] };
let clock = 1_800_000_000_000;
beforeEach(() => {
  env = { DB: createTestDb().db };
  clock = 1_800_000_000_000;
});

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: Record<string, any> }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await handle(new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, clock);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
async function signup(name: string): Promise<string> {
  const r = await api('POST', '/api/register', { name, password: 'geheim1234' });
  expect(r.status).toBe(201);
  return r.json.token as string;
}
const save = (token: string, money: number): Promise<unknown> =>
  api('GET', '/api/save', undefined, token).then((c) => api('PUT', '/api/save', { save: { version: 1, money, skins: [] }, baseVersion: c.json.version }, token));

describe('Admin: Zugriff', () => {
  it('nur Entity_2806 (ohne Groß-/Kleinschreibung) darf, andere bekommen 403', async () => {
    const admin = await signup('entity_2806');
    const anna = await signup('Anna');
    expect((await api('GET', '/api/me', undefined, admin)).json.admin).toBe(true);
    expect((await api('GET', '/api/me', undefined, anna)).json.admin).toBe(false);
    expect((await api('GET', '/api/admin/overview', undefined, admin)).status).toBe(200);
    for (const [m, p] of [['GET', '/api/admin/overview'], ['POST', '/api/admin/global'], ['POST', '/api/admin/event'], ['POST', '/api/admin/broadcast'], ['POST', '/api/admin/user']] as const) {
      expect((await api(m, p, m === 'POST' ? {} : undefined, anna)).status, p).toBe(403);
      expect((await api(m, p, m === 'POST' ? {} : undefined)).status, p).toBe(401);
    }
  });
});

describe('Admin: Multiplikatoren, Events, Nachrichten', () => {
  it('öffentlich ohne Anmeldung lesbar: Erz-Multiplikator, aktive Events, neueste Nachricht', async () => {
    const admin = await signup('Entity_2806');
    expect((await api('GET', '/api/global')).json).toMatchObject({ oreMult: 1, speedMult: 1, events: [], message: null });
    expect((await api('POST', '/api/admin/global', { oreMult: 5, speedMult: 2 }, admin)).status).toBe(200);
    await api('POST', '/api/admin/event', { name: 'Goldrausch', kind: 'ore', mult: 3, minutes: 10 }, admin);
    await api('POST', '/api/admin/broadcast', { text: 'Hallo zusammen!' }, admin);
    const g = (await api('GET', '/api/global')).json;
    expect(g.oreMult).toBe(5);
    expect(g.speedMult).toBe(2);
    expect(g.events).toHaveLength(1);
    expect(g.events[0]).toMatchObject({ name: 'Goldrausch', kind: 'ore', mult: 3, endsAt: clock + 600_000 });
    expect(g.message).toMatchObject({ id: 1, text: 'Hallo zusammen!' });
    // Events laufen von selbst ab
    clock += 11 * 60_000;
    expect((await api('GET', '/api/global')).json.events).toEqual([]);
  });

  it('prüft Eingaben', async () => {
    const admin = await signup('Entity_2806');
    for (const bad of [{ oreMult: -1 }, { oreMult: 'viel' }, { oreMult: 1e13 }, { speedMult: NaN }]) {
      expect((await api('POST', '/api/admin/global', bad, admin)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const bad of [{ name: '', kind: 'ore', mult: 2, minutes: 5 }, { name: 'x', kind: 'geld', mult: 2, minutes: 5 }, { name: 'x', kind: 'ore', mult: -2, minutes: 5 }, { name: 'x', kind: 'ore', mult: 2, minutes: 0 }]) {
      expect((await api('POST', '/api/admin/event', bad, admin)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await api('POST', '/api/admin/broadcast', { text: '  ' }, admin)).status).toBe(400);
    expect((await api('POST', '/api/admin/broadcast', { text: 'x'.repeat(301) }, admin)).status).toBe(400);
  });

  it('Events lassen sich einzeln oder alle beenden; Nachrichten löschen', async () => {
    const admin = await signup('Entity_2806');
    const a = (await api('POST', '/api/admin/event', { name: 'A', kind: 'ore', mult: 2, minutes: 5 }, admin)).json.event;
    await api('POST', '/api/admin/event', { name: 'B', kind: 'speed', mult: 4, minutes: 5 }, admin);
    await api('POST', '/api/admin/event/stop', { id: a.id }, admin);
    expect((await api('GET', '/api/global')).json.events.map((e: any) => e.name)).toEqual(['B']);
    await api('POST', '/api/admin/event/stop', { all: true }, admin);
    expect((await api('GET', '/api/global')).json.events).toEqual([]);
    await api('POST', '/api/admin/broadcast', { text: 'eins' }, admin);
    await api('POST', '/api/admin/broadcast', { text: 'zwei' }, admin);
    expect((await api('GET', '/api/global')).json.message.id).toBe(2);
    await api('POST', '/api/admin/message/delete', { id: 2 }, admin);
    expect((await api('GET', '/api/global')).json.message).toMatchObject({ id: 1, text: 'eins' });
    await api('POST', '/api/admin/message/delete', { all: true }, admin);
    expect((await api('GET', '/api/global')).json.message).toBeNull();
  });
});

describe('Admin: Spieler', () => {
  it('Übersicht, Münzen geben/setzen, Skin geben', async () => {
    const admin = await signup('Entity_2806');
    const anna = await signup('Anna');
    await save(anna, 100);
    const o = (await api('GET', '/api/admin/overview', undefined, admin)).json;
    expect(o.users).toBe(2);
    expect(o.players.find((p: any) => p.name === 'Anna').money).toBe(100);
    await api('POST', '/api/admin/user', { name: 'anna', action: 'giveCoins', amount: 50 }, admin);
    expect((await api('GET', '/api/save', undefined, anna)).json.save.money).toBe(150);
    await api('POST', '/api/admin/user', { name: 'Anna', action: 'setCoins', amount: 7 }, admin);
    expect((await api('GET', '/api/save', undefined, anna)).json.save.money).toBe(7);
    expect((await api('POST', '/api/admin/user', { name: 'Anna', action: 'giveSkin', skin: 'gibtsnicht' }, admin)).status).toBe(400);
    expect((await api('POST', '/api/admin/user', { name: 'Anna', action: 'giveSkin', skin: 'geist' }, admin)).status).toBe(200);
    expect((await api('GET', '/api/save', undefined, anna)).json.save.skins).toContain('geist');
    expect((await api('POST', '/api/admin/user', { name: 'Nobody', action: 'giveCoins', amount: 1 }, admin)).status).toBe(404);
    expect((await api('POST', '/api/admin/user', { name: 'Anna', action: 'giveCoins', amount: -1 }, admin)).status).toBe(400);
  });

  it('Passwort zurücksetzen beendet Sitzungen; Löschen entfernt Spieler samt Geschenken, nie sich selbst', async () => {
    const admin = await signup('Entity_2806');
    const anna = await signup('Anna');
    await api('POST', '/api/admin/user', { name: 'Anna', action: 'resetPassword', password: 'neuespass99' }, admin);
    expect((await api('GET', '/api/me', undefined, anna)).status).toBe(401);
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'geheim1234' })).status).toBe(401);
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'neuespass99' })).status).toBe(200);
    expect((await api('POST', '/api/admin/user', { name: 'Anna', action: 'resetPassword', password: 'kurz' }, admin)).status).toBe(400);
    expect((await api('POST', '/api/admin/user', { name: 'Entity_2806', action: 'delete' }, admin)).status).toBe(400);
    expect((await api('POST', '/api/admin/user', { name: 'Anna', action: 'delete' }, admin)).status).toBe(200);
    expect((await api('POST', '/api/login', { name: 'Anna', password: 'neuespass99' })).status).toBe(401);
    expect((await api('GET', '/api/admin/overview', undefined, admin)).json.users).toBe(1);
  });
});
