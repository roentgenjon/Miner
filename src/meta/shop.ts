import { COMBO, PICK, PLAYER, TNT, UPGRADES, UPGRADE_PRICE_MULT, type UpgradeDef } from '../config';
import type { Mods, UpgradeId, Upgrades } from '../game/types';
import type { Meta } from './save';

/** Höchstwerte, die nach Erreichen keinen Spielvorteil mehr bringen. */
export const MAX_TNT_RADIUS = 12;
export const MAX_LIGHT_BONUS = 40;
export const MAX_MOVE_SPEED = 20;

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

/** Preis für die nächste Stufe (gerundet auf 1/5/10 je nach Höhe). */
export function upgradeCost(id: UpgradeId, level: number): number {
  const d = getDef(id);
  // Exponentieller Bereich bis tailFrom - 1, danach linear weiter (sonst wären 10 000 Stufen unbezahlbar).
  const expLevel = d.tailFrom !== undefined ? Math.min(level, d.tailFrom - 1) : level;
  const raw = d.baseCost * Math.pow(d.growth, expLevel);
  const step = raw < 100 ? 1 : raw < 1000 ? 5 : 10;
  const base = Math.round(raw / step) * step;
  const tail = d.tailFrom !== undefined && level >= d.tailFrom ? Math.floor((level - (d.tailFrom - 1)) * (d.tailStep ?? 0)) : 0;
  return Math.max(1, Math.round((base + tail) * UPGRADE_PRICE_MULT));
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

export interface BulkResult {
  bought: number;
  spent: number;
  /** Warum aufgehört wurde, falls nicht alle gewünschten Stufen gekauft wurden. */
  stoppedBy: 'max' | 'money' | null;
}

const BULK_LIMIT = 1_000_000;

/** Kauft bis zu `count` Stufen am Stück (`Infinity` = so viele wie möglich). */
export function buyUpgradeMany(meta: Meta, id: UpgradeId, count: number): BulkResult {
  const d = getDef(id);
  let bought = 0;
  let spent = 0;
  let level = meta.upgrades[id];
  let stoppedBy: BulkResult['stoppedBy'] = null;
  // Sicherung: bei bis zu 10^11 Stufen nie unbegrenzt in einem Klick rechnen.
  while (bought < Math.min(count, BULK_LIMIT)) {
    if (level >= d.maxLevel) {
      stoppedBy = 'max';
      break;
    }
    const cost = upgradeCost(id, level);
    if (meta.money - spent < cost) {
      stoppedBy = 'money';
      break;
    }
    spent += cost;
    level++;
    bought++;
  }
  meta.money -= spent;
  meta.upgrades[id] = level;
  return { bought, spent, stoppedBy };
}

/** Gesamtpreis der nächsten `count` Stufen (begrenzt durch die Maximalstufe). */
export function costOfNext(id: UpgradeId, level: number, count: number): { levels: number; cost: number } {
  const d = getDef(id);
  const levels = Math.max(0, Math.min(count, d.maxLevel - level));
  let cost = 0;
  for (let i = 0; i < levels; i++) cost += upgradeCost(id, level + i);
  return { levels, cost };
}

/** Rechnet Upgrade-Stufen in konkrete Spielwerte um. */
export function computeMods(u: Upgrades): Mods {
  const per = (id: UpgradeId): number => getDef(id).perLevel;
  return {
    digSpeed: 1 + per('pick') * Math.min(u.pick, PICK.softCap) + PICK.tailPerLevel * Math.max(0, u.pick - PICK.softCap),
    maxEnergy: PLAYER.baseEnergy + per('lamp') * u.lamp,
    maxHp: PLAYER.baseHp + per('armor') * u.armor,
    startTnt: Math.floor(TNT.baseStart + TNT.perLevel * u.tnt),
    coalMult: 1 + per('coal') * u.coal,
    oreMult: 1 + per('ore') * u.ore,
    comboWindow: COMBO.window + per('combo') * u.combo,
    fallReduction: per('boots') * u.boots,
    rockReduction: per('helmet') * u.helmet,
    lootMult: 1 + per('luck') * u.luck,
    // Obergrenzen: sehr große Radien/Lichtkegel/Lauftempo bringen spielerisch nichts mehr (und kosten Rechenzeit)
    tntRadius: Math.min(MAX_TNT_RADIUS, TNT.radius + per('power') * u.power),
    blastLoot: Math.min(1, TNT.blastLoot + per('blast') * u.blast),
    drainMult: Math.max(0.2, 1 - per('saver') * u.saver),
    lightBonus: Math.min(MAX_LIGHT_BONUS, per('light') * u.light),
    moveSpeed: Math.min(MAX_MOVE_SPEED, 1 + per('legs') * u.legs),
    comboMax: COMBO.maxMult + per('master') * u.master,
    revives: per('revive') * u.revive,
    startDepth: per('lift') * u.lift,
    digCostMult: Math.max(0.1, 1 - per('gentle') * u.gentle),
    hazardReduction: Math.min(0.9, per('ward') * u.ward),
    regenSeconds: u.regen > 0 ? Math.max(3, 90 - per('regen') * u.regen) : 0,
    veinChance: Math.min(0.9, per('vein') * u.vein),
    critChance: Math.min(0.9, per('crit') * u.crit),
    tntFuse: Math.max(0.4, TNT.fuse - per('fuse') * u.fuse),
    invulnBonus: per('shield') * u.shield,
    bounty: per('bounty') * u.bounty,
    tntRegenSeconds: u.tntregen > 0 ? Math.max(4, 60 - per('tntregen') * u.tntregen) : 0,
    batDodge: Math.min(0.9, per('dodge') * u.dodge),
  };
}

/** Zahl mit höchstens `d` Nachkommastellen, deutsches Komma, ohne überflüssige Nullen. */
function n(x: number, d = 2): string {
  const s = x.toFixed(d);
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).replace('.', ',');
}

/** Kurzbeschreibung der Wirkung einer Stufe (für die Werkstatt-Anzeige). */
export function describeLevel(id: UpgradeId, level: number): string {
  const u = emptyUpgrades();
  u[id] = level;
  const m = computeMods(u);
  switch (id) {
    case 'pick':
      return `Grabtempo ×${m.digSpeed >= 1000 ? Math.round(m.digSpeed).toLocaleString('de-DE') : n(m.digSpeed, 3)}`;
    case 'lamp':
      return `${n(m.maxEnergy, 1)} Energie`;
    case 'armor':
      return `${m.maxHp} Leben`;
    case 'tnt':
      return `${m.startTnt} Dynamit zum Start`;
    case 'coal':
      return `+${n((m.coalMult - 1) * 100, 1)} % Kohle-Energie`;
    case 'ore':
      return `+${n((m.oreMult - 1) * 100, 1)} % Erzwert`;
    case 'combo':
      return `${n(m.comboWindow, 2)} s Kombo-Fenster`;
    case 'boots':
      return `−${m.fallReduction} Fallschaden`;
    case 'helmet':
      return `−${m.rockReduction} Steinschlag`;
    case 'luck':
      return `+${n((m.lootMult - 1) * 100, 1)} % Beute`;
    case 'power':
      return `Radius ${n(m.tntRadius, 2)}`;
    case 'blast':
      return `${Math.round(m.blastLoot * 100)} % Erz aus Sprengungen`;
    case 'saver':
      return `−${n((1 - m.drainMult) * 100, 1)} % Lampenverbrauch`;
    case 'light':
      return `+${n(m.lightBonus, 2)} Felder Licht`;
    case 'legs':
      return `+${n((m.moveSpeed - 1) * 100, 1)} % Lauftempo`;
    case 'master':
      return `Kombo bis ×${n(m.comboMax, 2)}`;
    case 'revive':
      return `${m.revives} Wiederbelebung${m.revives === 1 ? '' : 'en'}`;
    case 'lift':
      return `Start bei ${m.startDepth.toLocaleString('de-DE')} m`;
    case 'gentle':
      return `−${n((1 - m.digCostMult) * 100, 1)} % Grabenergie`;
    case 'ward':
      return `−${n(m.hazardReduction * 100, 1)} % Fledermäuse`;
    case 'regen':
      return m.regenSeconds > 0 ? `1 Leben alle ${n(m.regenSeconds, 1)} s` : 'keine Selbstheilung';
    case 'vein':
      return `${n(m.veinChance * 100, 1)} % Nachbar-Erz mit`;
    case 'crit':
      return `${n(m.critChance * 100, 1)} % Doppelfund`;
    case 'fuse':
      return `Lunte ${n(m.tntFuse, 2)} s`;
    case 'shield':
      return `+${n(m.invulnBonus, 2)} s unverwundbar`;
    case 'bounty':
      return `● ${n(m.bounty, 0)} pro Fledermaus`;
    case 'tntregen':
      return m.tntRegenSeconds > 0 ? `1 Dynamit alle ${n(m.tntRegenSeconds, 1)} s` : 'kein Nachschub';
    case 'dodge':
      return `${n(m.batDodge * 100, 1)} % Ausweichen`;
  }
}
