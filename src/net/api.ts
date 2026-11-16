/** Client für den Schacht-Server (siehe server/). Alle Aufrufe liefern ein Ergebnis-Objekt, nie eine Ausnahme. */

/** Adresse des Servers; beim Bauen mit VITE_API_URL überschreibbar. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://schacht-api.jonathanrontgen7.workers.dev';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; data?: Record<string, unknown> };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface InboxGift {
  id: string;
  kind: 'coins' | 'skin';
  amount: number | null;
  skin: string | null;
  note: string | null;
  created: number;
  from: string;
}

export interface SaveReply {
  save: unknown;
  version: number;
  updated: number;
}

export type GiftBody = { to: string; kind: 'coins'; amount: number; note?: string } | { to: string; kind: 'skin'; skin: string; note?: string };

export interface Api {
  /** Globale Multiplikatoren/Events/Nachricht (ohne Anmeldung). */
  global(): Promise<ApiResult<{ now: number; oreMult: number; speedMult: number; events: { id: string; name: string; kind: 'ore' | 'speed'; mult: number; endsAt: number }[]; message: { id: number; text: string; created: number } | null }>>;
  /** Admin-Aufruf (nur für den Administrator erlaubt). */
  admin<T = Record<string, unknown>>(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>>;
  register(name: string, password: string): Promise<ApiResult<{ token: string; name: string }>>;
  login(name: string, password: string): Promise<ApiResult<{ token: string; name: string }>>;
  logout(token: string): Promise<ApiResult<{ ok: true }>>;
  me(token: string): Promise<ApiResult<{ name: string; hasSave: boolean; version: number; inbox: number }>>;
  getSave(token: string): Promise<ApiResult<SaveReply>>;
  putSave(token: string, save: unknown, baseVersion: number): Promise<ApiResult<{ version: number; updated: number }>>;
  send(token: string, body: GiftBody): Promise<ApiResult<{ id: string; to: string; version: number; save: unknown }>>;
  inbox(token: string): Promise<ApiResult<{ gifts: InboxGift[] }>>;
  claim(token: string, id: string): Promise<ApiResult<{ version: number; save: unknown }>>;
}

export function createApi(base: string = API_URL, fetchFn: FetchLike = (u, i) => fetch(u, i), timeoutMs = 15_000): Api {
  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetchFn(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl?.signal });
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        /* leere oder keine JSON-Antwort */
      }
      if (res.ok) return { ok: true, data: json as T };
      return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : 'server', data: json };
    } catch {
      return { ok: false, status: 0, error: 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    global: () => call('GET', '/api/global'),
    admin: (token, method, path, body) => call(method, `/api/admin/${path}`, body, token),
    register: (name, password) => call('POST', '/api/register', { name, password }),
    login: (name, password) => call('POST', '/api/login', { name, password }),
    logout: (token) => call('POST', '/api/logout', undefined, token),
    me: (token) => call('GET', '/api/me', undefined, token),
    getSave: (token) => call('GET', '/api/save', undefined, token),
    putSave: (token, save, baseVersion) => call('PUT', '/api/save', { save, baseVersion }, token),
    send: (token, body) => call('POST', '/api/send', body, token),
    inbox: (token) => call('GET', '/api/inbox', undefined, token),
    claim: (token, id) => call('POST', '/api/inbox/claim', { id }, token),
  };
}

/** Verständliche Meldung zu einem Fehlercode des Servers. */
export function describeApiError(status: number, error: string, data?: Record<string, unknown>): string {
  switch (error) {
    case 'network':
      return 'Keine Verbindung zum Server. Bitte später noch einmal versuchen.';
    case 'invalid_name':
      return 'Der Name muss 3–16 Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, _ und -).';
    case 'invalid_password':
      return 'Das Passwort muss 8–128 Zeichen lang sein.';
    case 'name_taken':
      return 'Diesen Namen gibt es schon.';
    case 'invalid_credentials':
      return 'Name oder Passwort stimmt nicht.';
    case 'locked':
      return `Zu viele Fehlversuche. Bitte in ${typeof data?.retryAfter === 'number' ? data.retryAfter : 60} Sekunden erneut versuchen.`;
    case 'unauthorized':
      return 'Du bist nicht mehr angemeldet. Bitte melde dich erneut an.';
    case 'unknown_recipient':
      return 'Diesen Spieler gibt es nicht.';
    case 'self':
      return 'Du kannst dir nichts selbst schenken.';
    case 'not_enough_money':
      return 'So viele Münzen hast du nicht.';
    case 'skin_not_owned':
      return 'Diesen Skin besitzt du nicht.';
    case 'skin_already_owned':
      return 'Diesen Skin hast du schon. Das Geschenk bleibt im Posteingang.';
    case 'no_cloud_save':
      return 'Dein Spielstand ist noch nicht online gesichert.';
    case 'rate_limited':
      return 'Du hast in der letzten Stunde schon viele Geschenke verschickt. Bitte warte etwas.';
    case 'inbox_full':
      return 'Der Posteingang dieses Spielers ist voll.';
    case 'conflict':
      return 'Dein Spielstand wurde gerade auf einem anderen Gerät geändert. Bitte synchronisiere zuerst.';
    case 'gift_not_found':
      return 'Dieses Geschenk gibt es nicht mehr.';
    case 'invalid_gift':
      return 'Das Geschenk ist ungültig.';
    case 'forbidden':
      return 'Das darf nur der Administrator.';
    case 'invalid_mult':
      return 'Der Multiplikator muss eine Zahl von 0 bis 1e12 sein.';
    case 'invalid_event':
      return 'Das Event ist ungültig (Name, Art und Faktor angeben).';
    case 'invalid_minutes':
      return 'Die Dauer muss zwischen 1 Minute und 14 Tagen liegen.';
    case 'too_many_events':
      return 'Es laufen schon zu viele Events (höchstens 20).';
    case 'invalid_message':
      return 'Die Nachricht ist leer oder ungültig.';
    case 'message_too_long':
      return 'Die Nachricht ist zu lang (höchstens 300 Zeichen).';
    case 'invalid_amount':
      return 'Die Menge ist ungültig.';
    case 'invalid_skin':
      return 'Diesen Skin gibt es nicht.';
    case 'invalid_action':
      return 'Diese Aktion gibt es nicht.';
    default:
      return status >= 500 ? 'Der Server hat gerade ein Problem. Bitte später noch einmal versuchen.' : `Fehler: ${error}`;
  }
}
