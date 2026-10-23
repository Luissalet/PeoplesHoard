import test from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { api } from "../client/src/api.js";
import { interactionBody, interactionTime } from "../client/src/interaction-time.js";

test("local contact date becomes an explicit instant; native timeline keeps its latest contact", async () => {
  const previousZone = process.env.TZ;
  const fetchOriginal = globalThis.fetch;
  let server;
  process.env.HOARD_EVENTS = "0";
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  process.env.HOARD_FAUSTUS_URL = "http://127.0.0.1:1";
  try {
    process.env.TZ = "Europe/Madrid";
    const draft = { channel: "call", summary: "Conversación ficticia anterior", local_at: "2026-01-12T23:45" };
    const body = interactionBody(draft);
    assert.equal(body.at, "2026-01-12T22:45:00.000Z");
    assert.deepEqual(draft, { channel: "call", summary: "Conversación ficticia anterior", local_at: "2026-01-12T23:45" });
    assert.equal(interactionTime(draft.local_at).time_zone, "Europe/Madrid");
    assert.equal(interactionTime(draft.local_at).utc_offset, "UTC+01:00");
    assert.equal(interactionTime("2026-07-12T23:45").utc_offset, "UTC+02:00");
    // The preview exposes the browser's actual interpretation through a spring clock change.
    assert.match(interactionTime("2026-03-29T02:30").label, /3:30/);
    assert.equal(interactionTime("2026-03-29T02:30").at, "2026-03-29T01:30:00.000Z");
    assert.equal(interactionTime(""), null);
    assert.throws(() => interactionBody({ ...draft, local_at: "invalid" }), /no válida/);
    const nowBody = interactionBody({ channel: "meet", summary: "Ahora", local_at: "" });
    assert.deepEqual(nowBody, { channel: "meet", summary: "Ahora" });

    process.env.TZ = "UTC"; // A server in another zone must receive the same instant.
    server = await bootServer();
    globalThis.fetch = (url, options) => fetchOriginal(new URL(url, server.base), options);
    const create = async (name) => (await server.call("POST", "/api/people", { name })).body;
    const recent = await create("Marta Reciente Ficticia");
    const first = await create("Nora Sin Historial Ficticia");
    const untouched = await create("Inés Conservada Ficticia");
    const snapshot = async (id) => (await server.call("GET", `/api/people/${id}`)).body;
    const untouchedBefore = await snapshot(untouched.id);
    const latest = await api.interactions.add(recent.id, { at: "2026-10-20T15:00:00Z", channel: "meet", summary: "Reciente" });
    const older = await api.interactions.add(recent.id, body);
    assert.equal(older.at, body.at);
    const full = await snapshot(recent.id);
    assert.equal(full.last_contact_at, latest.at);
    assert.deepEqual(full.interactions.map((item) => item.at), [latest.at, body.at]);
    const firstContact = await api.interactions.add(first.id, body);
    assert.equal((await snapshot(first.id)).last_contact_at, firstContact.at);
    const beforeNow = Date.now();
    const current = await api.interactions.add(first.id, nowBody);
    assert.ok(Date.parse(current.at) >= beforeNow && Date.parse(current.at) <= Date.now());
    assert.equal((await snapshot(first.id)).last_contact_at, current.at);
    assert.deepEqual(await snapshot(untouched.id), untouchedBefore);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (server) await server.stop();
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
