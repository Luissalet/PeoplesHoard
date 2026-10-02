// The background sweep: reads funes.minutes.ready from the hub, remembers where it got to, retries what failed,
// and stays off when asked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { pollOnce, sweep, startPoller, stopPoller, autoEnabled, syncStatus, SCAN_LIMIT } from "../server/commitments-poller.js";
import { pollState, listCommitments } from "../server/commitments.js";
import { createPerson } from "../server/people.js";

let s, hub;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  createPerson({ name: "Pedro Gil" });
});
after(async () => {
  stopPoller();
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

const minutes = (id, owner = "Pedro Gil", action = `Tarea de ${id}`) => ({ status: "ready", cached: true, minutes: {
  session_id: id, title: `Reunión ${id}`, started_at: "2026-10-02T10:00:00",
  action_items: [{ owner, action, evidence: { start_s: 1, end_s: 3, speaker: "otros", quote: "lo hago yo" } }],
} });

test("the first sweep only notes where the hub is: old meetings are not replayed", async () => {
  hub.event("funes.minutes.ready", { session_id: "old", title: "Vieja", action_items: 1 });
  hub.state.minutes.old = minutes("old");
  assert.equal(pollState().since_id, null);
  const first = await pollOnce();
  assert.equal(first.status, "baseline");
  assert.equal(pollState().since_id, hub.state.lastId);
  assert.equal(hub.state.calls.length, 0);
  assert.equal((await pollOnce()).status, "idle");
});

test("a new meeting is ingested through the hub and the cursor moves on", async () => {
  hub.state.minutes.a = minutes("a");
  hub.state.minutes.b = minutes("b");
  hub.event("funes.minutes.ready", { session_id: "a", title: "A", action_items: 1, started_at: "2026-10-02T10:00:00" });
  hub.event("other.thing", { session_id: "zzz" });
  const last = hub.event("funes.minutes.ready", { session_id: "b", title: "B", action_items: 1 });
  const out = await pollOnce();
  assert.equal(out.status, "processed");
  assert.deepEqual(out.ingested.map((i) => i.session_id), ["a", "b"]);
  assert.equal(listCommitments({ status: "all" }).length, 2);
  assert.ok(pollState().since_id >= last);
  const query = hub.state.eventQueries.at(-1);
  assert.match(query, /type=funes\.minutes\.ready/);
  assert.match(query, /since_id=\d+/);
  assert.equal((await pollOnce()).status, "idle");
  assert.equal(hub.state.calls.filter((c) => c.arguments.session_id === "a").length, 1, "nothing is asked twice");
});

test("a meeting with no action items costs no call", async () => {
  hub.event("funes.minutes.ready", { session_id: "empty", title: "Sin tareas", action_items: 0 });
  const before = hub.state.calls.length;
  assert.equal((await pollOnce()).status, "processed");
  assert.equal(hub.state.calls.length, before);
});

test("when Funes fails the event is retried on the next sweep, in order, and then given up on", async () => {
  hub.state.minutes.flaky = { __error: { status: 500, error: "busy" } };
  hub.state.minutes.after = minutes("after");
  hub.event("funes.minutes.ready", { session_id: "flaky", title: "Inestable", action_items: 1 });
  hub.event("funes.minutes.ready", { session_id: "after", title: "Después", action_items: 1 });
  const cursor = pollState().since_id;
  const first = await pollOnce();
  assert.equal(first.status, "stalled");
  assert.equal(pollState().since_id, cursor, "the cursor stays before the failed meeting");
  assert.equal(listCommitments({ status: "all" }).some((c) => c.text === "Tarea de after"), false, "later meetings wait their turn");
  hub.state.minutes.flaky = minutes("flaky");
  const second = await pollOnce();
  assert.equal(second.status, "processed");
  assert.deepEqual(second.ingested.map((i) => i.session_id), ["flaky", "after"]);

  // a meeting that never works does not block the rest forever
  hub.state.minutes.never = { __error: { status: 500, error: "broken" } };
  hub.state.minutes.next = minutes("next");
  hub.event("funes.minutes.ready", { session_id: "never", title: "Roto", action_items: 1 });
  hub.event("funes.minutes.ready", { session_id: "next", title: "Siguiente", action_items: 1 });
  let result;
  for (let i = 0; i < 6; i++) result = await pollOnce();
  assert.ok(listCommitments({ status: "all" }).some((c) => c.text === "Tarea de next"));
  assert.equal(result.status, "idle");
});

test("a hub that is down leaves the cursor alone", async () => {
  const cursor = pollState().since_id;
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try {
    assert.equal((await pollOnce()).status, "hub_down");
    const swept = await sweep();
    assert.equal(swept.status, "hub_down");
    assert.match(syncStatus().last_error, /./);
  } finally {
    process.env.HOARD_HUB_URL = saved;
  }
  assert.equal(pollState().since_id, cursor);
  assert.equal((await sweep()).status, "idle");
  assert.equal(syncStatus().last_error, "");
});

test("a long run of unrelated events does not hide later meetings", async () => {
  // the hub scans a limited window before filtering by type: the cursor must still advance
  hub.state.lastId += SCAN_LIMIT + 50;
  const cursor = pollState().since_id;
  const result = await pollOnce();
  assert.equal(result.status, "idle");
  assert.equal(pollState().since_id, cursor + SCAN_LIMIT);
});

test("PEOPLE_COMMITMENTS_AUTO=0 keeps the poller off; the sweep is also reachable by REST", async () => {
  for (const off of ["0", "false", "off", "no"]) assert.equal(autoEnabled({ PEOPLE_COMMITMENTS_AUTO: off }), false);
  assert.equal(autoEnabled({}), true);
  assert.equal(startPoller({ env: { PEOPLE_COMMITMENTS_AUTO: "0" } }), false);
  assert.equal(syncStatus().enabled, false);
  assert.equal(syncStatus().last_status, "off");
  const ran = (await s.call("POST", "/api/commitments/sync")).body;
  assert.ok(["idle", "processed"].includes(ran.result.status));
  assert.equal(ran.sync.hub, hub.url);
  assert.equal(typeof (await s.call("GET", "/api/commitments/sync")).body.since_id, "number");
  assert.equal(startPoller({ intervalMs: 600000, env: {} }), true);
  assert.equal(syncStatus().enabled, true);
  stopPoller();
});
