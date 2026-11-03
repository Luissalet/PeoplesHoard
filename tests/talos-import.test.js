// commitments_import_talos: only firm commitments from a Talos meeting are imported, once; the rest is rejected with the reason.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import * as people from "../server/people.js";
import * as commitments from "../server/commitments.js";
import { listInteractions } from "../server/interactions.js";

let s, hub, marta, pedro;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
  pedro = people.createPerson({ name: "Pedro Gil" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

const SESSION = "20261002-100000-ab12";
const source = (item, start, quote) => ({ app: "talos", session_id: SESSION, ref: `talos:${SESSION}#${item}`, title: "Reunión de la reforma", start_s: start, end_s: start + 8, quote, speaker: "yo" });
// what Talos's scribe_requirements (format commitments) returns for the Spanish/English fixture meeting of 2026-10-02
const FIRM_MINE = {
  schema: "talos.commitment/1", kind: "commitment", firm: true, item_id: "rq-aaa111", text: "Vale, yo me encargo de enviar el presupuesto revisado a Marta el martes.",
  owner: "yo", counterpart: "Marta Lozano", due: "2026-10-06", due_text: "el martes", confidence: 0.9, cue: "yo me encargo",
  source: source("rq-aaa111", 6, "Vale, yo me encargo de enviar el presupuesto revisado a Marta el martes."),
};
const FIRM_THEIRS = {
  schema: "talos.commitment/1", kind: "commitment", firm: true, item_id: "rq-bbb222", text: "Pedro enviará el informe de costes el viernes.",
  owner: "Pedro Gil", counterpart: null, due: "2026-10-09", due_text: "el viernes", confidence: 0.78, cue: "enviará",
  source: { ...source("rq-bbb222", 70, "Pedro enviará el informe de costes el viernes."), speaker: "otros" },
};
const FIRM_UNKNOWN_OWNER = {
  schema: "talos.commitment/1", kind: "commitment", firm: true, item_id: "rq-ccc333", text: "I'll send the signed contract to Pedro by Friday.", owner: "otros",
  counterpart: "Pedro", due: "2026-10-09", due_text: "by Friday", confidence: 0.9, cue: "I'll send", source: { ...source("rq-ccc333", 120, "I'll send the signed contract to Pedro by Friday."), speaker: "otros" },
};
const PROPOSAL = { kind: "proposal", firm: false, item_id: "rq-ddd444", text: "Podríamos mover la entrega al jueves si hace falta.", cue: "Podríamos", source: source("rq-ddd444", 14, "Podríamos mover la entrega al jueves si hace falta.") };
const meeting = { title: "Reunión de la reforma", at: "2026-10-02T10:00:00Z", session_id: SESSION };

test("a proposal is rejected with its reason and nothing is created", () => {
  const out = commitments.importFromTalos({ commitments: [PROPOSAL], meeting });
  assert.equal(out.imported, 0);
  assert.equal(out.queued, 0);
  assert.equal(out.rejected.length, 1);
  assert.equal(out.rejected[0].code, "proposal");
  assert.match(out.rejected[0].reason, /propuesta/);
  assert.equal(out.rejected[0].item_id, "rq-ddd444");
  assert.equal(commitments.listCommitments({ status: "all" }).length, 0);
});

test("only firm commitments are imported: every other kind and unmarked items are rejected", () => {
  const items = [
    { kind: "question", text: "Marta, ¿puedes confirmar el presupuesto?", source: { ref: "talos:x#q" } },
    { kind: "decision", text: "Hemos decidido usar la opción B.", source: { ref: "talos:x#d" } },
    { kind: "requirement", text: "La aplicación debe exportar a PDF.", source: { ref: "talos:x#r" } },
    { kind: "commitment", firm: false, text: "Quizá lo mando.", source: { ref: "talos:x#nf" } },
    { kind: "commitment", firm: true, text: "Lo hago yo.", source: {} },
    { kind: "commitment", firm: true, text: "", source: { ref: "talos:x#e" } },
    "not an object",
  ];
  const out = commitments.importFromTalos({ items });
  assert.equal(out.imported + out.queued, 0);
  assert.deepEqual(out.rejected.map((r) => r.code), ["not_commitment", "not_commitment", "not_commitment", "not_firm", "no_source_ref", "no_text", "invalid"]);
  assert.ok(out.rejected.every((r) => r.reason.length > 10));
  assert.equal(commitments.listCommitments({ status: "all" }).length, 0);
  assert.throws(() => commitments.importFromTalos({}), /commitments/);
});

test("a firm commitment is imported once and dated; the same source reference is never created twice", () => {
  const payload = { commitments: [FIRM_MINE, FIRM_THEIRS, PROPOSAL], meeting };
  const first = commitments.importFromTalos(payload, { today: "2026-10-02" });
  assert.equal(first.status, "imported");
  assert.equal(first.imported, 2);
  assert.equal(first.duplicates, 0);
  assert.equal(first.rejected.length, 1);
  assert.equal(first.commitments.length, 2);

  const mine = commitments.getCommitment(first.commitments[0]);
  assert.equal(mine.direction, "i_owe");
  assert.equal(mine.person_id, marta.id);
  assert.equal(mine.due, "2026-10-06");
  assert.equal(mine.due_text, "el martes");
  assert.deepEqual(mine.source, { kind: "funes", ref: `talos:${SESSION}#rq-aaa111`, quote: FIRM_MINE.text, at: "2026-10-02T10:00:06.000Z" });
  const theirs = commitments.getCommitment(first.commitments[1]);
  assert.equal(theirs.direction, "owed_to_me");
  assert.equal(theirs.person_id, pedro.id);
  assert.equal(theirs.source.at, "2026-10-02T10:01:10.000Z");

  const again = commitments.importFromTalos(payload, { today: "2026-10-02" });
  assert.equal(again.imported, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(again.rejected.length, 1);
  assert.equal(commitments.listCommitments({ status: "all" }).length, 2);
  // a reordered batch with an extra copy of the same item inside it is still the same two commitments
  const shuffled = commitments.importFromTalos({ commitments: [FIRM_THEIRS, FIRM_MINE, FIRM_MINE], meeting });
  assert.equal(shuffled.imported, 0);
  assert.equal(shuffled.duplicates, 3);
  // the meeting lands once on each person's timeline
  assert.equal(listInteractions(marta.id).filter((i) => /Reunión de la reforma/.test(i.summary || i.text || JSON.stringify(i))).length, 1);
});

test("dedup holds after the commitment was completed or dropped, and after its review was settled", () => {
  const ref = commitments.listCommitments({ status: "all" }).find((c) => c.source.ref.endsWith("rq-aaa111"));
  commitments.completeCommitment(ref.id);
  assert.equal(commitments.importFromTalos({ commitments: [FIRM_MINE], meeting }).duplicates, 1);
  commitments.dropCommitment(ref.id);
  assert.equal(commitments.importFromTalos({ commitments: [FIRM_MINE], meeting }).duplicates, 1);

  const queued = commitments.importFromTalos({ commitments: [FIRM_UNKNOWN_OWNER], meeting });
  assert.equal(queued.imported, 0);
  assert.equal(queued.queued, 1);
  assert.equal(commitments.listReview().length, 1);
  assert.equal(commitments.importFromTalos({ commitments: [FIRM_UNKNOWN_OWNER], meeting }).duplicates, 1, "a waiting proposal is not queued twice");
  const review = commitments.listReview()[0];
  assert.equal(review.reason, "unassigned");
  const settled = commitments.resolveReview(review.id, { action: "accept", direction: "owed_to_me", person_id: pedro.id });
  assert.equal(settled.commitment.source.ref, `talos:${SESSION}#rq-ccc333`);
  assert.equal(commitments.importFromTalos({ commitments: [FIRM_UNKNOWN_OWNER], meeting }).duplicates, 1, "nor created again once the user settled it");
});

test("the REST route and the agent tool take the same payload", async () => {
  const fresh = { ...FIRM_MINE, item_id: "rq-eee555", text: "Yo envío las muestras el lunes.", source: source("rq-eee555", 200, "Yo envío las muestras el lunes.") };
  const rest = await s.call("POST", "/api/commitments/import-talos", { commitments: [fresh, PROPOSAL], meeting });
  assert.equal(rest.status, 200);
  assert.equal(rest.body.imported, 1);
  assert.equal(rest.body.rejected[0].code, "proposal");
  assert.equal(typeof rest.body.pending_review, "number");
  const tool = await s.agent("commitments_import_talos", { commitments: [fresh, PROPOSAL], meeting });
  assert.equal(tool.status, 200, JSON.stringify(tool.body));
  assert.equal(tool.body.imported, 0);
  assert.equal(tool.body.duplicates, 1);
  assert.equal(tool.body.rejected.length, 1);
  assert.equal((await s.agent("commitments_import_talos", { commitments: [] })).status, 400);
  const listed = await s.call("GET", "/api/agent/tools");
  const entry = listed.body.tools.find((t) => t.name === "commitments_import_talos");
  assert.match(entry.description, /\nSinónimos: /);
  assert.equal(entry.annotations.readOnlyHint, false);
  assert.ok(entry.description.split("\n", 1)[0].length <= 110);
});
