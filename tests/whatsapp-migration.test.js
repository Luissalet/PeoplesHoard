// Migration 5 rebuilds the commitments table (to allow the "whatsapp" source and add the message time) without losing anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, DB_FILE, init, close, db } from "../server/db.js";
import { tempDir } from "./helpers.js";

test("migration 5 keeps the commitments of a version 4 database and lets 'whatsapp' in", () => {
  const dir = tempDir();
  const old = new DatabaseSync(path.join(dir, DB_FILE));
  old.exec("PRAGMA foreign_keys = ON");
  old.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  MIGRATIONS.slice(0, 4).forEach((sql, i) => {
    old.exec(sql);
    old.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(i + 1, new Date().toISOString());
  });
  old.prepare("INSERT INTO people (id, name, created_at, updated_at) VALUES ('p1', 'Marta Lozano', 'x', 'x')").run();
  old.prepare("INSERT INTO commitments (id, direction, person_id, text, due, source_kind, source_ref, dedupe_key, created_at, updated_at) VALUES ('c1', 'i_owe', 'p1', 'Mandar el informe', '2026-10-12', 'funes', 's@1', 'funes:s@1:mandar el informe', 'x', 'x')").run();
  old.close();
  init(dir);
  try {
    assert.equal(db().prepare("SELECT MAX(version) AS v FROM schema_version").get().v, MIGRATIONS.length);
    const row = db().prepare("SELECT * FROM commitments WHERE id = 'c1'").get();
    assert.deepEqual([row.text, row.due, row.person_id, row.source_kind, row.source_at], ["Mandar el informe", "2026-10-12", "p1", "funes", null]);
    const insert = (id, kind, key) => db().prepare("INSERT INTO commitments (id, direction, text, source_kind, dedupe_key, created_at, updated_at) VALUES (?, 'i_owe', 't', ?, ?, 'x', 'x')").run(id, kind, key);
    insert("c2", "whatsapp", "whatsapp:a:t");
    assert.throws(() => insert("c3", "whatsapp", "whatsapp:a:t"), "the dedupe index survived the rebuild");
    assert.throws(() => insert("c4", "telegram", null), "the source kinds are still checked");
    db().prepare("DELETE FROM people WHERE id = 'p1'").run();
    assert.equal(db().prepare("SELECT person_id FROM commitments WHERE id = 'c1'").get().person_id, null, "deleting the person still leaves the commitment");
    assert.ok(db().prepare("SELECT name FROM sqlite_master WHERE name = 'message_ledger'").get());
    assert.ok(db().prepare("SELECT name FROM sqlite_master WHERE name = 'commitments_status_due'").get(), "the indexes were recreated");
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
