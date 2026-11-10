import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { defaultMeta } from '../src/meta/save';
import { buyUpgrade, computeMods, upgradeCost } from '../src/meta/shop';

describe('Werkstatt', () => {
  it('hat mindestens 20 Upgrades mit eindeutiger ID', () => {
    expect(UPGRADES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });

  it('Preise steigen mit der Stufe', () => {
    for (const u of UPGRADES) {
      expect(upgradeCost(u.id, 1)).toBeGreaterThan(upgradeCost(u.id, 0));
    }
  });

  it('kauft Upgrade, zieht Geld ab, erhöht Stufe', () => {
    const m = defaultMeta();
    m.money = 100;
    const cost = upgradeCost('pick', 0);
    const r = buyUpgrade(m, 'pick');
    expect(r).toEqual({ ok: true, cost });
    expect(m.money).toBe(100 - cost);
    expect(m.upgrades.pick).toBe(1);
  });

  it('verweigert Kauf bei zu wenig Geld', () => {
    const m = defaultMeta();
    m.money = 1;
    expect(buyUpgrade(m, 'lamp')).toEqual({ ok: false, reason: 'money' });
    expect(m.money).toBe(1);
    expect(m.upgrades.lamp).toBe(0);
  });

  it('verweigert Kauf bei Maximalstufe', () => {
    const m = defaultMeta();
    m.money = 1e9;
    m.upgrades.boots = 3;
    expect(buyUpgrade(m, 'boots')).toEqual({ ok: false, reason: 'max' });
    expect(m.money).toBe(1e9);
  });

  it('Start-Dynamit = 40 + 3 pro Stufe', () => {
    const m = defaultMeta();
    expect(computeMods(m.upgrades).startTnt).toBe(40);
    m.upgrades.tnt = 5;
    expect(computeMods(m.upgrades).startTnt).toBe(55);
    m.upgrades.tnt = 10;
    expect(computeMods(m.upgrades).startTnt).toBe(70);
  });

  it('Upgrades wirken auf die Spielwerte', () => {
    const m = defaultMeta();
    m.upgrades.pick = 5;
    m.upgrades.armor = 2;
    m.upgrades.lamp = 4;
    const mods = computeMods(m.upgrades);
    expect(mods.digSpeed).toBeCloseTo(1.6);
    expect(mods.maxHp).toBe(5);
    expect(mods.maxEnergy).toBe(160);
  });
});
