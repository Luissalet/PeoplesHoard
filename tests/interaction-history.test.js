import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { db } from "../server/db.js";
import { searchInteractions } from "../server/interactions.js";
import { historyQuery } from "../client/src/history-filters.js";

let server, person, archived, old;
before(async () => {
  server = await bootServer();
  person = (await server.call("POST", "/api/people", { name: "Ángela Prueba", nickname: "Lola" })).body;
  archived = (await server.call("POST", "/api/people", { name: "Persona archivada", archived: true })).body;
  old = (await server.call("POST", `/api/people/${person.id}/interactions`, { at: "2025-01-01T10:00:00Z", channel: "meet", summary: "Café, excursión y fotografías." })).body;
  for (let i = 0; i < 30; i++) await server.call("POST", `/api/people/${person.id}/interactions`, { at: "2026-10-23T12:00:00Z", channel: "call", summary: `Llamada ${i}` });
  await server.call("POST", `/api/people/${archived.id}/interactions`, { at: "2026-10-25T01:30:00Z", channel: "email", summary: "Fotografías archivadas." });
});
after(async () => { await server.stop(); });

test("finds an old contact beyond the recent ten, with accent-insensitive AND terms", async () => {
  const recent = await server.agent("get_person", { person: person.id });
  assert.equal(recent.body.interactions.length, 10);
  assert.ok(!recent.body.interactions.some((row) => row.id === old.id));
  const found = searchInteractions({ q: "ANGELA cafe excursion" });
  assert.equal(found.total, 1);
  assert.equal(found.interactions[0].id, old.id);
  assert.equal(searchInteractions({ q: "Lola fotografías" }).total, 1);
  assert.equal(searchInteractions({ q: "%" }).total, 0, "query text is literal, not SQL wildcards");
});

test("stable pagination visits every tied-time interaction exactly once", () => {
  const ids = [];
  for (let offset = 0; offset < 31; offset += 7) {
    const page = searchInteractions({ person_id: person.id, limit: 7, offset });
    assert.equal(page.total, 31);
    assert.equal(page.has_more, offset + 7 < 31);
    ids.push(...page.interactions.map((row) => row.id));
  }
  assert.equal(ids.length, 31);
  assert.equal(new Set(ids).size, 31);
  assert.equal(ids.at(-1), old.id);
});

test("person, medium, archived and inclusive instant filters agree in HTTP and MCP domain", async () => {
  const args = { person_id: archived.id, channel: "email", include_archived: true,
    from: "2026-10-25T02:30:00+01:00", to: "2026-10-25T01:30:00Z" };
  assert.equal(searchInteractions({ person_id: archived.id }).total, 0);
  const expected = searchInteractions(args);
  assert.equal(expected.total, 1);
  assert.equal(expected.interactions[0].person_archived, true);
  const api = await server.call("GET", "/api/interactions?" + new URLSearchParams(args));
  assert.equal(api.status, 200);
  assert.deepEqual(api.body, expected);
  const agent = await server.agent("search_interactions", args);
  assert.equal(agent.status, 200);
  assert.deepEqual(agent.body, expected);
});

test("read-only history leaves recorded people and interactions exactly unchanged", () => {
  const snapshot = () => ({ people: db().prepare("SELECT * FROM people ORDER BY id").all(), interactions: db().prepare("SELECT * FROM interactions ORDER BY id").all() });
  const before = snapshot();
  searchInteractions({ q: "café", include_archived: true });
  searchInteractions({ from: "2020-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z", limit: 100 });
  assert.deepEqual(snapshot(), before);
});

test("malformed filters are rejected by the native contract and HTTP", async () => {
  for (const input of [{ from: "2026-02-30T12:00:00Z" }, { from: "2026-10-25" }, { from: "2026-10-25T12:00:00" },
    { from: "2026-10-25T00:00:00Z", to: "2026-10-24T00:00:00Z" }, { limit: 0 }, { offset: -1 }, { include_archived: "yes" }, { channel: "fax" }, { surprise: true }]) {
    assert.throws(() => searchInteractions(input), undefined, JSON.stringify(input));
    assert.equal((await server.call("GET", "/api/interactions?" + new URLSearchParams(input))).status, 400);
  }
});

test("browser-local day bounds cover a whole DST day, not a fixed twenty-four hours", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Madrid";
  try {
    const base = { q: "", include_archived: false, limit: "25", person_id: "", channel: "", from: "2026-10-25", to: "2026-10-25" };
    const query = historyQuery(base);
    assert.equal(query.from, "2026-10-24T22:00:00.000Z");
    assert.equal(query.to, "2026-10-25T22:59:59.999Z");
    assert.throws(() => historyQuery({ ...base, from: "2026-02-30" }));
    assert.throws(() => historyQuery({ ...base, from: "2026-10-26" }));
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
