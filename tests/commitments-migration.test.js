// Migration 2 adds the commitments tables to a database made by the previous version, keeping its data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, DB_FILE, init, close, db } from "../server/db.js";
import { tempDir } from "./helpers.js";

test("a version 1 database gains the commitments tables and keeps its rows", () => {
  const dir = tempDir();
  const old = new DatabaseSync(path.join(dir, DB_FILE));
  old.exec("PRAGMA foreign_keys = ON");
  old.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  old.exec(MIGRATIONS[0]);
  old.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
  old.prepare("INSERT INTO people (id, name, created_at, updated_at) VALUES ('p1', 'Marta Lozano', 'x', 'x')").run();
  old.close();

  init(dir);
  try {
    assert.equal(db().prepare("SELECT MAX(version) AS v FROM schema_version").get().v, MIGRATIONS.length);
    assert.equal(db().prepare("SELECT name FROM people WHERE id = 'p1'").get().name, "Marta Lozano");
    const tables = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    assert.ok(tables.includes("commitments") && tables.includes("commitment_review"));
    const columns = db().prepare("PRAGMA table_info(commitments)").all().map((c) => c.name);
    for (const name of ["id", "direction", "person_id", "person_name_raw", "text", "due", "due_text", "status", "source_kind", "source_ref",
      "source_quote", "created_at", "updated_at", "done_at", "last_nudged_at"]) assert.ok(columns.includes(name), name);
    // the same promise from the same source cannot be stored twice, and a bad direction is refused by the database itself
    const insert = (id, key, direction = "i_owe") => db().prepare(
      "INSERT INTO commitments (id, direction, text, dedupe_key, created_at, updated_at) VALUES (?, ?, 't', ?, 'x', 'x')").run(id, direction, key);
    insert("c1", "funes:s:t");
    assert.throws(() => insert("c2", "funes:s:t"));
    assert.throws(() => insert("c3", null, "sideways"));
    insert("c4", null);
    insert("c5", null); // no key, no constraint
    // deleting the person leaves the commitment
    db().prepare("UPDATE commitments SET person_id = 'p1' WHERE id = 'c1'").run();
    db().prepare("DELETE FROM people WHERE id = 'p1'").run();
    assert.equal(db().prepare("SELECT person_id FROM commitments WHERE id = 'c1'").get().person_id, null);
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
