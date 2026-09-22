import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bootServer } from "./helpers.js";
import { TOOLS } from "../server/agent-tools.js";

const EXPECTED = [
  "find_people", "get_person", "upsert_person", "add_alias", "add_fact", "log_interaction",
  "add_reminder", "complete_reminder", "upcoming", "list_people", "merge_people", "delete_person",
];

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("tool list is public and complete, with Spanish synonyms", async () => {
  const r = await s.call("GET", "/api/agent/tools");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tools.map((t) => t.name), EXPECTED);
  assert.ok(r.body.instructions.length > 100);
  for (const t of r.body.tools) {
    assert.match(t.description, /\nSinónimos: /, `${t.name} has a Sinónimos line`);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === "boolean");
  }
  assert.equal(r.body.tools.find((t) => t.name === "delete_person").annotations.destructiveHint, true);
  assert.equal(r.body.tools.find((t) => t.name === "merge_people").annotations.destructiveHint, true);
  assert.equal(TOOLS.length, EXPECTED.length);
});

test("agent/call requires the bearer token from the data dir", async () => {
  assert.equal((await s.call("POST", "/api/agent/call", { name: "list_people", arguments: {} })).status, 401);
  assert.equal((await s.call("POST", "/api/agent/call", { name: "list_people", arguments: {} }, { Authorization: "Bearer nope" })).status, 401);
  const token = fs.readFileSync(path.join(s.dataDir, "mcp-token"), "utf8").trim();
  assert.equal(token, s.token);
  assert.equal(token.length, 64);
  const ok = await s.call("POST", "/api/agent/call", { name: "list_people", arguments: {} }, { Authorization: `Bearer ${token}` });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { people: [] });
  assert.equal((await s.agent("nope", {})).status, 404);
  assert.equal((await s.agent("upsert_person", {})).status, 400);
});

test("upsert_person creates then updates idempotently by name", async () => {
  const created = await s.agent("upsert_person", { person: "Contacto de Agente", circles: ["trabajo"], summary: "Se conocieron en una conferencia." });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.created, true);
  const updated = await s.agent("upsert_person", { person: "Contacto de Agente", location: "Valencia" });
  assert.equal(updated.body.created, false);
  assert.equal(updated.body.person.id, created.body.person.id);
  assert.equal(updated.body.person.circles.length, 1, "circles kept, only location changed");
});

test("find_people and get_person resolve fuzzily and report ambiguity", async () => {
  const found = await s.agent("find_people", { query: "contacto de agente" });
  assert.equal(found.status, 200);
  assert.ok(found.body.candidates.length >= 1);
  const personId = found.body.candidates[0].id;

  const got = await s.agent("get_person", { person: personId });
  assert.equal(got.status, 200);
  assert.equal(got.body.id, personId);
  assert.ok(Array.isArray(got.body.interactions));
  assert.ok(Array.isArray(got.body.reminders));
  assert.equal(got.body.reminders.every((r) => !r.done), true, "only open reminders");

  assert.equal((await s.agent("get_person", { person: "Nadie Que No Existe Jamas" })).status, 400);

  // Two people sharing a name resolve to candidates, not a guess.
  await s.agent("upsert_person", { person: "Duplicado Test" });
  await s.call("POST", "/api/people", { name: "Duplicado Test" });
  const ambiguous = await s.agent("get_person", { person: "Duplicado Test" });
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.body.candidates.length, 2);
});

test("add_alias, add_fact and log_interaction resolve the person by name", async () => {
  await s.agent("upsert_person", { person: "Persona Con Alias" });
  const alias = await s.agent("add_alias", { person: "Persona Con Alias", kind: "whatsapp", value: "PCA" });
  assert.equal(alias.status, 200);
  const again = await s.agent("add_alias", { person: "Persona Con Alias", kind: "whatsapp", value: "PCA" });
  assert.equal(again.body.alias.id, alias.body.alias.id, "idempotent");

  // Resolves by the alias itself too.
  const byAlias = await s.agent("get_person", { person: "PCA" });
  assert.equal(byAlias.status, 200);

  const fact = await s.agent("add_fact", { person: "Persona Con Alias", key: "trabaja en", value: "Empresa Ficticia S.L." });
  assert.equal(fact.status, 200);

  const interaction = await s.agent("log_interaction", { person: "Persona Con Alias", channel: "whatsapp", summary: "Hablamos de vacaciones." });
  assert.equal(interaction.status, 200);
  assert.equal(interaction.body.interaction.source, "agent");
  const person = await s.agent("get_person", { person: "Persona Con Alias" });
  assert.equal(person.body.days_since_last_contact, 0);
});

test("add_reminder, complete_reminder and upcoming", async () => {
  await s.agent("upsert_person", { person: "Persona Recordatorio", contact_every_days: 3 });
  const reminder = await s.agent("add_reminder", { person: "Persona Recordatorio", due: "2026-10-15", text: "Enviar felicitación." });
  assert.equal(reminder.status, 200);
  const upcoming = await s.agent("upcoming", { days: 365 });
  assert.equal(upcoming.status, 200);
  assert.ok(upcoming.body.reminders.some((r) => r.id === reminder.body.reminder.id));
  assert.ok(upcoming.body.neglected.some((n) => n.name === "Persona Recordatorio"), "never contacted, cadence set");
  const done = await s.agent("complete_reminder", { id: reminder.body.reminder.id });
  assert.equal(done.body.reminder.done, true);
  assert.equal((await s.agent("complete_reminder", { id: "nope" })).status, 404);
});

test("list_people filters by circle", async () => {
  await s.agent("upsert_person", { person: "Persona Circulo Test", circles: ["circulo-agente"] });
  const listed = await s.agent("list_people", { circle: "circulo-agente" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.people.length, 1);
  assert.equal(listed.body.people[0].name, "Persona Circulo Test");
});

test("merge_people and delete_person are destructive and confirmable", async () => {
  const keep = await s.agent("upsert_person", { person: "Fusion Mantener" });
  const drop = await s.agent("upsert_person", { person: "Fusion Eliminar" });
  await s.agent("add_fact", { person: "Fusion Eliminar", key: "nota", value: "dato a conservar" });
  const merged = await s.agent("merge_people", { keep_id: keep.body.person.id, drop_id: drop.body.person.id });
  assert.equal(merged.status, 200);
  const full = await s.agent("get_person", { person: keep.body.person.id });
  assert.ok(full.body.facts.some((f) => f.value === "dato a conservar"));
  assert.equal((await s.agent("get_person", { person: drop.body.person.id })).status, 400);

  const del = await s.agent("delete_person", { id: keep.body.person.id });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted.id, keep.body.person.id);
  assert.equal((await s.agent("delete_person", { id: keep.body.person.id })).status, 404);
});
