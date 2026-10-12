// The Faustus copilot's view of the app: real objects per view, unsaved form fields, changed-only saves, refresh on turn end.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContext, changedFields, collectContext, installCopilot, parseRoute, rebaseForm, registerProvider, subscribeRefresh,
} from "../client/src/copilot-context.js";

const person = {
  id: "p1", name: "Ana Garcia", nickname: "Anita", circles: ["familia", "amigos"], birthday: "1990-03-14", location: "Sevilla", summary: "Prima de Sevilla.",
  archived: false, contact_every_days: 30, days_since_contact: 12,
  facts: [{ id: "f1", key: "le gusta", value: "el senderismo" }], aliases: [{ id: "a1" }], interactions: [{ id: "i1" }],
  reminders: [{ id: "r1", text: "Llamar", due: "2026-10-20", kind: "custom", done: false }, { id: "r2", text: "Hecho", due: "2026-10-01", done: true }],
};
const commitments = [{ id: "c1", text: "Devolver el libro", direction: "i_owe", status: "open", due: "2026-10-18", person_id: "p1", person_name: "Ana Garcia", overdue: false, source: { kind: "manual" } }];
const gifts = [{ id: "g1", idea: "Mochila", status: "idea", budget: 60, person_id: "p1", watched: false }];
const deps = {
  getPerson: async (id) => { if (id !== "p1") throw new Error("not found"); return person; },
  getCommitment: async (id) => { if (id !== "c1") throw new Error("not found"); return commitments[0]; },
  listCommitments: async () => ({ commitments }),
  listGifts: async () => ({ gifts }),
};
const ids = (ctx) => ctx.active_objects.map((o) => `${o.kind}:${o.object_id}`);

test("only the fields the user changed are sent, including manual clears", () => {
  assert.deepEqual(changedFields({ name: "Ana", nickname: "Anita", location: "Sevilla" }, { name: "Ana", nickname: "", location: "Madrid" }), { nickname: "", location: "Madrid" });
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), {});
});

test("a reload keeps what the user typed and updates the rest", () => {
  const before = { name: "Ana", location: "Sevilla" };
  const form = { name: "Ana", location: "Madrid" };
  const after = { name: "Ana Garcia", location: "Sevilla" };
  assert.deepEqual(rebaseForm(before, after, form), { name: "Ana Garcia", location: "Madrid" });
  assert.deepEqual(changedFields(before, form), { location: "Madrid" });   // the assistant's rename survives the user's save
});

test("route parsing defaults to the people list", () => {
  assert.equal(parseRoute("").page, "personas");
  assert.deepEqual([parseRoute("#/personas/p1").page, parseRoute("#/personas/p1").param], ["personas", "p1"]);
});

test("a person's page returns the real person, facts, open reminders, open commitments and gift ideas", async () => {
  const editors = [{ kind: "person-form", object_id: "p1", dirty: true, fields: { location: "Madrid" }, changed: { location: "Madrid" } }];
  const ctx = await buildContext({ ...deps, hash: "#/personas/p1", editors, view: {} });
  assert.deepEqual(ids(ctx), ["person:p1", "fact:f1", "reminder:r1", "commitment:c1", "gift:g1"]);
  const p = ctx.active_objects[0];
  assert.equal(p.title, "Ana Garcia");
  assert.deepEqual(p.circles, ["familia", "amigos"]);
  assert.equal(p.facts, 1);
  assert.equal(p.open_reminders, 1);
  assert.equal(ctx.view.page, "person");
  assert.equal(ctx.view.object_id, "p1");
  assert.deepEqual(ctx.view.editor.changed, { location: "Madrid" });
});

test("unknown, new and plain list views yield no object and never throw", async () => {
  for (const hash of ["#/personas/nope", "#/personas/new", "", "#/personas", "#/agenda", "#/ajustes", "#/compromisos"]) {
    const ctx = await buildContext({ ...deps, hash, editors: [], view: {} });
    assert.deepEqual(ctx.active_objects, [], hash);
    assert.ok(ctx.view.page);
  }
  const broken = { getPerson: async () => { throw new Error("down"); }, getCommitment: async () => { throw new Error("down"); }, listCommitments: async () => { throw new Error("down"); }, listGifts: async () => { throw new Error("down"); } };
  assert.deepEqual((await buildContext({ ...broken, hash: "#/personas/p1", editors: [], view: {} })).active_objects, []);
});

test("list views carry their filters; the person filter adds that person", async () => {
  const list = await buildContext({ ...deps, hash: "#/personas", editors: [], view: { filters: { q: "ana", circle: "familia" } } });
  assert.deepEqual(list.view.filters, { q: "ana", circle: "familia" });
  assert.equal(list.view.page, "people");
  const promises = await buildContext({ ...deps, hash: "#/compromisos", editors: [], view: { filters: { status: "open", person: "p1" }, review_count: 2 } });
  assert.deepEqual(ids(promises), ["person:p1"]);
  assert.equal(promises.view.review_count, 2);
  assert.equal((await buildContext({ ...deps, hash: "#/agenda", editors: [], view: { days: 14 } })).view.days, 14);
});

test("an open commitment editor adds its commitment; creation forms add none", async () => {
  const ctx = await buildContext({ ...deps, hash: "#/compromisos", view: {}, editors: [
    { kind: "commitment-form", object_id: "c1", dirty: true, fields: { due: "2026-10-30" } },
    { kind: "commitment-form", object_id: "gone", dirty: false, fields: {} },
    { kind: "commitment-new", object_id: null, dirty: true, fields: { text: "Nuevo" } },
  ] });
  assert.deepEqual(ids(ctx), ["commitment:c1"]);
  assert.equal(ctx.view.editors.length, 3);
  assert.equal(ctx.view.editor.kind, "commitment-form");
  const creating = await buildContext({ ...deps, hash: "#/personas", view: {}, editors: [{ kind: "person-new", object_id: null, dirty: true, fields: { name: "Luis" } }] });
  assert.deepEqual(creating.active_objects, []);
  assert.deepEqual(creating.view.editor.fields, { name: "Luis" });
});

test("pages and forms answer the context request", () => {
  const target = new EventTarget();
  registerProvider(() => ({ view: { days: 7 }, editors: [{ kind: "fact-new", object_id: null }, null] }), target);
  registerProvider(() => ({ editors: [{ kind: "person-form", object_id: "p1" }] }), target);
  registerProvider(() => { throw new Error("a broken provider must not break the others"); }, target);
  const { editors, view } = collectContext(target);
  assert.deepEqual(editors.map((e) => e.kind), ["person-form", "fact-new"]);
  assert.equal(view.days, 7);
});

test("turn end (event and callback) refreshes once", async () => {
  const target = new EventTarget();
  installCopilot(target);
  assert.equal(typeof target.hoardCopilot.context, "function");
  let calls = 0;
  const off = subscribeRefresh(() => { calls += 1; });
  target.dispatchEvent(new Event("hoard:copilot-turn-end"));
  target.hoardCopilot.onTurnEnd();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls, 1);
  off();
});
