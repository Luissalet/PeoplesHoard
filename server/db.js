// Single SQLite connection (node:sqlite) with ordered migrations, plus a
// hand-maintained FTS5 index over people. Opening, WAL, busy timeout, the migration loop, transactions (re-entrant, savepoints)
// and the checkpoint on close are the family's openDatabase (hoard-commons/server.js). Only the HTTP server process opens
// the database; the MCP bridge proxies.
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase } from "./hoard-commons/server.js";

export const DB_FILE = "peoples-hoard.db";

export const MIGRATIONS = [
  `
  CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nickname TEXT NOT NULL DEFAULT '',
    circles TEXT NOT NULL DEFAULT '[]',
    birthday TEXT NULL,
    location TEXT NOT NULL DEFAULT '',
    how_met TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    contact_every_days INTEGER NULL,
    last_contact_at TEXT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX people_archived ON people(archived);
  CREATE INDEX people_name ON people(name COLLATE NOCASE);

  CREATE TABLE aliases (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX aliases_kind_value ON aliases(kind, value COLLATE NOCASE);
  CREATE INDEX aliases_person ON aliases(person_id);

  CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX facts_person ON facts(person_id);
  CREATE UNIQUE INDEX facts_person_key_value ON facts(person_id, key COLLATE NOCASE, value COLLATE NOCASE);

  CREATE TABLE interactions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'other',
    summary TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX interactions_person ON interactions(person_id, at);

  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    person_id TEXT NULL REFERENCES people(id) ON DELETE CASCADE,
    due TEXT NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'custom',
    created_at TEXT NOT NULL
  );
  CREATE INDEX reminders_due ON reminders(due);
  CREATE INDEX reminders_person ON reminders(person_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: commitments ("who promised what to whom and by when") and the review queue for
  // proposals that need a person picked or a human yes (names that do not resolve, text
  // pasted by the user, a promise between two third parties).
  `
  CREATE TABLE commitments (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('i_owe', 'owed_to_me')),
    person_id TEXT NULL REFERENCES people(id) ON DELETE SET NULL,
    person_name_raw TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    due TEXT NULL,
    due_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
    source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('funes', 'chat', 'manual', 'text', 'mail')),
    source_ref TEXT NOT NULL DEFAULT '',
    source_quote TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_at TEXT NULL,
    last_nudged_at TEXT NULL
  );
  CREATE INDEX commitments_status_due ON commitments(status, due);
  CREATE INDEX commitments_person ON commitments(person_id);
  CREATE UNIQUE INDEX commitments_dedupe ON commitments(dedupe_key) WHERE dedupe_key IS NOT NULL;

  CREATE TABLE commitment_review (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('minutes', 'text')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'discarded')),
    proposal TEXT NOT NULL,
    candidates TEXT NOT NULL DEFAULT '[]',
    dedupe_key TEXT NULL,
    commitment_id TEXT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT NULL
  );
  CREATE INDEX commitment_review_status ON commitment_review(status, created_at);
  CREATE UNIQUE INDEX commitment_review_dedupe ON commitment_review(dedupe_key) WHERE dedupe_key IS NOT NULL;
  `,
  // 3: an interaction may remember what it came from (a meeting's minutes, a mail) so the same source never lands
  // twice on a timeline, and gift ideas per person (an idea may be watched by Tantalus: watcher_id).
  `
  ALTER TABLE interactions ADD COLUMN ref TEXT NULL;
  CREATE UNIQUE INDEX interactions_ref ON interactions(person_id, ref) WHERE ref IS NOT NULL;

  CREATE TABLE gift_ideas (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    idea TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    budget REAL NULL,
    status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'bought', 'dropped')),
    watcher_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX gift_ideas_person ON gift_ideas(person_id, status);
  `,
  // 4: aliases keep the value as typed and a comparison key (`norm`: e-mail without +tag, phone as +34...). Old rows are filled
  // in the first time they are looked at (handles.js ensureNorms), so nothing is rewritten here.
  `
  ALTER TABLE aliases ADD COLUMN norm TEXT NULL;
  CREATE INDEX aliases_norm ON aliases(kind, norm);
  `,
];

let database = null;
let connection = null;
let dataDirectory = null;

/**
 * The FTS5 table is created (idempotently) outside the numbered migrations
 * because the best tokenizer option depends on the SQLite build: we try the
 * accent-folding variants first and fall back gracefully.
 */
function ensureFts(conn) {
  const variants = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(person_id UNINDEXED, name, nickname, aliases, summary, notes, facts, tokenize='unicode61 remove_diacritics 2')",
    "CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(person_id UNINDEXED, name, nickname, aliases, summary, notes, facts, tokenize='unicode61 remove_diacritics 1')",
    "CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(person_id UNINDEXED, name, nickname, aliases, summary, notes, facts)",
  ];
  let lastError = null;
  for (const sql of variants) {
    try {
      conn.exec(sql);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No se pudo crear el índice de búsqueda (FTS5).");
}

export function init(dataDir) {
  if (connection) return connection;
  dataDirectory = dataDir;
  database = openDatabase(path.join(dataDir, DB_FILE), { migrations: MIGRATIONS });
  connection = database.raw;
  ensureFts(connection);
  return connection;
}

export function db() {
  if (!connection) throw new Error("Database not initialised. Call init(dataDir) first.");
  return connection;
}

export function dataDir() {
  return dataDirectory;
}

export function close() {
  if (database) database.close();
  database = null;
  connection = null;
  dataDirectory = null;
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Run fn (synchronous) inside a transaction; a nested call is a savepoint of the outer one. */
export function transaction(fn) {
  db();
  return database.tx(fn);
}

export function getSetting(key, fallback = null) {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
  return value;
}
