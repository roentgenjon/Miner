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
import { ACCOUNTS } from './config';
import {
  accountKey,
  activeAccount,
  createAccount,
  deleteAccount,
  exportAccount,
  importAccount,
  loadAccounts,
  renameAccount,
  saveAccounts,
  switchAccount,
} from './meta/accounts';
import { defaultStore, loadMeta, saveMeta, type Meta } from './meta/save';
import { createGift, decodeGift, giftLink, extractCode, loadLedger, redeemGift, saveLedger } from './meta/gifts';
import { selectedSkin } from './meta/skins';
import { createApi } from './net/api';
import { CloudSync } from './net/sync';
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

// Konten: lokale Profile auf diesem Gerät, jedes mit eigenem Spielstand (siehe meta/accounts.ts).
const store = defaultStore();
let accounts = loadAccounts(store);
saveAccounts(accounts, store);
let meta: Meta = loadMeta(store, accountKey(accounts.active));
/** Speichert den Spielstand des aktiven Kontos. */
function persist(): void {
  saveMeta(meta, store, accountKey(accounts.active));
  sync.markDirty();
  scheduleCloudPush();
}

/** Online-Konto: Spielstand etwa 4 s nach der letzten Änderung sichern. */
let pushTimer: number | undefined;
function scheduleCloudPush(): void {
  if (sync.state() !== 'dirty') return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void sync.push(), 4000);
}
const sfx = new Sfx();
sfx.enabled = meta.sound;

const sync = new CloudSync({
  api: createApi(),
  store,
  getMeta: () => meta,
  // Online-Stand übernehmen: lokal speichern, ohne ihn als „geändert“ zu markieren
  applyMeta: (m) => {
    meta = m;
    saveMeta(meta, store, accountKey(accounts.active));
    sfx.enabled = meta.sound;
  },
  accountId: () => accounts.active,
});

const canvas = el<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const stepper = new FixedStepper();
const pad = el('pad');
const hud = new Hud(el('hud'), el('toasts'), () => togglePause());

let mode: Mode = 'menu';
let state: GameState = createGame({ seed: 'menu', mods: computeMods(emptyUpgrades()) });
let endTimer = 0;
/** Geschenk-Code aus einem geöffneten Link, der noch angezeigt werden soll. */
let pendingGift: string | null = null;

const controls = new Controls(canvas, pad, {
  onPause: () => togglePause(),
  onToggleAuto: () => toggleAuto(),
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
    persist();
  },
  save: () => persist(),
  forceUpdate: () => void forceUpdate(),
  sfx: (k) => sfx.ui(k),
  skinPreview: (id, size) => renderer.skinPreview(id, size),
  cloud: {
    info: () => ({ state: sync.state(), name: sync.link?.name ?? null, accountName: accounts.accounts.find((a) => a.id === sync.link?.accountId)?.name ?? null }),
    signIn: (mode, name, password) => sync.signIn(mode, name, password),
    pending: () => sync.pending,
    adopt: () => {
      const e = sync.adoptPending();
      return e;
    },
    push: () => sync.push(),
    resolve: (choice) => sync.resolve(choice),
    signOut: () => sync.signOut(),
    pull: () => sync.pull(),
    send: (body) => sync.send(body),
    inbox: () => sync.inbox(),
    claim: (id) => sync.claim(id),
  },
  gifts: {
    create: (spec) => {
      persist();
      const ledger = loadLedger(store);
      const r = createGift(meta, activeAccount(accounts).name, spec, ledger);
      if (!r.ok) return { error: r.reason === 'money' ? 'So viele Münzen hast du nicht.' : r.reason === 'skin' ? 'Diesen Skin kannst du nicht verschenken.' : 'Bitte eine ganze Menge ab 1 eingeben.' };
      persist();
      saveLedger(ledger, store);
      return { code: r.code, link: giftLink(r.code, giftBase()), label: r.label };
    },
    preview: (text) => {
      const d = decodeGift(text);
      if (!d.ok) return { error: giftDecodeError(d.reason) };
      const ledger = loadLedger(store);
      if (ledger.sent.includes(d.gift.id) || meta.sentGifts.some((g) => g.id === d.gift.id)) return { error: 'Das ist dein eigenes Geschenk.' };
      if (ledger.redeemed.includes(d.gift.id)) return { error: 'Dieses Geschenk wurde auf diesem Gerät schon eingelöst.' };
      return { gift: d.gift };
    },
    redeem: (text) => {
      const d = decodeGift(text);
      if (!d.ok) return { error: giftDecodeError(d.reason) };
      const ledger = loadLedger(store);
      const r = redeemGift(meta, d.gift, ledger);
      if (!r.ok) {
        return { error: r.reason === 'own' ? 'Das ist dein eigenes Geschenk.' : r.reason === 'used' ? 'Dieses Geschenk wurde auf diesem Gerät schon eingelöst.' : 'Diesen Skin hast du schon – gib das Geschenk an jemand anderen weiter.' };
      }
      persist();
      saveLedger(ledger, store);
      return { message: `Eingelöst: ${r.label}` };
    },
    link: (code) => giftLink(code, giftBase()),
  },
  accounts: {
    list: () => accounts,
    peek: (id) => (id === accounts.active ? meta : loadMeta(store, accountKey(id))),
    switchTo: (id) => {
      persist();
      if (!switchAccount(accounts, id)) return;
      saveAccounts(accounts, store);
      meta = loadMeta(store, accountKey(id));
      sfx.enabled = meta.sound;
    },
    create: (name) => {
      persist();
      const r = createAccount(accounts, name);
      if (!r.ok) return accountError(r.reason);
      saveAccounts(accounts, store);
      saveMeta(loadMeta(null), store, accountKey(r.id)); // leerer Spielstand
      return null;
    },
    rename: (id, name) => {
      const r = renameAccount(accounts, id, name);
      if (!r.ok) return accountError(r.reason);
      saveAccounts(accounts, store);
      return null;
    },
    remove: (id) => {
      if (!deleteAccount(accounts, id, store)) return false;
      saveAccounts(accounts, store);
      meta = loadMeta(store, accountKey(accounts.active));
      sfx.enabled = meta.sound;
      return true;
    },
    exportFile: (id) => {
      persist();
      const acc = accounts.accounts.find((a) => a.id === id) ?? activeAccount(accounts);
      const data = exportAccount(acc.name, loadMeta(store, accountKey(acc.id)));
      download(`schacht-${acc.name.replace(/[^a-z0-9äöüß_-]+/gi, '_')}.json`, data);
    },
    importText: (text) => {
      persist();
      const r = importAccount(accounts, store, saveMeta, text);
      if (!r.ok) return r.reason === 'limit' ? accountError('limit') : 'Das ist keine gültige Konto-Datei.';
      saveAccounts(accounts, store);
      return null;
    },
  },
});

function giftBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function giftDecodeError(reason: 'format' | 'checksum' | 'invalid'): string {
  if (reason === 'checksum') return 'Der Code ist beschädigt oder falsch abgetippt.';
  if (reason === 'invalid') return 'Dieses Geschenk ist ungültig.';
  return 'Das ist kein Geschenk-Code.';
}

function accountError(reason: 'name' | 'duplicate' | 'limit'): string {
  if (reason === 'duplicate') return 'Diesen Namen gibt es schon.';
  if (reason === 'limit') return `Höchstens ${ACCOUNTS.max} Konten pro Gerät.`;
  return 'Bitte einen Namen eingeben.';
}

/** Löst den Download einer Textdatei aus. */
function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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

function setAuto(on: boolean): void {
  state.input.autoTnt = on;
  pad.querySelector('[data-action="auto"]')?.classList.toggle('on', on);
  pad.querySelector('[data-action="auto"]')?.setAttribute('aria-pressed', String(on));
}

function toggleAuto(): void {
  if (mode !== 'playing') return;
  const on = !state.input.autoTnt;
  setAuto(on);
  meta.autoTnt = on;
  persist();
  hud.toast(on ? 'Auto-Dynamit AN – legt beim Graben 3 Felder voraus' : 'Auto-Dynamit AUS', on ? 'good' : 'info');
}

function startRun(daily: boolean): void {
  sfx.unlock();
  state = createGame({
    seed: daily ? dailySeed() : randomSeed(),
    daily,
    mods: computeMods(meta.upgrades),
    record: meta.bestDepth,
    skin: selectedSkin(meta).id,
  });
  controls.setTarget(state.input);
  setAuto(meta.autoTnt);
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
  if (pendingGift) checkIncomingGift();
}

function finishRun(): void {
  if (mode === 'result') return;
  mode = 'result';
  controls.enabled = false;
  controls.setTarget(null);
  const result = applyRunResult(meta, state);
  persist();
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
    persist();
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

// Online-Konto: beim Start den Online-Stand prüfen (neue Geschenke, anderes Gerät); beim Verlassen der Seite sichern.
void sync.pull().then((msg) => {
  if (msg) hud.toast(msg, msg.includes('Konflikt') || msg.includes('anderen Gerät') ? 'bad' : 'good');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && sync.state() === 'dirty') void sync.push();
});

// Geschenk-Link (…#gift=CODE): Annahme-Dialog zeigen und den Code aus der Adresse entfernen.
// Gilt beim Start und auch, wenn der Link in einem schon offenen Tab geöffnet wird (nur der #-Teil ändert sich).
// Läuft gerade eine Runde, wird das Geschenk gemerkt und erst im Menü gezeigt.
function checkIncomingGift(): void {
  const code = extractCode(window.location.hash.replace(/^#/, '?'));
  if (code) {
    pendingGift = code;
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (pendingGift && (mode === 'menu' || mode === 'result')) {
    const c = pendingGift;
    pendingGift = null;
    overlay.showIncomingGift(c);
  }
}

window.addEventListener('hashchange', checkIncomingGift);
checkIncomingGift();

// Nur im Dev-Server: Debug-Zugriff für manuelle Tests (wird im Build entfernt).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__schacht = {
    get state() {
      return state;
    },
    get meta() {
      return meta;
    },
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
