// Regression tests from the independent review of the WhatsApp commitments (#240): conditionals and doubts anywhere in the clause,
// past references that are not deadlines, several promises in one message, irony, relayed promises, figures of speech, what is
// stripped from the action, the night-time «mañana», a phone nobody owns, a model pass that must not lose messages when the hub is down,
// and the rule that the event bus never carries the words of a message. Fictional people only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import * as commitments from "../server/commitments.js";
import { extractCommitments, commitmentsFromMessages } from "../server/whatsapp.js";

// Wednesday 7 October 2026, 12:00 local.
const WED = new Date(2026, 9, 7, 12, 0, 0).getTime();
const x = (text, sender = "me", at = WED) => extractCommitments(text, { sender, at });

test("a condition or a doubt AFTER the promise cancels it too (and the same before it)", () => {
  for (const [text, sender] of [
    ["Te lo mando el lunes si puedo", "me"],
    ["Te lo mando mañana si no llueve", "me"],
    ["Te llamo mañana, si te viene bien", "me"],
    ["Te lo mando el lunes, pero no sé si podré", "me"],
    ["Te lo mando el lunes, aunque no creo que llegue", "me"],
    ["Te lo mando el lunes, a menos que haya problemas", "me"],
    ["Te lo mando el lunes salvo que me surja algo", "me"],
    ["Te lo mando el lunes a no ser que pase algo", "me"],
    ["I'll send it Friday if I can", "me"],
    ["I'll send it Friday unless something comes up", "me"],
    ["I'll send it Friday, if possible", "me"],
    ["I'll send it Friday, weather permitting", "me"],
    ["Creo que te lo mando mañana", "me"],
    ["I think I'll send it tomorrow", "me"],
    ["Si puedes, te lo mando mañana", "me"],
    ["Si puedo te lo mando el lunes y te llamo el martes", "me"],
    ["Te lo mando el lunes si puedo", "them"],
    ["Intentaré mandártelo el lunes, te lo mando el lunes si puedo", "them"],
  ]) assert.deepEqual(x(text, sender), [], `${sender}: ${text}`);
  // a yes written without its accent is not an "if", and "no te preocupes" is not a negation
  assert.equal(x("Si, te lo mando mañana").length, 1);
  assert.equal(x("Don't worry, I'll send it tomorrow").length, 1);
  assert.equal(x("No te preocupes, te lo mando mañana").length, 1);
});

test("a past reference is not a deadline: «la cena del sábado pasado», «la cena del viernes»", () => {
  let [c] = x("Me debes 20 euros de la cena del sábado pasado", "me");
  assert.equal(c.due, null);
  assert.equal(c.text, "20 euros de la cena del sábado pasado");
  assert.equal(c.direction, "owed_to_me");
  [c] = x("Me debes la cena del viernes", "me");
  assert.equal(c.due, null);
  assert.equal(c.text, "La cena del viernes", "the object is not cut");
  [c] = x("Te mando las fotos del lunes pasado el jueves");
  assert.equal(c.due, "2026-10-08", "the reference is skipped, the real day is found");
  assert.equal(x("Te debo la comida del domingo pasado")[0].due, null);
  assert.equal(x("Te mando el informe el lunes")[0].due, "2026-10-12", "a plain weekday is still a deadline");
  assert.equal(x("Te lo pago antes del viernes")[0].due, "2026-10-09", "«antes del viernes» is a deadline");
  assert.equal(x("I'll send it by Friday")[0].due, "2026-10-09");
  assert.equal(x("You owe me dinner from last Friday", "me")[0].due, null);
});

test("several promises in one message are several commitments, and a courtesy clause does not cancel the rest", () => {
  let out = x("Te mando el informe el lunes y te llamo el martes");
  assert.deepEqual(out.map((c) => [c.text, c.due]), [["Mandar el informe", "2026-10-12"], ["Llamar", "2026-10-13"]]);
  out = x("Te los traigo mañana, te pago el viernes y te devuelvo el libro el sábado");
  assert.deepEqual(out.map((c) => c.due), ["2026-10-08", "2026-10-09", "2026-10-10"]);
  out = x("Te mando un abrazo y te llamo el lunes");
  assert.deepEqual(out.map((c) => [c.text, c.due]), [["Llamar", "2026-10-12"]]);
  out = x("I'll send the contract on Thursday and I'll call you on Friday");
  assert.deepEqual(out.map((c) => c.due), ["2026-10-08", "2026-10-09"]);
  // one debt told in two clauses is one commitment
  out = x("Me debes 20 euros de la cena, acuérdate de pasármelos antes del 15", "them");
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].direction, out[0].due], ["i_owe", "2026-10-15"]);
  out = x("Te debo 20 euros, te los pago el viernes");
  assert.equal(out.length, 1);
  assert.equal(out[0].due, "2026-10-09");
  // a condition on one clause leaves the other alone
  out = x("Te mando el informe el lunes y te llamo el martes si puedo");
  assert.deepEqual(out.map((c) => c.action), ["Mandar algo"]);
});

test("irony is flagged, relayed promises and «me debes una» are not commitments, emoji and laughter leave the action", () => {
  assert.equal(x("Sí, claro, te lo mando mañana")[0].doubtful, true);
  assert.equal(x("Jajajaja te lo mando mañana sin falta")[0].doubtful, true);
  assert.equal(x("Te lo mando mañana sin falta. Eso dijo")[0].doubtful, true);
  assert.equal(x("Yeah right, I'll send it tomorrow")[0].doubtful, true);
  assert.equal(x("Jaja vale, te lo mando mañana")[0].doubtful, false, "plain laughter is not irony");
  assert.equal(x("Te lo mando mañana")[0].doubtful, false);
  assert.deepEqual(x("Dile a Ana que te lo mando mañana", "them"), []);
  assert.deepEqual(x("Tell Ana I'll send it tomorrow", "them"), []);
  assert.deepEqual(x("Me debes una", "them"), []);
  assert.deepEqual(x("Me debes una 😉", "them"), []);
  assert.deepEqual(x("You owe me one", "them"), []);
  assert.equal(x("Me debes una cena", "them").length, 1, "«una cena» is a real debt");
  const [c] = x("Te mando las fotos del viaje 👍🏽😂 jajaja mañana ❤️");
  assert.equal(c.text, "Mandar las fotos del viaje");
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{1F3FB}-\u{1F3FF}‍️]|jaja/u.test(c.text), false);
});

test("«mañana» typed between 00:00 and 05:59 is flagged, in the daytime it is not", () => {
  const night = new Date(2026, 9, 7, 2, 30, 0).getTime();
  assert.equal(x("Mañana te mando las fotos", "me", night)[0].night, true);
  assert.equal(x("Te lo mando el lunes", "me", night)[0].night, false, "a weekday is not ambiguous");
  assert.equal(x("Mañana te mando las fotos")[0].night, false);
  assert.equal(x("Mañana te mando las fotos", "me", new Date(2026, 9, 7, 6, 0, 0).getTime())[0].night, false);
});

test("the action in plain words for the bus never contains the sentence", () => {
  const [a] = x("Te mando el informe confidencial ZXQ-17 el lunes");
  assert.equal(a.action, "Mandar algo");
  assert.equal(x("Me debes 20 euros ZXQ-18", "them")[0].action, "Saldar una deuda");
  assert.equal(x("I'll pay you back ZXQ-19 on Friday")[0].action, "Pagar algo");
  assert.equal(x("Te llamo el martes ZXQ-20")[0].action, "Llamar");
  for (const c of [a]) assert.equal(/ZXQ|informe/.test(c.action), false);
});

// ---------------------------------------------------------------------------- the batch --

let s, hub, ana, bea, ceci;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  ana = people.createPerson({ name: "Ana Ferrer" });
  aliases.addAlias(ana.id, { kind: "whatsapp", value: "+34 655 000 111" });
  bea = people.createPerson({ name: "Beatriz Solé" });
  ceci = people.createPerson({ name: "Cecilia Marín" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});

const wait = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 15)); }
  return false;
};
const ts = (day, hour = 12) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const msg = (id, chat, name, sender, text, when, extra = {}) => ({ id, chat_id: chat, contact_name: name, sender, text, timestamp: when, ...extra });

test("irony and a night-time «mañana» go to review instead of the list; a plain promise is recorded", async () => {
  const out = await commitmentsFromMessages({ messages: [
    msg("d1", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Jajajaja te lo mando mañana sin falta", ts(7)),
    msg("d2", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Mañana te mando las fotos del piso", new Date(2026, 9, 7, 3, 0, 0).toISOString()),
    msg("d3", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Te mando las fotos del piso el lunes", ts(7)),
  ] });
  assert.deepEqual([out.created, out.queued], [1, 2], JSON.stringify(out));
  const reasons = commitments.listReview().map((r) => r.reason).sort();
  assert.deepEqual(reasons, ["doubtful", "late_night"]);
  const doubtful = commitments.listReview().find((r) => r.reason === "doubtful");
  assert.deepEqual(doubtful.candidates.map((c) => c.id), [ana.id], "the person is proposed");
  assert.equal(doubtful.proposal.source.kind, "whatsapp");
  assert.equal(commitments.listCommitments({ status: "all" }).some((c) => /sin falta/.test(c.source.quote || "")), false);
});

test("a number nobody owns with a name that fits one person is asked about, and the answer teaches the number", async () => {
  const first = await commitmentsFromMessages({ messages: [
    msg("p1", "34677123456@s.whatsapp.net", "Beatriz Solé", "them", "Te mando el presupuesto el viernes", ts(7)),
  ] });
  assert.deepEqual([first.created, first.queued, first.unlinked], [0, 1, 0], JSON.stringify(first));
  const item = commitments.listReview().find((r) => r.reason === "phone_unknown");
  assert.deepEqual(item.candidates.map((c) => c.id), [bea.id]);
  assert.equal(item.proposal.phone, "+34677123456");
  const done = commitments.resolveReview(item.id, { action: "accept", person_id: bea.id });
  assert.equal(done.commitment.person_id, bea.id);
  // the number now belongs to her card: the next message links by itself
  const next = await commitmentsFromMessages({ messages: [
    msg("p2", "34677123456@s.whatsapp.net", "Beatriz", "them", "Te llamo el martes para lo del seguro", ts(7)),
  ] });
  assert.deepEqual([next.created, next.queued, next.linked], [1, 0, 1], JSON.stringify(next));
  // a name that matches nobody keeps the name and creates the commitment (nothing to confuse it with)
  const stranger = await commitmentsFromMessages({ messages: [
    msg("p3", "34699000111@s.whatsapp.net", "Fulano de Tal", "them", "Te devuelvo el cargador el jueves", ts(7)),
  ] });
  assert.deepEqual([stranger.created, stranger.unlinked], [1, 1]);
});

test("refine with the hub down does not mark the messages as read: they come back next time", async () => {
  const batch = [msg("r1", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Cuando pueda te hago llegar el dossier completo, sin prisa", ts(7))];
  const down = await commitmentsFromMessages({ refine: true, messages: batch }, { chat: async () => ({ ok: false, error: "hub_down" }) });
  assert.equal(down.refine.status, "hub_down");
  assert.equal(down.retry, 1);
  const again = await commitmentsFromMessages({ refine: true, messages: batch }, { chat: async () => ({ ok: true, json: { commitments: [
    { message: 0, direction: "i_owe", action: "Enviar el dossier", due_text: "", quote: "te hago llegar el dossier completo" },
  ] } }) });
  assert.equal(again.skipped.seen, 0, "it was read again, not skipped");
  assert.equal(again.refine.proposals, 1);
  assert.equal(again.retry, 0);
  const third = await commitmentsFromMessages({ refine: true, messages: batch }, { chat: async () => { throw new Error("must not be asked again"); } });
  assert.equal(third.skipped.seen, 1, "answered once: read for good");
  // without refine, nothing is deferred and nothing is sent to the model
  const plain = await commitmentsFromMessages({ messages: [msg("r2", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Cuando pueda te hago llegar el dossier completo", ts(7))] });
  assert.equal(plain.skipped.seen, 0);
  assert.equal(plain.retry, undefined);
  const after = await commitmentsFromMessages({ messages: [msg("r2", "34655000111@s.whatsapp.net", "Ana Ferrer", "me", "Cuando pueda te hago llegar el dossier completo", ts(7))] });
  assert.equal(after.skipped.seen, 1);
});

test("the event bus never carries the words of a message: sentinel strings in the sentence and the quote stay home", async () => {
  const texts = [
    "Te mando el contrato SENTINEL-ALFA el lunes",
    "Me debes 20 euros de SENTINEL-BETA para el 15",
    "I'll bring the SENTINEL-GAMMA book on Friday",
    "Te llamo el martes por SENTINEL-DELTA",
    "Te debo SENTINEL-EPSILON, te los pago el viernes",
  ];
  const before = hub.state.emitted.length;
  const out = await commitmentsFromMessages({ messages: texts.map((t, i) => msg(`e${i}`, "34655000111@s.whatsapp.net", "Ana Ferrer", i % 2 ? "them" : "me", t, ts(7))) });
  assert.ok(out.created >= 4, JSON.stringify(out));
  await wait(() => hub.state.emitted.length >= before + out.created);
  // an edit that gives a commitment a day, a review that settles one and the overdue nudge announce it again: none may quote the message
  const mine = commitments.listCommitments({ status: "all" }).find((c) => /SENTINEL-ALFA/.test(c.text));
  commitments.updateCommitment(mine.id, { due: "2026-10-30" });
  const owned = commitments.listCommitments({ status: "all" }).filter((c) => c.source.kind === "whatsapp");
  assert.ok(owned.length >= 4);
  const sent = await commitments.nudgeOverdue({ today: "2027-02-01" });
  assert.ok(sent >= 1);
  const wire = JSON.stringify(hub.state.emitted);
  assert.equal(/SENTINEL|contrato|libro|book|Te mando|te los pago|euros/i.test(wire), false, wire);
  for (const e of hub.state.emitted.slice(before)) {
    if (e.type === "people.commitment.added" || e.type === "people.commitment.noted" || e.type === "people.commitment.overdue") {
      assert.match(e.data.text, /^(?:[A-ZÁÉÍÓÚ][a-záéíóúñ]+ algo|Encargarme de algo|Saldar una deuda|Llamar|Avisar|Escribir|Confirmar|Contestar|Cumplir lo prometido|Compromiso de WhatsApp)$/);
    }
  }
  // the stored commitment keeps its sentence (it is the owner's own list)
  assert.ok(owned.some((c) => /SENTINEL-ALFA/.test(c.source.quote)));
});

test("a hidden-id chat identified only by a nickname never links by name on its own", async () => {
  const out = await commitmentsFromMessages({ messages: [
    msg("l1", "99887766554433@lid", "Cecilia Marín", "them", "Te mando el informe el viernes", ts(7), { name_unverified: true }),
  ] });
  assert.deepEqual([out.created, out.queued], [0, 1], JSON.stringify(out));
  const item = commitments.listReview().find((r) => r.reason === "phone_unknown" && r.proposal.source.ref.startsWith("99887766554433@lid"));
  assert.deepEqual(item.candidates.map((c) => c.id), [ceci.id]);
  assert.equal(item.proposal.phone, "");
  const done = commitments.resolveReview(item.id, { action: "accept", person_id: ceci.id });
  assert.equal(done.commitment.person_id, ceci.id);
  assert.equal(aliases.listAliases(ceci.id).length, 0, "there is no number to remember");
});

test("«si o si» is an emphatic yes and «no matter what» a promise, not a condition or a negation (a real condition beside them still cancels)", () => {
  for (const [text, sender] of [
    ["Te lo mando el lunes si o si", "me"],
    ["Si o si te lo mando el lunes", "me"],
    ["S\u00ed o s\u00ed te lo mando ma\u00f1ana", "me"],
    ["Te lo mando ma\u00f1ana s\u00ed o s\u00ed, no te preocupes", "me"],
    ["I'll send it Friday no matter what", "me"],
    ["No matter what, I'll send it Friday", "me"],
    ["Te lo mando el lunes si o si", "them"],
  ]) assert.equal(x(text, sender).length, 1, `${sender}: ${text}`);
  assert.equal(x("Te lo mando el lunes si o si").at(0).direction, "i_owe");
  for (const text of [
    "Te lo mando el lunes si o si, si puedo",
    "Te lo mando el lunes si o si, aunque no creo",
    "I'll send it Friday no matter what, if I can",
    "I'll send it Friday no matter what, maybe",
    "Si puedo te lo mando el lunes si o si",
  ]) assert.deepEqual(x(text), [], text);
  // the ordinary conditional is still a conditional, and a plain «no» is still a negation
  assert.deepEqual(x("Si quieres te lo mando el lunes"), []);
  assert.deepEqual(x("No te lo mando el lunes"), []);
});
