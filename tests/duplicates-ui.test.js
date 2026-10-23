import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { api } from "../client/src/api.js";
import { db } from "../server/db.js";

test("duplicate UI filters share native pairs/counts and preserve normalized contact records", async () => {
  process.env.HOARD_EVENTS = "0";
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  process.env.HOARD_FAUSTUS_URL = "http://127.0.0.1:1";
  const server = await bootServer();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (url, options) => fetchOriginal(new URL(url, server.base), options);
  try {
    assert.deepEqual(await api.people.duplicates({ min_score: 1, limit: 20, archived: false }), { pairs: [], total: 0, scanned: 0 });
    const create = async (person) => (await server.call("POST", "/api/people", person)).body;
    const a = await create({ name: "Carmen Ruiz Caso", birthday: "1980-05-05" });
    const b = await create({ name: "Carmen Ruiz Otro", birthday: "1980-05-05" });
    await create({ name: "Carmen Ruiz Caso", birthday: "1980-05-05", archived: true });
    const unique = await create({ name: "Bruno Sol UnicoQA" });
    await server.call("POST", `/api/people/${a.id}/aliases`, { kind: "email", value: "carmen.a@example.test" });
    await server.call("POST", `/api/people/${unique.id}/aliases`, { kind: "phone", value: "+34 600 123 987" });
    await server.call("POST", `/api/people/${b.id}/facts`, { key: "le gusta", value: "Fixture de datos" });
    assert.equal(db().prepare("SELECT COUNT(*) n FROM aliases WHERE norm IS NULL OR norm=''").get().n, 0);
    const snapshot = async () => { const out = (await server.call("GET", "/api/export")).body; delete out.exported_at; return out; };
    const before = await snapshot();
    const out = await api.people.duplicates({ min_score: 0.7, limit: 20, archived: false });
    assert.equal(out.scanned, 3); assert.equal(out.total, 1);
    assert.equal(out.pairs[0].suggested_keep_id, b.id);
    assert.ok(out.pairs[0].reasons.some((reason) => reason.startsWith("mismo cumpleaños")));
    assert.deepEqual(out, (await server.agent("find_duplicate_people", { min_score: 0.7, limit: 20, include_archived: false })).body);
    const archived = await api.people.duplicates({ min_score: 0.7, limit: 1, archived: true });
    assert.equal(archived.scanned, 4); assert.equal(archived.total, 3); assert.equal(archived.pairs.length, 1);
    assert.deepEqual((await api.people.duplicates({ min_score: 1, limit: 20, archived: false })).pairs, []);
    assert.deepEqual(await snapshot(), before);
  } finally {
    globalThis.fetch = fetchOriginal;
    await server.stop();
  }
});
