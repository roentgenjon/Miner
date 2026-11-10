import type { GameState } from '../game/state';
import { comboMult } from '../game/loot';
import { HEART_DEPTH } from '../config';
import { h, fmt } from './dom';

/** Spielanzeige als DOM-Overlay. Liest nur den Zustand. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hearts: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly depth: HTMLElement;
  private readonly money: HTMLElement;
  private readonly tnt: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly missions: HTMLElement;
  private readonly toasts: HTMLElement;
  private cache = new Map<string, string>();

  constructor(root: HTMLElement, toasts: HTMLElement, onPause: () => void) {
    this.root = root;
    this.toasts = toasts;
    this.hearts = h('div', { class: 'hearts' });
    this.energyFill = h('div', { class: 'energy-fill' });
    this.depth = h('span', { class: 'depth' });
    this.money = h('span', { class: 'money' });
    this.tnt = h('span', { class: 'tnt' });
    this.combo = h('div', { class: 'combo' });
    this.missions = h('ul', { class: 'missions' });
    const pause = h('button', { class: 'pause-btn', title: 'Pause (P)', onclick: onPause }, 'II');
    pause.setAttribute('aria-label', 'Pause');
    root.append(
      h('div', { class: 'hud-row' }, this.hearts, h('div', { class: 'energy' }, this.energyFill), pause),
      h('div', { class: 'hud-row stats' }, this.depth, this.money, this.tnt),
      this.combo,
      this.missions,
    );
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.cache.clear();
  }

  private set(key: string, value: string, apply: () => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply();
  }

  update(s: GameState): void {
    const p = s.player;
    this.set('hearts', `${p.hp}/${p.maxHp}`, () => {
      this.hearts.replaceChildren();
      for (let i = 0; i < p.maxHp; i++) {
        this.hearts.append(h('span', { class: i < p.hp ? 'heart full' : 'heart empty' }, '♥'));
      }
    });
    const f = Math.max(0, Math.min(1, p.energy / p.maxEnergy));
    this.set('energy', f.toFixed(3), () => {
      this.energyFill.style.width = `${f * 100}%`;
      this.energyFill.classList.toggle('low', f < 0.25);
    });
    this.set('depth', String(p.y), () => (this.depth.textContent = `${p.y} m / ${HEART_DEPTH}`));
    this.set('money', String(s.wallet), () => (this.money.textContent = `● ${fmt(s.wallet)}`));
    this.set('tnt', String(p.tnt), () => (this.tnt.textContent = `TNT ${p.tnt}`));

    const c = s.combo;
    const ck = c.count > 1 ? `${c.count}:${Math.ceil(c.timer * 4)}` : '';
    this.set('combo', ck, () => {
      if (c.count > 1) {
        this.combo.textContent = `Kombo ×${comboMult(c.count, s.mods.comboMax).toFixed(2).replace(/\.?0+$/, '')}`;
        this.combo.style.opacity = '1';
      } else {
        this.combo.textContent = '';
        this.combo.style.opacity = '0';
      }
    });
    const mk = s.missions.map((m) => `${m.progress}${m.done ? '!' : ''}`).join('|');
    this.set('missions', mk, () => {
      this.missions.replaceChildren(
        ...s.missions.map((m) =>
          h('li', { class: m.done ? 'done' : '' }, `${m.done ? '✓' : '·'} ${m.text} (${Math.min(m.progress, m.target)}/${m.target})`),
        ),
      );
    });
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'zone' = 'info'): void {
    const el = h('div', { class: `toast ${kind}` }, text);
    this.toasts.append(el);
    window.setTimeout(() => el.classList.add('out'), 2200);
    window.setTimeout(() => el.remove(), 2800);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }
}
