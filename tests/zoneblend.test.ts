import { describe, expect, it } from 'vitest';
import { ZONE_COUNT, ZONE_LENGTH } from '../src/config';
import { zoneBlend } from '../src/render/zoneblend';

describe('Zonenübergang (Darstellung)', () => {
  it('blendet nur an den Zonengrenzen, stärker direkt an der Grenze', () => {
    const rows = Array.from({ length: ZONE_LENGTH }, (_, r) => zoneBlend(5, r)?.alpha ?? 0);
    expect(rows[0]).toBe(0.35);
    expect(rows[1]).toBe(0.15);
    for (let r = 2; r < ZONE_LENGTH - 2; r++) expect(rows[r]).toBe(0); // Mitte der Zone bleibt rein
    expect(rows[ZONE_LENGTH - 2]).toBe(0.15);
    expect(rows[ZONE_LENGTH - 1]).toBe(0.35);
  });

  it('mischt die jeweils benachbarte Zone ein (unten die nächste, oben die vorherige)', () => {
    expect(zoneBlend(5, ZONE_LENGTH - 1)?.zone.index).toBe(6);
    expect(zoneBlend(5, 0)?.zone.index).toBe(4);
  });

  it('ist spiegelbildlich: beide Seiten einer Grenze haben dieselbe Stärke', () => {
    expect(zoneBlend(7, ZONE_LENGTH - 1)?.alpha).toBe(zoneBlend(8, 0)?.alpha);
    expect(zoneBlend(7, ZONE_LENGTH - 2)?.alpha).toBe(zoneBlend(8, 1)?.alpha);
  });

  it('an den Enden des Schachts gibt es keine Nachbarn ohne Zone', () => {
    expect(zoneBlend(0, 0)).toBeNull();
    expect(zoneBlend(ZONE_COUNT - 1, ZONE_LENGTH - 1)).toBeNull();
    expect(zoneBlend(0, ZONE_LENGTH - 1)?.zone.index).toBe(1);
    expect(zoneBlend(ZONE_COUNT - 1, 0)?.zone.index).toBe(ZONE_COUNT - 2);
  });
});
