import { DEFAULT_SKIN, SKINS, type SkinDef } from '../config';
import type { Meta } from './save';

export function skinDef(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? (SKINS[0] as SkinDef);
}

/** Frei verfügbar, gekauft oder über einen Erfolg freigeschaltet? */
export function isSkinUnlocked(meta: Meta, id: string): boolean {
  const def = SKINS.find((s) => s.id === id);
  if (!def) return false;
  if (def.cost === 0 && !def.achievement) return true;
  if (meta.skins.includes(id)) return true;
  return def.achievement !== undefined && meta.achievements[def.achievement] !== undefined;
}

export type SkinBuyResult = { ok: true; cost: number } | { ok: false; reason: 'owned' | 'money' | 'locked' };

/** Kauft einen Skin mit Münzen. Skins, die über Erfolge kommen, sind nicht kaufbar. */
export function buySkin(meta: Meta, id: string): SkinBuyResult {
  const def = SKINS.find((s) => s.id === id);
  if (!def || def.achievement) return { ok: false, reason: 'locked' };
  if (isSkinUnlocked(meta, id)) return { ok: false, reason: 'owned' };
  if (meta.money < def.cost) return { ok: false, reason: 'money' };
  meta.money -= def.cost;
  meta.skins.push(id);
  return { ok: true, cost: def.cost };
}

/** Wählt einen freigeschalteten Skin aus. */
export function selectSkin(meta: Meta, id: string): boolean {
  if (!isSkinUnlocked(meta, id)) return false;
  meta.skin = id;
  return true;
}

export function selectedSkin(meta: Meta): SkinDef {
  return skinDef(isSkinUnlocked(meta, meta.skin) ? meta.skin : DEFAULT_SKIN);
}
