import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1Result, D1Statement } from '../server/src/db';

/** D1-Ersatz für Tests: dieselben SQL-Anweisungen laufen gegen SQLite im Speicher. */
export function createTestDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));

  class Stmt implements D1Statement {
    constructor(
      readonly sql: string,
      readonly args: SQLInputValue[] = [],
    ) {}
    bind(...values: unknown[]): D1Statement {
      return new Stmt(this.sql, values.map((v) => (v === undefined ? null : v)) as SQLInputValue[]);
    }
    async first<T>(): Promise<T | null> {
      const row = raw.prepare(this.sql).get(...this.args);
      return row ? ({ ...row } as T) : null;
    }
    async all<T>(): Promise<D1Result<T>> {
      return { results: raw.prepare(this.sql).all(...this.args).map((r) => ({ ...r }) as T) };
    }
    async run(): Promise<D1Result> {
      const r = raw.prepare(this.sql).run(...this.args);
      return { meta: { changes: Number(r.changes) } };
    }
  }

  const db: D1Database = {
    prepare: (sql) => new Stmt(sql),
    async batch<T>(statements: D1Statement[]): Promise<D1Result<T>[]> {
      raw.exec('BEGIN');
      try {
        const out: D1Result<T>[] = [];
        for (const s of statements) out.push((await s.run()) as D1Result<T>);
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, raw };
}
