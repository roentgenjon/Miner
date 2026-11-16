import { SKINS, UPGRADES } from '../config';
import { fmtCoins, parseCoins } from '../format';
import { ACHIEVEMENTS } from '../meta/achievements';
import type { Meta } from '../meta/save';
import { describeApiError, type ApiResult } from '../net/api';
import { h, onEnter, plainInput } from './dom';

export interface AdminDeps {
  show(...content: (Node | null)[]): void;
  btn(label: string, onclick: () => void, cls?: string): HTMLButtonElement;
  back(): void;
  call<T = Record<string, any>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>>;
  meta(): Meta;
  save(): void;
}

interface Overview {
  now: number;
  users: number;
  gifts: number;
  global: { oreMult: number; speedMult: number; events: { id: string; name: string; kind: 'ore' | 'speed'; mult: number; endsAt: number }[]; messages: { id: number; text: string; created: number }[] };
  players: { name: string; created: number; updated: number; money: number; bestDepth: number; runs: number }[];
}

type Tab = 'global' | 'events' | 'message' | 'players' | 'self';
const TABS: [Tab, string][] = [
  ['global', 'Global'],
  ['events', 'Events'],
  ['message', 'Nachricht'],
  ['players', 'Spieler'],
  ['self', 'Mein Konto'],
];

/** Zahl für Multiplikatoren: „2,5“, „1e6“, „3k“, „1M“ … */
export function parseMult(text: string): number {
  const t = text.trim().replace(',', '.');
  if (/^(\d+\.?\d*|\.\d+)(e\d+)?$/i.test(t)) return Number(t);
  return parseCoins(text);
}

function input(placeholder: string, value = '', type = 'text'): HTMLInputElement {
  const el = h('input', { class: 'text-input' });
  el.type = type;
  el.placeholder = placeholder;
  el.value = value;
  el.autocomplete = 'off';
  el.setAttribute('aria-label', placeholder);
  plainInput(el);
  return el;
}

const mm = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)} h ` : ''}${Math.floor((s % 3600) / 60)} min`;
};

/** Verwaltungsbereich für den Administrator (Server prüft die Berechtigung bei jedem Aufruf). */
export class AdminPanel {
  private tab: Tab = 'global';
  private data: Overview | null = null;
  private notice: string | null = null;
  private busy = false;
  /** Gemeinsame Eingaben der Spieler-Seite bleiben beim Neuzeichnen erhalten. */
  private draft = { amount: '', skin: SKINS[0]?.id ?? 'miner', filter: '' };

  constructor(private readonly d: AdminDeps) {}

  open(): void {
    this.notice = null;
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.busy = true;
    this.render();
    const r = await this.d.call<Overview>('GET', 'overview');
    this.busy = false;
    if (r.ok) this.data = r.data;
    else this.notice = describeApiError(r.status, r.error, r.data);
    this.render();
  }

  /** Aufruf an den Server mit Meldung; danach neu laden. */
  private async act(method: 'GET' | 'POST', path: string, body: unknown, okText: string): Promise<boolean> {
    this.busy = true;
    this.render();
    const r = await this.d.call(method, path, body);
    this.notice = r.ok ? okText : describeApiError(r.status, r.error, r.data);
    await this.reload();
    return r.ok;
  }

  private render(): void {
    const tabs = h('div', { class: 'btn-row tabs' }, ...TABS.map(([id, label]) => this.d.btn(label, () => ((this.tab = id), (this.notice = null), this.render()), `small${this.tab === id ? ' primary' : ''}`)));
    const body = h('div', { class: 'admin-body' });
    if (this.tab === 'self') body.append(...this.selfTab());
    else if (!this.data) body.append(h('p', { class: 'notice' }, this.busy ? '⏳ Lade …' : 'Keine Daten.'));
    else if (this.tab === 'global') body.append(...this.globalTab(this.data));
    else if (this.tab === 'events') body.append(...this.eventsTab(this.data));
    else if (this.tab === 'message') body.append(...this.messageTab(this.data));
    else body.append(...this.playersTab(this.data));
    this.d.show(
      h('h2', {}, 'Admin'),
      this.data ? h('p', { class: 'hint' }, `${this.data.users} Spieler online registriert · ${this.data.gifts} Geschenke`) : null,
      tabs,
      this.busy ? h('p', { class: 'notice' }, '⏳ Bitte warten …') : null,
      this.notice ? h('p', { class: 'notice' }, this.notice) : null,
      body,
      this.d.btn('Zurück', () => this.d.back()),
    );
  }

  /* ---------- Global ---------- */

  private globalTab(o: Overview): Node[] {
    const ore = input('Erz-Multiplikator', String(o.global.oreMult));
    const speed = input('Grabtempo-Multiplikator', String(o.global.speedMult));
    const apply = (): void => {
      const a = parseMult(ore.value);
      const b = parseMult(speed.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        this.notice = 'Bitte gültige Zahlen eingeben (z. B. 2, 2,5, 1e6, 3K).';
        return this.render();
      }
      void this.act('POST', 'global', { oreMult: a, speedMult: b }, `Gespeichert: Erz ×${fmtCoins(a)} · Tempo ×${fmtCoins(b)} – gilt für alle Spieler.`);
    };
    onEnter(ore, apply);
    onEnter(speed, apply);
    return [
      h('h3', {}, 'Globale Multiplikatoren'),
      h('p', { class: 'hint' }, 'Gelten sofort für alle Spieler (sie holen sich den Wert etwa alle 30 Sekunden). 1 = normal, 0 = Erze wertlos.'),
      h('label', { class: 'hint' }, 'Erzwert ×'),
      ore,
      h('label', { class: 'hint' }, 'Grabtempo ×'),
      speed,
      h('div', { class: 'btn-row' }, this.d.btn('Speichern', apply, 'primary'), this.d.btn('Zurücksetzen (×1)', () => void this.act('POST', 'global', { oreMult: 1, speedMult: 1 }, 'Zurückgesetzt: alles ×1.'), 'small')),
      h('p', { class: 'hint' }, `Aktuell: Erz ×${fmtCoins(o.global.oreMult)} · Tempo ×${fmtCoins(o.global.speedMult)}`),
    ];
  }

  /* ---------- Events ---------- */

  private eventsTab(o: Overview): Node[] {
    const name = input('Name, z. B. Goldrausch', 'Goldrausch');
    name.maxLength = 40;
    const kind = h('select', { class: 'text-input' });
    for (const [v, l] of [['ore', 'Erzwert'], ['speed', 'Grabtempo']] as const) {
      const op = h('option', {}, l);
      op.value = v;
      kind.append(op);
    }
    const mult = input('Faktor, z. B. 2', '2');
    const minutes = input('Dauer in Minuten', '30');
    const start = (): void => {
      const m = parseMult(mult.value);
      const min = Number(minutes.value.replace(',', '.'));
      if (!name.value.trim() || !Number.isFinite(m) || !Number.isFinite(min)) {
        this.notice = 'Bitte Name, Faktor und Dauer ausfüllen.';
        return this.render();
      }
      void this.act('POST', 'event', { name: name.value, kind: kind.value, mult: m, minutes: min }, `Event „${name.value.trim()}“ läuft: ×${fmtCoins(m)} für ${min} min.`);
    };
    const list = o.global.events;
    const out: (Node | null)[] = [
      h('h3', {}, 'Event starten'),
      h('p', { class: 'hint' }, 'Zeitlich begrenzter Multiplikator für alle Spieler. Mehrere Events gleicher Art werden multipliziert.'),
      name,
      kind,
      mult,
      minutes,
      this.d.btn('Event starten', start, 'primary'),
      h('h3', {}, `Laufende Events (${list.length})`),
      ...(list.length === 0
        ? [h('p', { class: 'hint' }, 'Gerade läuft kein Event.')]
        : list.map((e) =>
            h(
              'div',
              { class: 'account' },
              h('div', { class: 'info' }, h('b', {}, `${e.name} · ${e.kind === 'ore' ? 'Erzwert' : 'Tempo'} ×${fmtCoins(e.mult)}`), h('span', {}, `noch ${mm(e.endsAt - o.now)}`)),
              this.d.btn('Beenden', () => void this.act('POST', 'event/stop', { id: e.id }, `Event „${e.name}“ beendet.`), 'small'),
            ),
          )),
      list.length > 0 ? this.d.btn('Alle beenden', () => void this.act('POST', 'event/stop', { all: true }, 'Alle Events beendet.'), 'small') : null,
    ];
    return out.filter((n): n is Node => n !== null);
  }

  /* ---------- Nachricht ---------- */

  private messageTab(o: Overview): Node[] {
    const text = h('textarea', { class: 'text-input' });
    text.maxLength = 300;
    text.rows = 4;
    text.placeholder = 'Nachricht an alle Spieler (höchstens 300 Zeichen)';
    text.setAttribute('aria-label', 'Nachricht');
    const send = (): void => {
      if (!text.value.trim()) {
        this.notice = 'Bitte eine Nachricht eingeben.';
        return this.render();
      }
      if (!window.confirm('Diese Nachricht jetzt als Pop-up an ALLE Spieler schicken?')) return;
      void this.act('POST', 'broadcast', { text: text.value }, 'Gesendet – alle Spieler sehen sie beim nächsten Abruf (etwa 30 Sekunden).');
    };
    const msgs = [...o.global.messages].reverse();
    return [
      h('h3', {}, 'Nachricht an alle'),
      h('p', { class: 'hint' }, 'Erscheint bei jedem Spieler einmal als Pop-up (auch ohne Online-Konto).'),
      text,
      this.d.btn('An alle senden', send, 'primary'),
      h('h3', {}, `Letzte Nachrichten (${msgs.length})`),
      ...(msgs.length === 0
        ? [h('p', { class: 'hint' }, 'Noch keine Nachrichten.')]
        : msgs.map((m) =>
            h(
              'div',
              { class: 'account' },
              h('div', { class: 'info' }, h('b', {}, `#${m.id} · ${new Date(m.created).toLocaleString('de-DE')}`), h('span', {}, m.text)),
              this.d.btn('Löschen', () => void this.act('POST', 'message/delete', { id: m.id }, `Nachricht #${m.id} gelöscht.`), 'small'),
            ),
          )),
    ];
  }

  /* ---------- Spieler ---------- */

  private playersTab(o: Overview): Node[] {
    const amount = input('Münzen, z. B. 5K, 2,5M, 1QA', this.draft.amount);
    const skin = h('select', { class: 'text-input' });
    for (const s of SKINS) {
      const op = h('option', {}, s.name);
      op.value = s.id;
      skin.append(op);
    }
    skin.value = this.draft.skin;
    const filter = input('Spieler suchen …', this.draft.filter);
    const keep = (): void => {
      this.draft = { amount: amount.value, skin: skin.value, filter: filter.value };
    };
    amount.addEventListener('input', keep);
    skin.addEventListener('change', keep);
    filter.addEventListener('input', () => {
      keep();
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...rows(q));
    });
    const amt = (): number | null => {
      const v = parseCoins(amount.value);
      if (!Number.isFinite(v)) {
        this.notice = 'Bitte eine Münzmenge eingeben (z. B. 5K, 2,5M).';
        this.render();
        return null;
      }
      return v;
    };
    const user = (name: string, action: string, extra: Record<string, unknown>, ok: string): void => void this.act('POST', 'user', { name, action, ...extra }, ok);
    const rows = (q: string): Node[] =>
      o.players
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) =>
          h(
            'div',
            { class: 'account admin-player' },
            h('div', { class: 'info' }, h('b', {}, p.name), h('span', {}, `● ${fmtCoins(p.money)} · Rekord ${fmtCoins(p.bestDepth)} m · ${p.runs} Runden`)),
            h(
              'div',
              { class: 'btn-row wrap' },
              this.d.btn('+ Münzen', () => ((v) => v !== null && user(p.name, 'giveCoins', { amount: v }, `${p.name}: + ${fmtCoins(v)} Münzen.`))(amt()), 'small'),
              this.d.btn('Münzen = …', () => ((v) => v !== null && user(p.name, 'setCoins', { amount: v }, `${p.name}: Münzen gesetzt auf ${fmtCoins(v)}.`))(amt()), 'small'),
              this.d.btn('Skin geben', () => user(p.name, 'giveSkin', { skin: skin.value }, `${p.name}: Skin „${SKINS.find((s) => s.id === skin.value)?.name ?? skin.value}“ vergeben.`), 'small'),
              this.d.btn('Passwort neu', () => {
                const pw = window.prompt(`Neues Passwort für „${p.name}“ (mindestens 8 Zeichen):`);
                if (pw) user(p.name, 'resetPassword', { password: pw }, `${p.name}: Passwort geändert, alle Geräte abgemeldet.`);
              }, 'small'),
              this.d.btn('Abmelden', () => user(p.name, 'logout', {}, `${p.name}: überall abgemeldet.`), 'small'),
              this.d.btn('Löschen', () => {
                if (window.confirm(`„${p.name}“ samt Spielstand und Geschenken endgültig löschen?`)) user(p.name, 'delete', {}, `${p.name} gelöscht.`);
              }, 'small danger'),
            ),
          ),
        );
    const list = h('div', { class: 'admin-list' }, ...rows(this.draft.filter.trim().toLowerCase()));
    return [
      h('h3', {}, `Spieler (${o.players.length}${o.users > o.players.length ? ` von ${o.users}` : ''})`),
      h('p', { class: 'hint' }, 'Menge und Skin oben einstellen, dann bei einem Spieler auf die Aktion tippen. Änderungen erscheinen beim Spieler nach dem nächsten Abgleich.'),
      amount,
      skin,
      filter,
      list,
    ];
  }

  /* ---------- Eigenes Konto (nur auf diesem Gerät) ---------- */

  private selfTab(): Node[] {
    const m = this.d.meta();
    const amount = input('Münzen, z. B. 5K, 2,5M, 1QA', this.draft.amount);
    amount.addEventListener('input', () => (this.draft.amount = amount.value));
    const done = (text: string): void => {
      this.d.save();
      this.notice = text;
      this.render();
    };
    const need = (): number | null => {
      const v = parseCoins(amount.value);
      if (!Number.isFinite(v)) {
        this.notice = 'Bitte eine Münzmenge eingeben (z. B. 5K, 2,5M).';
        this.render();
        return null;
      }
      return v;
    };
    return [
      h('h3', {}, 'Dieses Konto'),
      h('p', { class: 'hint' }, `● ${fmtCoins(m.money)} · Rekord ${fmtCoins(m.bestDepth)} m · ${m.runs} Runden. Änderungen gelten für dieses Gerät und werden online gesichert, wenn du angemeldet bist.`),
      amount,
      h(
        'div',
        { class: 'btn-row wrap' },
        this.d.btn('+ Münzen', () => ((v) => v !== null && ((m.money = Math.min(1e60, m.money + v)), done(`+ ${fmtCoins(v)} Münzen.`)))(need()), 'small'),
        this.d.btn('Münzen = …', () => ((v) => v !== null && ((m.money = Math.min(1e60, v)), done(`Münzen: ${fmtCoins(v)}.`)))(need()), 'small'),
        this.d.btn('Rekord = …', () => ((v) => v !== null && ((m.bestDepth = v), done(`Rekord: ${fmtCoins(v)} m.`)))(need()), 'small'),
      ),
      h(
        'div',
        { class: 'btn-row wrap' },
        this.d.btn('Alle Upgrades max', () => {
          for (const u of UPGRADES) m.upgrades[u.id] = u.maxLevel;
          done('Alle Upgrades auf Höchststufe.');
        }, 'small'),
        this.d.btn('Upgrades zurücksetzen', () => {
          if (!window.confirm('Alle Upgrades dieses Kontos auf Stufe 0 setzen?')) return;
          for (const u of UPGRADES) m.upgrades[u.id] = 0;
          done('Upgrades zurückgesetzt.');
        }, 'small'),
        this.d.btn('Alle Skins', () => {
          m.skins = SKINS.map((s) => s.id);
          done('Alle Skins freigeschaltet.');
        }, 'small'),
        this.d.btn('Alle Erfolge', () => {
          for (const a of ACHIEVEMENTS) if (m.achievements[a.id] === undefined) m.achievements[a.id] = Date.now();
          done('Alle Erfolge freigeschaltet.');
        }, 'small'),
      ),
    ];
  }
}
