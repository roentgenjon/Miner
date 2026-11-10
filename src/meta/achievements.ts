import { HEART_DEPTH } from '../config';
import type { RunStats } from '../game/types';
import type { Meta } from './save';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Prüft Gesamtstand (Meta) plus laufende Runde. */
  check: (meta: Meta, run: RunStats, won: boolean) => boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'schiefer', name: 'Schieferbrecher', desc: 'Erreiche 40 m Tiefe.', check: (m, r) => Math.max(m.bestDepth, r.depth) >= 40 },
  { id: 'magma', name: 'Magmaläufer', desc: 'Erreiche 110 m Tiefe.', check: (m, r) => Math.max(m.bestDepth, r.depth) >= 110 },
  { id: 'kristall', name: 'Kristallseher', desc: 'Erreiche 200 m Tiefe.', check: (m, r) => Math.max(m.bestDepth, r.depth) >= 200 },
  { id: 'herz', name: 'Herz des Bergs', desc: `Erreiche das Herz in ${HEART_DEPTH} m.`, check: (m, _r, won) => won || m.wins > 0 },
  { id: 'kombo', name: 'Kombo-König', desc: 'Erreiche eine 6er-Kombo.', check: (_m, r) => r.comboMax >= 6 },
  { id: 'fledermaus', name: 'Fledermausjäger', desc: 'Erledige insgesamt 10 Fledermäuse.', check: (m, r) => m.totals.bats + r.bats >= 10 },
  { id: 'truhen', name: 'Schatzsucher', desc: 'Öffne insgesamt 10 Truhen.', check: (m, r) => m.totals.chests + r.chests >= 10 },
  { id: 'sprengmeister', name: 'Sprengmeister', desc: 'Sprenge insgesamt 500 Blöcke mit Dynamit.', check: (m, r) => m.totals.tntBlocks + r.tntBlocks >= 500 },
  { id: 'goldrausch', name: 'Goldrausch', desc: 'Verdiene insgesamt 5000 Münzen.', check: (m, r) => m.totals.earned + r.money >= 5000 },
];

/** Schaltet neu erfüllte Erfolge frei (mutiert meta) und gibt sie zurück. */
export function evaluateAchievements(meta: Meta, run: RunStats, won = false, now = Date.now()): AchievementDef[] {
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (meta.achievements[a.id] !== undefined) continue;
    if (a.check(meta, run, won)) {
      meta.achievements[a.id] = now;
      fresh.push(a);
    }
  }
  return fresh;
}
