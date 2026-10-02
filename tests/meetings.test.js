// people_from_minutes: who was at a meeting gets "Reunión: <title>" on that day, once, and nobody is invented.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import { listInteractions } from "../server/interactions.js";
import { peopleFromMinutes, minutesRef } from "../server/meetings.js";
import { ingestMinutes } from "../server/commitments.js";

const wait = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
};

let s, hub, marta, pedro, lucia1, lucia2, ana;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
  pedro = people.createPerson({ name: "Pedro Gil" });
  lucia1 = people.createPerson({ name: "Lucía Pérez" });
  lucia2 = people.createPerson({ name: "Lucía Gómez" });
  ana = people.createPerson({ name: "Ana Torres" });
  aliases.addAlias(ana.id, { kind: "email", value: "Ana.Torres@example.test" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});
beforeEach(() => {
  hub.state.calls.length = 0;
  hub.state.refs.length = 0;
});

const MINUTES = (id, attendees, extra = {}) => ({
  ok: true, status: "ready", cached: true, minutes_id: id, title: "Reunión de la reforma", date: "2026-10-02", attendees,
  action_items: [], summary: "Se revisa el presupuesto.", ...extra,
});
const meetLines = (personId) => listInteractions(personId).filter((i) => i.summary.startsWith("Reunión:"));

test("attendees are matched by name, alias and e-mail; the rest is reported, never created", async () => {
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Marta", "Pedro Gil", "Lucía", "Sofía", "yo", "otros", "ana.torres@example.test", "Pedro Gil"]);
  const before = people.listPeople({ archived: "all" }).length;
  const out = await peopleFromMinutes("ses-1");
  assert.equal(out.ok, true);
  assert.equal(out.status, "ok");
  assert.equal(out.title, "Reunión de la reforma");
  assert.equal(out.date, "2026-10-02");
  assert.deepEqual(out.matched.map((m) => m.person).sort(), ["Ana Torres", "Marta Lozano", "Pedro Gil"]);
  assert.deepEqual(out.unmatched, ["Sofía"]);
  assert.equal(out.ambiguous.length, 1);
  assert.equal(out.ambiguous[0].attendee, "Lucía");
  assert.deepEqual(out.ambiguous[0].candidates.map((c) => c.name).sort(), ["Lucía Gómez", "Lucía Pérez"]);
  assert.equal(out.logged, 3);
  assert.equal(people.listPeople({ archived: "all" }).length, before, "nobody is created");
  for (const p of [marta, pedro, ana]) {
    const lines = meetLines(p.id);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].summary, "Reunión: Reunión de la reforma");
    assert.equal(lines[0].channel, "meet");
    assert.equal(new Date(lines[0].at).getFullYear(), 2026);
    assert.equal(people.getPerson(p.id).last_contact_at, lines[0].at);
  }
  assert.equal(meetLines(lucia1.id).length + meetLines(lucia2.id).length, 0, "an ambiguous name is not guessed");
  assert.deepEqual(hub.state.calls.map((c) => [c.app, c.tool, c.arguments]), [["funes", "minutes_get", { minutes_id: "ses-1", generate: false }]]);
});

test("running it again, or by the other road, never logs the same meeting twice", async () => {
  const again = await peopleFromMinutes("ses-1");
  assert.equal(again.logged, 0);
  assert.equal(again.already, 3);
  assert.equal(meetLines(marta.id).length, 1);
  // the commitments road reads the same meeting with the exact start time: same day, same title -> still once
  const fresh = people.createPerson({ name: "Raúl Vega" });
  ingestMinutes({
    session_id: "ses-2", title: "Comité de compras", started_at: "2026-10-03T09:30:00",
    action_items: [{ owner: "Raúl Vega", action: "Traer el contrato", counterpart: "", evidence: { start_s: 3, quote: "lo traigo yo" } }],
  });
  assert.equal(meetLines(fresh.id).length, 1);
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Raúl Vega"], { title: "Comité de compras", date: "2026-10-03" });
  const out = await peopleFromMinutes("ses-2");
  assert.equal(out.logged, 0);
  assert.equal(out.already, 1);
  assert.equal(meetLines(fresh.id).length, 1);
  // and the other way round: a meeting seen here first is not logged again when its commitments arrive
  const late = people.createPerson({ name: "Teresa Mora" });
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Teresa Mora"], { title: "Revisión de planos", date: "2026-10-04" });
  assert.equal((await peopleFromMinutes("ses-3")).logged, 1);
  ingestMinutes({
    session_id: "ses-3", title: "Revisión de planos", started_at: "2026-10-04T16:00:00",
    action_items: [{ owner: "Teresa Mora", action: "Enviar los planos", counterpart: "", evidence: { start_s: 3, quote: "los envío yo" } }],
  });
  assert.equal(meetLines(late.id).length, 1);
});

test("the meeting is linked in the hub's reference graph from the person to the minutes", async () => {
  const solo = people.createPerson({ name: "Irene Salas" });
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Irene Salas"], { title: "Kickoff" });
  await peopleFromMinutes("ses-ref");
  const sent = () => hub.state.refs.find((r) => r.to === minutesRef("ses-ref"));
  assert.ok(await wait(() => !!sent()));
  assert.deepEqual(sent(), { from: `hoard://people/person/${solo.id}`, to: minutesRef("ses-ref"), rel: "meeting", from_label: "Irene Salas", to_label: "Kickoff", note: "" });
  assert.equal(listInteractions(solo.id)[0].ref, minutesRef("ses-ref"));
});

test("what Funes cannot give is said, not thrown", async () => {
  hub.state.tools["funes.minutes_get"] = (args) => ({ ok: false, status: "no_model", minutes_id: args.minutes_id, detail: "nothing loaded" });
  assert.deepEqual(await peopleFromMinutes("x"), { ok: false, status: "no_model", minutes_id: "x", detail: "nothing loaded" });
  hub.state.tools["funes.minutes_get"] = () => ({ __error: { status: 404, error: "Unknown session: x" } });
  assert.equal((await peopleFromMinutes("x")).status, "unknown_minutes");
  hub.state.tools["funes.minutes_get"] = () => ({ __error: { status: 500, error: "boom" } });
  assert.equal((await peopleFromMinutes("x")).status, "funes_error");
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Marta"], { title: "" });
  assert.equal((await peopleFromMinutes("x")).status, "no_title");
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try { assert.equal((await peopleFromMinutes("x")).status, "hub_down"); } finally { process.env.HOARD_HUB_URL = saved; }
  await assert.rejects(() => peopleFromMinutes("  "), /minutes_id/);
});

test("an older Funes without minutes_get is read through scribe_minutes, only when asked to write minutes", async () => {
  hub.state.tools["funes.minutes_get"] = () => ({ __error: { status: 404, error: "Unknown tool: minutes_get" } });
  const quiet = await peopleFromMinutes("old-1");
  assert.equal(quiet.status, "tool_missing");
  const person = people.createPerson({ name: "Julia Nieto" });
  hub.state.minutes["old-1"] = { status: "ready", minutes: { session_id: "old-1", title: "Reunión antigua", started_at: "2026-09-30T10:00:00", participants: ["Julia Nieto"], action_items: [{ owner: "yo", counterpart: "Marta Lozano", action: "x" }] } };
  const out = await peopleFromMinutes("old-1", { generate: true });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.matched.map((m) => m.person).sort(), ["Julia Nieto", "Marta Lozano"]);
  assert.equal(out.date, "2026-09-30");
  assert.equal(meetLines(person.id).length, 1);
  delete hub.state.tools["funes.minutes_get"];
});

test("the tool and the REST route do the same", async () => {
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Pedro Gil"], { title: "Cierre de obra", date: "2026-10-05" });
  const viaTool = await s.agent("people_from_minutes", { minutes_id: "ses-9" });
  assert.equal(viaTool.status, 200, JSON.stringify(viaTool.body));
  assert.equal(viaTool.body.logged, 1);
  const viaRest = await s.call("POST", "/api/meetings/from-minutes", { minutes_id: "ses-9" });
  assert.equal(viaRest.status, 200);
  assert.equal(viaRest.body.already, 1);
  const bad = await s.agent("people_from_minutes", {});
  assert.equal(bad.status, 400);
});

test("a person merged into another keeps the meeting once", async () => {
  const a = people.createPerson({ name: "Duplicado Uno" });
  const b = people.createPerson({ name: "Duplicado Dos" });
  hub.state.tools["funes.minutes_get"] = (args) => MINUTES(args.minutes_id, ["Duplicado Uno", "Duplicado Dos"], { title: "Doble", date: "2026-10-06" });
  await peopleFromMinutes("ses-merge");
  const merged = people.mergePeople(a.id, b.id);
  assert.equal(merged.id, a.id);
  assert.equal(meetLines(a.id).length, 1);
});
