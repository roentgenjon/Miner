import { beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../server/src/index';
import { createApi, describeApiError } from '../src/net/api';
import { CLOUD_KEY, CloudSync, hasProgress, loadLinks } from '../src/net/sync';
import { defaultMeta, type KeyValueStore, type Meta } from '../src/meta/save';
import { createTestDb } from './d1-sqlite';

let env: { DB: ReturnType<typeof createTestDb>['db'] };
let clock: number;
let offline = false;

beforeEach(() => {
  env = { DB: createTestDb().db };
  clock = 1_800_000_000_000;
  offline = false;
});

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** Ein „Gerät“: eigener Speicher, eigener Spielstand, Client gegen den echten Server-Code. */
function device(accountId = 'main') {
  const store = memStore();
  const state = { meta: defaultMeta(), account: accountId };
  const api = createApi('https://api.test', async (url, init) => {
    if (offline) throw new TypeError('offline');
    return handle(new Request(url, init), env, clock);
  });
  const sync = new CloudSync({
    api,
    store,
    getMeta: () => state.meta,
    applyMeta: (m: Meta) => {
      state.meta = m;
    },
    accountId: () => state.account,
  });
  return { sync, store, state };
}

async function connect(d: ReturnType<typeof device>, name: string, mode: 'login' | 'register' = 'register') {
  const r = await d.sync.signIn(mode, name, 'geheim1234');
  expect(r.ok).toBe(true);
  return r;
}

describe('Cloud-Sync: Anmelden', () => {
  it('neues Online-Konto: Gerätestand wird hochgeladen und steht danach online', async () => {
    const a = device();
    a.state.meta.money = 500;
    a.state.meta.upgrades.pick = 7;
    const r = await connect(a, 'Anna');
    expect(r.ok && r.plan).toBe('upload');
    expect(await a.sync.push()).toBeNull();
    expect(a.sync.state()).toBe('synced');
    const b = device();
    const r2 = await connect(b, 'Anna', 'login');
    expect(r2.ok && r2.plan).toBe('adopt'); // leeres Gerät -> Online-Stand einfach laden
    expect(b.sync.adoptPending()).toBeNull();
    expect(b.state.meta.money).toBe(500);
    expect(b.state.meta.upgrades.pick).toBe(7);
  });

  it('Gerät mit eigenem Fortschritt und Online-Stand: der Nutzer muss wählen', async () => {
    const a = device();
    a.state.meta.money = 500;
    await connect(a, 'Anna');
    await a.sync.push();
    const b = device();
    b.state.meta.money = 9;
    b.state.meta.runs = 3;
    const r = await connect(b, 'Anna', 'login');
    expect(r.ok && r.plan).toBe('ask');
    expect(r.ok && r.cloudMeta?.money).toBe(500);
    expect(b.state.meta.money).toBe(9); // noch nichts überschrieben
    expect(hasProgress(b.state.meta)).toBe(true);
    expect(hasProgress(defaultMeta())).toBe(false);
  });

  it('zeigt verständliche Fehler und merkt sich nichts bei falschen Daten', async () => {
    const a = device();
    await connect(a, 'Anna');
    const b = device();
    const bad = await b.sync.signIn('login', 'Anna', 'falsches-passwort');
    expect(bad).toEqual({ ok: false, message: 'Name oder Passwort stimmt nicht. Noch kein Online-Konto? Dann „Neu registrieren“ drücken.' });
    expect(b.sync.state()).toBe('off');
    expect(b.store.data.has(CLOUD_KEY)).toBe(false);
    const dup = await b.sync.signIn('register', 'anna', 'geheim1234');
    expect(dup.ok === false && dup.message).toBe('Diesen Namen gibt es schon.');
    const shortPw = await b.sync.signIn('register', 'Berta', 'kurz');
    expect(shortPw.ok === false && shortPw.message).toContain('8–128');
    offline = true;
    const off = await b.sync.signIn('login', 'Anna', 'geheim1234');
    expect(off.ok === false && off.message).toContain('Keine Verbindung');
  });

  it('merkt sich die Anmeldung über einen Neustart (gespeichert, geprüft beim Laden)', async () => {
    const a = device();
    await connect(a, 'Anna');
    const again = loadLinks(a.store).main;
    expect(again?.name).toBe('Anna');
    expect(again?.token).toMatch(/^[0-9a-f]{64}$/);
    a.store.data.set(CLOUD_KEY, JSON.stringify({ version: 2, links: { main: { name: 'x', token: 'zu-kurz' } } }));
    expect(loadLinks(a.store)).toEqual({});
    a.store.data.set(CLOUD_KEY, '{kaputt');
    expect(loadLinks(a.store)).toEqual({});
  });
});

describe('Cloud-Sync: Speichern, Laden, Konflikte', () => {
  async function pair() {
    const a = device();
    a.state.meta.money = 100;
    await connect(a, 'Anna');
    await a.sync.push();
    const b = device();
    await connect(b, 'Anna', 'login');
    b.sync.adoptPending();
    return { a, b };
  }

  it('markiert Änderungen als offen und sichert sie; der andere bekommt sie ohne Rückfrage', async () => {
    const { a, b } = await pair();
    a.state.meta.money = 250;
    a.sync.markDirty();
    expect(a.sync.state()).toBe('dirty');
    expect(await a.sync.push()).toBeNull();
    expect(a.sync.state()).toBe('synced');
    expect(await b.sync.pull()).toBe('Neuer Online-Stand geladen.');
    expect(b.state.meta.money).toBe(250);
    expect(b.sync.state()).toBe('synced');
    expect(await b.sync.pull()).toBeNull(); // nichts Neues
  });

  it('Konflikt: beide ändern etwas – nichts wird überschrieben, bis der Nutzer entscheidet', async () => {
    const { a, b } = await pair();
    a.state.meta.money = 250;
    a.sync.markDirty();
    await a.sync.push();
    b.state.meta.money = 777; // anderes Gerät, ohne Wissen über A
    b.sync.markDirty();
    expect(await b.sync.push()).toContain('anderen Gerät');
    expect(b.sync.state()).toBe('conflict');
    expect(b.sync.pending?.meta.money).toBe(250);
    // weitere Sicherungen sind gesperrt, solange ungelöst
    expect(await b.sync.push()).toContain('anderen Gerät');
    expect(await a.sync.pull()).toBeNull();
    expect(((await createApi('https://api.test', async (u, i) => handle(new Request(u, i), env, clock)).getSave(a.sync.link?.token ?? '')) as { ok: true; data: { save: { money: number } } }).data.save.money).toBe(250);
  });

  it('Konflikt lösen: „Online-Stand laden“ verwirft den Gerätestand', async () => {
    const { a, b } = await pair();
    a.state.meta.money = 250;
    await a.sync.push();
    b.state.meta.money = 777;
    b.sync.markDirty();
    await b.sync.push();
    expect(await b.sync.resolve('cloud')).toBeNull();
    expect(b.state.meta.money).toBe(250);
    expect(b.sync.state()).toBe('synced');
  });

  it('Konflikt lösen: „Gerätestand hochladen“ ersetzt den Online-Stand', async () => {
    const { a, b } = await pair();
    a.state.meta.money = 250;
    await a.sync.push();
    b.state.meta.money = 777;
    b.sync.markDirty();
    await b.sync.push();
    expect(await b.sync.resolve('local')).toBeNull();
    expect(b.sync.state()).toBe('synced');
    expect(await a.sync.pull()).toBe('Neuer Online-Stand geladen.');
    expect(a.state.meta.money).toBe(777);
  });

  it('beim Start: ungesicherte Änderungen plus neuerer Online-Stand ergeben einen Konflikt, nichts geht verloren', async () => {
    const { a, b } = await pair();
    a.state.meta.money = 250;
    await a.sync.push();
    b.state.meta.money = 5;
    b.sync.markDirty();
    expect(await b.sync.pull()).toContain('anderen Gerät');
    expect(b.state.meta.money).toBe(5);
    expect(b.sync.state()).toBe('conflict');
  });

  it('ohne Netz bleibt die Änderung als „offen“ erhalten und wird später gesichert', async () => {
    const { a } = await pair();
    a.state.meta.money = 999;
    a.sync.markDirty();
    offline = true;
    expect(await a.sync.push()).toContain('Keine Verbindung');
    expect(a.sync.state()).toBe('dirty');
    expect(await a.sync.pull()).toBeNull(); // kein Absturz, kein Datenverlust
    offline = false;
    expect(await a.sync.pull()).toBeNull(); // gleiche Version + dirty -> push
    expect(a.sync.state()).toBe('synced');
  });

  it('abgelaufene Sitzung: Status „abgelaufen“, nichts wird überschrieben', async () => {
    const { a } = await pair();
    clock += 31 * 86_400_000;
    a.state.meta.money = 1;
    a.sync.markDirty();
    expect(await a.sync.push()).toContain('nicht mehr angemeldet');
    expect(a.sync.state()).toBe('expired');
    expect(await a.sync.pull()).toBeNull();
  });

  it('Abmelden entfernt die Verbindung lokal und beendet die Sitzung auf dem Server', async () => {
    const { a } = await pair();
    const token = a.sync.link?.token ?? '';
    await a.sync.signOut();
    expect(a.sync.state()).toBe('off');
    expect(a.store.data.has(CLOUD_KEY)).toBe(false);
    const api = createApi('https://api.test', async (u, i) => handle(new Request(u, i), env, clock));
    expect((await api.me(token)).ok).toBe(false);
  });

  it('ein anderes lokales Konto ohne Verbindung ist „offline“ und wird nicht synchronisiert', async () => {
    const { a } = await pair();
    a.state.account = 'a-zweites-konto';
    expect(a.sync.state()).toBe('off');
    a.sync.markDirty();
    expect(a.sync.link).toBeNull();
    expect(await a.sync.push()).toBe('Kein Online-Konto verbunden.');
    expect(await a.sync.pull()).toBeNull();
    expect(await a.sync.send({ to: 'Berta', kind: 'coins', amount: 1 })).toEqual({ error: 'Verbinde zuerst ein Online-Konto.' });
    a.state.account = 'main'; // zurück: die Verbindung ist noch da
    expect(a.sync.state()).toBe('synced');
  });
});

describe('Cloud-Sync: altes lokales Konto online machen', () => {
  it('jedes lokale Konto kann ein eigenes Online-Konto bekommen; Stände bleiben getrennt', async () => {
    const d = device('main');
    d.state.meta.money = 111;
    await connect(d, 'Anna');
    await d.sync.push();

    // zweites, altes lokales Konto mit eigenem Stand: aktivieren und online machen
    d.state.account = 'altes-konto';
    d.state.meta = { ...defaultMeta(), money: 999_999, runs: 60, bestDepth: 8_124_634 };
    const r = await connect(d, 'Berta');
    expect(r.ok && r.plan).toBe('upload'); // neues Online-Konto -> der alte Gerätestand wird hochgeladen
    expect(await d.sync.push()).toBeNull();
    expect(d.sync.linkedNames()).toEqual({ main: 'Anna', 'altes-konto': 'Berta' });

    // Online-Stände liegen getrennt beim richtigen Konto
    const api = createApi('https://api.test', async (u, i) => handle(new Request(u, i), env, clock));
    const annaToken = d.sync.link?.token; // gehört gerade zu „altes-konto“ = Berta
    const bertaSave = (await api.getSave(annaToken ?? '')) as { ok: true; data: { save: { money: number } } };
    expect(bertaSave.data.save.money).toBe(999_999);
    d.state.account = 'main';
    expect(d.sync.state()).toBe('synced');
    expect(d.sync.link?.name).toBe('Anna');
    const annaSave = (await api.getSave(d.sync.link?.token ?? '')) as { ok: true; data: { save: { money: number } } };
    expect(annaSave.data.save.money).toBe(111);
  });

  it('ein Online-Konto lässt sich nicht mit zwei lokalen Konten verbinden', async () => {
    const d = device('main');
    await connect(d, 'Anna');
    d.state.account = 'zweites';
    const r = await d.sync.signIn('login', 'anna', 'geheim1234');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('schon mit einem anderen Konto');
    expect(d.sync.state()).toBe('off');
  });

  it('Altes lokales Konto mit Fortschritt, bestehendes Online-Konto: der Nutzer muss wählen', async () => {
    const a = device('main');
    a.state.meta.money = 500;
    await connect(a, 'Anna');
    await a.sync.push();
    const b = device('altes-konto');
    b.state.meta = { ...defaultMeta(), money: 9, runs: 2 };
    const r = await b.sync.signIn('login', 'Anna', 'geheim1234');
    expect(r.ok && r.plan).toBe('ask');
    expect(b.state.meta.money).toBe(9); // nichts überschrieben
  });

  it('Stand wartet pro Konto: ein Wechsel verwechselt die Auswahl nicht', async () => {
    const a = device('main');
    a.state.meta.money = 500;
    await connect(a, 'Anna');
    await a.sync.push();
    const b = device('altes-konto');
    b.state.meta = { ...defaultMeta(), money: 9, runs: 2 };
    await b.sync.signIn('login', 'Anna', 'geheim1234');
    expect(b.sync.pending?.meta.money).toBe(500);
    b.state.account = 'anderes-konto';
    expect(b.sync.pending).toBeNull(); // gehört zu „altes-konto“
    b.state.account = 'altes-konto';
    expect(b.sync.pending?.meta.money).toBe(500);
  });

  it('Verbindung lösen beim Löschen eines Kontos: lokal weg, Online-Konto bleibt bestehen', async () => {
    const d = device('main');
    d.state.meta.money = 42;
    await connect(d, 'Anna');
    await d.sync.push();
    d.sync.forget('main');
    expect(d.sync.state()).toBe('off');
    expect(d.sync.linkedNames()).toEqual({});
    expect(d.store.data.has(CLOUD_KEY)).toBe(false);
    // das Online-Konto lebt weiter und lässt sich erneut verbinden
    const again = await d.sync.signIn('login', 'Anna', 'geheim1234');
    expect(again.ok).toBe(true);
  });

  it('übernimmt eine alte Einzelverbindung (Format vor den Mehrfach-Konten)', async () => {
    const d = device('main');
    await connect(d, 'Anna');
    const link = d.sync.link;
    expect(link).not.toBeNull();
    // altes Format: Verbindung direkt als Objekt gespeichert
    d.store.data.set(CLOUD_KEY, JSON.stringify(link));
    const migrated = loadLinks(d.store);
    expect(Object.keys(migrated)).toEqual(['main']);
    expect(migrated.main?.name).toBe('Anna');
    const d2 = device('main');
    d2.store.data.set(CLOUD_KEY, JSON.stringify(link));
    const sync2 = new CloudSync({ api: createApi('https://api.test', async (u, i) => handle(new Request(u, i), env, clock)), store: d2.store, getMeta: () => d2.state.meta, applyMeta: () => undefined, accountId: () => 'main' });
    expect(sync2.state()).toBe('synced');
  });
});

describe('Cloud-Sync: Geschenke an Spieler', () => {
  async function two() {
    const anna = device();
    anna.state.meta.money = 1000;
    anna.state.meta.skins = ['rot'];
    await connect(anna, 'Anna');
    await anna.sync.push();
    const berta = device();
    await connect(berta, 'Berta');
    return { anna, berta };
  }

  it('verschickt Münzen: Absender wird belastet, Empfänger nimmt im Posteingang an', async () => {
    const { anna, berta } = await two();
    const r = await anna.sync.send({ to: 'berta', kind: 'coins', amount: 400, note: 'Viel Spaß' });
    expect(r).toEqual({ message: 'Geschenk an Berta geschickt.' });
    expect(anna.state.meta.money).toBe(600);
    expect(anna.sync.state()).toBe('synced');

    const box = await berta.sync.inbox();
    expect('gifts' in box && box.gifts).toHaveLength(1);
    const gift = 'gifts' in box ? box.gifts[0] : undefined;
    expect(gift).toMatchObject({ kind: 'coins', amount: 400, from: 'Anna', note: 'Viel Spaß' });
    expect(await berta.sync.claim(gift?.id ?? '')).toEqual({ message: 'Geschenk angenommen.' });
    expect(berta.state.meta.money).toBe(400);
    expect(berta.sync.state()).toBe('synced');
    expect(await berta.sync.claim(gift?.id ?? '')).toEqual({ error: 'Dieses Geschenk gibt es nicht mehr.' });
  });

  it('sichert vor dem Verschenken zuerst die neuesten Änderungen', async () => {
    const { anna } = await two();
    anna.state.meta.money = 2000; // lokal mehr verdient, noch nicht online
    anna.sync.markDirty();
    const r = await anna.sync.send({ to: 'Berta', kind: 'coins', amount: 1500 }); // ginge nur mit dem neuen Stand
    expect(r).toEqual({ message: 'Geschenk an Berta geschickt.' });
    expect(anna.state.meta.money).toBe(500);
  });

  it('verschickt Skins und zeigt Fehler verständlich', async () => {
    const { anna } = await two();
    expect(await anna.sync.send({ to: 'Berta', kind: 'skin', skin: 'rot' })).toEqual({ message: 'Geschenk an Berta geschickt.' });
    expect(anna.state.meta.skins).toEqual([]);
    expect(await anna.sync.send({ to: 'Berta', kind: 'skin', skin: 'gold' })).toEqual({ error: 'Diesen Skin besitzt du nicht.' });
    expect(await anna.sync.send({ to: 'Niemand', kind: 'coins', amount: 1 })).toEqual({ error: 'Diesen Spieler gibt es nicht.' });
    expect(await anna.sync.send({ to: 'Anna', kind: 'coins', amount: 1 })).toEqual({ error: 'Du kannst dir nichts selbst schenken.' });
    expect(await anna.sync.send({ to: 'Berta', kind: 'coins', amount: 99999 })).toEqual({ error: 'So viele Münzen hast du nicht.' });
    expect(anna.state.meta.money).toBe(1000); // Fehler ändern nichts
  });

  it('bei offenem Konflikt wird nicht verschenkt', async () => {
    const { anna } = await two();
    if (anna.sync.link) anna.sync.link.conflict = true;
    expect(await anna.sync.send({ to: 'Berta', kind: 'coins', amount: 1 })).toEqual({ error: describeApiError(409, 'conflict') });
    expect(await anna.sync.claim('0000000000000000')).toEqual({ error: describeApiError(409, 'conflict') });
  });

  it('Münzen bleiben insgesamt erhalten (Anna + Berta)', async () => {
    const { anna, berta } = await two();
    await anna.sync.send({ to: 'Berta', kind: 'coins', amount: 123 });
    await anna.sync.send({ to: 'Berta', kind: 'coins', amount: 77 });
    const box = await berta.sync.inbox();
    for (const g of 'gifts' in box ? box.gifts : []) await berta.sync.claim(g.id);
    expect(anna.state.meta.money + berta.state.meta.money).toBe(1000);
  });
});

describe('API-Fehlertexte', () => {
  it('kennt alle Fehlercodes des Servers auf Deutsch', () => {
    for (const code of ['network', 'invalid_name', 'invalid_password', 'name_taken', 'invalid_credentials', 'locked', 'unauthorized', 'unknown_recipient', 'self', 'not_enough_money', 'skin_not_owned', 'skin_already_owned', 'no_cloud_save', 'rate_limited', 'inbox_full', 'conflict', 'gift_not_found', 'invalid_gift']) {
      expect(describeApiError(400, code), code).not.toMatch(/^Fehler:/);
    }
    expect(describeApiError(500, 'internal')).toContain('Server');
    expect(describeApiError(429, 'locked', { retryAfter: 42 })).toContain('42');
  });
});
