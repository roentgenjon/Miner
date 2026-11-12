import { describe, expect, it } from 'vitest';
import { GIFTS } from '../src/config';
import {
  GIFT_LEDGER_KEY,
  GIFT_PREFIX,
  createGift,
  decodeGift,
  describeGift,
  encodeGift,
  extractCode,
  giftLink,
  loadLedger,
  redeemGift,
  saveLedger,
  validateGift,
  type Gift,
} from '../src/meta/gifts';
import { defaultMeta, parseMeta, type KeyValueStore } from '../src/meta/save';

const ledger = () => ({ redeemed: [] as string[], sent: [] as string[] });

function rich() {
  const m = defaultMeta();
  m.money = 1000;
  m.skins = ['rot', 'gold'];
  return m;
}

describe('Geschenke: Kodierung', () => {
  const gift: Gift = { id: 'abc123def456', from: 'Jörg Öl', kind: 'coins', amount: 500, note: 'Viel Spaß – äöü!', created: 1 };

  it('codiert und decodiert verlustfrei (auch Umlaute und Sonderzeichen)', () => {
    const code = encodeGift(gift);
    expect(code.startsWith(GIFT_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9._-]+$/); // link-tauglich
    const r = decodeGift(code);
    expect(r.ok && r.gift).toEqual(gift);
  });

  it('versteht Code und ganzen Link, auch mit Leerzeichen und Text drumherum', () => {
    const code = encodeGift(gift);
    const link = giftLink(code, 'https://beispiel.de/Miner/?x=1#alt');
    expect(link).toBe(`https://beispiel.de/Miner/?x=1#gift=${code}`);
    expect(extractCode(`  ${code}  `)).toBe(code);
    expect(extractCode(link)).toBe(code);
    expect(extractCode(`Hier dein Geschenk: ${link} viel Spaß`)).toBe(code);
    expect(extractCode('quatsch')).toBeNull();
    expect(decodeGift(link).ok).toBe(true);
  });

  it('erkennt Tippfehler und Beschädigung über die Prüfsumme', () => {
    const code = encodeGift(gift);
    const broken = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    expect(decodeGift(broken)).toEqual({ ok: false, reason: 'checksum' });
    expect(decodeGift(code.slice(0, -3))).toEqual({ ok: false, reason: 'checksum' });
    expect(decodeGift('gift1.nodot')).toEqual({ ok: false, reason: 'format' });
    expect(decodeGift('')).toEqual({ ok: false, reason: 'format' });
  });

  it('lehnt unsinnige Inhalte auch mit korrekter Prüfsumme ab', () => {
    const bad = (g: unknown): boolean => decodeGift(encodeGift(g as Gift)).ok;
    expect(bad({ ...gift })).toBe(true);
    expect(bad({ ...gift, amount: 0 })).toBe(false);
    expect(bad({ ...gift, amount: -5 })).toBe(false);
    expect(bad({ ...gift, amount: 2.5 })).toBe(false);
    expect(bad({ ...gift, amount: GIFTS.maxCoins + 1 })).toBe(false);
    expect(bad({ ...gift, amount: '500' })).toBe(false);
    expect(bad({ ...gift, kind: 'dynamit' })).toBe(false);
    expect(bad({ ...gift, id: '../../x' })).toBe(false);
    expect(bad({ id: 'abc123def456', kind: 'skin', skin: 'miner' })).toBe(false); // Standard-Skin
    expect(bad({ id: 'abc123def456', kind: 'skin', skin: 'geist' })).toBe(false); // Erfolgs-Skin
    expect(bad({ id: 'abc123def456', kind: 'skin', skin: 'gibtsnicht' })).toBe(false);
    expect(bad({ id: 'abc123def456', kind: 'skin', skin: 'rot' })).toBe(true);
  });

  it('bereinigt Absender und Nachricht (Länge, Steuerzeichen)', () => {
    const g = validateGift({ ...gift, from: 'x'.repeat(50), note: `${'n'.repeat(100)}\u0000\u0007` });
    expect(g?.from).toHaveLength(16);
    expect(g?.note?.length).toBeLessThanOrEqual(GIFTS.noteMax);
    expect(g?.note).not.toMatch(/[\u0000-\u001f]/);
  });

  it('beschreibt Geschenke lesbar', () => {
    expect(describeGift({ ...gift, amount: 1234567 })).toBe('● 1.234.567 Münzen');
    expect(describeGift({ id: 'abc123def456', from: 'A', kind: 'skin', skin: 'gold', created: 0 })).toBe('Skin „Goldhelm“');
  });
});

describe('Geschenke: verschenken', () => {
  it('zieht Münzen sofort ab und merkt das Geschenk zum erneuten Kopieren', () => {
    const m = rich();
    const l = ledger();
    const r = createGift(m, 'Anna', { kind: 'coins', amount: 400, note: 'Hi' }, l, 5, 'idabcdef01');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(m.money).toBe(600);
    expect(m.sentGifts[0]).toMatchObject({ id: 'idabcdef01', code: r.code, label: '● 400 Münzen' });
    expect(l.sent).toEqual(['idabcdef01']);
    const back = decodeGift(r.code);
    expect(back.ok && back.gift).toMatchObject({ kind: 'coins', amount: 400, from: 'Anna', note: 'Hi' });
  });

  it('lehnt ungültige Mengen ab, ohne etwas abzubuchen', () => {
    for (const amount of [0, -1, 1.5, NaN, Infinity, GIFTS.maxCoins + 1]) {
      const m = rich();
      expect(createGift(m, 'A', { kind: 'coins', amount }, ledger()).ok).toBe(false);
      expect(m.money).toBe(1000);
      expect(m.sentGifts).toHaveLength(0);
    }
    const m = rich();
    expect(createGift(m, 'A', { kind: 'coins', amount: 1001 }, ledger())).toEqual({ ok: false, reason: 'money' });
    expect(m.money).toBe(1000);
  });

  it('verschenkt gekaufte Skins (weg vom Konto, Auswahl fällt auf Standard zurück)', () => {
    const m = rich();
    m.skin = 'gold';
    const r = createGift(m, 'A', { kind: 'skin', skin: 'gold' }, ledger());
    expect(r.ok).toBe(true);
    expect(m.skins).toEqual(['rot']);
    expect(m.skin).toBe('miner');
  });

  it('verschenkt nur, was man besitzt und was verschenkbar ist', () => {
    const m = rich();
    for (const skin of ['violett', 'miner', 'geist', 'gibtsnicht', 'regenbogen']) {
      expect(createGift(m, 'A', { kind: 'skin', skin }, ledger())).toEqual({ ok: false, reason: 'skin' });
    }
    expect(m.skins).toEqual(['rot', 'gold']);
  });

  it('behält nur die letzten Geschenke', () => {
    const m = rich();
    m.money = 1e9;
    for (let i = 0; i < GIFTS.keepSent + 5; i++) createGift(m, 'A', { kind: 'coins', amount: 1 }, ledger(), i, `id${String(i).padStart(8, '0')}`);
    expect(m.sentGifts).toHaveLength(GIFTS.keepSent);
    expect(m.sentGifts[0]?.id).toBe(`id${String(GIFTS.keepSent + 4).padStart(8, '0')}`);
  });
});

describe('Geschenke: einlösen', () => {
  const coins: Gift = { id: 'giftcoins001', from: 'Anna', kind: 'coins', amount: 250, created: 1 };
  const skin: Gift = { id: 'giftskin0001', from: 'Anna', kind: 'skin', skin: 'rot', created: 1 };

  it('bucht Münzen und Skins gut', () => {
    const m = defaultMeta();
    const l = ledger();
    expect(redeemGift(m, coins, l)).toEqual({ ok: true, label: '● 250 Münzen' });
    expect(m.money).toBe(250);
    expect(redeemGift(m, skin, l)).toEqual({ ok: true, label: 'Skin „Rotkittel“' });
    expect(m.skins).toEqual(['rot']);
  });

  it('jeder Code zählt pro Gerät nur einmal – auch in einem anderen Konto', () => {
    const a = defaultMeta();
    const b = defaultMeta();
    const l = ledger(); // Gerätebuch gilt für alle Konten
    expect(redeemGift(a, coins, l).ok).toBe(true);
    expect(redeemGift(a, coins, l)).toEqual({ ok: false, reason: 'used' });
    expect(redeemGift(b, coins, l)).toEqual({ ok: false, reason: 'used' });
    expect(a.money).toBe(250);
    expect(b.money).toBe(0);
  });

  it('eigene Geschenke lassen sich nicht selbst einlösen (auch nicht im Zweitkonto)', () => {
    const sender = rich();
    const l = ledger();
    const r = createGift(sender, 'A', { kind: 'coins', amount: 100 }, l);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(redeemGift(sender, r.gift, l)).toEqual({ ok: false, reason: 'own' });
    const second = defaultMeta(); // anderes Konto auf demselben Gerät
    expect(redeemGift(second, r.gift, l)).toEqual({ ok: false, reason: 'own' });
    expect(second.money).toBe(0);
    // auf einem anderen Gerät (eigenes Gerätebuch) klappt es
    const other = defaultMeta();
    expect(redeemGift(other, r.gift, ledger()).ok).toBe(true);
    expect(other.money).toBe(100);
  });

  it('einen schon vorhandenen Skin lehnt es ab, ohne den Code zu verbrauchen', () => {
    const m = defaultMeta();
    m.skins = ['rot'];
    const l = ledger();
    expect(redeemGift(m, skin, l)).toEqual({ ok: false, reason: 'owned' });
    expect(l.redeemed).toEqual([]);
    const other = defaultMeta();
    expect(redeemGift(other, skin, l).ok).toBe(true); // weitergereicht
  });
});

describe('Geschenke: Speicher', () => {
  function memStore(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('speichert und lädt das Gerätebuch, kaputte Daten fallen auf leer zurück', () => {
    const s = memStore();
    saveLedger({ redeemed: ['a1', 'a2'], sent: ['s1'] }, s);
    expect(loadLedger(s)).toEqual({ redeemed: ['a1', 'a2'], sent: ['s1'] });
    s.data.set(GIFT_LEDGER_KEY, '{kaputt');
    expect(loadLedger(s)).toEqual({ redeemed: [], sent: [] });
    expect(loadLedger(null)).toEqual({ redeemed: [], sent: [] });
  });

  it('begrenzt das Gerätebuch', () => {
    const s = memStore();
    const many = Array.from({ length: GIFTS.ledgerMax + 50 }, (_, i) => `g${i}`);
    saveLedger({ redeemed: many, sent: [] }, s);
    expect(loadLedger(s).redeemed).toHaveLength(GIFTS.ledgerMax);
  });

  it('Spielstand: verschenkte Geschenke werden eingelesen und bereinigt', () => {
    const m = parseMeta({ sentGifts: [{ id: 'x', code: 'gift1.a.b', label: 'L', created: 5 }, { id: 5 }, 'quatsch', null, { id: 'y', code: 'z'.repeat(5000), label: 'x' }] });
    expect(m.sentGifts).toEqual([{ id: 'x', code: 'gift1.a.b', label: 'L', created: 5 }]);
    expect(parseMeta({ sentGifts: 'nope' }).sentGifts).toEqual([]);
  });
});
