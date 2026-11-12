import { describe, expect, it } from 'vitest';
import { HEART_DEPTH, SAVE_KEY, UPGRADES } from '../src/config';
import { evaluateAchievements, ACHIEVEMENTS } from '../src/meta/achievements';
import { applyRunResult } from '../src/meta/progress';
import { defaultMeta, loadMeta, parseMeta, saveMeta, type KeyValueStore } from '../src/meta/save';
import { emptyStats } from '../src/game/state';
import { blankGame } from './helpers';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('Speicherstand', () => {
  it('speichert unter "schacht-meta" und lädt wieder', () => {
    const store = memStore();
    const m = defaultMeta();
    m.money = 123;
    m.upgrades.lamp = 4;
    m.bestDepth = 77;
    expect(saveMeta(m, store)).toBe(true);
    expect(store.data.has(SAVE_KEY)).toBe(true);
    expect(SAVE_KEY).toBe('schacht-meta');
    const loaded = loadMeta(store);
    expect(loaded).toEqual(m);
  });

  it('übersteht kaputte Daten', () => {
    const store = memStore();
    store.data.set(SAVE_KEY, '{kaputt');
    expect(loadMeta(store)).toEqual(defaultMeta());
    expect(parseMeta({ money: -5, upgrades: { pick: 1e30 }, bestDepth: 'x' }).upgrades.pick).toBe(UPGRADES.find((u) => u.id === 'pick')?.maxLevel);
    expect(parseMeta(null)).toEqual(defaultMeta());
  });
});

describe('Rundenergebnis & Erfolge', () => {
  it('bucht Münzen, Rekord und Statistik', () => {
    const m = defaultMeta();
    const s = blankGame();
    s.wallet = 200;
    s.stats.depth = Math.round(HEART_DEPTH * 0.01) + 5;
    s.stats.ores = 10;
    s.status = 'ended';
    const r = applyRunResult(m, s);
    expect(r.banked).toBe(200);
    expect(r.newBest).toBe(true);
    expect(m.money).toBe(200);
    expect(m.bestDepth).toBe(Math.round(HEART_DEPTH * 0.01) + 5);
    expect(m.totals.ores).toBe(10);
    expect(r.achievements.map((a) => a.id)).toContain('schiefer');
  });

  it('behält bei Tod nur einen Teil', () => {
    const m = defaultMeta();
    const s = blankGame();
    s.wallet = 100;
    s.status = 'dead';
    expect(applyRunResult(m, s).banked).toBe(70);
  });

  it('führt den Tagesrekord pro Datum', () => {
    const m = defaultMeta();
    const s = blankGame();
    s.daily = true;
    s.stats.depth = 30;
    s.status = 'ended';
    applyRunResult(m, s, '2026-11-10');
    s.stats.depth = 20;
    applyRunResult(m, s, '2026-11-10');
    expect(m.daily).toEqual({ date: '2026-11-10', best: 30, runs: 2 });
    applyRunResult(m, s, '2026-11-11');
    expect(m.daily).toEqual({ date: '2026-11-11', best: 20, runs: 1 });
  });

  it('hat 9 Erfolge, die einmalig freigeschaltet werden', () => {
    expect(ACHIEVEMENTS).toHaveLength(9);
    const m = defaultMeta();
    const stats = { ...emptyStats(), depth: Math.round(HEART_DEPTH * 0.02) + 10, comboMax: 6 };
    const first = evaluateAchievements(m, stats).map((a) => a.id);
    expect(first).toEqual(expect.arrayContaining(['schiefer', 'magma', 'kombo']));
    expect(evaluateAchievements(m, stats)).toHaveLength(0);
  });
});
