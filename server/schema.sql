-- Datenbank-Schema für den Schacht-Server (Cloudflare D1 / SQLite).
-- Anwenden: npx wrangler d1 execute schacht-db --remote --file=server/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  save TEXT,
  save_version INTEGER NOT NULL DEFAULT 0,
  save_updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id),
  to_user INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  amount INTEGER,
  skin TEXT,
  note TEXT,
  created INTEGER NOT NULL,
  claimed INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts(to_user, claimed);
CREATE INDEX IF NOT EXISTS idx_gifts_from ON gifts(from_user, created);
