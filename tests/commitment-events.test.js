// `people.commitment.added` is what the hub turns into a deadline: it carries title, due, ref and person,
// and is only sent for what the user owes and has a day for. The rest is announced as `people.commitment.noted`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { today, addDays } from "../server/dates.js";
import * as people from "../server/people.js";
import * as commitments from "../server/commitments.js";

const wait = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
};

let s, hub, marta;
const T = today();
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});
const events = (type, id) => hub.state.emitted.filter((e) => e.type === type && e.data.id === id);

test("what I owe with a day is announced as added, with title, due, ref and person", async () => {
  const added = (await s.agent("commitment_add", { direction: "i_owe", person: "Marta", text: "Enviar el presupuesto revisado", due: addDays(T, 5) })).body.commitment;
  assert.ok(await wait(() => events("people.commitment.added", added.id).length === 1));
  const [event] = events("people.commitment.added", added.id);
  assert.equal(event.source, "people");
  assert.equal(event.data.title, "Enviar el presupuesto revisado (Marta Lozano)");
  assert.equal(event.data.due, addDays(T, 5));
  assert.equal(event.data.ref, `hoard://people/commitment/${added.id}`);
  assert.equal(event.data.person, "Marta Lozano");
  assert.equal(event.data.direction, "i_owe");
  assert.equal(events("people.commitment.noted", added.id).length, 0);
});

test("what someone owes me, or what has no day yet, is only noted: no deadline rule fires for it", async () => {
  const theirs = (await s.agent("commitment_add", { direction: "owed_to_me", person: "Marta", text: "Devolverme el libro", due: addDays(T, 5) })).body.commitment;
  const dateless = (await s.agent("commitment_add", { direction: "i_owe", person: "Marta", text: "Mandarle las fotos", due_text: "algún día" })).body.commitment;
  assert.ok(await wait(() => events("people.commitment.noted", theirs.id).length === 1 && events("people.commitment.noted", dateless.id).length === 1));
  assert.equal(events("people.commitment.added", theirs.id).length, 0);
  assert.equal(events("people.commitment.added", dateless.id).length, 0);
  const noted = events("people.commitment.noted", theirs.id)[0].data;
  assert.equal(noted.text, "Devolverme el libro");
  assert.equal(noted.direction, "owed_to_me");
});

test("a commitment that becomes mine with a day later (a day added, or the review queue) is announced then", async () => {
  const dateless = (await s.agent("commitment_add", { direction: "i_owe", person: "Marta", text: "Reservar la sala" })).body.commitment;
  assert.ok(await wait(() => events("people.commitment.noted", dateless.id).length === 1));
  await s.agent("commitment_update", { id: dateless.id, due: addDays(T, 9) });
  assert.ok(await wait(() => events("people.commitment.added", dateless.id).length === 1));
  assert.equal(events("people.commitment.added", dateless.id)[0].data.due, addDays(T, 9));
  await s.agent("commitment_update", { id: dateless.id, text: "Reservar la sala grande" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(events("people.commitment.added", dateless.id).length, 1, "an edit that changes nothing about being a deadline announces nothing");
  // from the review queue: an unknown owner, then the user says it is mine
  const queued = commitments.listReview();
  assert.ok(Array.isArray(queued));
  const flipped = (await s.agent("commitment_add", { direction: "owed_to_me", person: "Marta", text: "Pagar la cena", due: addDays(T, 4) })).body.commitment;
  await wait(() => events("people.commitment.noted", flipped.id).length === 1);
  await s.agent("commitment_update", { id: flipped.id, direction: "i_owe" });
  assert.ok(await wait(() => events("people.commitment.added", flipped.id).length === 1));
  assert.equal(events("people.commitment.added", flipped.id)[0].data.title, "Pagar la cena (Marta Lozano)");
});

test("a meeting's own promise with a day reaches the hub as added; imports and done ones stay silent", async () => {
  const out = commitments.ingestMinutes({
    session_id: "ses-ev", title: "Reunión", started_at: `${T}T10:00:00`,
    action_items: [{ owner: "yo", action: "Entregar el informe", counterpart: "Marta Lozano", due_date: addDays(T, 7), evidence: { start_s: 5, speaker: "yo", quote: "yo entrego el informe" } }],
  });
  const id = out.commitments[0];
  assert.ok(await wait(() => events("people.commitment.added", id).length === 1));
  assert.equal(events("people.commitment.added", id)[0].data.ref, `hoard://people/commitment/${id}`);
  const quiet = commitments.addCommitment({ direction: "i_owe", person_id: marta.id, text: "Importado", due: addDays(T, 3) }, { emit: false }).commitment;
  const closed = commitments.addCommitment({ direction: "i_owe", person_id: marta.id, text: "Hecho", due: addDays(T, 3) }).commitment;
  commitments.completeCommitment(closed.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(events("people.commitment.added", quiet.id).length + events("people.commitment.noted", quiet.id).length, 0);
  assert.equal(events("people.commitment.done", closed.id).length, 1);
});
