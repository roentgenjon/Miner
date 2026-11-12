/** Minimale D1-Schnittstelle (so viel, wie der Server braucht) – in Tests durch SQLite ersetzbar. */
export interface D1Result<T = unknown> {
  results?: T[];
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  /** Führt alle Anweisungen nacheinander in EINER Transaktion aus. */
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

export interface Env {
  DB: D1Database;
  /** Kommagetrennte Liste erlaubter Herkunfts-Adressen (CORS). */
  ALLOWED_ORIGINS?: string;
}
