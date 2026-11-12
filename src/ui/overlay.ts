import { ACCOUNTS, HEART_DEPTH, SKINS, UPGRADES } from '../config';
import { dailyKey } from '../game/rng';
import type { GameState } from '../game/state';
import { ACHIEVEMENTS } from '../meta/achievements';
import type { RunResult } from '../meta/progress';
import { activeAccount, type AccountIndex } from '../meta/accounts';
import { describeGift, type Gift, type GiftSpec } from '../meta/gifts';
import type { Meta, SentGift } from '../meta/save';
import { buySkin, isSkinUnlocked, selectSkin } from '../meta/skins';
import { buyUpgradeMany, costOfNext, describeLevel, upgradeCost } from '../meta/shop';
import { copyText, fmt, h } from './dom';

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
  gifts: {
    create(spec: GiftSpec): { error: string } | { code: string; link: string; label: string };
    /** Prüft einen Code/Link, ohne ihn einzulösen. */
    preview(text: string): { error: string } | { gift: Gift };
    redeem(text: string): { error: string } | { message: string };
    link(code: string): string;
  };
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
      h('div', { class: 'btn-row' }, this.btn('Skins', () => this.showSkins()), this.btn('Geschenke', () => this.showGifts())),
      h('div', { class: 'btn-row' }, this.btn(`Konto: ${activeAccount(this.act.accounts.list()).name}`, () => this.showAccounts(), 'small'), this.soundBtn()),
      this.btn('Update erzwingen', () => this.act.forceUpdate(), 'small'),
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

  /** Annahme-Dialog für einen geöffneten Geschenk-Link. */
  showIncomingGift(code: string): void {
    const r = this.act.gifts.preview(code);
    if ('error' in r) {
      this.show(h('h2', {}, 'Geschenk'), h('p', { class: 'notice' }, r.error), this.btn('Weiter', () => this.showMenu(), 'primary'));
      return;
    }
    const g = r.gift;
    this.show(
      h('h2', {}, 'Du hast ein Geschenk!'),
      h('div', { class: 'gift-card' }, h('b', {}, describeGift(g)), h('span', {}, `von ${g.from}`), g.note ? h('em', {}, `„${g.note}“`) : null),
      this.btn('Annehmen', () => {
        const res = this.act.gifts.redeem(code);
        this.act.sfx('error' in res ? 'deny' : 'buy');
        this.showGifts('error' in res ? res.error : res.message);
      }, 'primary'),
      this.btn('Später', () => this.showMenu()),
    );
  }

  showGifts(msg: string | null = null, created: { code: string; link: string; label: string } | null = null, kind: 'coins' | 'skin' = 'coins'): void {
    const m = this.meta();
    const giftable = SKINS.filter((s) => s.cost > 0 && !s.achievement && m.skins.includes(s.id));

    const amount = h('input', { class: 'text-input' });
    amount.type = 'number';
    amount.min = '1';
    amount.step = '1';
    amount.inputMode = 'numeric';
    amount.placeholder = `Münzen (du hast ${fmt(m.money)})`;
    amount.setAttribute('aria-label', 'Anzahl Münzen');
    const skinSel = h('select', { class: 'text-input' });
    for (const s of giftable) skinSel.append(h('option', {}, `${s.name}`), );
    skinSel.querySelectorAll('option').forEach((o, i) => (o.value = giftable[i]?.id ?? ''));
    const note = h('input', { class: 'text-input' });
    note.type = 'text';
    note.maxLength = 40;
    note.placeholder = 'Nachricht (optional)';
    note.setAttribute('aria-label', 'Nachricht');
    note.autocomplete = 'off';

    const create = this.btn('Geschenk erstellen', () => {
      const spec: GiftSpec =
        kind === 'coins' ? { kind: 'coins', amount: Number(amount.value), note: note.value } : { kind: 'skin', skin: skinSel.value, note: note.value };
      const label = kind === 'coins' ? `${fmt(Number(amount.value) || 0)} Münzen` : `Skin „${SKINS.find((s) => s.id === skinSel.value)?.name ?? ''}“`;
      if (!window.confirm(`${label} werden von deinem Konto abgebucht und in einen Code verpackt. Fortfahren?`)) return;
      const r = this.act.gifts.create(spec);
      if ('error' in r) {
        this.act.sfx('deny');
        this.showGifts(r.error, null, kind);
      } else {
        this.act.save();
        this.showGifts(null, r, kind);
      }
    }, 'primary');

    const redeemInput = h('input', { class: 'text-input' });
    redeemInput.type = 'text';
    redeemInput.placeholder = 'Code oder Link einfügen';
    redeemInput.setAttribute('aria-label', 'Geschenk-Code');
    redeemInput.autocomplete = 'off';

    const copy = (text: string, what: string): void => {
      void copyText(text).then((ok) => this.showGifts(ok ? `${what} kopiert.` : 'Kopieren nicht möglich – bitte den Code von Hand markieren.', created, kind));
    };
    const share = (c: { code: string; link: string; label: string }): void => {
      const text = `Ich schenke dir ${c.label} in Schacht!`;
      if (navigator.share) void navigator.share({ title: 'Schacht-Geschenk', text, url: c.link }).catch(() => undefined);
      else copy(`${text} ${c.link}`, 'Nachricht mit Link');
    };

    const card = created
      ? h(
          'div',
          { class: 'gift-card' },
          h('b', {}, `Geschenk bereit: ${created.label}`),
          h('span', {}, 'Schick den Link oder Code an deine Freundin / deinen Freund. Er ist bereits von deinem Konto abgebucht.'),
          h('textarea', { class: 'code-box' }, created.code),
          h('div', { class: 'acc-actions' }, this.btn('Link kopieren', () => copy(created.link, 'Link'), 'small primary'), this.btn('Code kopieren', () => copy(created.code, 'Code'), 'small'), this.btn('Teilen', () => share(created), 'small')),
        )
      : null;
    if (card) {
      const ta = card.querySelector('textarea');
      if (ta) {
        ta.readOnly = true;
        ta.rows = 3;
        ta.addEventListener('focus', () => ta.select());
      }
    }

    this.show(
      h('h2', {}, 'Geschenke'),
      h('p', { class: 'hint' }, 'Verschenke Münzen oder einen gekauften Skin per Link oder Code. Ein Code lässt sich pro Gerät nur einmal einlösen. Ohne Server kann ich nicht verhindern, dass jemand ihn weitergibt – verschick ihn nur an Leute, denen du vertraust.'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      card,
      h('h3', {}, 'Verschenken'),
      h('div', { class: 'btn-row' }, this.btn('Münzen', () => this.showGifts(null, created, 'coins'), kind === 'coins' ? 'small primary' : 'small'), this.btn('Skin', () => this.showGifts(null, created, 'skin'), kind === 'skin' ? 'small primary' : 'small')),
      kind === 'coins' ? amount : giftable.length > 0 ? skinSel : h('p', { class: 'hint' }, 'Du hast keinen gekauften Skin, den du verschenken könntest.'),
      note,
      kind === 'coins' || giftable.length > 0 ? create : null,
      h('h3', {}, 'Einlösen'),
      h('div', { class: 'new-account' }, redeemInput, this.btn('Einlösen', () => {
        const r = this.act.gifts.redeem(redeemInput.value);
        this.act.sfx('error' in r ? 'deny' : 'buy');
        this.showGifts('error' in r ? r.error : r.message, created, kind);
      }, 'small primary')),
      m.sentGifts.length > 0 ? h('h3', {}, 'Zuletzt verschenkt') : null,
      ...m.sentGifts.map((g: SentGift) =>
        h('div', { class: 'account' }, h('div', { class: 'info' }, h('b', {}, g.label), h('span', {}, new Date(g.created).toLocaleString('de-DE'))), this.btn('Link erneut kopieren', () => copy(this.act.gifts.link(g.code), 'Link'), 'small')),
      ),
      this.btn('Zurück', () => this.showMenu()),
    );
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
