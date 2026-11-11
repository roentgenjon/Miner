import { ENERGY, zoneAt } from '../config';
import { updateBats } from './bats';
import { updatePhysics } from './physics';
import { updatePlayer } from './player';
import { addBonus } from './loot';
import { damagePlayer, emit, type GameState } from './state';
import { updateAutoTnt, updateTnt } from './tnt';
import { updateMissions } from '../meta/missions';

export { createGame, drainEvents } from './state';

/** Ein fester Logikschritt. Kein DOM, kein Rendering. */
export function step(s: GameState, dt: number): void {
  if (s.status !== 'playing') return;
  s.time += dt;
  s.tick++;

  updatePlayer(s, dt);
  if (s.status === 'playing') updateAutoTnt(s, dt);
  if (s.status === 'playing') updateTnt(s, dt);
  if (s.status === 'playing') updatePhysics(s, dt);
  if (s.status === 'playing') updateBats(s, dt);
  if (s.status === 'playing') updateEnergy(s, dt);

  updateCombo(s, dt);
  trackProgress(s);
}

function updateEnergy(s: GameState, dt: number): void {
  const p = s.player;
  if (p.y <= 0) return;
  p.energy = Math.max(0, p.energy - ENERGY.drain * zoneAt(p.y).drain * s.mods.drainMult * dt);
  if (p.energy <= 0) {
    p.darkT += dt;
    if (p.darkT >= ENERGY.darkDamageEvery) {
      p.darkT = 0;
      damagePlayer(s, 1, 'dark', true);
    }
  } else {
    p.darkT = 0;
  }
}

function updateCombo(s: GameState, dt: number): void {
  if (s.combo.timer > 0) {
    s.combo.timer = Math.max(0, s.combo.timer - dt);
    if (s.combo.timer === 0) s.combo.count = 0;
  }
}

function trackProgress(s: GameState): void {
  const p = s.player;
  if (p.y > s.stats.depth) s.stats.depth = p.y;

  const zone = zoneAt(p.y);
  if (zone.id !== s.zone) {
    s.zone = zone.id;
    emit(s, { type: 'zone', zone: zone.id, name: zone.name });
  }

  for (const m of updateMissions(s.missions, s.stats)) {
    addBonus(s, m.reward);
    emit(s, { type: 'mission', id: m.id, text: m.text, reward: m.reward });
  }
}

/** Runde vorzeitig beenden (Pause-Menü „Aufgeben“). */
export function endRun(s: GameState): void {
  if (s.status === 'playing') s.status = 'ended';
}
