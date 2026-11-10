import { COMBO, PLAYER, TNT, UPGRADES, type UpgradeDef } from '../config';
import type { Mods, UpgradeId, Upgrades } from '../game/types';
import type { Meta } from './save';

export function emptyUpgrades(): Upgrades {
  const u = {} as Upgrades;
  for (const d of UPGRADES) u[d.id] = 0;
  return u;
}

export function getDef(id: UpgradeId): UpgradeDef {
  const d = UPGRADES.find((u) => u.id === id);
  if (!d) throw new Error(`Unbekanntes Upgrade: ${id}`);
  return d;
}

/** Preis für die nächste Stufe (auf 5 gerundet). */
export function upgradeCost(id: UpgradeId, level: number): number {
  const d = getDef(id);
  return Math.round((d.baseCost * Math.pow(d.growth, level)) / 5) * 5;
}

export type BuyResult = { ok: true; cost: number } | { ok: false; reason: 'max' | 'money' };

export function buyUpgrade(meta: Meta, id: UpgradeId): BuyResult {
  const d = getDef(id);
  const level = meta.upgrades[id];
  if (level >= d.maxLevel) return { ok: false, reason: 'max' };
  const cost = upgradeCost(id, level);
  if (meta.money < cost) return { ok: false, reason: 'money' };
  meta.money -= cost;
  meta.upgrades[id] = level + 1;
  return { ok: true, cost };
}

/** Rechnet Upgrade-Stufen in konkrete Spielwerte um. */
export function computeMods(u: Upgrades): Mods {
  const per = (id: UpgradeId): number => getDef(id).perLevel;
  return {
    digSpeed: 1 + per('pick') * u.pick,
    maxEnergy: PLAYER.baseEnergy + per('lamp') * u.lamp,
    maxHp: PLAYER.baseHp + per('armor') * u.armor,
    startTnt: TNT.baseStart + TNT.perLevel * u.tnt,
    coalMult: 1 + per('coal') * u.coal,
    oreMult: 1 + per('ore') * u.ore,
    comboWindow: COMBO.window + per('combo') * u.combo,
    fallReduction: per('boots') * u.boots,
    rockReduction: Math.floor(per('helmet') * u.helmet),
    lootMult: 1 + per('luck') * u.luck,
  };
}

/** Kurzbeschreibung der Wirkung einer Stufe (für die Werkstatt-Anzeige). */
export function describeLevel(id: UpgradeId, level: number): string {
  const u = emptyUpgrades();
  u[id] = level;
  const m = computeMods(u);
  switch (id) {
    case 'pick':
      return `+${Math.round((m.digSpeed - 1) * 100)} % Grabtempo`;
    case 'lamp':
      return `${Math.round(m.maxEnergy)} Energie`;
    case 'armor':
      return `${m.maxHp} Leben`;
    case 'tnt':
      return `${m.startTnt} Dynamit zum Start`;
    case 'coal':
      return `+${Math.round((m.coalMult - 1) * 100)} % Kohle-Energie`;
    case 'ore':
      return `+${Math.round((m.oreMult - 1) * 100)} % Erzwert`;
    case 'combo':
      return `${m.comboWindow.toFixed(1).replace('.', ',')} s Kombo-Fenster`;
    case 'boots':
      return `−${m.fallReduction} Fallschaden`;
    case 'helmet':
      return `−${m.rockReduction} Steinschlag/Lava`;
    case 'luck':
      return `+${Math.round((m.lootMult - 1) * 100)} % Beute`;
  }
}
