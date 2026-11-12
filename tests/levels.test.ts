import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { createGame } from '../src/game/state';
import { buyUpgrade, computeMods, emptyUpgrades, MAX_LIGHT_BONUS, MAX_MOVE_SPEED, MAX_TNT_RADIUS, upgradeCost } from '../src/meta/shop';
import { defaultMeta, parseMeta } from '../src/meta/save';

const max = (id: string): number => UPGRADES.find((u) => u.id === id)?.maxLevel ?? 0;

describe('Mehr Stufen', () => {
  it('die Upgrades haben deutlich mehr Stufen', () => {
    expect(max('lamp')).toBe(25_000);
    expect(max('tnt')).toBe(30_000);
    expect(max('ore')).toBe(30_000);
    expect(max('master')).toBe(14_000);
    expect(max('armor')).toBe(40);
    expect(max('boots')).toBe(40);
    expect(max('revive')).toBe(25);
    // ohne die Spitzhacke (1 Mio.) waren es vorher rund 33 000 Stufen, jetzt über 180 000
    expect(UPGRADES.filter((u) => u.id !== 'pick').reduce((a, u) => a + u.maxLevel, 0)).toBeGreaterThan(180_000);
  });

  it('Höchststufen von Lederwams, Federstiefeln und Zweitem Leben wirken', () => {
    const m = computeMods({ ...emptyUpgrades(), armor: 40, boots: 40, revive: 25 });
    expect(m.maxHp).toBe(43);
    expect(m.fallReduction).toBe(40);
    expect(m.revives).toBe(25);
    const s = createGame({ seed: 'viel', mods: m });
    expect(s.player.hp).toBe(43);
    expect(s.revives).toBe(25);
  });

  it('Obergrenzen verhindern sinnlose Extremwerte', () => {
    const m = computeMods({ ...emptyUpgrades(), power: max('power'), light: max('light'), legs: max('legs') });
    expect(m.tntRadius).toBe(MAX_TNT_RADIUS);
    expect(m.lightBonus).toBe(MAX_LIGHT_BONUS);
    expect(m.moveSpeed).toBe(MAX_MOVE_SPEED);
    // die Höchststufe ist genau die, ab der die Grenze erreicht wird (keine wirkungslosen Stufen)
    const before = computeMods({ ...emptyUpgrades(), power: max('power') - 1 });
    expect(before.tntRadius).toBeLessThan(MAX_TNT_RADIUS);
  });

  it('Preise bleiben auch auf den letzten Stufen bezahlbar und steigen insgesamt', () => {
    for (const u of UPGRADES) {
      const last = upgradeCost(u.id, u.maxLevel - 1);
      expect(last, u.id).toBeGreaterThan(upgradeCost(u.id, 0));
      expect(last, u.id).toBeLessThanOrEqual(600_000);
    }
  });

  it('man kann Lederwams und Federstiefel bis zur neuen Höchststufe kaufen, dann ist Schluss', () => {
    const m = defaultMeta();
    m.money = 1e9;
    for (let i = 0; i < 40; i++) expect(buyUpgrade(m, 'armor').ok).toBe(true);
    expect(buyUpgrade(m, 'armor')).toEqual({ ok: false, reason: 'max' });
    expect(m.upgrades.armor).toBe(40);
  });

  it('alte Spielstände bleiben gültig, zu hohe Stufen werden begrenzt', () => {
    const m = parseMeta({ upgrades: { armor: 10, lamp: 2500, boots: 999, revive: 5 } });
    expect(m.upgrades.armor).toBe(10);
    expect(m.upgrades.lamp).toBe(2500);
    expect(m.upgrades.boots).toBe(40);
    expect(m.upgrades.revive).toBe(5);
  });
});
