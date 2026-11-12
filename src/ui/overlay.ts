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
import type { GiftBody, InboxGift } from '../net/api';
import type { SignInOutcome, SyncState } from '../net/sync';
import { copyText, fmt, h, onEnter, plainInput } from './dom';
import { fmtCoins } from '../format';

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
  cloud: {
    info(): { state: SyncState; name: string | null };
    /** Konto-Kennung -> Name des verbundenen Online-Kontos. */
    linked(): Record<string, string>;
    signIn(mode: 'login' | 'register', name: string, password: string): Promise<SignInOutcome>;
    /** Online-Stand, der bei einer Auswahl oder einem Konflikt vorliegt. */
    pending(): { meta: Meta; version: number } | null;
    adopt(): string | null;
    push(): Promise<string | null>;
    resolve(choice: 'cloud' | 'local'): Promise<string | null>;
    signOut(): Promise<void>;
    pull(): Promise<string | null>;
    send(body: GiftBody): Promise<{ error: string } | { message: string }>;
    inbox(): Promise<{ error: string } | { gifts: InboxGift[] }>;
    claim(id: string): Promise<{ error: string } | { message: string }>;
  };
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
        h('div', {}, h('b', {}, `● ${fmtCoins(m.money)}`), h('span', {}, 'Münzen')),
        h('div', {}, h('b', {}, `${fmt(m.bestDepth)} m`), h('span', {}, 'Rekord')),
        h('div', {}, h('b', {}, `${Object.keys(m.achievements).length}/${ACHIEVEMENTS.length}`), h('span', {}, 'Erfolge')),
      ),
      this.btn('Neuer Schacht', () => this.act.startRun(false), 'primary'),
      this.btn(`Tagesschacht · ${new Date().toLocaleDateString('de-DE')}`, () => this.act.startRun(true)),
      h('p', { class: 'hint' }, dailyBest > 0 ? `Heute bisher: ${dailyBest} m` : 'Gleicher Schacht für alle – pro Tag neu.'),
      h('div', { class: 'btn-row' }, this.btn('Werkstatt', () => this.showShop()), this.btn('Erfolge', () => this.showTrophies())),
      h('div', { class: 'btn-row' }, this.btn('Skins', () => this.showSkins()), this.btn('Geschenke', () => this.showGifts())),
      h('div', { class: 'btn-row' }, this.btn(`Konto: ${activeAccount(this.act.accounts.list()).name}`, () => this.showAccounts(), 'small'), this.soundBtn()),
      (() => {
        const c = this.act.cloud.info();
        return c.state === 'synced' || c.state === 'dirty' ? h('p', { class: 'hint' }, `Online als ${c.name ?? ''}${c.state === 'synced' ? ' ✓' : ' …'}`) : null;
      })(),
      this.btn('Update erzwingen', () => this.act.forceUpdate(), 'small'),
      h('p', { class: 'hint keys' }, '← → ↓ ↑ / A D S W graben & klettern · Leertaste: Dynamit · P / Esc: Pause · Wischen oder Tippen am Handy'),
      h('p', { class: 'hint keys' }, `Version ${__BUILD__}`),
    );
  }

  showShop(): void {
    const m = this.meta();
    const list = h('div', { class: 'shop-list' });
    const money = h('b', {}, `● ${fmtCoins(m.money)}`);

    const render = (): void => {
      money.textContent = `● ${fmtCoins(this.meta().money)}`;
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
              : buyBtn(`● ${fmtCoins(cost)}`, 1, ''),
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
            h('div', { class: 'info' }, h('b', {}, `${u.name}  ${lvl < 1e6 ? lvl.toLocaleString("de-DE") : fmtCoins(lvl)}/${fmtCoins(u.maxLevel)}`), h('span', {}, u.desc), bar, h('em', {}, describeLevel(u.id, lvl) + (maxed ? '' : `  →  ${describeLevel(u.id, lvl + 1)}`))),
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

  showGifts(msg: string | null = null, created: { code: string; link: string; label: string } | null = null, kind: 'coins' | 'skin' = 'coins', via: 'code' | 'online' = 'code'): void {
    const m = this.meta();
    const giftable = SKINS.filter((s) => s.cost > 0 && !s.achievement && m.skins.includes(s.id));
    const cloud = this.act.cloud.info();
    const online = cloud.state === 'synced' || cloud.state === 'dirty';
    const go = (message: string | null, c: typeof created = created, k: typeof kind = kind, v: typeof via = via): void => this.showGifts(message, c, k, v);

    const amount = h('input', { class: 'text-input' });
    amount.type = 'number';
    amount.min = '1';
    amount.step = '1';
    amount.inputMode = 'numeric';
    amount.placeholder = `Münzen (du hast ${fmtCoins(m.money)})`;
    amount.setAttribute('aria-label', 'Anzahl Münzen');
    const skinSel = h('select', { class: 'text-input' });
    for (const s of giftable) {
      const opt = h('option', {}, s.name);
      opt.value = s.id;
      skinSel.append(opt);
    }
    const note = h('input', { class: 'text-input' });
    note.type = 'text';
    note.maxLength = 40;
    note.placeholder = 'Nachricht (optional)';
    note.setAttribute('aria-label', 'Nachricht');
    note.autocomplete = 'off';
    const recipient = h('input', { class: 'text-input' });
    recipient.type = 'text';
    recipient.maxLength = 16;
    recipient.placeholder = 'Name des Spielers';
    recipient.setAttribute('aria-label', 'Name des Empfängers');
    recipient.autocomplete = 'off';
    plainInput(recipient);

    const labelOf = (): string => (kind === 'coins' ? `${fmtCoins(Number(amount.value) || 0)} Münzen` : `Skin „${SKINS.find((s) => s.id === skinSel.value)?.name ?? ''}“`);

    const create = this.btn('Geschenk erstellen', () => {
      const spec: GiftSpec =
        kind === 'coins' ? { kind: 'coins', amount: Number(amount.value), note: note.value } : { kind: 'skin', skin: skinSel.value, note: note.value };
      if (!window.confirm(`${labelOf()} werden von deinem Konto abgebucht und in einen Code verpackt. Fortfahren?`)) return;
      const r = this.act.gifts.create(spec);
      if ('error' in r) {
        this.act.sfx('deny');
        go(r.error);
      } else {
        this.act.save();
        go(null, r);
      }
    }, 'primary');

    const sendOnline = this.btn('An Spieler schicken', () => {
      const to = recipient.value.trim();
      if (!to) return go('Bitte den Namen des Spielers eingeben.');
      if (!window.confirm(`${labelOf()} an „${to}“ schicken? Es wird sofort von deinem Konto abgebucht.`)) return;
      const body: GiftBody =
        kind === 'coins' ? { to, kind: 'coins', amount: Number(amount.value), note: note.value } : { to, kind: 'skin', skin: skinSel.value, note: note.value };
      sendOnline.disabled = true;
      void this.act.cloud.send(body).then((r) => {
        this.act.sfx('error' in r ? 'deny' : 'buy');
        go('error' in r ? r.error : r.message);
      });
    }, 'primary');

    const redeemInput = h('input', { class: 'text-input' });
    redeemInput.type = 'text';
    redeemInput.placeholder = 'Code oder Link einfügen';
    redeemInput.setAttribute('aria-label', 'Geschenk-Code');
    redeemInput.autocomplete = 'off';
    plainInput(redeemInput);
    onEnter(recipient, () => (kind === 'coins' ? amount : note).focus());

    const copy = (text: string, what: string): void => {
      void copyText(text).then((ok) => go(ok ? `${what} kopiert.` : 'Kopieren nicht möglich – bitte den Code von Hand markieren.'));
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

    // Posteingang (Geschenke von anderen Spielern): wird nachgeladen
    const inboxBox = h('div', { class: 'inbox' });
    if (online) {
      void this.act.cloud.inbox().then((r) => {
        if ('error' in r) return;
        if (r.gifts.length === 0) {
          inboxBox.replaceChildren(h('p', { class: 'hint' }, 'Dein Posteingang ist leer.'));
          return;
        }
        inboxBox.replaceChildren(
          ...r.gifts.map((g) =>
            h(
              'div',
              { class: 'gift-card' },
              h('b', {}, g.kind === 'coins' ? `● ${fmtCoins(g.amount ?? 0)} Münzen` : `Skin „${SKINS.find((s) => s.id === g.skin)?.name ?? g.skin}“`),
              h('span', {}, `von ${g.from}`),
              g.note ? h('em', {}, `„${g.note}“`) : null,
              this.btn('Annehmen', () => {
                void this.act.cloud.claim(g.id).then((res) => {
                  this.act.sfx('error' in res ? 'deny' : 'buy');
                  go('error' in res ? res.error : res.message);
                });
              }, 'small primary'),
            ),
          ),
        );
      });
    }

    this.show(
      h('h2', {}, 'Geschenke'),
      h('p', { class: 'hint' }, 'Verschenke Münzen oder einen gekauften Skin: an einen Spieler mit Online-Konto direkt, oder per Link/Code an alle anderen.'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      online ? h('h3', {}, 'Posteingang') : null,
      online ? inboxBox : null,
      card,
      h('h3', {}, 'Verschenken'),
      h('div', { class: 'btn-row' }, this.btn('Münzen', () => go(null, created, 'coins'), kind === 'coins' ? 'small primary' : 'small'), this.btn('Skin', () => go(null, created, 'skin'), kind === 'skin' ? 'small primary' : 'small')),
      h('div', { class: 'btn-row' }, this.btn('An Spieler (online)', () => go(null, created, kind, 'online'), via === 'online' ? 'small primary' : 'small'), this.btn('Per Code / Link', () => go(null, created, kind, 'code'), via === 'code' ? 'small primary' : 'small')),
      via === 'online' && !online ? h('p', { class: 'hint' }, 'Dafür brauchst du ein verbundenes Online-Konto – und der Empfänger auch. Gib schon mal den Namen ein; zum Abschicken verbindest du dein Konto kurz.') : null,
      via === 'online' ? recipient : null,
      kind === 'coins' ? amount : giftable.length > 0 ? skinSel : h('p', { class: 'hint' }, 'Du hast keinen gekauften Skin, den du verschenken könntest.'),
      note,
      kind === 'coins' || giftable.length > 0
        ? via === 'online'
          ? online
            ? sendOnline
            : this.btn('Online-Konto verbinden …', () => this.showAccounts(), 'primary')
          : create
        : null,
      via === 'code' ? h('p', { class: 'hint' }, 'Ein Code lässt sich pro Gerät nur einmal einlösen, ist aber nicht an eine Person gebunden – verschick ihn nur an Leute, denen du vertraust.') : null,
      h('h3', {}, 'Code einlösen'),
      h('div', { class: 'new-account' }, redeemInput, this.btn('Einlösen', () => {
        const r = this.act.gifts.redeem(redeemInput.value);
        this.act.sfx('error' in r ? 'deny' : 'buy');
        go('error' in r ? r.error : r.message);
      }, 'small primary')),
      m.sentGifts.length > 0 ? h('h3', {}, 'Zuletzt per Code verschenkt') : null,
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
      money.textContent = `● ${fmtCoins(m.money)}`;
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
            label = `● ${fmtCoins(skin.cost)}`;
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

  showAccounts(msg: string | null = null, focusOnline = false): void {
    const idx = this.act.accounts.list();
    const input = h('input', { class: 'text-input' });
    input.type = 'text';
    input.maxLength = ACCOUNTS.nameMax;
    input.placeholder = 'Name des neuen Kontos';
    input.setAttribute('aria-label', 'Name des neuen Kontos');
    input.autocomplete = 'off';
    plainInput(input, 'words');
    const file = h('input', {});
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((text) => this.showAccounts(this.act.accounts.importText(text) ?? 'Konto importiert.'));
    });
    const createLocal = (): void => this.showAccounts(this.act.accounts.create(input.value) ?? 'Konto angelegt.');
    onEnter(input, createLocal);
    const linked = this.act.cloud.linked();
    const rows = idx.accounts.map((a) => {
      const m = this.act.accounts.peek(a.id);
      const active = a.id === idx.active;
      const onlineName = linked[a.id];
      return h(
        'div',
        { class: `account ${active ? 'active' : ''}` },
        h('div', { class: 'info' }, h('b', {}, `${a.name}${active ? '  (aktiv)' : ''}`), h('span', {}, `● ${fmtCoins(m.money)} · Rekord ${fmt(m.bestDepth)} m · ${m.runs} Runden`), h('span', {}, onlineName ? `☁ online als ${onlineName}` : 'nur auf diesem Gerät')),
        h(
          'div',
          { class: 'acc-actions' },
          onlineName
            ? null
            : this.btn('Online machen …', () => {
                // Das (alte) Konto aktivieren und den Bildschirm zum Online-Machen zeigen.
                if (!active) this.act.accounts.switchTo(a.id);
                this.showGoOnline();
              }, 'small primary'),
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
      h('p', { class: 'hint' }, 'Konten liegen zunächst nur auf diesem Gerät. Mit einem Online-Konto wird der Spielstand des aktiven Kontos online gesichert, und du kannst Spielern Geschenke schicken.'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      this.onlineBox(),
      h('div', { class: 'account-list' }, ...rows),
      h('div', { class: 'new-account' }, input, this.btn('Anlegen', createLocal, 'small primary')),
      this.btn('Konto importieren (Datei)', () => file.click(), 'small'),
      file,
      this.btn('Zurück', () => this.showMenu()),
    );
      if (focusOnline) this.root.querySelector('.online-box')?.scrollIntoView({ block: 'center' });
  }

  /** Meldet das aktive Konto beim Server an oder registriert es und sagt, wie es weitergeht. */
  private async connect(
    mode: 'login' | 'register',
    name: string,
    password: string,
  ): Promise<{ kind: 'done'; message: string } | { kind: 'choice' } | { kind: 'error'; message: string }> {
    const r = await this.act.cloud.signIn(mode, name, password);
    if (!r.ok) return { kind: 'error', message: r.message };
    const online = this.act.cloud.info().name ?? name.trim();
    if (r.plan === 'upload') {
      const e = await this.act.cloud.push();
      return e
        ? { kind: 'error', message: `Verbunden, aber das Hochladen hat nicht geklappt: ${e}` }
        : { kind: 'done', message: `Dein Spielstand ist jetzt online gesichert – als „${online}“.` };
    }
    if (r.plan === 'adopt') {
      const e = this.act.cloud.adopt();
      return e ? { kind: 'error', message: e } : { kind: 'done', message: `Online-Konto „${online}“ verbunden, sein Spielstand wurde geladen.` };
    }
    return { kind: 'choice' };
  }

  /** Eigener Bildschirm: ein (altes) lokales Konto online machen – mit klaren Schritten und sichtbarem Fortschritt. */
  showGoOnline(msg: string | null = null, prefill = ''): void {
    const acc = activeAccount(this.act.accounts.list());
    const m = this.meta();
    const name = h('input', { class: 'text-input' });
    name.type = 'text';
    name.maxLength = 16;
    name.placeholder = 'Online-Name (3–16 Zeichen)';
    name.autocomplete = 'username';
    name.value = prefill;
    name.setAttribute('aria-label', 'Online-Name');
    plainInput(name);
    const pw = h('input', { class: 'text-input' });
    pw.type = 'password';
    pw.maxLength = 128;
    pw.placeholder = 'Passwort (mind. 8 Zeichen)';
    pw.autocomplete = 'current-password';
    pw.setAttribute('aria-label', 'Passwort');
    plainInput(pw);

    const busy = h('p', { class: 'notice' }, '⏳ Verbinde mit dem Server … (kann ein paar Sekunden dauern)');
    busy.hidden = true;
    const buttons: HTMLButtonElement[] = [];
    const go = (mode: 'login' | 'register'): void => {
      if (!name.value.trim() || !pw.value) return this.showGoOnline('Bitte Online-Name und Passwort eingeben.', name.value);
      busy.hidden = false;
      buttons.forEach((b) => (b.disabled = true));
      void this.connect(mode, name.value, pw.value).then((r) => {
        if (r.kind === 'error') return this.showGoOnline(r.message, name.value);
        if (r.kind === 'choice') return this.showCloudChoice();
        this.showOnlineDone(r.message);
      });
    };
    onEnter(name, () => pw.focus());
    onEnter(pw, () => go('register'));
    const reg = this.btn('Neu registrieren', () => go('register'), 'primary');
    const login = this.btn('Ich habe schon ein Online-Konto: Anmelden', () => go('login'), 'small');
    buttons.push(reg, login);

    this.show(
      h('h2', {}, `„${acc.name}“ online machen`),
      h('div', { class: 'gift-card' }, h('b', {}, acc.name), h('span', {}, `● ${fmtCoins(m.money)} · Rekord ${fmt(m.bestDepth)} m · ${m.runs} Runden`), h('span', {}, 'Dieser Spielstand wird online gesichert.')),
      h('p', { class: 'hint' }, '1. Denk dir einen Online-Namen und ein Passwort aus. 2. Tippe auf „Neu registrieren“. Erst dann ist das Konto online.'),
      msg ? h('p', { class: 'notice' }, msg) : null,
      name,
      pw,
      busy,
      reg,
      login,
      h('p', { class: 'hint' }, 'Das Passwort kann nicht zurückgesetzt werden – merk es dir gut. Der Name ist für andere sichtbar (Geschenke).'),
      this.btn('Zurück', () => this.showAccounts()),
    );
  }

  /** Bestätigung nach erfolgreichem Verbinden. */
  showOnlineDone(message: string): void {
    const info = this.act.cloud.info();
    this.show(
      h('h2', { class: 'win' }, '✓ Online!'),
      h('div', { class: 'gift-card' }, h('b', {}, info.name ?? ''), h('span', {}, message)),
      h('p', { class: 'hint' }, 'Von jetzt an wird der Spielstand automatisch gesichert, und du kannst Spielern Geschenke schicken. In der Kontenliste steht das Konto jetzt mit „☁ online“.'),
      this.btn('Weiter', () => this.showAccounts(), 'primary'),
    );
  }

  /** Bereich „Online-Konto“ im Konten-Bildschirm. */
  private onlineBox(): Node {
    const info = this.act.cloud.info();
    const status: Record<SyncState, string> = {
      off: '',
      synced: '✓ Online gesichert',
      dirty: '⏳ Änderungen werden gleich gesichert …',
      conflict: '⚠ Konflikt: Online- und Gerätestand sind verschieden',
      expired: '✕ Sitzung abgelaufen – bitte neu anmelden',
    };
    if (info.state === 'off' || info.state === 'expired') {
      const name = h('input', { class: 'text-input' });
      name.type = 'text';
      name.maxLength = 16;
      name.placeholder = 'Online-Name';
      name.autocomplete = 'username';
      name.setAttribute('aria-label', 'Online-Name');
      plainInput(name);
      const pw = h('input', { class: 'text-input' });
      pw.type = 'password';
      pw.maxLength = 128;
      pw.placeholder = 'Passwort (mind. 8 Zeichen)';
      pw.autocomplete = 'current-password';
      pw.setAttribute('aria-label', 'Passwort');
      plainInput(pw);
      onEnter(name, () => pw.focus());
      onEnter(pw, () => submit('login'));
      const submit = (mode: 'login' | 'register'): void => {
        if (!name.value.trim() || !pw.value) return this.showAccounts('Bitte Online-Name und Passwort eingeben.');
        const btns = box.querySelectorAll('button');
        btns.forEach((b) => (b.disabled = true));
        busy.hidden = false;
        void this.connect(mode, name.value, pw.value).then((r) => {
          if (r.kind === 'error') return this.showAccounts(r.message);
          if (r.kind === 'choice') return this.showCloudChoice();
          this.showOnlineDone(r.message);
        });
      };
      const busy = h('p', { class: 'notice' }, '⏳ Verbinde mit dem Server …');
      busy.hidden = true;
      const box = h(
        'div',
        { class: 'online-box' },
        h('h3', {}, 'Online-Konto'),
        h('p', { class: 'hint' }, `Das Konto „${this.act.accounts.list().accounts.find((a) => a.id === this.act.accounts.list().active)?.name ?? ''}“ wird online gesichert.`),
        info.state === 'expired' ? h('p', { class: 'notice' }, status.expired) : null,
        h('div', { class: 'new-account' }, name),
        h('div', { class: 'new-account' }, pw),
        busy,
        h('div', { class: 'btn-row' }, this.btn('Anmelden', () => submit('login'), 'small primary'), this.btn('Neu registrieren', () => submit('register'), 'small')),
        h('p', { class: 'hint' }, 'Das Passwort kann nicht zurückgesetzt werden – merk es dir gut. Der Name ist für andere sichtbar (Geschenke).'),
      );
      return box;
    }
    return h(
      'div',
      { class: 'online-box' },
      h('h3', {}, 'Online-Konto'),
      h('div', { class: 'account active' }, h('div', { class: 'info' }, h('b', {}, info.name ?? ''), h('span', {}, status[info.state]))),
      info.state === 'conflict'
        ? this.btn('Konflikt lösen …', () => this.showCloudChoice(), 'small primary')
        : this.btn('Jetzt sichern und prüfen', () => void this.act.cloud.push().then(async (e) => this.showAccounts(e ?? ((await this.act.cloud.pull()) ?? 'Alles synchron.'))), 'small'),
      this.btn('Abmelden', () => void this.act.cloud.signOut().then(() => this.showAccounts('Online-Konto abgemeldet. Dein Gerätestand bleibt erhalten.')), 'small'),
    );
  }

  /** Auswahl bei abweichenden Ständen: Gerät oder Online? Zeigt beide nebeneinander. */
  showCloudChoice(): void {
    const online = this.act.cloud.pending();
    const dev = this.meta();
    const summary = (m: Meta): string => `● ${fmtCoins(m.money)} · Rekord ${fmt(m.bestDepth)} m · ${m.runs} Runden`;
    this.show(
      h('h2', {}, 'Welcher Stand gilt?'),
      h('p', { class: 'hint' }, 'Auf diesem Gerät und online liegt ein unterschiedlicher Spielstand. Einer ersetzt den anderen – das lässt sich nicht rückgängig machen.'),
      h('div', { class: 'gift-card' }, h('b', {}, 'Dieses Gerät'), h('span', {}, summary(dev)),
        this.btn('Gerätestand behalten und hochladen', () => void this.act.cloud.resolve('local').then((e) => this.showAccounts(e ?? 'Gerätestand ist jetzt online.')), 'small primary')),
      online
        ? h('div', { class: 'gift-card' }, h('b', {}, 'Online'), h('span', {}, summary(online.meta)),
            this.btn('Online-Stand laden', () => void this.act.cloud.resolve('cloud').then((e) => this.showAccounts(e ?? 'Online-Stand geladen.')), 'small primary'))
        : h('p', { class: 'notice' }, 'Der Online-Stand konnte nicht gelesen werden. Bitte später erneut versuchen.'),
      this.btn('Später entscheiden', () => this.showAccounts()),
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
        h('p', {}, `Verdient: ● ${fmtCoins(s.wallet)}`, s.status === 'dead' ? ` → gutgeschrieben ● ${fmtCoins(r.banked)}` : ''),
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
