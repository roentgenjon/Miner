import { ENERGY, ZONE_TOAST_EVERY, zoneAt } from '../config';
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

  if (s.status === 'playing') updateRegen(s, dt);
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

/** Selbstheilung (Leben) und Dynamit-Nachschub: je ein Punkt in festen Abständen, solange etwas fehlt. */
function updateRegen(s: GameState, dt: number): void {
  const p = s.player;
  const m = s.mods;
  if (m.regenSeconds > 0 && p.hp < p.maxHp) {
    s.regenT += dt;
    if (s.regenT >= m.regenSeconds) {
      s.regenT = 0;
      p.hp += 1;
      emit(s, { type: 'heal', amount: 1 });
    }
  } else {
    s.regenT = 0;
  }
  if (m.tntRegenSeconds > 0 && p.tnt < m.startTnt) {
    s.tntT += dt;
    if (s.tntT >= m.tntRegenSeconds) {
      s.tntT = 0;
      p.tnt += 1;
    }
  } else {
    s.tntT = 0;
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
    // Bei 1 Mio. Zonen nur alle ZONE_TOAST_EVERY Zonen eine Meldung.
    const milestone = Math.floor(zone.index / ZONE_TOAST_EVERY);
    if (milestone !== s.zoneMilestone) {
      s.zoneMilestone = milestone;
      emit(s, { type: 'zone', zone: zone.id, name: zone.name });
    }
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
