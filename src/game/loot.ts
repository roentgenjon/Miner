import { BLOCKS, CHEST, COMBO, ENERGY, ORE_VALUE_MULT, zoneValueScale } from '../config';
import { emit, type GameState } from './state';
import { Block, type BlockId } from './types';

export function comboMult(count: number, max: number = COMBO.maxMult): number {
  return Math.min(max, 1 + COMBO.stepBonus * Math.max(0, count - 1));
}

function addMoney(s: GameState, amount: number): void {
  s.wallet += amount;
  s.stats.money += amount;
}

export function addEnergy(s: GameState, amount: number): void {
  const p = s.player;
  p.energy = Math.min(p.maxEnergy, p.energy + amount);
}

/** Erz einsammeln: Kombo erhöhen und Münzen gutschreiben. */
export function collectOre(s: GameState, block: BlockId, x: number, y: number): void {
  const base = BLOCKS[block]?.value ?? 0;
  if (base <= 0) return;
  s.combo.count = s.combo.timer > 0 ? s.combo.count + 1 : 1;
  s.combo.timer = s.mods.comboWindow;
  s.stats.comboMax = Math.max(s.stats.comboMax, s.combo.count);
  const mult = comboMult(s.combo.count, s.mods.comboMax);
  const value = Math.round(base * ORE_VALUE_MULT * s.mods.oreMult * mult * zoneValueScale(y));
  addMoney(s, value);
  s.stats.ores++;
  emit(s, { type: 'ore', x, y, block, value, mult });
}

export function collectCoal(s: GameState, x: number, y: number): void {
  const energy = Math.round(ENERGY.coalGain * s.mods.coalMult);
  addEnergy(s, energy);
  s.stats.coal++;
  emit(s, { type: 'coal', x, y, energy });
}

export function openChest(s: GameState, x: number, y: number): void {
  const w = CHEST.weights;
  // Glückshände verschiebt Gewicht von Münzen weg zu den besseren Belohnungen.
  const lootBonus = s.mods.lootMult - 1;
  const weights = {
    money: w.money,
    coal: w.coal,
    tnt: w.tnt * (1 + lootBonus),
    heal: w.heal * (1 + lootBonus * 2),
  };
  const total = weights.money + weights.coal + weights.tnt + weights.heal;
  let r = s.rng.next() * total;
  s.stats.chests++;
  let text = '';
  if ((r -= weights.money) < 0) {
    const amount = Math.round((CHEST.moneyBase + CHEST.moneyDeep) * zoneValueScale(y) * s.mods.lootMult * (0.7 + s.rng.next() * 0.6));
    addMoney(s, amount);
    text = `+${amount} Münzen`;
  } else if ((r -= weights.coal) < 0) {
    addEnergy(s, CHEST.coalEnergy * s.mods.coalMult);
    text = 'Lampe aufgefüllt';
  } else if ((r -= weights.tnt) < 0) {
    s.player.tnt += CHEST.tntAmount;
    text = `+${CHEST.tntAmount} Dynamit`;
  } else if (s.player.hp < s.player.maxHp) {
    s.player.hp += 1;
    emit(s, { type: 'heal', amount: 1 });
    text = '+1 Leben';
  } else {
    const amount = Math.round(CHEST.moneyBase * s.mods.lootMult);
    addMoney(s, amount);
    text = `+${amount} Münzen`;
  }
  emit(s, { type: 'chest', x, y, text });
}

export function addBonus(s: GameState, amount: number): void {
  s.wallet += amount;
}

export function isBreakable(block: BlockId): boolean {
  return block !== Block.Air && (BLOCKS[block]?.breakable ?? false);
}
