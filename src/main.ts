import './style.css';
import { Sfx } from './audio/sfx';
import { zoneAt } from './config';
import { createGame, drainEvents, endRun, step } from './game/game';
import { dailySeed, randomSeed } from './game/rng';
import type { GameState } from './game/state';
import type { GameEvent } from './game/types';
import { Controls } from './input/controls';
import { FixedStepper } from './loop';
import { evaluateAchievements } from './meta/achievements';
import { applyRunResult } from './meta/progress';
import { loadMeta, saveMeta } from './meta/save';
import { computeMods, emptyUpgrades } from './meta/shop';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';

type Mode = 'menu' | 'playing' | 'paused' | 'ending' | 'result';

// Meldet dem Notfall-Skript in index.html, dass das Spiel gestartet ist.
(window as unknown as { __schachtBoot?: boolean }).__schachtBoot = true;
try {
  sessionStorage.removeItem('schacht-recover');
} catch {
  /* Speicher nicht verfügbar */
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} fehlt`);
  return e as T;
}

const meta = loadMeta();
const sfx = new Sfx();
sfx.enabled = meta.sound;

const canvas = el<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const stepper = new FixedStepper();
const pad = el('pad');
const hud = new Hud(el('hud'), el('toasts'), () => togglePause());

let mode: Mode = 'menu';
let state: GameState = createGame({ seed: 'menu', mods: computeMods(emptyUpgrades()) });
let endTimer = 0;

const controls = new Controls(canvas, pad, {
  onPause: () => togglePause(),
  playerScreen: () => renderer.playerScreen,
  onGesture: () => sfx.unlock(),
});

const overlay = new Overlay(el('overlay'), () => meta, {
  startRun,
  resume: () => togglePause(),
  quitRun: () => {
    endRun(state);
    finishRun();
  },
  toggleSound: () => {
    meta.sound = !meta.sound;
    sfx.enabled = meta.sound;
    saveMeta(meta);
  },
  save: () => saveMeta(meta),
  forceUpdate: () => void forceUpdate(),
  sfx: (k) => sfx.ui(k),
});

/** Service Worker und Caches entfernen und neu laden. Der Spielstand (localStorage) bleibt unberührt. */
async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    window.location.reload();
  }
}

function startRun(daily: boolean): void {
  sfx.unlock();
  state = createGame({
    seed: daily ? dailySeed() : randomSeed(),
    daily,
    mods: computeMods(meta.upgrades),
    record: meta.bestDepth,
  });
  controls.setTarget(state.input);
  controls.enabled = true;
  stepper.reset();
  endTimer = 0;
  mode = 'playing';
  overlay.hide();
  hud.show(true);
  pad.hidden = false;
  hud.toast(daily ? 'Tagesschacht – gleicher Schacht für alle' : 'Viel Erfolg!', 'info');
}

function togglePause(): void {
  if (mode === 'playing') {
    mode = 'paused';
    controls.enabled = false;
    controls.setTarget(state.input);
    overlay.showPause(state);
  } else if (mode === 'paused') {
    mode = 'playing';
    controls.enabled = true;
    stepper.reset();
    overlay.hide();
  }
}

function showMenu(): void {
  mode = 'menu';
  controls.enabled = false;
  hud.show(false);
  pad.hidden = true;
  overlay.showMenu();
}

function finishRun(): void {
  if (mode === 'result') return;
  mode = 'result';
  controls.enabled = false;
  controls.setTarget(null);
  const result = applyRunResult(meta, state);
  saveMeta(meta);
  hud.show(false);
  pad.hidden = true;
  overlay.showResult(state, result);
}

function onEvents(events: GameEvent[]): void {
  renderer.handleEvents(events);
  for (const e of events) {
    sfx.play(e);
    if (e.type === 'zone') hud.toast(`${e.name} · ${zoneAt(state.player.y).from.toLocaleString("de-DE")} m`, "zone");
    else if (e.type === 'mission') hud.toast(`Mission erfüllt: ${e.text} (+${e.reward})`, 'good');
    else if (e.type === 'revive') hud.toast('Zweites Leben! Weiter geht’s.', 'good');
    else if (e.type === 'hurt' && e.source === 'dark') hud.toast('Die Dunkelheit nagt an dir – such Kohle!', 'bad');
  }
  const fresh = evaluateAchievements(meta, state.stats, state.status === 'won');
  if (fresh.length > 0) {
    for (const a of fresh) hud.toast(`Erfolg: ${a.name}`, 'good');
    sfx.ui('achievement');
    saveMeta(meta);
  }
}

function logic(dt: number): void {
  step(state, dt);
  const ev = drainEvents(state);
  if (ev.length > 0) onEvents(ev);
  if (state.status !== 'playing' && mode === 'playing') {
    mode = 'ending';
    endTimer = state.status === 'won' ? 2.2 : 1.4;
    controls.enabled = false;
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  let alpha = 0;
  if (mode === 'playing') {
    alpha = stepper.advance(dt, logic);
  } else if (mode === 'ending') {
    endTimer -= dt;
    if (endTimer <= 0) finishRun();
  }
  renderer.draw(state, alpha, dt);
  if (mode === 'playing' || mode === 'ending' || mode === 'paused') hud.update(state);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'playing') togglePause();
  last = performance.now();
});

showMenu();
requestAnimationFrame(frame);

// Nur im Dev-Server: Debug-Zugriff für manuelle Tests (wird im Build entfernt).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__schacht = {
    get state() {
      return state;
    },
    meta,
    startRun,
    renderer,
  };
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const hadController = navigator.serviceWorker.controller !== null;
  let updateReady = false;
  // Neue Version aktiv: Seite neu laden – aber nie mitten in einer Runde.
  // Der neue Service Worker fragt beim Aktivieren an; wer antwortet, lädt sich selbst neu (siehe unten).
  navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
    if ((ev.data as { type?: string } | null)?.type === 'schacht-update') ev.ports[0]?.postMessage('ok');
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // Erstinstallation, nichts zu aktualisieren
    updateReady = true;
    if (mode === 'menu' || mode === 'result') window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
  window.setInterval(() => {
    if (updateReady && (mode === 'menu' || mode === 'result')) window.location.reload();
  }, 1000);
}
