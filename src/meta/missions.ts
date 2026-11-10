import { MISSION } from '../config';
import type { Rng } from '../game/rng';
import type { RunStats } from '../game/types';

export interface MissionDef {
  id: string;
  label: (target: number) => string;
  stat: keyof RunStats;
  targets: readonly [number, number, number];
  rewards: readonly [number, number, number];
}

export interface MissionState {
  id: string;
  text: string;
  stat: keyof RunStats;
  target: number;
  reward: number;
  tier: number;
  progress: number;
  done: boolean;
}

export const MISSION_DEFS: readonly MissionDef[] = [
  { id: 'depth', label: (n) => `Erreiche ${n} m Tiefe`, stat: 'depth', targets: [30, 70, 130], rewards: [50, 120, 260] },
  { id: 'ores', label: (n) => `Sammle ${n} Erze`, stat: 'ores', targets: [8, 18, 32], rewards: [50, 120, 250] },
  { id: 'combo', label: (n) => `Erreiche eine ${n}er-Kombo`, stat: 'comboMax', targets: [3, 5, 8], rewards: [60, 130, 280] },
  { id: 'tnt', label: (n) => `Sprenge ${n} Blöcke mit Dynamit`, stat: 'tntBlocks', targets: [12, 30, 60], rewards: [50, 110, 240] },
  { id: 'chests', label: (n) => `Öffne ${n} Truhe${n === 1 ? '' : 'n'}`, stat: 'chests', targets: [1, 2, 4], rewards: [60, 130, 270] },
  { id: 'bats', label: (n) => `Erledige ${n} ${n === 1 ? 'Fledermaus' : 'Fledermäuse'}`, stat: 'bats', targets: [1, 3, 6], rewards: [60, 140, 280] },
  { id: 'coal', label: (n) => `Sammle ${n} Kohle`, stat: 'coal', targets: [3, 7, 12], rewards: [40, 100, 220] },
  { id: 'money', label: (n) => `Verdiene ${n} Münzen`, stat: 'money', targets: [150, 400, 900], rewards: [50, 130, 300] },
];

function pickTier(rng: Rng): number {
  const r = rng.next();
  let acc = 0;
  for (let i = 0; i < MISSION.tierWeights.length; i++) {
    acc += MISSION.tierWeights[i] ?? 0;
    if (r < acc) return i;
  }
  return MISSION.tierWeights.length - 1;
}

/** Zieht zufällige, verschiedene Missionen. */
export function createMissions(rng: Rng, count = MISSION.count): MissionState[] {
  const pool = [...MISSION_DEFS];
  const out: MissionState[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const def = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    if (!def) break;
    const tier = pickTier(rng);
    const target = def.targets[tier] as number;
    out.push({
      id: def.id,
      text: def.label(target),
      stat: def.stat,
      target,
      reward: def.rewards[tier] as number,
      tier,
      progress: 0,
      done: false,
    });
  }
  return out;
}

/** Aktualisiert den Fortschritt anhand der Rundenstatistik, liefert neu erfüllte Missionen. */
export function updateMissions(missions: MissionState[], stats: RunStats): MissionState[] {
  const completed: MissionState[] = [];
  for (const m of missions) {
    if (m.done) continue;
    m.progress = Math.min(m.target, stats[m.stat]);
    if (m.progress >= m.target) {
      m.done = true;
      completed.push(m);
    }
  }
  return completed;
}
