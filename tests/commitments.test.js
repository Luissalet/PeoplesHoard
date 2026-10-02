// Commitments end to end: the tools, the REST API, minutes from Funes through a fake hub, the review queue,
// text extraction with a fake model, the digest, the brief, the calendar and the events.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { today, addDays } from "../server/dates.js";
import * as commitments from "../server/commitments.js";
import * as people from "../server/people.js";
import { calendarFeed } from "../server/calendar.js";
import { upcomingReport } from "../server/upcoming.js";
import { listInteractions } from "../server/interactions.js";

const wait = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return false;
};

let s, hub, marta, pedro, lucia1, lucia2;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = (await s.call("POST", "/api/people", { name: "Marta Lozano", circles: ["trabajo"] })).body;
  pedro = (await s.call("POST", "/api/people", { name: "Pedro Gil", circles: ["trabajo"] })).body;
  lucia1 = (await s.call("POST", "/api/people", { name: "Lucía Pérez" })).body;
  lucia2 = (await s.call("POST", "/api/people", { name: "Lucía Gómez" })).body;
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

const ev = (item) => ({ evidence: { start_s: 0, end_s: 5, speaker: "yo", quote: "frase literal" }, ...item });
const MINUTES = {
  session_id: "ses-1", title: "Reunión de la reforma", started_at: "2026-10-02T10:00:00",
  action_items: [
    ev({ owner: "yo", action: "Enviar el presupuesto revisado", counterpart: "Marta Lozano", due_text: "el martes", due_date: "2026-10-06", evidence: { start_s: 6, end_s: 14, speaker: "yo", quote: "yo me encargo de enviar el presupuesto revisado a Marta el martes" } }),
    ev({ owner: "Pedro Gil", action: "Preparar el informe de costes", counterpart: null, due_text: "el viernes que viene", due_date: null, evidence: { start_s: 14, end_s: 22, speaker: "otros", quote: "yo preparo el informe de costes" } }),
    ev({ owner: "Sofía", action: "Llamar al gremio", counterpart: null, due_text: "", due_date: null, evidence: { start_s: 30, end_s: 34, speaker: "otros", quote: "yo llamo al gremio" } }),
    ev({ owner: "Lucía", action: "Traer las muestras de azulejo", counterpart: null, due_text: "", due_date: null, evidence: { start_s: 40, end_s: 44, speaker: "otros", quote: "yo traigo las muestras" } }),
    ev({ owner: "Pedro Gil", action: "Pasarle las llaves a Marta", counterpart: "Marta Lozano", due_text: "", due_date: null, evidence: { start_s: 50, end_s: 54, speaker: "otros", quote: "le paso las llaves" } }),
    ev({ owner: "", action: "Revisar el contrato", counterpart: null, due_text: "", due_date: null, evidence: { start_s: 60, end_s: 64, speaker: "yo", quote: "hay que revisar el contrato" } }),
  ],
};
const ready = (minutes) => ({ status: "ready", cached: false, minutes });

test("minutes become commitments in the right direction; doubtful ones wait in the review queue", async () => {
  hub.state.minutes["ses-1"] = ready(MINUTES);
  const out = await s.agent("commitments_ingest_minutes", { session_id: "ses-1" });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.status, "ingested");
  assert.equal(out.body.items, 6);
  assert.equal(out.body.created, 2);
  assert.equal(out.body.queued, 4);
  assert.deepEqual(hub.state.calls[0], { app: "funes", tool: "scribe_minutes", arguments: { session_id: "ses-1", regenerate: false } });
  assert.match(hub.state.authHeaders.at(-1), /^Bearer /, "the call carries the app token");

  const list = (await s.agent("commitments_list", {})).body.commitments;
  assert.equal(list.length, 2);
  const mine = list.find((c) => c.direction === "i_owe");
  assert.equal(mine.person_id, marta.id);
  assert.equal(mine.due, "2026-10-06");
  assert.deepEqual(mine.source, { kind: "funes", ref: "ses-1@6", quote: "yo me encargo de enviar el presupuesto revisado a Marta el martes" });
  const theirs = list.find((c) => c.direction === "owed_to_me");
  assert.equal(theirs.person_id, pedro.id);
  assert.equal(theirs.due, null);
  assert.equal(theirs.due_text, "el viernes que viene");

  // "Reunión: <title>" once for each person involved, however many items they have
  const martaMeetings = listInteractions(marta.id).filter((i) => i.summary === "Reunión: Reunión de la reforma");
  assert.equal(martaMeetings.length, 1);
  assert.equal(martaMeetings[0].channel, "meet");
  assert.equal(martaMeetings[0].at.slice(0, 10), "2026-10-02");
  assert.equal(listInteractions(pedro.id).filter((i) => i.summary.startsWith("Reunión:")).length, 1);

  const queue = (await s.agent("commitments_review", {})).body;
  assert.equal(queue.pending, 4);
  const byReason = Object.fromEntries(queue.review.map((r) => [r.reason, r]));
  assert.deepEqual(Object.keys(byReason).sort(), ["ambiguous", "third_party", "unassigned", "unknown"]);
  assert.deepEqual(byReason.ambiguous.candidates.map((c) => c.id).sort(), [lucia1.id, lucia2.id].sort());
  assert.equal(byReason.unknown.proposal.person_name_raw, "Sofía");
  assert.equal(byReason.unknown.proposal.direction, "owed_to_me");
  assert.equal(byReason.third_party.proposal.person_name_raw, "Pedro Gil");
  assert.equal(byReason.unassigned.proposal.direction, null);
});

test("ingesting the same minutes again changes nothing", async () => {
  const again = await s.agent("commitments_ingest_minutes", { session_id: "ses-1" });
  assert.equal(again.body.created, 0);
  assert.equal(again.body.queued, 0);
  assert.equal(again.body.duplicates, 6);
  assert.equal((await s.agent("commitments_list", { status: "all" })).body.commitments.length, 2);
  assert.equal((await s.agent("commitments_review", {})).body.pending, 4);
  assert.equal(listInteractions(marta.id).filter((i) => i.summary.startsWith("Reunión:")).length, 1);
});

test("resolving the review queue: pick a candidate, create a person, discard", async () => {
  const queue = (await s.agent("commitments_review", {})).body.review;
  const reason = (r) => queue.find((q) => q.reason === r);

  // ambiguous: pick one of the candidates
  const picked = await s.agent("commitments_review", { action: "resolve", id: reason("ambiguous").id, decision: "accept", person: lucia2.id });
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  assert.equal(picked.body.commitment.person_id, lucia2.id);
  assert.equal(picked.body.commitment.direction, "owed_to_me");
  assert.equal(picked.body.commitment.source.ref, "ses-1@40");
  assert.equal(picked.body.pending, 3);
  // a settled item cannot be settled twice
  assert.equal((await s.agent("commitments_review", { action: "resolve", id: reason("ambiguous").id, decision: "discard" })).status, 409);

  // unknown: create the person on the spot
  const created = await s.agent("commitments_review", { action: "resolve", id: reason("unknown").id, decision: "accept", create_person: true });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const sofia = people.findPeople("Sofía")[0];
  assert.equal(created.body.commitment.person_id, sofia.id);
  assert.equal(sofia.name, "Sofía");

  // a person is required to accept
  const bare = await s.agent("commitments_review", { action: "resolve", id: reason("unassigned").id, decision: "accept", direction: "i_owe" });
  assert.equal(bare.status, 400);
  assert.match(bare.body.error, /Elige una persona/);
  const fixed = await s.agent("commitments_review", { action: "resolve", id: reason("unassigned").id, decision: "accept", direction: "i_owe", no_person: true, text: "Revisar el contrato de la obra" });
  assert.equal(fixed.body.commitment.text, "Revisar el contrato de la obra");
  assert.equal(fixed.body.commitment.person_id, null);

  // discard: gone, and the same minutes never bring it back
  const dropped = await s.agent("commitments_review", { action: "resolve", id: reason("third_party").id, decision: "discard" });
  assert.equal(dropped.body.review.status, "discarded");
  assert.equal(dropped.body.commitment, null);
  await s.agent("commitments_ingest_minutes", { session_id: "ses-1" });
  assert.equal((await s.agent("commitments_review", {})).body.pending, 0);
  assert.equal((await s.agent("commitments_list", { status: "all" })).body.commitments.length, 5);
  assert.equal((await s.agent("commitments_review", { action: "resolve", id: "nope", decision: "discard" })).status, 404);
  assert.equal((await s.agent("commitments_review", { action: "resolve" })).status, 400);
});

test("the other side being down or unable is reported, not thrown", async () => {
  hub.state.minutes["ses-2"] = { status: "no_model", detail: "Nothing loaded" };
  assert.equal((await s.agent("commitments_ingest_minutes", { session_id: "ses-2" })).body.status, "no_model");
  hub.state.minutes["ses-3"] = { __error: { status: 400, error: "unknown tool: scribe_minutes" } };
  assert.equal((await s.agent("commitments_ingest_minutes", { session_id: "ses-3" })).body.status, "tool_missing");
  hub.state.minutes["ses-4"] = { __error: { status: 500, error: "boom" } };
  const broken = (await s.agent("commitments_ingest_minutes", { session_id: "ses-4" })).body;
  assert.equal(broken.status, "funes_error");
  assert.equal((await s.agent("commitments_ingest_minutes", { session_id: "ghost" })).body.status, "unknown_session");

  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try {
    const down = await s.agent("commitments_ingest_minutes", { session_id: "ses-1" });
    assert.equal(down.status, 200);
    assert.equal(down.body.status, "hub_down");
  } finally {
    process.env.HOARD_HUB_URL = saved;
  }
});

test("an interaction is not logged for a meeting that only had unresolved names", async () => {
  hub.state.minutes["ses-5"] = ready({ session_id: "ses-5", title: "Llamada", started_at: "2026-10-03T09:00:00", action_items: [
    ev({ owner: "yo", action: "Mandar el contrato", counterpart: "Nadie Conocido", evidence: { start_s: 3, end_s: 6, speaker: "yo", quote: "mando el contrato" } }),
  ] });
  const out = (await s.agent("commitments_ingest_minutes", { session_id: "ses-5" })).body;
  assert.equal(out.created, 0);
  assert.equal(out.interactions, 0);
  assert.equal(out.queued, 1);
  const item = (await s.agent("commitments_review", {})).body.review[0];
  assert.equal(item.reason, "unknown");
  assert.equal(item.proposal.direction, "i_owe");
  await s.agent("commitments_review", { action: "resolve", id: item.id, decision: "discard" });
});

test("a person added to the proposal brings the meeting to their timeline once", async () => {
  hub.state.minutes["ses-6"] = ready({ session_id: "ses-6", title: "Visita a la obra", started_at: "2026-10-03T12:00:00", action_items: [
    ev({ owner: "yo", action: "Medir la cocina", counterpart: "Doña Rosa", evidence: { start_s: 5, end_s: 8, speaker: "yo", quote: "mido la cocina" } }),
    ev({ owner: "yo", action: "Pedir presupuesto de la encimera", counterpart: "Doña Rosa", evidence: { start_s: 12, end_s: 15, speaker: "yo", quote: "pido el presupuesto de la encimera" } }),
  ] });
  await s.agent("commitments_ingest_minutes", { session_id: "ses-6" });
  const queue = (await s.agent("commitments_review", {})).body.review;
  assert.equal(queue.length, 2);
  const first = await s.agent("commitments_review", { action: "resolve", id: queue[0].id, decision: "accept", create_person: "Rosa Vidal" });
  const rosa = first.body.commitment.person_id;
  await s.agent("commitments_review", { action: "resolve", id: queue[1].id, decision: "accept", person: rosa });
  assert.equal(listInteractions(rosa).filter((i) => i.summary === "Reunión: Visita a la obra").length, 1);
});

test("nothing uncertain goes straight into the list: no owner, otros, labels, no person for my own promise", async () => {
  const before = (await s.agent("commitments_list", { status: "all", limit: 500 })).body.commitments.length;
  hub.state.minutes["ses-live"] = ready({ session_id: "ses-live", title: "Reunión de prueba", started_at: "2026-10-02T04:00:00", action_items: [
    // the live case: owner unknown ("otros"), counterpart not in the book
    ev({ owner: "otros", action: "Enviar el presupuesto", counterpart: "Marta Ficticia", evidence: { start_s: 5, end_s: 9, speaker: "S1", quote: "Yo me encargo de enviarle el presupuesto a Marta Ficticia el martes que viene" } }),
    ev({ owner: "S1", action: "Revisar el borrador", counterpart: "Marta Lozano", evidence: { start_s: 20, end_s: 24, speaker: "S1", quote: "alguien revisa el borrador" } }),
    ev({ owner: null, action: "Sin dueño ni persona", evidence: { start_s: 30, end_s: 34, speaker: "S1", quote: "hay que hacerlo" } }),
    ev({ owner: "yo", action: "Promesa mía sin destinatario", counterpart: "otros", evidence: { start_s: 40, end_s: 44, speaker: "yo", quote: "yo lo hago" } }),
    ev({ owner: "yo", action: "Promesa mía a alguien que no conozco", counterpart: "Marta Ficticia", evidence: { start_s: 50, end_s: 54, speaker: "yo", quote: "yo le mando el borrador" } }),
    ev({ owner: "Marta Ficticia", action: "Devolverme el contrato", counterpart: "yo", evidence: { start_s: 60, end_s: 64, speaker: "S1", quote: "Marta Ficticia me tiene que devolver el contrato" } }),
    // certain: me to a known person
    ev({ owner: "yo", action: "Llamar a Pedro", counterpart: "Pedro Gil", evidence: { start_s: 70, end_s: 74, speaker: "yo", quote: "yo llamo a Pedro" } }),
  ] });
  const out = (await s.agent("commitments_ingest_minutes", { session_id: "ses-live" })).body;
  assert.equal(out.items, 7);
  assert.equal(out.created, 1, "only the item with a certain direction and person is recorded");
  assert.equal(out.queued, 6);
  const list = (await s.agent("commitments_list", { status: "all", limit: 500 })).body.commitments;
  assert.equal(list.length, before + 1);
  assert.ok(!list.some((c) => c.person_name === "" && c.source.ref?.startsWith("ses-live")), "no commitment without a person");
  const queue = (await s.agent("commitments_review", {})).body.review.filter((r) => r.proposal.source.ref.startsWith("ses-live@"));
  const byText = Object.fromEntries(queue.map((r) => [r.proposal.text, r]));
  assert.equal(byText["Enviar el presupuesto"].reason, "unassigned");
  assert.equal(byText["Enviar el presupuesto"].proposal.direction, null, "the direction is left to the user");
  assert.equal(byText["Enviar el presupuesto"].proposal.person_name_raw, "Marta Ficticia");
  assert.equal(byText["Revisar el borrador"].reason, "unassigned");
  assert.equal(byText["Revisar el borrador"].candidates[0].id, marta.id, "a counterpart who is in the book is offered");
  assert.equal(byText["Sin dueño ni persona"].reason, "unassigned");
  assert.equal(byText["Promesa mía sin destinatario"].reason, "no_person");
  assert.equal(byText["Promesa mía sin destinatario"].proposal.direction, "i_owe");
  assert.equal(byText["Promesa mía a alguien que no conozco"].reason, "unknown");
  assert.equal(byText["Devolverme el contrato"].reason, "unknown");
  assert.equal(byText["Devolverme el contrato"].proposal.direction, "owed_to_me");
});

test("a wrongly read item can be corrected: flip the direction and pick the person, from the queue or from the list", async () => {
  const queue = (await s.agent("commitments_review", {})).body.review;
  const wrong = queue.find((r) => r.proposal.text === "Enviar el presupuesto");
  // accepted from the queue with the direction and person the user chooses
  const fixed = (await s.agent("commitments_review", { action: "resolve", id: wrong.id, decision: "accept", direction: "i_owe", create_person: "Marta Ficticia" })).body.commitment;
  assert.equal(fixed.direction, "i_owe");
  assert.equal(fixed.person_name, "Marta Ficticia");
  // and an item already in the list can be flipped and re-pointed
  const flipped = await s.call("PATCH", `/api/commitments/${fixed.id}`, { direction: "owed_to_me", person_id: pedro.id });
  assert.equal(flipped.body.direction, "owed_to_me");
  assert.equal(flipped.body.person_id, pedro.id);
  assert.equal((await s.call("PATCH", `/api/commitments/${fixed.id}`, { person_id: null })).body.person_id, null);
  // leave the queue as the other tests expect it
  for (const r of (await s.agent("commitments_review", {})).body.review) await s.agent("commitments_review", { action: "resolve", id: r.id, decision: "discard" });
});

test("replace re-reads a meeting: untouched items go, what the user decided stays", async () => {
  const sid = "ses-replace";
  const items = (owner) => [
    ev({ owner, action: "Entregar la maqueta", counterpart: "Pedro Gil", evidence: { start_s: 5, end_s: 9, speaker: "S1", quote: "te entrego la maqueta" } }),
    ev({ owner: "yo", action: "Pagar la señal", counterpart: "Marta Lozano", evidence: { start_s: 15, end_s: 19, speaker: "S1", quote: "te pago la señal" } }),
    ev({ owner: "yo", action: "Mandar los planos", counterpart: "Pedro Gil", evidence: { start_s: 25, end_s: 29, speaker: "S1", quote: "te mando los planos" } }),
    ev({ owner: "Gregorio", action: "Visitar la obra", evidence: { start_s: 35, end_s: 39, speaker: "S1", quote: "yo visito la obra" } }),
  ];
  hub.state.minutes[sid] = ready({ session_id: sid, title: "Maqueta", started_at: "2026-10-02T09:00:00", action_items: items("otros") });
  const first = (await s.agent("commitments_ingest_minutes", { session_id: sid })).body;
  assert.equal(first.created, 2);
  assert.equal(first.queued, 2);
  const open = (await s.agent("commitments_list", { limit: 500 })).body.commitments.filter((c) => c.source.ref.startsWith(`${sid}@`));
  const pay = open.find((c) => c.text === "Pagar la señal");
  const send = open.find((c) => c.text === "Mandar los planos");
  await s.agent("commitment_done", { id: pay.id });                                      // touched: done
  await s.agent("commitment_update", { id: send.id, due_text: "mañana" });                // touched: edited
  const queue = (await s.agent("commitments_review", {})).body.review.filter((r) => r.proposal.source.ref.startsWith(`${sid}@`));
  const sofia = queue.find((r) => r.proposal.text === "Visitar la obra");
  await s.agent("commitments_review", { action: "resolve", id: sofia.id, decision: "discard" });  // decided: discarded
  assert.equal((await s.agent("commitments_ingest_minutes", { session_id: sid })).body.created, 0);

  // the model now reads the first item properly: Pedro owes me the model
  hub.state.minutes[sid] = ready({ session_id: sid, title: "Maqueta", started_at: "2026-10-02T09:00:00", action_items: items("Pedro Gil").map((i) => i.counterpart === "Pedro Gil" && i.owner === "Pedro Gil" ? { ...i, counterpart: "yo" } : i) });
  const redo = (await s.agent("commitments_ingest_minutes", { session_id: sid, replace: true })).body;
  assert.equal(redo.status, "ingested");
  assert.deepEqual(redo.replaced, { commitments: 0, review: 1 }, "the open item was waiting in the queue; the touched ones are not replaced");
  const after = (await s.agent("commitments_list", { status: "all", limit: 500 })).body.commitments.filter((c) => c.source.ref.startsWith(`${sid}@`));
  assert.equal(after.filter((c) => c.text === "Pagar la señal").length, 1);
  assert.equal(after.find((c) => c.text === "Pagar la señal").status, "done");
  assert.equal(after.filter((c) => c.text === "Mandar los planos").length, 1);
  assert.equal(after.find((c) => c.text === "Entregar la maqueta").direction, "owed_to_me");
  assert.equal(after.find((c) => c.text === "Visitar la obra"), undefined, "a discarded proposal is not brought back");

  // an untouched item that was wrong is replaced (deleting it by hand also works)
  const wrong = (await s.agent("commitment_add", { direction: "owed_to_me", text: "Item de otra fuente" })).body.commitment;
  hub.state.minutes["ses-x"] = ready({ session_id: "ses-x", title: "X", started_at: "2026-10-02T09:00:00", action_items: [
    ev({ owner: "Pedro Gil", action: "Revisar el plano", evidence: { start_s: 3, end_s: 6, speaker: "S1", quote: "reviso el plano" } }) ] });
  await s.agent("commitments_ingest_minutes", { session_id: "ses-x" });
  const placed = (await s.agent("commitments_list", {})).body.commitments.find((c) => c.source.ref === "ses-x@3");
  assert.equal(placed.direction, "owed_to_me");
  hub.state.minutes["ses-x"] = ready({ session_id: "ses-x", title: "X", started_at: "2026-10-02T09:00:00", action_items: [
    ev({ owner: "yo", action: "Revisar el plano", counterpart: "Pedro Gil", evidence: { start_s: 3, end_s: 6, speaker: "S1", quote: "reviso el plano" } }) ] });
  assert.equal((await s.agent("commitments_ingest_minutes", { session_id: "ses-x" })).body.created, 0, "without replace the first reading stands");
  const replaced = (await s.agent("commitments_ingest_minutes", { session_id: "ses-x", replace: true })).body;
  assert.deepEqual(replaced.replaced, { commitments: 1, review: 0 });
  assert.equal(replaced.created, 1);
  assert.equal((await s.agent("commitments_list", {})).body.commitments.find((c) => c.source.ref === "ses-x@3").direction, "i_owe");
  assert.equal((await s.agent("commitments_list", {})).body.commitments.some((c) => c.id === wrong.id), true, "other sources are untouched");
  assert.equal((await s.call("POST", "/api/commitments/ingest", { session_id: "ses-x", replace: true })).body.replaced.commitments, 1);
});

// ------------------------------------------------------------------ add / update

test("commitment_add resolves a person, turns words into a day and keeps the quote", async () => {
  const day = today();
  const out = await s.agent("commitment_add", { direction: "i_owe", person: "Marta Lozano", text: "Mandarle las fotos de la obra", due_text: "mañana", source_quote: "te mando las fotos mañana" });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.created, true);
  const c = out.body.commitment;
  assert.equal(c.due, addDays(day, 1));
  assert.equal(c.person_id, marta.id);
  assert.equal(c.source.kind, "chat");
  assert.equal(c.source.quote, "te mando las fotos mañana");
  assert.equal(c.days_until_due, 1);
  assert.equal(c.status, "open");

  // an unspecific phrase stays as words: no invented day
  const vague = (await s.agent("commitment_add", { direction: "owed_to_me", person: "Pedro", text: "Devolverme el taladro", due_text: "cuando pueda" })).body.commitment;
  assert.equal(vague.due, null);
  assert.equal(vague.due_text, "cuando pueda");
  assert.equal(vague.person_id, pedro.id);

  // an unknown name is kept as written, with a warning; an ambiguous one is refused with candidates
  const raw = (await s.agent("commitment_add", { direction: "i_owe", person: "El del taller", text: "Pagarle la factura" })).body;
  assert.equal(raw.commitment.person_id, null);
  assert.equal(raw.commitment.person_name, "El del taller");
  assert.match(raw.warning, /no está en la agenda/);
  const ambiguous = await s.agent("commitment_add", { direction: "i_owe", person: "Lucía", text: "Llamarla" });
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.body.candidates.length, 2);

  // a repeat with the same source_ref and text is a no-op
  const first = await s.agent("commitment_add", { direction: "i_owe", person: "Marta Lozano", text: "Confirmar la cita", source_ref: "msg-77" });
  const second = await s.agent("commitment_add", { direction: "i_owe", person: "Marta Lozano", text: "confirmar la  cita!", source_ref: "msg-77" });
  assert.equal(first.body.created, true);
  assert.equal(second.body.created, false);
  assert.equal(second.body.commitment.id, first.body.commitment.id);

  // validation
  assert.equal((await s.agent("commitment_add", { direction: "sideways", text: "x" })).status, 400);
  assert.equal((await s.agent("commitment_add", { direction: "i_owe", text: "x", due: "2026-02-30" })).status, 400);
});

test("update, done and drop return the new state and emit events", async () => {
  const added = (await s.agent("commitment_add", { direction: "i_owe", person: "Pedro Gil", text: "Enviar el plano", due: addDays(today(), 3) })).body.commitment;
  const moved = (await s.agent("commitment_update", { id: added.id, due_text: "pasado mañana", text: "Enviar el plano corregido" })).body.commitment;
  assert.equal(moved.due, addDays(today(), 2));
  assert.equal(moved.text, "Enviar el plano corregido");
  assert.equal((await s.agent("commitment_update", { id: added.id, direction: "owed_to_me", person: marta.id })).body.commitment.person_id, marta.id);
  assert.equal((await s.agent("commitment_update", { id: "nope", text: "x" })).status, 404);

  const done = (await s.agent("commitment_done", { id: added.id })).body.commitment;
  assert.equal(done.status, "done");
  assert.ok(done.done_at);
  assert.equal(done.overdue, false);
  assert.equal((await s.agent("commitment_done", { id: added.id })).body.commitment.status, "done");
  assert.ok(!(await s.agent("commitments_list", {})).body.commitments.some((c) => c.id === added.id));
  assert.ok((await s.agent("commitments_list", { status: "done" })).body.commitments.some((c) => c.id === added.id));

  const other = (await s.agent("commitment_add", { direction: "i_owe", text: "Algo que ya no hace falta" })).body.commitment;
  const dropped = (await s.agent("commitment_drop", { id: other.id })).body.commitment;
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.done_at, null);
  assert.equal((await s.agent("commitment_drop", { id: "nope" })).status, 404);

  assert.ok(await wait(() => hub.state.emitted.some((e) => e.type === "people.commitment.done" && e.data.id === added.id)));
  const addedEvent = hub.state.emitted.find((e) => e.type === "people.commitment.added" && e.data.id === added.id);
  assert.equal(addedEvent.source, "people");
  assert.equal(addedEvent.data.direction, "i_owe");
  assert.equal(addedEvent.data.person, "Pedro Gil");
  assert.ok(!hub.state.emitted.some((e) => e.type === "people.commitment.done" && e.data.id === other.id), "dropping is not completing");
});

test("filters: person, direction, overdue, due_before and status", async () => {
  const day = today();
  const late = (await s.agent("commitment_add", { direction: "owed_to_me", person: "Marta Lozano", text: "Pagarme la cena", due: addDays(day, -4) })).body.commitment;
  assert.equal(late.overdue, true);
  assert.equal(late.days_until_due, -4);
  const overdue = (await s.agent("commitments_list", { overdue: true })).body.commitments;
  assert.ok(overdue.some((c) => c.id === late.id) && overdue.every((c) => c.overdue));
  const owedToMe = (await s.agent("commitments_list", { direction: "owed_to_me" })).body.commitments;
  assert.ok(owedToMe.length > 0 && owedToMe.every((c) => c.direction === "owed_to_me"));
  const ofMarta = (await s.agent("commitments_list", { person: "Marta Lozano" })).body.commitments;
  assert.ok(ofMarta.length >= 2 && ofMarta.every((c) => c.person_id === marta.id));
  const soon = (await s.agent("commitments_list", { due_before: addDays(day, 1) })).body.commitments;
  assert.ok(soon.every((c) => c.due && c.due <= addDays(day, 1)));
  assert.equal((await s.agent("commitments_list", { person: "Nadie Que Exista" })).status, 400);
  // oldest deadline first
  const open = (await s.agent("commitments_list", {})).body.commitments.filter((c) => c.due);
  assert.deepEqual(open.map((c) => c.due), [...open.map((c) => c.due)].sort());
});

// ------------------------------------------------------------------ text extraction

test("extract from text: proposals with a verified quote go to the review queue, never straight in", async () => {
  const text = "Hola Marta, te mando el borrador del contrato el jueves sin falta. Por tu parte, ¿me traes las llaves del local el lunes? Un abrazo.";
  hub.state.chat = { status: 200, body: { ok: true, text: "", model: "fake-model", json: { commitments: [
    { direction: "i_owe", person: "Marta Lozano", action: "Mandar el borrador del contrato", due_text: "el jueves", due_date: null, quote: "te mando el borrador del contrato el jueves sin falta" },
    { direction: "owed_to_me", person: "Marta Lozano", action: "Traer las llaves del local", due_text: "el lunes", due_date: null, quote: "¿me traes las llaves del local el lunes?" },
    { direction: "i_owe", person: "Marta Lozano", action: "Algo inventado", due_text: "", due_date: null, quote: "esto no aparece en el texto" },
  ] } } };
  const before = (await s.agent("commitments_list", { status: "all" })).body.commitments.length;
  const out = (await s.agent("commitments_extract_text", { text, person_hint: "Marta" })).body;
  assert.equal(out.status, "proposed");
  assert.equal(out.proposals.length, 2);
  assert.equal(out.dropped, 1, "the proposal without a literal quote is dropped");
  assert.equal(out.model, "fake-model");
  assert.equal((await s.agent("commitments_list", { status: "all" })).body.commitments.length, before, "nothing recorded yet");
  const sent = hub.state.chats.at(-1);
  assert.equal(sent.capability, "llm");
  assert.match(sent.messages.at(-1).content, /Today is \d{4}-\d{2}-\d{2}/);
  assert.match(sent.messages.at(-1).content, /probably: Marta/);
  assert.ok(sent.json.properties.commitments, "the answer is constrained by a JSON schema");

  const first = out.proposals[0];
  assert.equal(first.reason, "proposed");
  assert.equal(first.candidates[0].id, marta.id);
  assert.ok(first.proposal.due && first.proposal.due > today(), "'el jueves' resolves to a future day");
  assert.equal(first.proposal.source.quote, "te mando el borrador del contrato el jueves sin falta");

  // the same text again proposes nothing new
  const again = (await s.agent("commitments_extract_text", { text, person_hint: "Marta" })).body;
  assert.equal(again.proposals.length, 0);
  assert.equal(again.duplicates, 2);

  // accepting records it with its source
  const accepted = (await s.agent("commitments_review", { action: "resolve", id: first.id, decision: "accept", person: marta.id })).body.commitment;
  assert.equal(accepted.direction, "i_owe");
  assert.equal(accepted.source.kind, "text");
  assert.equal(accepted.person_id, marta.id);
});

test("extract from text says so when there is no model or no hub, and rejects tiny or huge text", async () => {
  hub.state.chat = { status: 503, body: { ok: false, error: "no_model", detail: "Nothing is loaded" } };
  const none = (await s.agent("commitments_extract_text", { text: "Te mando las cuentas el lunes, de verdad." })).body;
  assert.equal(none.status, "no_model");
  assert.deepEqual(none.proposals, []);
  hub.state.chat = { status: 200, body: { ok: true, text: "no json", json: null, model: "m" } };
  assert.equal((await s.agent("commitments_extract_text", { text: "Te mando las cuentas el lunes, de verdad." })).body.status, "error");
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try {
    assert.equal((await s.agent("commitments_extract_text", { text: "Te mando las cuentas el lunes, de verdad." })).body.status, "hub_down");
  } finally {
    process.env.HOARD_HUB_URL = saved;
  }
  assert.equal((await s.agent("commitments_extract_text", { text: "corto" })).status, 400);
  assert.equal((await s.agent("commitments_extract_text", { text: "x".repeat(40001) })).status, 400);
});

test("locateQuote only accepts what the text literally says", () => {
  const text = "Te mando   el informe\nel viernes.";
  assert.equal(commitments.locateQuote(text, "te mando el informe el viernes"), "Te mando el informe el viernes");
  assert.equal(commitments.locateQuote(text, "“el informe”"), "el informe");
  assert.equal(commitments.locateQuote(text, "el informe del lunes"), null);
  assert.equal(commitments.locateQuote(text, "ok"), null);
});

// ------------------------------------------------------------------ digest, brief, calendar, upcoming

test("the digest says who is owed what, in words", async () => {
  const digest = (await s.agent("commitments_digest", { days: 7 })).body;
  assert.ok(digest.overdue_count >= 1, JSON.stringify(digest).slice(0, 600));
  assert.ok(digest.lines.includes(`Marta Lozano te debe: Pagarme la cena (venció el ${addDays(today(), -4)}, hace 4 días)`), digest.lines.join("\n"));
  assert.ok(digest.lines.some((l) => l.startsWith("Le debes a Marta Lozano: Mandarle las fotos de la obra (para mañana)")));
  assert.match(digest.summary, /compromisos? vencidos?/);
  assert.equal(digest.pending_review, 1, "the second proposal from the pasted text still waits");
  const group = digest.groups.find((g) => g.person_id === marta.id);
  assert.ok(group.i_owe.length >= 1 && group.owed_to_me.length >= 1);
  assert.equal(commitments.commitmentsDigest({ days: 7, today: "2031-01-01" }).upcoming_count, 0);
});

test("the person brief and get_person list open commitments both ways, with sources", async () => {
  const brief = (await s.call("GET", `/api/people/${marta.id}/brief`)).body;
  assert.ok(brief.open_commitments.i_owe.length >= 1);
  assert.ok(brief.open_commitments.owed_to_me.length >= 1);
  assert.match(brief.open_commitments.i_owe[0].source, /^commitment:/);
  const viaTool = (await s.agent("prepare_person_chat", { person: "Marta Lozano" })).body;
  assert.deepEqual(viaTool.open_commitments, brief.open_commitments);
  const full = (await s.agent("get_person", { person: "Marta Lozano" })).body;
  assert.equal(full.open_commitments.i_owe.length, brief.open_commitments.i_owe.length);
  const nobody = (await s.call("GET", `/api/people/${sofiaId()}/brief`)).body;
  assert.deepEqual(nobody.open_commitments.i_owe.concat(nobody.open_commitments.owed_to_me).length, 1);
});
const sofiaId = () => people.findPeople("Sofía")[0].id;

test("upcoming and the calendar export include open commitments with a due day", async () => {
  const report = upcomingReport({ days: 7 });
  assert.ok(report.commitments.some((c) => c.text === "Pagarme la cena"));
  assert.match(report.summary, /compromisos? vencidos? o próximos?/);
  const feed = calendarFeed();
  assert.ok(feed.commitments >= 3);
  assert.match(feed.text, /UID:commitment-[0-9a-f-]+@peoples-hoard\.local/);
  assert.match(feed.text, /SUMMARY:Debo a Marta Lozano: Mandarle las fotos de la obra/);
  assert.match(feed.text, /SUMMARY:Marta Lozano me debe: Pagarme la cena/);
  assert.ok(!feed.text.includes("Devolverme el taladro"), "no due day, no calendar entry");
  const ics = await fetch(`${s.base}/api/calendar.ics`);
  assert.match(await ics.text(), /CATEGORIES:Compromiso/);
});

test("overdue nudges go out once for each promise", async () => {
  const day = today();
  const first = await commitments.nudgeOverdue({ today: day });
  assert.ok(first >= 1);
  assert.ok(hub.state.emitted.some((e) => e.type === "people.commitment.overdue" && e.data.text === "Pagarme la cena" && e.data.days_overdue === 4));
  const sentBefore = hub.state.emitted.filter((e) => e.type === "people.commitment.overdue").length;
  assert.equal(await commitments.nudgeOverdue({ today: day }), 0);
  assert.equal(hub.state.emitted.filter((e) => e.type === "people.commitment.overdue").length, sentBefore);
  // a new deadline earns a new nudge
  const late = (await s.agent("commitments_list", { overdue: true })).body.commitments[0];
  await s.agent("commitment_update", { id: late.id, due: addDays(day, -2) });
  assert.equal(await commitments.nudgeOverdue({ today: day }), 1);
});

test("merging people moves their commitments; deleting one keeps the promise with the name", async () => {
  const dup = (await s.call("POST", "/api/people", { name: "Marta L." })).body;
  const c = (await s.agent("commitment_add", { direction: "i_owe", person: dup.id, text: "Devolverle el libro" })).body.commitment;
  await s.call("POST", "/api/people/merge", { keep_id: marta.id, drop_id: dup.id });
  assert.equal((await s.call("GET", `/api/commitments/${c.id}`)).body.person_id, marta.id);

  const temp = (await s.call("POST", "/api/people", { name: "Vecino Temporal" })).body;
  const k = (await s.agent("commitment_add", { direction: "owed_to_me", person: temp.id, text: "Devolverme la escalera" })).body.commitment;
  await s.call("DELETE", `/api/people/${temp.id}`);
  const kept = (await s.call("GET", `/api/commitments/${k.id}`)).body;
  assert.equal(kept.person_id, null);
  assert.equal(kept.person_name, "Vecino Temporal");
});

// ------------------------------------------------------------------ REST

test("REST: list, add, patch, delete, review, digest and the pending count", async () => {
  const added = await s.call("POST", "/api/commitments", { direction: "i_owe", person_id: pedro.id, text: "Enviar la factura", due: addDays(today(), 5) });
  assert.equal(added.status, 201);
  assert.equal(added.body.commitment.source.kind, "manual");
  const list = (await s.call("GET", `/api/commitments?person=${pedro.id}&direction=i_owe`)).body;
  assert.ok(list.commitments.some((c) => c.id === added.body.commitment.id));
  assert.equal(typeof list.pending_review, "number");
  const patched = await s.call("PATCH", `/api/commitments/${added.body.commitment.id}`, { status: "done" });
  assert.equal(patched.body.status, "done");
  assert.equal((await s.call("PATCH", "/api/commitments/nope", { status: "done" })).status, 404);
  assert.equal((await s.call("PATCH", `/api/commitments/${added.body.commitment.id}`, { status: "later" })).status, 400);
  assert.equal((await s.call("GET", "/api/commitments?status=weird")).status, 400);
  assert.equal((await s.call("DELETE", `/api/commitments/${added.body.commitment.id}`)).body.ok, true);
  assert.equal((await s.call("GET", `/api/commitments/${added.body.commitment.id}`)).status, 404);
  assert.ok((await s.call("GET", "/api/commitments/digest?days=3")).body.lines);
  const waiting = (await s.call("GET", "/api/commitments/review")).body;
  assert.equal(waiting.pending, 1);
  assert.equal(waiting.review[0].proposal.text, "Traer las llaves del local");
  assert.equal((await s.call("POST", `/api/commitments/review/${waiting.review[0].id}`, { action: "discard" })).body.review.status, "discarded");
  assert.deepEqual((await s.call("GET", "/api/commitments/review")).body, { review: [], pending: 0 });
  assert.equal((await s.call("GET", "/api/commitments/review?status=all")).body.review.length > 5, true);
  assert.equal((await s.call("POST", "/api/commitments/review/nope", { action: "discard" })).status, 404);

  hub.state.minutes["ses-rest"] = ready({ session_id: "ses-rest", title: "Café", started_at: "2026-10-04T08:00:00", action_items: [
    ev({ owner: "Pedro", action: "Mandar el vídeo", evidence: { start_s: 2, end_s: 5, speaker: "otros", quote: "mando el vídeo" } }),
  ] });
  const ingest = (await s.call("POST", "/api/commitments/ingest", { session_id: "ses-rest" })).body;
  assert.equal(ingest.status, "ingested");
  assert.equal(ingest.created, 1);
  assert.equal((await s.call("POST", "/api/commitments/ingest", {})).status, 400);
});
