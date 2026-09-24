import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer, FIXTURE_PEOPLE } from "./helpers.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("health and state bootstrap", async () => {
  const health = await s.call("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(health.body).sort(), ["dataDirConfigured", "hoard_link", "service", "version"]);
  assert.equal(typeof health.body.hoard_link.events, "boolean");
  assert.equal(health.body.service, "peoples-hoard");
  const state = await s.call("GET", "/api/state");
  assert.equal(state.status, 200);
  assert.equal(state.body.dataDir, s.dataDir);
  assert.deepEqual(state.body.circles, []);
});

test("people CRUD with validation", async () => {
  const bad = await s.call("POST", "/api/people", { name: "" });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);

  const badBirthday = await s.call("POST", "/api/people", { name: "Test", birthday: "31-02-2020" });
  assert.equal(badBirthday.status, 400);

  const created = await s.call("POST", "/api/people", FIXTURE_PEOPLE[0]);
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "José Ramírez");
  assert.deepEqual(created.body.circles, ["amigos"]);
  assert.equal(created.body.archived, false);

  const patched = await s.call("PATCH", `/api/people/${created.body.id}`, { location: "Madrid", circles: ["amigos", "trabajo"] });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.location, "Madrid");
  assert.deepEqual(patched.body.circles, ["amigos", "trabajo"]);
  assert.equal(patched.body.name, "José Ramírez", "untouched field kept");

  assert.equal((await s.call("PATCH", "/api/people/nope", { location: "x" })).status, 404);
  assert.equal((await s.call("GET", "/api/people/nope")).status, 404);

  const full = await s.call("GET", `/api/people/${created.body.id}`);
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.aliases, []);
  assert.deepEqual(full.body.facts, []);
  assert.equal(full.body.days_since_contact, null);
});

test("aliases, facts, interactions and reminders nested under a person", async () => {
  const person = (await s.call("POST", "/api/people", { name: "Ana García", nickname: "Anita" })).body;

  const alias = await s.call("POST", `/api/people/${person.id}/aliases`, { kind: "email", value: "ana@example.test" });
  assert.equal(alias.status, 201);
  const dupAlias = await s.call("POST", `/api/people/${person.id}/aliases`, { kind: "email", value: "ana@example.test" });
  assert.equal(dupAlias.status, 201, "idempotent for the same person");
  assert.equal(dupAlias.body.id, alias.body.id);

  const other = (await s.call("POST", "/api/people", { name: "Otra Persona" })).body;
  const clash = await s.call("POST", `/api/people/${other.id}/aliases`, { kind: "email", value: "ana@example.test" });
  assert.equal(clash.status, 409);

  const fact = await s.call("POST", `/api/people/${person.id}/facts`, { key: "le gusta", value: "la montaña" });
  assert.equal(fact.status, 201);
  const dupFact = await s.call("POST", `/api/people/${person.id}/facts`, { key: "le gusta", value: "la montaña" });
  assert.equal(dupFact.body.id, fact.body.id, "idempotent on key+value");

  const interaction = await s.call("POST", `/api/people/${person.id}/interactions`, { channel: "whatsapp", summary: "Quedamos para comer.", at: "2026-09-01T12:00:00.000Z" });
  assert.equal(interaction.status, 201);
  let refreshed = await s.call("GET", `/api/people/${person.id}`);
  assert.equal(refreshed.body.last_contact_at, "2026-09-01T12:00:00.000Z");

  // A later interaction moves last_contact_at forward; deleting it moves it back.
  const later = await s.call("POST", `/api/people/${person.id}/interactions`, { channel: "call", at: "2026-09-10T09:00:00.000Z" });
  refreshed = await s.call("GET", `/api/people/${person.id}`);
  assert.equal(refreshed.body.last_contact_at, "2026-09-10T09:00:00.000Z");
  await s.call("DELETE", `/api/interactions/${later.body.id}`);
  refreshed = await s.call("GET", `/api/people/${person.id}`);
  assert.equal(refreshed.body.last_contact_at, "2026-09-01T12:00:00.000Z");

  const reminder = await s.call("POST", `/api/people/${person.id}/reminders`, { due: "2026-10-01", text: "Enviar el libro que le prometí." });
  assert.equal(reminder.status, 201);
  assert.equal(reminder.body.done, false);
  const completed = await s.call("PATCH", `/api/reminders/${reminder.body.id}`, { done: true });
  assert.equal(completed.body.done, true);

  await s.call("DELETE", `/api/aliases/${alias.body.id}`);
  await s.call("DELETE", `/api/facts/${fact.body.id}`);
  refreshed = await s.call("GET", `/api/people/${person.id}`);
  assert.deepEqual(refreshed.body.aliases, []);
  assert.deepEqual(refreshed.body.facts, []);
});

test("search: q, circle and archived filters; accent-insensitive and partial", async () => {
  await s.call("POST", "/api/people", { name: "Fixture Search José Ramírez", circles: ["prueba-busqueda"] });
  const byFold = await s.call("GET", "/api/people?q=jose+ramirez");
  assert.ok(byFold.body.some((p) => p.name.includes("José Ramírez")));

  const byCircle = await s.call("GET", "/api/people?circle=prueba-busqueda");
  assert.equal(byCircle.body.length, 1);

  const archivedTarget = byCircle.body[0];
  await s.call("PATCH", `/api/people/${archivedTarget.id}`, { archived: true });
  assert.equal((await s.call("GET", "/api/people?circle=prueba-busqueda")).body.length, 0, "archived hidden by default");
  assert.equal((await s.call("GET", "/api/people?circle=prueba-busqueda&archived=true")).body.length, 1);
  assert.equal((await s.call("GET", "/api/people?circle=prueba-busqueda&archived=all")).body.length, 1);
});

test("resolve, circles and upcoming (birthdays, reminders, neglected)", async () => {
  const soon = await s.call("POST", "/api/people", { name: "Cumple Pronto", birthday: "--01-01", contact_every_days: 7 });
  const resolved = await s.call("GET", "/api/resolve?name=Cumple Pronto");
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.person.id, soon.body.id);

  const unknown = await s.call("GET", "/api/resolve?name=Nadie Que Exista Xyz");
  assert.equal(unknown.body.person, null);

  const circles = await s.call("GET", "/api/circles");
  assert.equal(circles.status, 200);
  assert.ok(Array.isArray(circles.body));

  await s.call("POST", `/api/people/${soon.body.id}/reminders`, { due: "2099-01-01", text: "Muy lejos, no debería salir en la ventana de 30 días." });
  const nearDue = "2026-10-01";
  const nearReminder = await s.call("POST", `/api/people/${soon.body.id}/reminders`, { due: nearDue, text: "Cerca." });

  const upcoming = await s.call("GET", "/api/upcoming?days=400");
  assert.equal(upcoming.status, 200);
  assert.ok(upcoming.body.birthdays.some((b) => b.person_id === soon.body.id));
  assert.ok(upcoming.body.reminders.some((r) => r.id === nearReminder.body.id));
  assert.ok(upcoming.body.neglected.some((n) => n.person_id === soon.body.id), "never contacted + cadence set => neglected");
  assert.match(upcoming.body.summary, /cumpleaños/);
});

test("merge endpoint and delete", async () => {
  const keep = (await s.call("POST", "/api/people", { name: "Merge Keep" })).body;
  const drop = (await s.call("POST", "/api/people", { name: "Merge Drop" })).body;
  const merged = await s.call("POST", "/api/people/merge", { keep_id: keep.id, drop_id: drop.id });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.id, keep.id);
  assert.equal((await s.call("GET", `/api/people/${drop.id}`)).status, 404);

  const del = await s.call("DELETE", `/api/people/${keep.id}`);
  assert.equal(del.body.ok, true);
});

test("export then import round-trips through a fresh id space", async () => {
  await s.call("POST", "/api/people", { name: "Exportable Uno", circles: ["export-test"] });
  const before = await s.call("GET", "/api/people?circle=export-test");
  const dump = await s.call("GET", "/api/export");
  assert.equal(dump.status, 200);
  assert.ok(dump.body.people.length >= 1);

  const imported = await s.call("POST", "/api/import", dump.body);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.people, dump.body.people.length);

  const after = await s.call("GET", "/api/people?circle=export-test&archived=all");
  assert.equal(after.body.length, before.body.length * 2, "import duplicated the fixtures under new ids");
});

test("unknown API routes and bad JSON answer with { error }", async () => {
  assert.equal((await s.call("GET", "/api/nothing")).status, 404);
  const response = await fetch(`${s.base}/api/people`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
});
