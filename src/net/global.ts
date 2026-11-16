/** Globale Einstellungen vom Server: Erz-Multiplikator, Events und Nachrichten des Administrators (gelten für alle Spieler). */
import type { Api } from './api';

export interface GlobalEvent {
  id: string;
  name: string;
  /** 'ore' = Erzwert, 'speed' = Grabtempo */
  kind: 'ore' | 'speed';
  mult: number;
  /** Ende in Server-Zeit (ms) */
  endsAt: number;
}

export interface GlobalMessage {
  id: number;
  text: string;
  created: number;
}

export interface GlobalInfo {
  now: number;
  oreMult: number;
  speedMult: number;
  events: GlobalEvent[];
  message: GlobalMessage | null;
}

export interface Multipliers {
  ore: number;
  speed: number;
  /** Noch laufende Events (Server-Zeit `serverNow`). */
  events: GlobalEvent[];
}

/** Gesamtfaktoren: Grundwert × alle gerade laufenden Events der jeweiligen Art. */
export function multipliers(info: GlobalInfo | null, serverNow: number): Multipliers {
  if (!info) return { ore: 1, speed: 1, events: [] };
  const events = info.events.filter((e) => e.endsAt > serverNow);
  let ore = info.oreMult;
  let speed = info.speedMult;
  for (const e of events) {
    if (e.kind === 'ore') ore *= e.mult;
    else speed *= e.mult;
  }
  return { ore, speed, events };
}

const SEEN_KEY = 'schacht-seen-message';

/** Holt die globalen Einstellungen regelmäßig und merkt sich, welche Nachricht schon gezeigt wurde. */
export class GlobalFeed {
  info: GlobalInfo | null = null;
  /** Server-Zeit minus Gerätezeit. */
  private offset = 0;

  constructor(
    private readonly api: Api,
    private readonly store: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Aktuelle Server-Zeit (geschätzt). */
  serverNow(): number {
    return this.clock() + this.offset;
  }

  async refresh(): Promise<void> {
    const r = await this.api.global();
    if (!r.ok) return; // offline: letzten Stand behalten
    const d = r.data;
    if (typeof d.now !== 'number') return;
    this.offset = d.now - this.clock();
    this.info = {
      now: d.now,
      oreMult: typeof d.oreMult === 'number' ? d.oreMult : 1,
      speedMult: typeof d.speedMult === 'number' ? d.speedMult : 1,
      events: Array.isArray(d.events) ? d.events : [],
      message: d.message && typeof d.message.text === 'string' ? d.message : null,
    };
  }

  mult(): Multipliers {
    return multipliers(this.info, this.serverNow());
  }

  private seenId(): number {
    try {
      return Number(this.store?.getItem(SEEN_KEY) ?? '-1');
    } catch {
      return -1;
    }
  }

  /** Nachricht, die dieses Gerät noch nicht gesehen hat (beim allerersten Start nur, wenn sie jünger als ein Tag ist). */
  unseenMessage(): GlobalMessage | null {
    const m = this.info?.message;
    if (!m) return null;
    let seen = -1;
    let known = false;
    try {
      const raw = this.store?.getItem(SEEN_KEY);
      known = raw !== null && raw !== undefined;
      seen = this.seenId();
    } catch {
      /* Speicher nicht verfügbar */
    }
    if (!known && this.serverNow() - m.created > 86_400_000) return null;
    return m.id > seen ? m : null;
  }

  markSeen(id: number): void {
    try {
      this.store?.setItem(SEEN_KEY, String(id));
    } catch {
      /* Speicher nicht verfügbar */
    }
  }
}
