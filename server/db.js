// Single SQLite connection (node:sqlite, WAL) with ordered migrations, plus a
// hand-maintained FTS5 index over people. Only the HTTP server process opens
// the database; the MCP bridge proxies.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const DB_FILE = "peoples-hoard.db";

const MIGRATIONS = [
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
];

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
  fs.mkdirSync(dataDir, { recursive: true });
  dataDirectory = dataDir;
  connection = new DatabaseSync(path.join(dataDir, DB_FILE));
  connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(connection);
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
  if (connection) connection.close();
  connection = null;
  dataDirectory = null;
}

function migrate(conn) {
  conn.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = conn.prepare("SELECT MAX(version) AS v FROM schema_version").get();
  const current = row?.v || 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    conn.exec("BEGIN");
    try {
      conn.exec(MIGRATIONS[i]);
      conn.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(i + 1, now());
      conn.exec("COMMIT");
    } catch (error) {
      conn.exec("ROLLBACK");
      throw error;
    }
  }
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Run fn inside a transaction; nested calls reuse the outer one. */
let depth = 0;
export function transaction(fn) {
  const conn = db();
  if (depth > 0) return fn();
  conn.exec("BEGIN");
  depth++;
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  } finally {
    depth--;
  }
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
