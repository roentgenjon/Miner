import { RUN } from '../config';
import { dailyKey } from '../game/rng';
import type { GameState } from '../game/state';
import { evaluateAchievements, type AchievementDef } from './achievements';
import type { Meta } from './save';

export interface RunResult {
  banked: number;
  newBest: boolean;
  achievements: AchievementDef[];
}

/** Überträgt das Ergebnis einer beendeten Runde in den Speicherstand. */
export function applyRunResult(meta: Meta, s: GameState, today: string = dailyKey()): RunResult {
  const won = s.status === 'won';
  const banked = Math.floor(s.wallet * (s.status === 'dead' ? RUN.deathKeep : 1));
  const newBest = s.stats.depth > meta.bestDepth;

  // Achievements gegen den Stand VOR der Addition prüfen, dann Totals aufrechnen.
  const achievements = evaluateAchievements(meta, s.stats, won);

  meta.money += banked;
  meta.runs++;
  if (won) meta.wins++;
  meta.bestDepth = Math.max(meta.bestDepth, s.stats.depth);
  meta.totals.ores += s.stats.ores;
  meta.totals.tntBlocks += s.stats.tntBlocks;
  meta.totals.chests += s.stats.chests;
  meta.totals.bats += s.stats.bats;
  meta.totals.coal += s.stats.coal;
  meta.totals.earned += banked;

  if (s.daily) {
    if (meta.daily.date !== today) meta.daily = { date: today, best: 0, runs: 0 };
    meta.daily.runs++;
    meta.daily.best = Math.max(meta.daily.best, s.stats.depth);
  }
  return { banked, newBest, achievements };
}
