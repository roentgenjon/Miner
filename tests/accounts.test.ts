import { describe, expect, it } from 'vitest';
import { ACCOUNTS, SAVE_KEY } from '../src/config';
import {
  ACCOUNTS_KEY,
  MAIN_ID,
  accountKey,
  activeAccount,
  createAccount,
  deleteAccount,
  exportAccount,
  importAccount,
  loadAccounts,
  parseImport,
  renameAccount,
  sanitizeName,
  saveAccounts,
  switchAccount,
} from '../src/meta/accounts';
import { defaultMeta, loadMeta, saveMeta, type KeyValueStore } from '../src/meta/save';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('Konten', () => {
  it('startet mit einem Konto „Spieler“, das den alten Spielstand-Schlüssel weiterverwendet', () => {
    const store = memStore();
    const old = defaultMeta();
    old.money = 321;
    saveMeta(old, store); // Spielstand aus der Zeit vor den Konten
    const idx = loadAccounts(store, 1000);
    expect(idx.accounts).toEqual([{ id: MAIN_ID, name: 'Spieler', created: 1000 }]);
    expect(idx.active).toBe(MAIN_ID);
    expect(accountKey(MAIN_ID)).toBe(SAVE_KEY);
    expect(loadMeta(store, accountKey(idx.active)).money).toBe(321);
  });

  it('legt Konten mit getrennten Spielständen an und wechselt zwischen ihnen', () => {
    const store = memStore();
    const idx = loadAccounts(store);
    const a = createAccount(idx, 'Anna', 1, 'a1');
    expect(a).toEqual({ ok: true, id: 'a1' });
    const main = defaultMeta();
    main.money = 100;
    saveMeta(main, store, accountKey(MAIN_ID));
    const anna = defaultMeta();
    anna.money = 999;
    saveMeta(anna, store, accountKey('a1'));
    expect(accountKey('a1')).toBe('schacht-meta:a1');

    expect(switchAccount(idx, 'a1')).toBe(true);
    expect(loadMeta(store, accountKey(idx.active)).money).toBe(999);
    expect(switchAccount(idx, MAIN_ID)).toBe(true);
    expect(loadMeta(store, accountKey(idx.active)).money).toBe(100);
    expect(switchAccount(idx, 'gibt-es-nicht')).toBe(false);
    expect(idx.active).toBe(MAIN_ID);
  });

  it('prüft Namen: leer, doppelt (ohne Groß/Klein), zu lang, Steuerzeichen und Limit', () => {
    const idx = loadAccounts(null);
    expect(createAccount(idx, '   ')).toEqual({ ok: false, reason: 'name' });
    expect(createAccount(idx, 'spieler')).toEqual({ ok: false, reason: 'duplicate' });
    expect(sanitizeName('  Max \n\t  Muster  ')).toBe('Max Muster');
    expect(sanitizeName('x'.repeat(40))).toHaveLength(ACCOUNTS.nameMax);
    expect(sanitizeName('\u0000\u0007')).toBeNull();
    for (let i = 0; idx.accounts.length < ACCOUNTS.max; i++) createAccount(idx, `Konto ${i}`);
    expect(createAccount(idx, 'Eins zu viel')).toEqual({ ok: false, reason: 'limit' });
  });

  it('benennt um (nicht auf einen vorhandenen Namen) und löscht samt Spielstand', () => {
    const store = memStore();
    const idx = loadAccounts(store);
    createAccount(idx, 'Anna', 1, 'a1');
    expect(renameAccount(idx, 'a1', 'Spieler')).toEqual({ ok: false, reason: 'duplicate' });
    expect(renameAccount(idx, 'a1', 'Anni')).toEqual({ ok: true });
    expect(idx.accounts.find((a) => a.id === 'a1')?.name).toBe('Anni');

    saveMeta(defaultMeta(), store, accountKey('a1'));
    expect(store.data.has('schacht-meta:a1')).toBe(true);
    switchAccount(idx, 'a1');
    expect(deleteAccount(idx, 'a1', store)).toBe(true);
    expect(store.data.has('schacht-meta:a1')).toBe(false);
    expect(idx.active).toBe(MAIN_ID); // aktives Konto gelöscht -> erstes übrige
    expect(idx.accounts).toHaveLength(1);
  });

  it('das letzte Konto lässt sich nicht löschen', () => {
    const idx = loadAccounts(memStore());
    expect(deleteAccount(idx, MAIN_ID, null)).toBe(false);
    expect(idx.accounts).toHaveLength(1);
  });

  it('speichert und lädt die Kontenliste; kaputte Daten fallen auf Standard zurück', () => {
    const store = memStore();
    const idx = loadAccounts(store);
    createAccount(idx, 'Anna', 5, 'a1');
    switchAccount(idx, 'a1');
    expect(saveAccounts(idx, store)).toBe(true);
    const again = loadAccounts(store);
    expect(again.active).toBe('a1');
    expect(activeAccount(again).name).toBe('Anna');

    store.data.set(ACCOUNTS_KEY, '{kaputt');
    expect(loadAccounts(store).accounts[0]?.id).toBe(MAIN_ID);
    store.data.set(ACCOUNTS_KEY, JSON.stringify({ accounts: [{ id: '../böse', name: 'x' }], active: 'x' }));
    expect(loadAccounts(store).accounts.map((a) => a.id)).toEqual([MAIN_ID]); // unzulässige Kennung wird verworfen
  });

  it('exportiert und importiert ein Konto (Namensgleichheit -> „(2)“)', () => {
    const store = memStore();
    const idx = loadAccounts(store);
    const meta = defaultMeta();
    meta.money = 4242;
    meta.upgrades.pick = 77;
    meta.bestDepth = 123;
    const text = exportAccount('Spieler', meta);
    const parsed = parseImport(text);
    expect(parsed.ok && parsed.meta.upgrades.pick).toBe(77);

    const r = importAccount(idx, store, saveMeta, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('Spieler (2)');
    const loaded = loadMeta(store, accountKey(r.id));
    expect(loaded.money).toBe(4242);
    expect(loaded.bestDepth).toBe(123);
    expect(idx.accounts).toHaveLength(2);
  });

  it('lehnt fremde oder kaputte Dateien beim Import ab', () => {
    const idx = loadAccounts(memStore());
    for (const bad of ['', 'kein json', '{}', JSON.stringify({ format: 'etwas-anderes', meta: {} }), JSON.stringify({ format: 'schacht-konto' }), '"x"']) {
      expect(importAccount(idx, null, saveMeta, bad)).toEqual({ ok: false, reason: 'format' });
    }
    expect(idx.accounts).toHaveLength(1);
  });

  it('übernimmt beim Import nur gültige Werte (Schutz vor manipulierten Dateien)', () => {
    const idx = loadAccounts(memStore());
    const evil = JSON.stringify({ format: 'schacht-konto', name: 'Böse', meta: { money: -5, upgrades: { pick: 1e30 }, skin: 'nicht-da', skins: ['regenbogen', 'x', 5], achievements: { herz: 1 } } });
    const store = memStore();
    const r = importAccount(idx, store, saveMeta, evil);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = loadMeta(store, accountKey(r.id));
    expect(m.money).toBe(0);
    expect(m.upgrades.pick).toBe(1_000_000);
    expect(m.skin).toBe('miner');
    expect(m.skins).toEqual(['regenbogen']); // bekannte Skins bleiben, Unbekanntes fliegt raus
  });
});
