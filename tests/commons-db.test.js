// Database-level checks of what People takes from the commons: old data stays findable after the alias keys arrive, the MCP token
// is stable, the database closes cleanly. (Own file: they open and close the process-wide database.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "./helpers.js";
import { db, init, close, MIGRATIONS, DB_FILE } from "../server/db.js";
import { openDatabase } from "../server/hoard-commons/server.js";
import { findHandle, findAnyHandle } from "../server/handles.js";
import { resolvePersonRef } from "../server/people.js";
import { createApp } from "../server/app.js";

test("a database from before the alias keys: migration 4 adds the column, old rows are filled in when first looked at, nothing is lost", () => {
  const dir = tempDir();
  try {
    const old = openDatabase(path.join(dir, DB_FILE), { migrations: MIGRATIONS.slice(0, 3) });
    old.run("INSERT INTO people (id, name, created_at, updated_at) VALUES ('p1', 'Vieja Agenda', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')");
    old.run("INSERT INTO aliases (id, person_id, kind, value, created_at) VALUES ('a1', 'p1', 'email', 'Vieja.Agenda@Example.TEST', '2025-01-01T00:00:00Z')");
    old.run("INSERT INTO aliases (id, person_id, kind, value, created_at) VALUES ('a2', 'p1', 'phone', '600 00 11 22', '2025-01-01T00:00:00Z')");
    old.run("INSERT INTO aliases (id, person_id, kind, value, created_at) VALUES ('a3', 'p1', 'whatsapp', 'Vieja WA', '2025-01-01T00:00:00Z')");
    assert.equal(old.schemaVersion(), 3);
    old.close();

    init(dir);
    assert.equal(db().prepare("SELECT MAX(version) AS v FROM schema_version").get().v, MIGRATIONS.length);
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM aliases WHERE norm IS NULL").get().n, 3, "the migration rewrites nothing");
    assert.equal(findHandle("email", "vieja.agenda+x@example.test").id, "a1", "found under another spelling at the first look");
    assert.equal(db().prepare("SELECT COUNT(*) AS n FROM aliases WHERE norm IS NULL").get().n, 0, "and every row has its key now");
    assert.equal(db().prepare("SELECT value FROM aliases WHERE id = 'a1'").get().value, "Vieja.Agenda@Example.TEST", "the value is as typed");
    assert.equal(findHandle("phone", "+34600001122").id, "a2");
    assert.equal(resolvePersonRef("Vieja WA").person.id, "p1");
    assert.equal(findAnyHandle("vieja wa").id, "a3");
    close();
    // opened a second time: nothing to do, still found
    init(dir);
    assert.equal(findHandle("email", "VIEJA.AGENDA@example.test").id, "a1");
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the MCP token is stable across restarts of the app on the same data folder", () => {
  const dir = tempDir();
  try {
    const first = createApp({ dataDir: dir, serveStatic: false });
    const second = createApp({ dataDir: dir, serveStatic: false });
    assert.equal(first.token, second.token);
    assert.equal(fs.readFileSync(path.join(dir, "mcp-token"), "utf8").trim(), first.token);
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closing the database checkpoints the WAL", () => {
  const dir = tempDir();
  try {
    init(dir);
    db().exec("INSERT INTO people (id, name, created_at, updated_at) VALUES ('x', 'Cierre', 'a', 'a')");
    close();
    const wal = path.join(dir, `${DB_FILE}-wal`);
    assert.ok(!fs.existsSync(wal) || fs.statSync(wal).size === 0, "no pending WAL is left behind");
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
