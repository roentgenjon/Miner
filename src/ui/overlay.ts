import { ACCOUNTS, HEART_DEPTH, SKINS, UPGRADES } from '../config';
import { dailyKey } from '../game/rng';
import type { GameState } from '../game/state';
import { ACHIEVEMENTS } from '../meta/achievements';
import type { RunResult } from '../meta/progress';
import { activeAccount, type AccountIndex } from '../meta/accounts';
import type { Meta } from '../meta/save';
import { buySkin, isSkinUnlocked, selectSkin } from '../meta/skins';
import { buyUpgradeMany, costOfNext, describeLevel, upgradeCost } from '../meta/shop';
import { fmt, h } from './dom';

export interface OverlayActions {
  startRun(daily: boolean): void;
  resume(): void;
  quitRun(): void;
  toggleSound(): void;
  save(): void;
  /** Service Worker und Caches löschen und neu laden (Spielstand bleibt erhalten). */
  forceUpdate(): void;
  sfx(kind: 'click' | 'buy' | 'deny'): void;
  /** Vorschaubild der Spielfigur in einem Skin. */
  skinPreview(skinId: string, size: number): HTMLCanvasElement;
  accounts: {
    list(): AccountIndex;
    /** Spielstand eines Kontos lesen (ohne zu wechseln). */
    peek(id: string): Meta;
    switchTo(id: string): void;
    /** Liefert eine Fehlermeldung oder null bei Erfolg. */
    create(name: string): string | null;
    rename(id: string, name: string): string | null;
    remove(id: string): boolean;
    exportFile(id: string): void;
    importText(text: string): string | null;
  };
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
      h('p', { class: 'tagline' }, `Grabe dich ${fmt(HEART_DEPTH)} m tief zum Herz des Bergs.`),
      h(
        'div',
        { class: 'stat-row' },
        h('div', {}, h('b', {}, `● ${fmt(m.money)}`), h('span', {}, 'Münzen')),
        h('div', {}, h('b', {}, `${fmt(m.bestDepth)} m`), h('span', {}, 'Rekord')),
        h('div', {}, h('b', {}, `${Object.keys(m.achievements).length}/${ACHIEVEMENTS.length}`), h('span', {}, 'Erfolge')),
      ),
      this.btn('Neuer Schacht', () => this.act.startRun(false), 'primary'),
      this.btn(`Tagesschacht · ${new Date().toLocaleDateString('de-DE')}`, () => this.act.startRun(true)),
      h('p', { class: 'hint' }, dailyBest > 0 ? `Heute bisher: ${dailyBest} m` : 'Gleicher Schacht für alle – pro Tag neu.'),
      h('div', { class: 'btn-row' }, this.btn('Werkstatt', () => this.showShop()), this.btn('Erfolge', () => this.showTrophies())),
      h('div', { class: 'btn-row' }, this.btn('Skins', () => this.showSkins()), this.btn(`Konto: ${activeAccount(this.act.accounts.list()).name}`, () => this.showAccounts())),
      h('div', { class: 'btn-row' }, this.soundBtn(), this.btn('Update erzwingen', () => this.act.forceUpdate(), 'small')),
      h('p', { class: 'hint keys' }, '← → ↓ ↑ / A D S W graben & klettern · Leertaste: Dynamit · P / Esc: Pause · Wischen oder Tippen am Handy'),
      h('p', { class: 'hint keys' }, `Version ${__BUILD__}`),
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
            // „Max“ nicht durchrechnen (bis zu 1 Mio. Stufen): es genügt, dass die nächste Stufe bezahlbar ist.
            const { levels, cost } = costOfNext(u.id, lvl, Number.isFinite(count) ? count : 1);
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
                  u.maxLevel >= 1000 ? buyBtn('×1k', 1000, 'tiny') : null,
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

  showSkins(): void {
    const list = h('div', { class: 'skin-grid' });
    const money = h('b', {}, '');
    const render = (): void => {
      const m = this.meta();
      money.textContent = `● ${fmt(m.money)}`;
      list.replaceChildren(
        ...SKINS.map((skin) => {
          const unlocked = isSkinUnlocked(m, skin.id);
          const selected = m.skin === skin.id && unlocked;
          let label: string;
          let cls = 'btn small';
          let action: () => void = () => undefined;
          if (selected) {
            label = 'Ausgewählt';
            cls += ' maxed';
          } else if (unlocked) {
            label = 'Auswählen';
            cls += ' primary';
            action = () => {
              selectSkin(this.meta(), skin.id);
              this.act.save();
              render();
            };
          } else if (skin.achievement) {
            label = 'Gesperrt';
            cls += ' poor';
          } else {
            label = `● ${fmt(skin.cost)}`;
            cls += m.money >= skin.cost ? ' primary' : ' poor';
            action = () => {
              const r = buySkin(this.meta(), skin.id);
              this.act.sfx(r.ok ? 'buy' : 'deny');
              if (r.ok) {
                selectSkin(this.meta(), skin.id);
                this.act.save();
              }
              render();
            };
          }
          return h(
            'div',
            { class: `skin-card ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}` },
            this.act.skinPreview(skin.id, 64),
            h('b', {}, skin.name),
            h('span', {}, skin.desc),
            h('button', { class: cls, onclick: action }, label),
          );
        }),
      );
    };
    render();
    this.show(h('h2', {}, 'Skins'), h('p', { class: 'wallet' }, 'Guthaben: ', money), list, this.btn('Zurück', () => this.showMenu()));
  }

  showAccounts(msg: string | null = null): void {
    const idx = this.act.accounts.list();
    const input = h('input', { class: 'text-input' });
    input.type = 'text';
    input.maxLength = ACCOUNTS.nameMax;
    input.placeholder = 'Name des neuen Kontos';
    input.setAttribute('aria-label', 'Name des neuen Kontos');
    input.autocomplete = 'off';
    const file = h('input', {});
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((text) => this.showAccounts(this.act.accounts.importText(text) ?? 'Konto importiert.'));
    });
    const rows = idx.accounts.map((a) => {
      const m = this.act.accounts.peek(a.id);
      const active = a.id === idx.active;
      return h(
        'div',
        { class: `account ${active ? 'active' : ''}` },
        h('div', { class: 'info' }, h('b', {}, `${a.name}${active ? '  (aktiv)' : ''}`), h('span', {}, `● ${fmt(m.money)} · Rekord ${fmt(m.bestDepth)} m · ${m.runs} Runden`)),
        h(
          'div',
          { class: 'acc-actions' },
          active ? null : this.btn('Wechseln', () => { this.act.accounts.switchTo(a.id); this.showAccounts(`Konto „${a.name}“ aktiv.`); }, 'small primary'),
          this.btn('Name', () => {
            const n = window.prompt('Neuer Name', a.name);
            if (n !== null) this.showAccounts(this.act.accounts.rename(a.id, n) ?? 'Umbenannt.');
          }, 'small'),
          this.btn('Export', () => this.act.accounts.exportFile(a.id), 'small'),
          idx.accounts.length > 1
            ? this.btn('Löschen', () => {
                if (window.confirm(`Konto „${a.name}“ mit allen Fortschritten endgültig löschen?`)) {
                  this.act.accounts.remove(a.id);
                  this.showAccounts(`Konto „${a.name}“ gelöscht.`);
                }
              }, 'small danger')
            : null,
        ),
      );
    });
    this.show(
      h('h2', {}, 'Konten'),
      h('p', { class: 'hint' }, 'Konten liegen nur auf diesem Gerät. Über Export und Import nimmst du ein Konto auf ein anderes Gerät mit.'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      h('div', { class: 'account-list' }, ...rows),
      h('div', { class: 'new-account' }, input, this.btn('Anlegen', () => this.showAccounts(this.act.accounts.create(input.value) ?? 'Konto angelegt.'), 'small primary')),
      this.btn('Konto importieren (Datei)', () => file.click(), 'small'),
      file,
      this.btn('Zurück', () => this.showMenu()),
    );
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
      h('p', { class: 'hint' }, `Tiefe ${fmt(s.player.y)} m · Rekord ${fmt(Math.max(s.record, s.stats.depth))} m`),
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
        h('p', {}, `Tiefe: ${fmt(s.stats.depth)} m`, r.newBest ? h('strong', {}, '  Neuer Rekord!') : null),
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
