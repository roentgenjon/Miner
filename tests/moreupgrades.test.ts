import { describe, expect, it } from 'vitest';
import { PLAYER, STEP, TNT, UPGRADES, UPGRADE_PRICE_MULT } from '../src/config';
import { step } from '../src/game/game';
import { collectOre } from '../src/game/loot';
import { damagePlayer } from '../src/game/state';
import { placeTnt } from '../src/game/tnt';
import { Block } from '../src/game/types';
import { defaultMeta } from '../src/meta/save';
import { buyUpgrade, computeMods, describeLevel, emptyUpgrades, upgradeCost } from '../src/meta/shop';
import { blankGame, cell, put } from './helpers';

function withMods(s: ReturnType<typeof blankGame>, levels: Partial<ReturnType<typeof emptyUpgrades>>): void {
  s.mods = computeMods({ ...emptyUpgrades(), ...levels });
  s.player.hp = s.player.maxHp = s.mods.maxHp;
  s.player.tnt = s.mods.startTnt;
}

function run(s: ReturnType<typeof blankGame>, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) step(s, STEP);
}

describe('Preise', () => {
  it('Upgrades kosten nur noch einen Bruchteil (Faktor in der Konfiguration)', () => {
    expect(UPGRADE_PRICE_MULT).toBe(0.1);
    expect(upgradeCost('pick', 0)).toBe(4); // früher 40
    expect(upgradeCost('lamp', 0)).toBe(4); // früher 35
    expect(upgradeCost('revive', 0)).toBe(80); // früher 800
    for (const u of UPGRADES) expect(upgradeCost(u.id, 0), u.id).toBeGreaterThanOrEqual(1);
  });

  it('man kommt mit wenig Münzen schon weit', () => {
    const m = defaultMeta();
    m.money = 100;
    let bought = 0;
    while (buyUpgrade(m, 'pick').ok) bought++;
    expect(bought).toBeGreaterThan(15); // früher: nur 3 Stufen für 100 Münzen
  });
});

describe('Neue Upgrades', () => {
  it('es gibt jetzt 28 Upgrades; jedes wirkt schon auf Stufe 1', () => {
    expect(UPGRADES.length).toBe(28);
    const base = JSON.stringify(computeMods(emptyUpgrades()));
    for (const id of ['regen', 'vein', 'crit', 'fuse', 'shield', 'bounty', 'tntregen', 'dodge'] as const) {
      expect(UPGRADES.some((u) => u.id === id), id).toBe(true);
      expect(JSON.stringify(computeMods({ ...emptyUpgrades(), [id]: 1 })), id).not.toBe(base);
      expect(describeLevel(id, 1).length).toBeGreaterThan(0);
    }
  });

  it('Selbstheilung: ein Leben nach der eingestellten Zeit, nie über das Maximum', () => {
    const s = blankGame();
    withMods(s, { regen: 100 }); // 90 − 70 = 20 s
    expect(s.mods.regenSeconds).toBeCloseTo(20);
    s.player.hp = 1;
    run(s, 19);
    expect(s.player.hp).toBe(1);
    run(s, 2);
    expect(s.player.hp).toBe(2);
    run(s, 60);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(computeMods(emptyUpgrades()).regenSeconds).toBe(0); // ohne Upgrade keine Heilung
    const none = blankGame();
    none.player.hp = 1;
    run(none, 200);
    expect(none.player.hp).toBe(1);
  });

  it('Dynamit-Nachschub: wächst bis zum Startvorrat nach, nicht darüber', () => {
    const s = blankGame();
    withMods(s, { tntregen: 100 }); // 60 − 45 = 15 s
    s.player.tnt = 10;
    run(s, 16);
    expect(s.player.tnt).toBe(11);
    s.player.tnt = s.mods.startTnt;
    run(s, 40);
    expect(s.player.tnt).toBe(s.mods.startTnt);
  });

  it('Kurze Lunte: Dynamit zündet früher (nicht unter 0,4 s)', () => {
    const s = blankGame();
    withMods(s, { fuse: 60 });
    placeTnt(s);
    expect(s.tnts[0]?.fuse).toBeCloseTo(TNT.fuse - 60 * 0.013);
    expect(computeMods({ ...emptyUpgrades(), fuse: 120 }).tntFuse).toBeGreaterThanOrEqual(0.4);
    expect(computeMods(emptyUpgrades()).tntFuse).toBe(TNT.fuse);
  });

  it('Schreckstarre: nach einem Treffer länger unverwundbar', () => {
    const s = blankGame();
    withMods(s, { shield: 60 });
    damagePlayer(s, 1, 'test');
    expect(s.player.invuln).toBeCloseTo(PLAYER.invuln + 60 * 0.0166);
    const plain = blankGame();
    damagePlayer(plain, 1, 'test');
    expect(plain.player.invuln).toBe(PLAYER.invuln);
  });

  it('Glückstreffer: Doppelfund mit der eingestellten Chance, sonst unverändert', () => {
    const value = (levels: Partial<ReturnType<typeof emptyUpgrades>>): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        const s = blankGame(Block.Dirt, `crit-${i}`);
        withMods(s, levels);
        s.stats.money = 0;
        collectOre(s, Block.Copper, 3, 5);
        out.push(s.stats.money);
      }
      return out;
    };
    expect(new Set(value({})).size).toBe(1); // ohne Upgrade immer gleich
    const hi = value({ crit: 250 }); // 45 %
    const doubles = hi.filter((v) => v === 120).length;
    expect(doubles / hi.length).toBeGreaterThan(0.33);
    expect(doubles / hi.length).toBeLessThan(0.57);
    expect(new Set(hi)).toEqual(new Set([60, 120]));
    expect(computeMods({ ...emptyUpgrades(), crit: 500 }).critChance).toBeLessThanOrEqual(0.9);
  });

  it('Aderngespür: nimmt beim Erzabbau ein Nachbar-Erz mit', () => {
    const s = blankGame();
    withMods(s, { vein: 450 }); // 90 %
    put(s, 3, 1, Block.Copper);
    put(s, 4, 1, Block.Gold); // Nachbar rechts
    s.input.held = 'down';
    // Wiederholen, bis der Würfel „ja“ sagt (Chance 90 %)
    run(s, 1);
    if (cell(s, 4, 1) !== Block.Air) {
      // Pech beim Würfeln: mit gleicher Welt, anderem Seed erneut
      for (let i = 0; i < 20 && cell(s, 4, 1) !== Block.Air; i++) {
        const t = blankGame(Block.Dirt, `vein-${i}`);
        withMods(t, { vein: 450 });
        put(t, 3, 1, Block.Copper);
        put(t, 4, 1, Block.Gold);
        t.input.held = 'down';
        run(t, 1);
        if (cell(t, 4, 1) === Block.Air) {
          expect(t.stats.ores).toBe(2);
          return;
        }
      }
    }
    expect(cell(s, 4, 1)).toBe(Block.Air);
    expect(s.stats.ores).toBe(2);
  });

  it('Aderngespür ohne Upgrade lässt Nachbarn stehen', () => {
    const s = blankGame();
    put(s, 3, 1, Block.Copper);
    put(s, 4, 1, Block.Gold);
    s.input.held = 'down';
    run(s, 1);
    expect(cell(s, 4, 1)).toBe(Block.Gold);
    expect(s.stats.ores).toBe(1);
  });

  it('Kopfgeld: Münzen für jede erledigte Fledermaus (auch durch Dynamit), sonst nichts', () => {
    const s = blankGame();
    withMods(s, { bounty: 50 }); // 200 Münzen
    s.bats.push({ id: 1, x: 4, y: 20, hp: 1, t: 1, cd: 0, awake: false });
    s.stats.money = 0;
    // Spieler schlägt zu: Bat neben ihm
    s.player.y = 20;
    put(s, 3, 20, Block.Air);
    put(s, 4, 20, Block.Air);
    s.input.held = 'right';
    run(s, 0.5);
    expect(s.stats.bats).toBe(1);
    expect(s.stats.money).toBe(200);

    const plain = blankGame();
    plain.bats.push({ id: 1, x: 4, y: 20, hp: 1, t: 1, cd: 0, awake: false });
    plain.player.y = 20;
    put(plain, 3, 20, Block.Air);
    put(plain, 4, 20, Block.Air);
    plain.input.held = 'right';
    run(plain, 0.5);
    expect(plain.stats.bats).toBe(1);
    expect(plain.stats.money).toBe(0);
  });

  it('Wendigkeit: weicht Bissen mit der eingestellten Chance aus', () => {
    const bites = (dodge: number): number => {
      let hurt = 0;
      for (let i = 0; i < 200; i++) {
        const s = blankGame(Block.Dirt, `dodge-${i}`);
        withMods(s, { dodge });
        s.player.hp = s.player.maxHp = 99;
        s.player.y = 30;
        put(s, 3, 30, Block.Air);
        put(s, 4, 30, Block.Air);
        s.bats.push({ id: 1, x: 4, y: 30, hp: 1, t: 99, cd: 0, awake: true });
        run(s, 0.1);
        if (s.player.hp < 99) hurt++;
      }
      return hurt;
    };
    expect(bites(0)).toBe(200);
    const half = bites(250); // 50 %
    expect(half).toBeGreaterThan(70);
    expect(half).toBeLessThan(130);
  });
});
