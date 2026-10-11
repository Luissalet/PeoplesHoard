// Commitments from chat messages (WhatsApp): the rule pass (Spanish and English, relative days, what must NOT count), the batch
// (dedupe, person matching, groups, review queue), the events it emits and the optional model pass. Fictional people only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import * as commitments from "../server/commitments.js";
import { extractCommitments, commitmentsFromMessages } from "../server/whatsapp.js";

// Wednesday 7 October 2026, 10:00 local: every relative day below counts from here.
const WED = new Date(2026, 9, 7, 10, 0, 0).getTime();
const ISO_WED = "2026-10-07T10:00:00";
const x = (text, sender = "me") => extractCommitments(text, { sender, at: WED });
const one = (text, sender) => { const out = x(text, sender); assert.equal(out.length, 1, `${text} -> ${JSON.stringify(out)}`); return out[0]; };

test("Spanish promises: I promise (i_owe), they promise (owed_to_me), with the day worked out from the message date", () => {
  let c = one("Te lo mando el lunes");
  assert.deepEqual([c.direction, c.due, c.due_text], ["i_owe", "2026-10-12", "el lunes"]);
  assert.equal(c.quote, "Te lo mando el lunes");
  c = one("Te mando la factura de marzo antes del 15");
  assert.deepEqual([c.direction, c.text, c.due], ["i_owe", "Mandar la factura de marzo", "2026-10-15"]);
  c = one("Ok, te paso el contacto de Marta mañana", "them");
  assert.deepEqual([c.direction, c.text, c.due], ["owed_to_me", "Pasar el contacto de Marta", "2026-10-08"]);
  c = one("Te devuelvo el libro en dos semanas", "them");
  assert.deepEqual([c.direction, c.due], ["owed_to_me", "2026-10-21"]);
  c = one("Voy a mandarte las fotos el domingo");
  assert.deepEqual([c.text, c.due], ["Mandar las fotos", "2026-10-11"]);
  c = one("Te voy a pagar el día 30");
  assert.equal(c.due, "2026-10-30");
  c = one("Te traigo el taladro el sábado");
  assert.deepEqual([c.text, c.due], ["Traer el taladro", "2026-10-10"]);
  c = one("Te mando el presupuesto el próximo miércoles.");
  assert.equal(c.due, "2026-10-14");
  c = one("Te paso 15 euros el 3");
  assert.equal(c.due, "2026-11-03");
  c = one("Me encargo de reservar la mesa para el 12 de noviembre");
  assert.deepEqual([c.text, c.due], ["Encargarme de reservar la mesa", "2026-11-12"]);
  c = one("Yo me encargo de las entradas");
  assert.deepEqual([c.direction, c.due], ["i_owe", null]);
  c = one("tengo que mandarte el pdf", "them");
  assert.equal(c.direction, "owed_to_me");
});

test("debts: te debo / me debes, and the other person's duty, in both directions", () => {
  let c = one("me debes la factura de septiembre", "them");
  assert.deepEqual([c.direction, c.text], ["i_owe", "La factura de septiembre"]);
  c = one("Me debes 20 euros de la cena", "me");
  assert.deepEqual([c.direction, c.text], ["owed_to_me", "20 euros de la cena"]);
  c = one("te debo una cerveza", "me");
  assert.deepEqual([c.direction, c.text], ["i_owe", "Una cerveza"]);
  c = one("Te debo 50€ del concierto, te los pago esta semana", "them");
  assert.deepEqual([c.direction, c.text, c.due], ["owed_to_me", "50€ del concierto", "2026-10-11"]);
  c = one("Tienes que mandarme el informe antes del viernes", "them");
  assert.deepEqual([c.direction, c.text, c.due], ["i_owe", "Mandar el informe", "2026-10-09"]);
  c = one("Tienes que mandarme el informe antes del viernes", "me");
  assert.equal(c.direction, "owed_to_me");
  c = one("quedamos en que me lo pasas el jueves", "them");
  assert.deepEqual([c.direction, c.due], ["i_owe", "2026-10-08"]);
  c = one("me prometiste que me lo traías el lunes", "me");
  assert.deepEqual([c.direction, c.due], ["owed_to_me", "2026-10-12"]);
});

test("English promises and debts", () => {
  let c = one("I'll send you the file by Friday");
  assert.deepEqual([c.direction, c.text, c.due], ["i_owe", "Send the file", "2026-10-09"]);
  c = one("Don't worry, I'll bring the documents next week");
  assert.deepEqual([c.text, c.due], ["Bring the documents", "2026-10-18"]);
  c = one("I'll call you tomorrow", "them");
  assert.deepEqual([c.direction, c.text, c.due], ["owed_to_me", "Call", "2026-10-08"]);
  c = one("You owe me 30 euros", "them");
  assert.deepEqual([c.direction, c.text], ["i_owe", "30 euros"]);
  c = one("I owe you a coffee");
  assert.equal(c.direction, "i_owe");
  c = one("you need to send me the contract by the 20th", "them");
  assert.deepEqual([c.direction, c.due], ["i_owe", "2026-10-20"]);
  c = one("I will pay you back on the 3rd of November");
  assert.equal(c.due, "2026-11-03");
});

test("relative days: this week and next week end on Sunday, end of month, weekday names count forward from the message", () => {
  assert.equal(one("Te lo mando esta semana").due, "2026-10-11");
  assert.equal(one("Te lo mando la semana que viene").due, "2026-10-18");
  assert.equal(one("Te lo mando a fin de mes").due, "2026-10-31");
  assert.equal(one("Te lo mando hoy").due, "2026-10-07");
  assert.equal(one("Te lo mando pasado mañana").due, "2026-10-09");
  assert.equal(one("Te lo mando el miércoles").due, "2026-10-14", "the same weekday means next week, not today");
  assert.equal(one("Te lo mando el 15/10").due, "2026-10-15");
  assert.equal(one("Te lo mando sin falta").due, null);
  // a message written on another day counts from that day
  const friday = extractCommitments("Te lo mando el lunes", { sender: "me", at: new Date(2026, 9, 9, 18, 0).getTime() });
  assert.equal(friday[0].due, "2026-10-12");
});

test("what must NOT become a commitment", () => {
  for (const [text, sender] of [
    ["El lunes fui al médico", "me"],
    ["¿Me lo pasas el lunes?", "them"],
    ["me lo pasas el lunes?", "them"],
    ["¿Te lo mando mañana?", "me"],
    ["Can you send me the report by Friday?", "them"],
    ["Si quieres te lo mando mañana", "me"],
    ["If you want I'll send it tomorrow", "me"],
    ["Igual te lo mando el viernes", "me"],
    ["Maybe I'll send it on Monday", "me"],
    ["No te lo mando hasta que pagues", "me"],
    ["I won't send it until Monday", "me"],
    ["Nunca te debo nada", "me"],
    ["No me debes nada", "them"],
    ["Reenviado: te lo mando el lunes", "them"],
    ["> Te lo mando el lunes\nvale", "them"],
    ["Pedro dijo \"te lo mando el lunes\" pero no sé", "them"],
    ["Dice que te lo manda el lunes", "them"],
    ["Te mando un abrazo", "me"],
    ["Te doy las gracias por todo", "me"],
    ["ayer te lo mandé", "me"],
    ["te lo mandé el lunes", "me"],
    ["te llamo luego", "me"],
    ["Te llamo cuando salga del trabajo", "them"],
    ["Hola! Te escribo para decirte que mañana no puedo", "me"],
    ["quedamos el sábado a las 10", "me"],
    ["Estaré allí el lunes", "me"],
    ["Le mando el contrato a Pedro mañana", "me"],
    ["Mañana por la mañana voy al gimnasio", "me"],
    ["https://example.test/te-lo-mando-el-lunes", "me"],
  ]) assert.deepEqual(x(text, sender), [], text);
  assert.equal(one("No te preocupes, te lo mando mañana").due, "2026-10-08", '"no te preocupes" is not a negation');
});

test("weak verbs need a day: te llamo luego is nothing, te llamo el martes is a promise", () => {
  assert.deepEqual(x("te llamo luego"), []);
  const c = one("Mañana por la mañana te llamo");
  assert.deepEqual([c.text, c.due], ["Llamar", "2026-10-08"]);
  assert.equal(one("I'll call you on Tuesday").due, "2026-10-13");
});

// -------------------------------------------------------------------- the batch --

const wait = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 15)); }
  return false;
};

let s, hub, marta, pedro, carmenV, carmenS;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
  aliases.addAlias(marta.id, { kind: "whatsapp", value: "+34 600 111 222" });
  pedro = people.createPerson({ name: "Pedro Ruiz" });
  carmenV = people.createPerson({ name: "Carmen Vega" });
  carmenS = people.createPerson({ name: "Carmen Soto" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

const ts = (day, hour = 10) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const msg = (id, chat, name, sender, text, when, extra = {}) => ({ id, chat_id: chat, contact_name: name, sender, text, timestamp: when, ...extra });
const BATCH = [
  msg("m1", "34600111222@s.whatsapp.net", "Marta", "me", "Te mando la factura el lunes", ts(7)),
  msg("m2", "34600111222@s.whatsapp.net", "Marta", "them", "Te debo 30 euros de la cena", ts(7, 11)),
  msg("m3", "34600111222@s.whatsapp.net", "Marta", "them", "Fui al médico y luego a casa, te cuento el lunes", ts(7, 12)),
  msg("m4", "pedro@c", "Pedro Ruiz", "them", "me debes el libro que te presté", ts(6)),
  msg("m5", "lucia@c", "Lucía Prado", "me", "Mañana te llamo para lo del piso", ts(7), { phone: "+34 611 222 333" }),
  msg("m6", "carmen@c", "Carmen", "me", "Te devuelvo el cargador el viernes", ts(7)),
  msg("m7", "grupo@g.us", "Piso compartido", "them", "Yo me encargo de la compra el sábado", ts(7), { is_group: true }),
];

test("a batch records the promises with source, quote, message time, direction, person and day", async () => {
  const r = await s.agent("commitments_from_messages", { messages: BATCH });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const out = r.body.result ?? r.body;
  assert.equal(out.received, 7);
  assert.equal(out.skipped.group, 1);
  assert.equal(out.created, 4, JSON.stringify(out));
  assert.equal(out.queued, 1, "Carmen matches two people: the review queue decides");
  assert.equal(out.linked, 3);
  assert.equal(out.unlinked, 1);
  const list = commitments.listCommitments({ status: "all" }).filter((c) => c.source.kind === "whatsapp");
  assert.equal(list.length, 4);
  const byText = (text) => list.find((c) => c.text === text);
  const invoice = byText("Mandar la factura");
  assert.deepEqual([invoice.direction, invoice.person_id, invoice.due, invoice.status], ["i_owe", marta.id, "2026-10-12", "open"]);
  assert.equal(invoice.source.quote, "Te mando la factura el lunes");
  assert.equal(invoice.source.at, new Date(ts(7)).toISOString());
  assert.equal(invoice.source.ref, "34600111222@s.whatsapp.net|m1");
  const debt = byText("30 euros de la cena");
  assert.deepEqual([debt.direction, debt.person_id], ["owed_to_me", marta.id], "matched by phone: the chat id carries the number");
  const book = byText("El libro que te presté");
  assert.deepEqual([book.direction, book.person_id], ["i_owe", pedro.id], "matched by name");
  const call = list.find((c) => c.text === "Llamar para lo del piso");
  assert.deepEqual([call.person_id, call.person_name, call.direction, call.due], [null, "Lucía Prado", "i_owe", "2026-10-08"], "nobody in the book: the name stays as written");
  assert.equal(list.some((c) => /cuento/.test(c.text)), false, "te cuento is not a promise");
  const pending = commitments.listReview();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reason, "ambiguous");
  assert.deepEqual(pending[0].candidates.map((c) => c.id).sort(), [carmenV.id, carmenS.id].sort());
  assert.equal(pending[0].proposal.source.kind, "whatsapp");
  assert.equal(pending[0].proposal.source.quote, "Te devuelvo el cargador el viernes");
  assert.equal(pending[0].proposal.source.at, new Date(ts(7)).toISOString());
});

test("sending the same batch again adds nothing; reprocess does not duplicate either", async () => {
  const before = commitments.listCommitments({ status: "all" }).length;
  const again = (await s.agent("commitments_from_messages", { messages: BATCH })).body;
  const out = again.result ?? again;
  assert.equal(out.created, 0);
  assert.equal(out.read, 0);
  assert.equal(out.skipped.seen, 6, "every message but the group one was already read");
  const forced = (await s.agent("commitments_from_messages", { messages: BATCH, reprocess: true })).body;
  const out2 = forced.result ?? forced;
  assert.equal(out2.created, 0);
  assert.equal(out2.queued, 0);
  assert.ok(out2.duplicates >= 4);
  assert.equal(commitments.listCommitments({ status: "all" }).length, before);
  assert.equal(commitments.listReview().length, 1);
});

test("a message deleted from the list does not come back when the batch is sent again", async () => {
  const mine = commitments.listCommitments({ status: "all" }).find((c) => c.text === "30 euros de la cena");
  assert.ok(commitments.deleteCommitment(mine.id));
  await commitmentsFromMessages({ messages: BATCH });
  assert.equal(commitments.listCommitments({ status: "all" }).some((c) => c.text === "30 euros de la cena"), false);
});

test("events: the deadline event carries the direction and source and never the message; what they owe me is only noted", async () => {
  const mine = commitments.listCommitments({ status: "all" }).find((c) => c.text === "Mandar la factura");
  assert.ok(await wait(() => hub.state.emitted.some((e) => e.type === "people.commitment.added" && e.data.id === mine.id)));
  const added = hub.state.emitted.find((e) => e.type === "people.commitment.added" && e.data.id === mine.id);
  assert.equal(added.data.direction, "i_owe");
  assert.equal(added.data.source, "whatsapp");
  assert.equal(added.data.due, "2026-10-12");
  assert.equal(added.data.title, "Mandar algo (Marta Lozano)", "the bus gets the action in plain words, not the sentence");
  assert.equal(added.data.text, "Mandar algo");
  assert.equal(added.data.ref, `hoard://people/commitment/${mine.id}`);
  const book = commitments.listCommitments({ status: "all" }).find((c) => c.text === "El libro que te presté");
  assert.ok(await wait(() => hub.state.emitted.some((e) => e.type === "people.commitment.noted" && e.data.id === book.id)));
  assert.equal(hub.state.emitted.some((e) => e.type === "people.commitment.added" && e.data.id === book.id), false, "no day and owed to me: no deadline");
  const wire = JSON.stringify(hub.state.emitted);
  assert.equal(/te cuento el lunes|Fui al médico|quote/.test(wire), false, "no message body and no quote on the bus");
  assert.equal(hub.state.chats.length, 0, "the model is never asked unless refine is on");
});

test("the REST route does the same and the commitment shows its source in the list", async () => {
  const r = await s.call("POST", "/api/commitments/from-messages", { messages: [msg("r1", "34600111222@s.whatsapp.net", "Marta", "them", "Te mando el contrato mañana", ts(8))] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 1);
  assert.equal(typeof r.body.pending_review, "number");
  const list = await s.call("GET", `/api/commitments?person=${marta.id}`);
  const item = list.body.commitments.find((c) => c.text === "Mandar el contrato");
  assert.equal(item.source.kind, "whatsapp");
  assert.equal(item.source.quote, "Te mando el contrato mañana");
  assert.equal(item.direction, "owed_to_me");
  assert.equal(item.due, "2026-10-09");
  const bad = await s.call("POST", "/api/commitments/from-messages", { messages: [] });
  assert.equal(bad.status, 400);
});

test("a message without a usable sender or time is counted as invalid, not fatal", async () => {
  const out = await commitmentsFromMessages({ messages: [
    { id: "i1", text: "Te lo mando el lunes", timestamp: ts(7) },
    { id: "i2", sender: "me", text: "Te lo mando el lunes", timestamp: "not a date" },
    { id: "i3", sender: "me", text: "ok", timestamp: ts(7) },
    { id: "i4", chat_id: "x@c", contact_name: "Nadie", from_me: true, text: "Te lo mando el lunes", timestamp: String(Math.floor(new Date(ts(7)).getTime() / 1000)) },
  ] });
  assert.deepEqual([out.skipped.invalid, out.skipped.empty, out.created], [2, 1, 1]);
  assert.equal(commitments.listCommitments({ status: "all" }).find((c) => c.source.ref === "x@c|i4").due, "2026-10-12", "epoch seconds work");
});

test("the review queue settles an ambiguous contact into a commitment that keeps its WhatsApp source and time", async () => {
  const [item] = commitments.listReview();
  const out = commitments.resolveReview(item.id, { action: "accept", person_id: carmenS.id });
  assert.equal(out.commitment.person_id, carmenS.id);
  assert.equal(out.commitment.direction, "i_owe");
  assert.equal(out.commitment.source.kind, "whatsapp");
  assert.equal(out.commitment.source.at, new Date(ts(7)).toISOString());
  assert.equal(out.commitment.source.quote, "Te devuelvo el cargador el viernes");
  // the export carries the source and the time, and an import restores them
  const exp = (await s.call("GET", "/api/export")).body;
  const exported = exp.commitments.find((c) => c.id === out.commitment.id);
  assert.equal(exported.source.at, out.commitment.source.at);
});

test("refine: the model pass is optional, only reads what the rules missed and only proposes (quote verified)", async () => {
  const first = hub.state.chats.length;
  hub.state.chat = { status: 200, body: { ok: true, text: "{}", model: "fake-model", json: { commitments: [
    { message: 0, direction: "i_owe", action: "Enviar el dossier", due_text: "el jueves", quote: "te hago llegar el dossier" },
    { message: 0, direction: "i_owe", action: "Inventado", due_text: "", quote: "frase que nadie escribió" },
  ] } } };
  const out = await commitmentsFromMessages({ refine: true, messages: [
    msg("f1", "34600111222@s.whatsapp.net", "Marta", "me", "Cuando pueda te hago llegar el dossier completo, sin prisa", ts(7)),
  ] });
  assert.equal(hub.state.chats.length, first + 1);
  assert.equal(out.created, 0, "the model never writes straight into the list");
  assert.equal(out.refine.status, "ok");
  assert.equal(out.refine.proposals, 1);
  assert.equal(out.refine.dropped, 1);
  const proposal = commitments.listReview().find((r) => r.reason === "model_whatsapp");
  assert.equal(proposal.proposal.source.kind, "whatsapp");
  assert.equal(proposal.proposal.due, "2026-10-08");
  assert.deepEqual(proposal.candidates.map((c) => c.id), [marta.id]);
  // and it degrades quietly when there is no model
  hub.state.chat = { status: 200, body: { ok: false, error: "no_model", detail: "none loaded" } };
  const none = await commitmentsFromMessages({ refine: true, messages: [msg("f2", "34600111222@s.whatsapp.net", "Marta", "me", "Cuando pueda te hago llegar el dossier completo, sin prisa", ts(8))] });
  assert.equal(none.refine.status, "no_model");
  assert.equal(none.created, 0);
});
