import { describe, expect, it } from 'vitest';
import { LEVEL_SCALE, MAX_LEVEL_CAP, UPGRADES } from '../src/config';
import { defaultMeta } from '../src/meta/save';
import { buyUpgrade, buyUpgradeMany, computeMods, costOfNext, upgradeCost } from '../src/meta/shop';

describe('Werkstatt', () => {
  it('hat mindestens 20 Upgrades mit eindeutiger ID', () => {
    expect(UPGRADES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
  });

  it('Preise steigen mit der Stufe (insgesamt)', () => {
    for (const u of UPGRADES) {
      const later = Math.min(u.maxLevel - 1, 25);
      expect(upgradeCost(u.id, later), u.id).toBeGreaterThan(upgradeCost(u.id, 0));
      expect(upgradeCost(u.id, 1), u.id).toBeGreaterThanOrEqual(upgradeCost(u.id, 0));
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
    m.upgrades.boots = UPGRADES.find((u) => u.id === 'boots')?.maxLevel ?? 0;
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
    expect(mods.digSpeed).toBeCloseTo(4);
    expect(mods.maxHp).toBe(5);
    expect(mods.maxEnergy).toBeCloseTo(103);
  });
});

describe('Stufenverlauf', () => {
  it('Preise fallen nie, steigen insgesamt und bleiben bezahlbar', () => {
    for (const u of UPGRADES) {
      let prev = 0;
      const first = upgradeCost(u.id, 0);
      // Stichprobe: dichter am Anfang, dann in großen Schritten bis zur Höchststufe
      const lv = new Set<number>([u.maxLevel - 1]);
      for (let l = 0; l < Math.min(u.maxLevel, 3000); l++) lv.add(l);
      for (let l = 3000; l < u.maxLevel; l += Math.ceil(u.maxLevel / 4000)) lv.add(l);
      for (const lvl of [...lv].sort((a, b) => a - b)) {
        const c = upgradeCost(u.id, lvl);
        expect(c, `${u.id} Stufe ${lvl}`).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
      expect(prev, `${u.id} letzte Stufe`).toBeGreaterThan(first);
      expect(prev, `${u.id} letzte Stufe`).toBeLessThanOrEqual(600_000 * LEVEL_SCALE);
    }
  });

  it('hat deutlich mehr Stufen als zuvor', () => {
    const total = UPGRADES.reduce((a, u) => a + u.maxLevel, 0);
    expect(total).toBeGreaterThan(250);
  });

  it('Höchststufen ergeben gültige Spielwerte', () => {
    const u = defaultMeta().upgrades;
    for (const d of UPGRADES) u[d.id] = d.maxLevel;
    const m = computeMods(u);
    expect(m.startTnt).toBe(40 + 3 * 30_000 * LEVEL_SCALE);
    expect(m.drainMult).toBeGreaterThanOrEqual(0.2);
    expect(m.digCostMult).toBeGreaterThanOrEqual(0.1);
    expect(m.blastLoot).toBeLessThanOrEqual(1);
    expect(m.startDepth).toBe(8_000_000 * LEVEL_SCALE);
    expect(m.moveSpeed).toBe(20); // Obergrenze
  });
});

describe('Spitzhacke', () => {
  it('hat 9 Billiarden Stufen; das Tempo steigt stetig, nach Stufe 10000 nur noch langsamer', () => {
    const def = UPGRADES.find((u) => u.id === 'pick');
    expect(def?.maxLevel).toBe(MAX_LEVEL_CAP);
    const speed = (l: number): number => computeMods({ ...defaultMeta().upgrades, pick: l }).digSpeed;
    const levels = [0, 1, 10, 1000, 10_000, 10_001, 100_000, 1_000_000, 10_000_000, 100_000_000_000, MAX_LEVEL_CAP];
    for (let i = 1; i < levels.length; i++) expect(speed(levels[i] as number)).toBeGreaterThan(speed(levels[i - 1] as number));
    expect(speed(10)).toBeCloseTo(7);
    expect(speed(10_000)).toBeCloseTo(6001);
    expect(speed(MAX_LEVEL_CAP) / (0.01 * MAX_LEVEL_CAP)).toBeCloseTo(1, 3);
  });

  it('Preise bleiben auch bei Stufe 100 Milliarden im sechsstelligen Bereich', () => {
    expect(upgradeCost('pick', 99)).toBeLessThan(4000);
    expect(upgradeCost('pick', MAX_LEVEL_CAP - 1)).toBeLessThanOrEqual(6e15);
    expect(upgradeCost('pick', 100)).toBeGreaterThanOrEqual(upgradeCost('pick', 99));
  });
});

describe('Sammelkauf', () => {
  it('kauft mehrere Stufen am Stück und zieht die Summe ab', () => {
    const m = defaultMeta();
    m.money = 1_000_000;
    const expected = costOfNext('pick', 0, 100);
    const r = buyUpgradeMany(m, 'pick', 100);
    expect(r).toEqual({ bought: 100, spent: expected.cost, stoppedBy: null });
    expect(m.upgrades.pick).toBe(100);
    expect(m.money).toBe(1_000_000 - expected.cost);
  });

  it('Max kauft so viele, wie das Geld erlaubt', () => {
    const m = defaultMeta();
    m.money = 500;
    const r = buyUpgradeMany(m, 'pick', Infinity);
    expect(r.stoppedBy).toBe('money');
    expect(r.bought).toBeGreaterThan(5);
    expect(m.money).toBeGreaterThanOrEqual(0);
    expect(m.money + r.spent).toBe(500);
    expect(m.upgrades.pick).toBe(r.bought);
  });

  it('hält an der Maximalstufe an', () => {
    const m = defaultMeta();
    m.money = 1e12;
    m.upgrades.helmet = 2 * LEVEL_SCALE - 1;
    const r = buyUpgradeMany(m, 'helmet', 10);
    expect(r.bought).toBe(1);
    expect(r.stoppedBy).toBe('max');
  });
});

describe('Sammelkauf bei sehr vielen Stufen', () => {
  it('Max kauft sofort Milliarden Stufen und gibt nie mehr aus als vorhanden', () => {
    const m = defaultMeta();
    m.money = 1e20;
    const t0 = Date.now();
    const r = buyUpgradeMany(m, 'pick', Infinity);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.stoppedBy).toBe('money');
    expect(r.bought).toBeGreaterThan(1_000_000_000);
    expect(m.money).toBeGreaterThanOrEqual(0);
    expect(m.money + r.spent).toBe(1e20);
    // zweiter Klick kauft nichts mehr dazu (Rest reicht nicht für eine Stufe)
    expect(buyUpgradeMany(m, 'pick', Infinity).bought).toBeLessThanOrEqual(1);
  });

  it('Summenformel weicht von der Einzelrechnung kaum ab', () => {
    let exact = 0;
    for (let i = 0; i < 50_000; i++) exact += upgradeCost('lamp', 1000 + i);
    const { cost } = costOfNext('lamp', 1000, 50_000);
    expect(Math.abs(cost - exact) / exact).toBeLessThan(0.001);
  });
});

describe('Billiarden Stufen', () => {
  it('Max terminiert auch bei Billiarden Stufen und bleibt unter der Höchststufe', () => {
    for (const id of ['pick', 'lamp', 'armor'] as const) {
      const m = defaultMeta();
      m.money = 1e40;
      const r = buyUpgradeMany(m, id, Infinity);
      const top = UPGRADES.find((u) => u.id === id)?.maxLevel ?? 0;
      expect(m.upgrades[id], id).toBeLessThanOrEqual(top);
      expect(Number.isSafeInteger(m.upgrades[id]), id).toBe(true);
      expect(r.bought).toBe(m.upgrades[id]);
      expect(m.money).toBeGreaterThanOrEqual(0);
    }
    const m = defaultMeta();
    m.money = 1e12;
    expect(buyUpgradeMany(m, 'lamp', Infinity).stoppedBy).toBe('money');
  });
});
