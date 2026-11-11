import { HEART_DEPTH, UPGRADES } from '../config';
import { dailyKey } from '../game/rng';
import type { GameState } from '../game/state';
import { ACHIEVEMENTS } from '../meta/achievements';
import type { RunResult } from '../meta/progress';
import type { Meta } from '../meta/save';
import { buyUpgradeMany, costOfNext, describeLevel, upgradeCost } from '../meta/shop';
import { fmt, h } from './dom';

export interface OverlayActions {
  startRun(daily: boolean): void;
  resume(): void;
  quitRun(): void;
  toggleSound(): void;
  save(): void;
  sfx(kind: 'click' | 'buy' | 'deny'): void;
}

/** Vollbild-Menüs: Hauptmenü, Werkstatt, Erfolge, Pause, Ergebnis. */
export class Overlay {
  private lastDaily = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly meta: () => Meta,
    private readonly act: OverlayActions,
  ) {}

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  private show(...content: (Node | null)[]): void {
    this.root.hidden = false;
    this.root.replaceChildren(h('div', { class: 'panel' }, ...content));
    this.root.scrollTop = 0;
  }

  private btn(label: string, onclick: () => void, cls = ''): HTMLButtonElement {
    return h(
      'button',
      {
        class: `btn ${cls}`.trim(),
        onclick: () => {
          this.act.sfx('click');
          onclick();
        },
      },
      label,
    );
  }

  private soundBtn(): HTMLButtonElement {
    const b = this.btn(this.meta().sound ? 'Ton: an' : 'Ton: aus', () => {
      this.act.toggleSound();
      b.textContent = this.meta().sound ? 'Ton: an' : 'Ton: aus';
    }, 'small');
    return b;
  }

  showMenu(): void {
    const m = this.meta();
    const today = dailyKey();
    const dailyBest = m.daily.date === today ? m.daily.best : 0;
    this.show(
      h('h1', { class: 'title' }, 'SCHACHT'),
      h('p', { class: 'tagline' }, `Grabe dich ${HEART_DEPTH} m tief zum Herz des Bergs.`),
      h(
        'div',
        { class: 'stat-row' },
        h('div', {}, h('b', {}, `● ${fmt(m.money)}`), h('span', {}, 'Münzen')),
        h('div', {}, h('b', {}, `${m.bestDepth} m`), h('span', {}, 'Rekord')),
        h('div', {}, h('b', {}, `${Object.keys(m.achievements).length}/${ACHIEVEMENTS.length}`), h('span', {}, 'Erfolge')),
      ),
      this.btn('Neuer Schacht', () => this.act.startRun(false), 'primary'),
      this.btn(`Tagesschacht · ${new Date().toLocaleDateString('de-DE')}`, () => this.act.startRun(true)),
      h('p', { class: 'hint' }, dailyBest > 0 ? `Heute bisher: ${dailyBest} m` : 'Gleicher Schacht für alle – pro Tag neu.'),
      h('div', { class: 'btn-row' }, this.btn('Werkstatt', () => this.showShop()), this.btn('Erfolge', () => this.showTrophies())),
      this.soundBtn(),
      h('p', { class: 'hint keys' }, '← → ↓ ↑ / A D S W graben & klettern · Leertaste: Dynamit · P / Esc: Pause · Wischen oder Tippen am Handy'),
    );
  }

  showShop(): void {
    const m = this.meta();
    const list = h('div', { class: 'shop-list' });
    const money = h('b', {}, `● ${fmt(m.money)}`);

    const render = (): void => {
      money.textContent = `● ${fmt(this.meta().money)}`;
      list.replaceChildren(
        ...UPGRADES.map((u) => {
          const lvl = this.meta().upgrades[u.id];
          const maxed = lvl >= u.maxLevel;
          const cost = upgradeCost(u.id, lvl);
          const bar = h('div', { class: 'lvlbar' }, h('i', { style: `width:${(lvl / u.maxLevel) * 100}%` }));
          const buyBtn = (label: string, count: number, cls: string): HTMLButtonElement => {
            const { levels, cost } = costOfNext(u.id, lvl, count);
            const ok = levels > 0 && this.meta().money >= cost;
            return h(
              'button',
              {
                class: `btn small buy ${cls} ${ok ? 'primary' : 'poor'}`,
                onclick: () => {
                  const r = buyUpgradeMany(this.meta(), u.id, count);
                  this.act.sfx(r.bought > 0 ? 'buy' : 'deny');
                  if (r.bought > 0) this.act.save();
                  render();
                },
              },
              label,
            );
          };
          const buy = h(
            'div',
            { class: 'buy-col' },
            maxed
              ? h('button', { class: 'btn small buy maxed' }, 'Max')
              : buyBtn(`● ${fmt(cost)}`, 1, ''),
            !maxed && u.maxLevel >= 30
              ? h(
                  'div',
                  { class: 'bulk' },
                  buyBtn('×10', 10, 'tiny'),
                  buyBtn('×100', 100, 'tiny'),
                  buyBtn(`Max`, Infinity, 'tiny'),
                )
              : null,
          );
          return h(
            'div',
            { class: 'shop-item' },
            h('div', { class: 'info' }, h('b', {}, `${u.name}  ${lvl}/${u.maxLevel}`), h('span', {}, u.desc), bar, h('em', {}, describeLevel(u.id, lvl) + (maxed ? '' : `  →  ${describeLevel(u.id, lvl + 1)}`))),
            buy,
          );
        }),
      );
    };
    render();
    this.show(h('h2', {}, 'Werkstatt'), h('p', { class: 'wallet' }, 'Guthaben: ', money), list, this.btn('Zurück', () => this.showMenu()));
  }

  showTrophies(): void {
    const m = this.meta();
    this.show(
      h('h2', {}, 'Erfolge'),
      h(
        'div',
        { class: 'trophies' },
        ...ACHIEVEMENTS.map((a) => {
          const got = m.achievements[a.id] !== undefined;
          return h('div', { class: `trophy ${got ? 'got' : ''}` }, h('b', {}, `${got ? '★' : '☆'} ${a.name}`), h('span', {}, a.desc));
        }),
      ),
      this.btn('Zurück', () => this.showMenu()),
    );
  }

  showPause(s: GameState): void {
    this.show(
      h('h2', {}, 'Pause'),
      h('p', { class: 'hint' }, `Tiefe ${s.player.y} m · Rekord ${Math.max(s.record, s.stats.depth)} m`),
      h(
        'ul',
        { class: 'missions big' },
        ...s.missions.map((mi) => h('li', { class: mi.done ? 'done' : '' }, `${mi.done ? '✓' : '·'} ${mi.text} (${Math.min(mi.progress, mi.target)}/${mi.target}) · ● ${mi.reward}`)),
      ),
      this.btn('Weiter', () => this.act.resume(), 'primary'),
      this.soundBtn(),
      this.btn('Runde beenden', () => this.act.quitRun(), 'danger'),
    );
  }

  showResult(s: GameState, r: RunResult): void {
    this.lastDaily = s.daily;
    const title = s.status === 'won' ? 'Herz des Bergs erreicht!' : s.status === 'dead' ? 'Verschüttet!' : 'Runde beendet';
    const won = s.status === 'won';
    this.show(
      h('h2', { class: won ? 'win' : s.status === 'dead' ? 'lose' : '' }, title),
      h(
        'div',
        { class: 'result' },
        h('p', {}, `Tiefe: ${s.stats.depth} m`, r.newBest ? h('strong', {}, '  Neuer Rekord!') : null),
        h('p', {}, `Erze: ${s.stats.ores} · Truhen: ${s.stats.chests} · Fledermäuse: ${s.stats.bats}`),
        h('p', {}, `Gesprengt: ${s.stats.tntBlocks} Blöcke`),
        h('p', {}, `Verdient: ● ${fmt(s.wallet)}`, s.status === 'dead' ? ` → gutgeschrieben ● ${fmt(r.banked)}` : ''),
      ),
      h(
        'ul',
        { class: 'missions big' },
        ...s.missions.map((mi) => h('li', { class: mi.done ? 'done' : '' }, `${mi.done ? '✓' : '✗'} ${mi.text}${mi.done ? ` (+${mi.reward})` : ''}`)),
      ),
      r.achievements.length > 0
        ? h('div', { class: 'new-ach' }, ...r.achievements.map((a) => h('p', {}, `★ Erfolg: ${a.name}`)))
        : null,
      this.btn('Nochmal', () => this.act.startRun(this.lastDaily), 'primary'),
      h('div', { class: 'btn-row' }, this.btn('Werkstatt', () => this.showShop()), this.btn('Menü', () => this.showMenu())),
    );
  }
}
