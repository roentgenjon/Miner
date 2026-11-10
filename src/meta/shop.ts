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
    rockReduction: per('helmet') * u.helmet,
    lootMult: 1 + per('luck') * u.luck,
    tntRadius: TNT.radius + per('power') * u.power,
    blastLoot: Math.min(1, TNT.blastLoot + per('blast') * u.blast),
    drainMult: Math.max(0.2, 1 - per('saver') * u.saver),
    lightBonus: per('light') * u.light,
    moveSpeed: 1 + per('legs') * u.legs,
    lavaReduction: per('heat') * u.heat,
    comboMax: COMBO.maxMult + per('master') * u.master,
    revives: per('revive') * u.revive,
    startDepth: per('lift') * u.lift,
    digCostMult: Math.max(0.1, 1 - per('gentle') * u.gentle),
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
      return `−${m.rockReduction} Steinschlag`;
    case 'luck':
      return `+${Math.round((m.lootMult - 1) * 100)} % Beute`;
    case 'power':
      return `Radius ${m.tntRadius.toFixed(1).replace('.', ',')}`;
    case 'blast':
      return `${Math.round(m.blastLoot * 100)} % Erz aus Sprengungen`;
    case 'saver':
      return `−${Math.round((1 - m.drainMult) * 100)} % Lampenverbrauch`;
    case 'light':
      return `+${m.lightBonus.toFixed(1).replace('.', ',')} Felder Licht`;
    case 'legs':
      return `+${Math.round((m.moveSpeed - 1) * 100)} % Lauftempo`;
    case 'heat':
      return `−${m.lavaReduction} Lavaschaden`;
    case 'master':
      return `Kombo bis ×${m.comboMax.toFixed(1).replace('.', ',').replace(',0', '')}`;
    case 'revive':
      return `${m.revives} Wiederbelebung${m.revives === 1 ? '' : 'en'}`;
    case 'lift':
      return `Start bei ${m.startDepth} m`;
    case 'gentle':
      return `−${Math.round((1 - m.digCostMult) * 100)} % Grabenergie`;
  }
}
