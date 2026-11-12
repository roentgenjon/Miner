import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN, SKINS } from '../src/config';
import { createGame } from '../src/game/state';
import { PLAYER } from '../src/render/sprites';
import { defaultMeta, parseMeta } from '../src/meta/save';
import { buySkin, isSkinUnlocked, selectedSkin, selectSkin } from '../src/meta/skins';
import { computeMods, emptyUpgrades } from '../src/meta/shop';

describe('Skins', () => {
  it('hat 8 Skins mit eindeutiger Kennung; der Standard-Skin ist gratis', () => {
    expect(SKINS).toHaveLength(8);
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(8);
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
});
