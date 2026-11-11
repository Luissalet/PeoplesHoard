import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bootServer } from "./helpers.js";
import { db } from "../server/db.js";
import { createPerson } from "../server/people.js";
import { createInteraction, exportInteractions, searchInteractions } from "../server/interactions.js";

let server, person, archived;
const summary = 'Cámara, "montaña"\nSegunda línea — ' + "historia ".repeat(180);
before(async () => {
  server = await bootServer();
  person = createPerson({ name: "Ángela Exportación (ficticia)", nickname: "Lola" });
  archived = createPerson({ name: "Archivo (ficticio)", archived: true });
  for (let index = 0; index < 137; index++) createInteraction(person.id, {
    at: "2026-10-23T12:00:00Z", channel: "meet", summary: `${index} ${summary}`,
  });
  createInteraction(archived.id, { at: "2026-10-24T12:00:00Z", channel: "call", summary: "Archivada" });
});
after(async () => { await server.stop(); });

test("export snapshot contains all rows beyond pagination and the agent response cap", async () => {
  const snapshot = () => ({ people: db().prepare("SELECT * FROM people ORDER BY id").all(), rows: db().prepare("SELECT * FROM interactions ORDER BY id").all() });
  const before = snapshot();
  const result = await server.agent("export_interactions", { q: "ANGELA camara", format: "json" });
  assert.equal(result.status, 200);
  assert.equal(result.body.truncated, undefined);
  assert.ok(Buffer.byteLength(result.body.text, "utf8") > 20000);
  const data = JSON.parse(result.body.text);
  assert.equal(data.count, 137);
  assert.equal(data.interactions.length, 137);
  assert.equal(new Set(data.interactions.map((row) => row.id)).size, 137);
  const ordered = [0, 100].flatMap((offset) => searchInteractions({ person_id: person.id, limit: 100, offset }).interactions);
  assert.deepEqual(data.interactions, ordered);
  assert.equal(data.interactions[0].ref, null);
  assert.equal(data.interactions[0].person_archived, false);
  const search = await server.agent("search_interactions", { limit: 100 });
  assert.ok(search.body.truncated, "ordinary search remains capped");
  assert.deepEqual(snapshot(), before, "exports and search leave every stored value unchanged");
});

test("HTTP attachment preserves UTF-8 CSV quotes, commas and multiline summaries", async () => {
  const response = await fetch(server.base + "/api/interactions/export", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ person_id: person.id, format: "csv" }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/csv; charset=utf-8/);
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="contact-history-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191], "UTF-8 BOM for spreadsheet import");
  const csv = bytes.toString("utf8");
  assert.match(csv, /Cámara, ""montaña""\nSegunda línea/);
  assert.match(csv, /"person_archived"/);
  assert.ok(csv.endsWith("\r\n"));
  const agent = await server.agent("export_interactions", { person_id: person.id, format: "csv" });
  assert.equal(agent.body.text, csv, "HTTP and MCP return the same complete CSV");
});

test("real MCP client receives the complete JSON and CSV exports while search remains capped", async () => {
  const client = new Client({ name: "contact-export-regression", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve(import.meta.dirname, "../server/mcp.js")],
    env: { ...process.env, PEOPLE_URL: server.base, PEOPLE_DATA_DIR: server.dataDir,
      HOARD_HUB_URL: "http://127.0.0.1:9", HOARD_EVENTS: "0" }, stderr: "pipe" });
  try {
    await client.connect(transport);
    for (const format of ["json", "csv"]) {
      const args = { person_id: person.id, format };
      const output = await client.callTool({ name: "export_interactions", arguments: args });
      assert.ok(!output.isError);
      const result = JSON.parse(output.content[0].text);
      const expected = exportInteractions(args);
      assert.equal(result.count, 137);
      assert.ok(Buffer.byteLength(result.text) > 20000);
      assert.ok(!result.truncated && !Object.hasOwn(result, "__uncapped"));
      // Each call has its own timestamp; the exported rows and CSV bytes remain identical.
      if (format === "json") {
        assert.deepEqual(JSON.parse(result.text).interactions, JSON.parse(expected.text).interactions);
      } else assert.equal(result.text, expected.text);
    }
    const search = await client.callTool({ name: "search_interactions", arguments: { limit: 100 } });
    assert.ok(JSON.parse(search.content[0].text).truncated);
  } finally { await client.close(); }
});

test("export filters match history, including archived contacts, inclusive dates and empty results", () => {
  const args = { person_id: archived.id, channel: "call", include_archived: true,
    from: "2026-10-24T14:00:00+02:00", to: "2026-10-24T12:00:00Z" };
  const result = exportInteractions(args);
  assert.equal(result.count, 1);
  assert.deepEqual(JSON.parse(result.text).interactions, searchInteractions(args).interactions);
  assert.equal(exportInteractions({ person_id: archived.id }).count, 0);
  assert.equal(JSON.parse(exportInteractions({ q: "nunca coincide" }).text).interactions.length, 0);
  assert.equal(exportInteractions({ q: "nunca coincide", format: "csv" }).text.split("\r\n").length, 2);
});

test("export rejects pagination, bad formats and malformed filters in HTTP and agent calls", async () => {
  for (const args of [{ limit: 1 }, { offset: 100 }, { format: "pdf" }, { include_archived: "true" }, { q: "x".repeat(201) },
    { from: "2026-10-24" }, { from: "2026-10-25T00:00:00Z", to: "2026-10-24T00:00:00Z" }]) {
    assert.equal((await server.call("POST", "/api/interactions/export", args)).status, 400, JSON.stringify(args));
    assert.equal((await server.agent("export_interactions", args)).status, 400, JSON.stringify(args));
  }
});
