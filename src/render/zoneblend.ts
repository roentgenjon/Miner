import { ZONE_COUNT, ZONE_LENGTH, zoneByIndex, type ZoneDef } from '../config';

/**
 * Weicher Farbübergang zwischen benachbarten Zonen (nur Darstellung):
 * die letzten zwei Zeilen einer Zone und die ersten zwei der nächsten blenden die Nachbarfarbe leicht ein,
 * sodass 0 % → 15 % → 35 % | 35 % → 15 % → 0 % entsteht statt eines harten Streifens.
 *
 * `row` ist die Zeile innerhalb der Zone (0 … ZONE_LENGTH − 1). Liefert null, wenn nichts einzublenden ist.
 */
export function zoneBlend(index: number, row: number): { zone: ZoneDef; alpha: number } | null {
  const last = ZONE_LENGTH - 1;
  if (row >= last - 1 && index + 1 < ZONE_COUNT) return { zone: zoneByIndex(index + 1), alpha: row === last ? 0.35 : 0.15 };
  if (row <= 1 && index > 0) return { zone: zoneByIndex(index - 1), alpha: row === 0 ? 0.35 : 0.15 };
  return null;
}
