// Contexts: one living card per person or group, quick capture, items with a day and a reminder window, the digest lines
// and the agenda entries. Fictional fixtures only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { today, addDays } from "../server/dates.js";
import * as people from "../server/people.js";
import * as contexts from "../server/contexts.js";
import { nudgesReport } from "../server/nudges.js";
import { agendaItems } from "../server/agenda.js";

let s, hub, marta, pedro;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano", birthday: `1990-${addDays(today(), 30).slice(5)}` });
  pedro = people.createPerson({ name: "Pedro Gil" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

test("a person's context is created once and gathers what is captured for them", async () => {
  const first = await s.agent("context_capture", { person: "Marta", text: "Le gustaría una cafetera de émbolo", kind: "idea" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.created, true);
  assert.equal(first.body.context.kind, "person");
  assert.equal(first.body.context.person_id, marta.id);
  assert.equal(first.body.item.kind, "idea");
  assert.equal(first.body.item.status, "open");
  assert.equal(first.body.item.ref, `hoard://people/context-item/${first.body.item.id}`);

  const again = await s.agent("context_capture", { person: "Marta Lozano", text: "le gustaría una cafetera de émbolo" });
  assert.equal(again.body.created, false, "the same open idea is not saved twice");
  assert.equal(again.body.item.id, first.body.item.id);
  assert.equal(again.body.context.id, first.body.context.id, "a person has one context");

  const card = await s.agent("context_get", { context: "Marta" });
  assert.equal(card.status, 200, JSON.stringify(card.body));
  assert.equal(card.body.context.id, first.body.context.id);
  assert.equal(card.body.items.idea.length, 1);
  assert.equal(card.body.person.name, "Marta Lozano");
  assert.equal(card.body.dates[0].kind, "birthday");
  assert.equal(card.body.dates[0].days_until, 30);
});

test("a capture with no person and no context lands in «Sin asignar» and can be filed later", async () => {
  const loose = await s.agent("context_capture", { text: "Reservar mesa en el japonés" });
  assert.equal(loose.status, 200, JSON.stringify(loose.body));
  assert.equal(loose.body.context.name, "Sin asignar");
  assert.equal(loose.body.context.kind, "group");
  const listed = await s.agent("context_list", {});
  assert.ok(listed.body.contexts.some((c) => c.name === "Sin asignar" && c.open_items >= 1));
  const moved = await s.agent("context_item_add", { context: "Pedro", kind: "place", text: "El japonés del centro" });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.item.kind, "place");
});

test("a group context keeps its members and its own items", async () => {
  const created = await s.agent("context_create", { name: "La casa", kind: "group", people: ["Marta", "Pedro"], notes: "Piso de la playa" });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.created, true);
  const id = created.body.context.id;
  const twice = await s.agent("context_create", { name: "la casa", kind: "group" });
  assert.equal(twice.body.created, false, "the same group name is not created twice");
  assert.equal(twice.body.context.id, id);

  const card = await s.agent("context_get", { context: "La casa" });
  assert.deepEqual(card.body.members.map((m) => m.name).sort(), ["Marta Lozano", "Pedro Gil"]);
  assert.equal(card.body.context.notes, "Piso de la playa");

  const plan = await s.agent("context_item_add", { context: "La casa", kind: "plan", text: "Cambiar el colchón", due: addDays(today(), 10) });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.item.due, addDays(today(), 10));
  assert.equal((await s.agent("context_item_add", { context: "La casa", kind: "plan", text: "x", due: "10/12/2026" })).status, 400);
  assert.equal((await s.agent("context_item_add", { context: "La casa", kind: "plan", text: "x", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await s.agent("context_item_add", { context: "No existe", text: "x" })).status, 400);
});

test("a plan with a day comes back inside its reminder window, not before", async () => {
  const far = await s.agent("context_item_add", { context: "Pedro", kind: "plan", text: "Cumpleaños de su hija", due: addDays(today(), 40), remind_days_before: 21 });
  assert.equal(far.status, 200, JSON.stringify(far.body));
  const near = await s.agent("context_item_add", { context: "Pedro", kind: "pending", text: "Devolverle el libro", due: addDays(today(), 5) });
  assert.equal(near.status, 200, JSON.stringify(near.body));

  const upcoming = await s.agent("context_upcoming", { days: 60 });
  const texts = upcoming.body.items.map((i) => i.text);
  assert.ok(texts.includes("Devolverle el libro"));
  assert.ok(texts.includes("Cumpleaños de su hija"));
  const nearItem = upcoming.body.items.find((i) => i.text === "Devolverle el libro");
  assert.equal(nearItem.remind_now, true);
  assert.equal(nearItem.remind_days_before, 21, "21 days before by default");
  const farItem = upcoming.body.items.find((i) => i.text === "Cumpleaños de su hija");
  assert.equal(farItem.remind_now, false, "40 days away is outside a 21-day window");

  const report = nudgesReport({ today: today() });
  const titles = report.items.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes("Devolverle el libro")), "the open reminder reaches the digest");
  assert.ok(!titles.some((t) => t.includes("Cumpleaños de su hija")), "the far one does not yet");
  assert.ok(report.contexts.length >= 1);
});

test("«sin contestar a…» is a day, and it reaches the digest", async () => {
  const card = await s.agent("context_get", { context: "Pedro" });
  const id = card.body.context.id;
  const marked = await s.call("POST", `/api/contexts/${id}/reply`, { since: addDays(today(), -4) });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.awaiting_reply_since, addDays(today(), -4));
  const again = await s.agent("context_get", { context: "Pedro" });
  assert.equal(again.body.awaiting_reply_days, 4);
  const report = nudgesReport({ today: today() });
  assert.ok(report.items.some((i) => i.title === "Sin contestar a Pedro Gil desde hace 4 días"));
  const cleared = await s.call("POST", `/api/contexts/${id}/reply`, { since: null });
  assert.equal(cleared.body.awaiting_reply_since, null);
  assert.ok(!nudgesReport({ today: today() }).items.some((i) => i.title.startsWith("Sin contestar a")));
});

test("REST: list, card, add, change status, delete, and the person's own card", async () => {
  const list = await s.call("GET", "/api/contexts");
  assert.equal(list.status, 200);
  assert.ok(list.body.contexts.length >= 3);

  const personCard = await s.call("GET", `/api/people/${marta.id}/context`);
  assert.equal(personCard.status, 200, JSON.stringify(personCard.body));
  assert.equal(personCard.body.context.person_id, marta.id);

  const added = await s.call("POST", `/api/contexts/${personCard.body.context.id}/items`, { kind: "wish", text: "Una bici de gravel", budget: 800 });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const itemId = added.body.item.id;
  assert.equal(added.body.item.budget, 800);

  const done = await s.call("PATCH", `/api/context-items/${itemId}`, { status: "done" });
  assert.equal(done.body.status, "done");
  assert.ok(done.body.done_at);
  const card = await s.call("GET", `/api/contexts/${personCard.body.context.id}`);
  assert.equal(card.body.items.wish.length, 0, "a done item leaves the open groups");
  assert.ok(card.body.done.some((i) => i.id === itemId));

  assert.equal((await s.call("PATCH", `/api/context-items/${itemId}`, { status: "mal" })).status, 400);
  assert.equal((await s.call("DELETE", `/api/context-items/${itemId}`)).body.ok, true);
  assert.equal((await s.call("GET", "/api/contexts/no-existe")).status, 404);
  assert.equal((await s.call("GET", `/api/people/${pedro.id}/context`)).status, 200);
});

test("a plan with a day shows on the family agenda", async () => {
  const day = addDays(today(), 3);
  await s.agent("context_item_add", { context: "La casa", kind: "plan", text: "Pintar el salón", due: day });
  const items = agendaItems(today(), addDays(today(), 7));
  const found = items.find((i) => i.title === "Pintar el salón (La casa)");
  assert.ok(found, JSON.stringify(items.map((i) => i.title)));
  assert.equal(found.start, day);
});

test("merging two people keeps both cards' items in the kept one", async () => {
  const a = people.createPerson({ name: "Ana Duplicada" });
  const b = people.createPerson({ name: "Ana Duplicada Bis" });
  contexts.capture({ person: a.id, text: "Le gusta el té verde", kind: "taste" });
  contexts.capture({ person: b.id, text: "Quiere un libro de setas", kind: "idea" });
  people.mergePeople(a.id, b.id);
  const card = contexts.contextCard(contexts.ensurePersonContext(a.id).id);
  const texts = Object.values(card.items).flat().map((i) => i.text);
  assert.ok(texts.includes("Le gusta el té verde"));
  assert.ok(texts.includes("Quiere un libro de setas"));
  assert.equal(contexts.listContexts({}).filter((c) => c.person_id === b.id).length, 0);
});

test("a backup carries the contexts and restores them onto the new people", async () => {
  const backup = await s.call("GET", "/api/export");
  assert.equal(backup.status, 200);
  assert.ok(backup.body.contexts.contexts.length >= 3);
  assert.ok(backup.body.contexts.items.length >= 3);
  const restored = await s.call("POST", "/api/import", backup.body);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.ok(restored.body.contexts >= 3);
  assert.ok(restored.body.context_items >= 3);
});