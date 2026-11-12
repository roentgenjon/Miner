import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKINS } from '../src/config';
import { createGame } from '../src/game/state';
import { PLAYER } from '../src/render/sprites';
import { ACHIEVEMENTS } from '../src/meta/achievements';
import { defaultMeta, parseMeta } from '../src/meta/save';
import { buySkin, isSkinUnlocked, selectedSkin, selectSkin } from '../src/meta/skins';
import { computeMods, emptyUpgrades } from '../src/meta/shop';

describe('Skins', () => {
  it('hat 26 Skins mit eindeutiger Kennung; der Standard-Skin ist gratis', () => {
    expect(SKINS).toHaveLength(26);
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(26);
    expect(new Set(SKINS.map((s) => s.name)).size).toBe(26);
    for (const s of SKINS) {
      expect(s.id).toMatch(/^[a-z]{2,20}$/);
      expect(s.desc.length).toBeGreaterThan(5);
    }
    expect(SKINS.find((s) => s.id === DEFAULT_SKIN)?.cost).toBe(0);
    for (const s of SKINS) {
      // Paletten dürfen nur Farben der Spielfigur ersetzen, und es muss gültige Farben geben
      for (const [letter, color] of Object.entries(s.palette)) {
        expect(PLAYER.palette[letter], `${s.id}: ${letter}`).toBeDefined();
        expect(color, `${s.id}: ${letter}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('Standard-Skin ist frei, andere sind anfangs gesperrt', () => {
    const m = defaultMeta();
    expect(isSkinUnlocked(m, 'miner')).toBe(true);
    expect(isSkinUnlocked(m, 'rot')).toBe(false);
    expect(isSkinUnlocked(m, 'unbekannt')).toBe(false);
    expect(selectedSkin(m).id).toBe('miner');
  });

  it('kauft Skins mit Münzen, zieht ab und merkt sie sich', () => {
    const m = defaultMeta();
    m.money = 1000;
    expect(buySkin(m, 'rot')).toEqual({ ok: true, cost: 300 });
    expect(m.money).toBe(700);
    expect(m.skins).toEqual(['rot']);
    expect(isSkinUnlocked(m, 'rot')).toBe(true);
    expect(buySkin(m, 'rot')).toEqual({ ok: false, reason: 'owned' });
    expect(m.money).toBe(700);
  });

  it('verweigert Kauf bei zu wenig Geld', () => {
    const m = defaultMeta();
    m.money = 10;
    expect(buySkin(m, 'gold')).toEqual({ ok: false, reason: 'money' });
    expect(m.money).toBe(10);
    expect(m.skins).toEqual([]);
  });

  it('Erfolgs-Skin ist nicht kaufbar, schaltet sich aber durch den Erfolg frei', () => {
    const m = defaultMeta();
    m.money = 1e9;
    expect(buySkin(m, 'geist')).toEqual({ ok: false, reason: 'locked' });
    expect(isSkinUnlocked(m, 'geist')).toBe(false);
    m.achievements.herz = Date.now();
    expect(isSkinUnlocked(m, 'geist')).toBe(true);
    expect(selectSkin(m, 'geist')).toBe(true);
    expect(m.skin).toBe('geist');
  });

  it('wählt nur freigeschaltete Skins aus', () => {
    const m = defaultMeta();
    expect(selectSkin(m, 'violett')).toBe(false);
    expect(m.skin).toBe('miner');
    m.money = 600;
    buySkin(m, 'violett');
    expect(selectSkin(m, 'violett')).toBe(true);
    expect(selectedSkin(m).id).toBe('violett');
  });

  it('Speicherstand: gewählter Skin bleibt, Unzulässiges wird zurückgesetzt', () => {
    const ok = parseMeta({ skins: ['rot'], skin: 'rot' });
    expect(ok.skin).toBe('rot');
    expect(parseMeta({ skin: 'gold' }).skin).toBe('miner'); // nicht gekauft
    expect(parseMeta({ skin: 'geist' }).skin).toBe('miner'); // Erfolg fehlt
    expect(parseMeta({ skin: 'geist', achievements: { herz: 1 } }).skin).toBe('geist');
    expect(parseMeta({ skin: 123, skins: 'x' }).skin).toBe('miner');
    expect(parseMeta({ skins: ['miner', 'rot', 'rot', 'quatsch'] }).skins).toEqual(['rot']);
  });

  it('der gewählte Skin gelangt in die Runde', () => {
    const s = createGame({ seed: 'skin', mods: computeMods(emptyUpgrades()), skin: 'nacht' });
    expect(s.skin).toBe('nacht');
    expect(createGame({ seed: 'skin', mods: computeMods(emptyUpgrades()) }).skin).toBe(DEFAULT_SKIN);
  });

  it('Erfolgs-Skins: jeder gehört zu einem echten Erfolg, kein Erfolg hat zwei Skins, nicht kaufbar', () => {
    const ach = SKINS.filter((s) => s.achievement);
    expect(ach).toHaveLength(9);
    const ids = ach.map((s) => s.achievement);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ach) {
      expect(ACHIEVEMENTS.some((a) => a.id === s.achievement), s.id).toBe(true);
      expect(s.cost, s.id).toBe(0);
      const m = defaultMeta();
      m.money = 1e12;
      expect(buySkin(m, s.id)).toEqual({ ok: false, reason: 'locked' });
      expect(isSkinUnlocked(m, s.id)).toBe(false);
      m.achievements[s.achievement as string] = 1;
      expect(isSkinUnlocked(m, s.id)).toBe(true);
    }
  });

  it('Kaufskins haben steigende, sinnvolle Preise und lassen sich kaufen', () => {
    const buyable = SKINS.filter((s) => s.cost > 0);
    expect(buyable).toHaveLength(16);
    for (const s of buyable) {
      expect(s.cost).toBeGreaterThan(0);
      const m = defaultMeta();
      m.money = s.cost;
      expect(buySkin(m, s.id)).toEqual({ ok: true, cost: s.cost });
      expect(m.money).toBe(0);
    }
  });

  it('Schimmer-Skins haben eine zweite Farbgebung, Regenbogen/Geist keine nötig', () => {
    const shimmer = SKINS.filter((s) => s.effect === 'shimmer');
    expect(shimmer.length).toBeGreaterThanOrEqual(6);
    for (const s of shimmer) {
      expect(s.palette2, s.id).toBeDefined();
      for (const [letter, color] of Object.entries(s.palette2 ?? {})) {
        expect(PLAYER.palette[letter], `${s.id}: ${letter}`).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // die beiden Farbgebungen unterscheiden sich wirklich
      expect(JSON.stringify(s.palette2)).not.toBe(JSON.stringify(s.palette));
    }
  });

  it('der Speicherstand übernimmt neue Skins (gekauft oder über Erfolg) und verwirft ungültige', () => {
    expect(parseMeta({ skins: ['diamant'], skin: 'diamant' }).skin).toBe('diamant');
    expect(parseMeta({ skin: 'steinmetz' }).skin).toBe('miner'); // Erfolg fehlt
    expect(parseMeta({ skin: 'steinmetz', achievements: { schiefer: 1 } }).skin).toBe('steinmetz');
    expect(parseMeta({ skins: ['steinmetz'] }).skins).toEqual([]); // Erfolgs-Skins werden nicht „besessen“
  });
});
