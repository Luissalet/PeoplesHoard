// What People takes from the family's commons (Hoard Link 0.8): spoken due dates, the iCalendar export, handle normalisation in the
// aliases (with old rows found lazily), the duplicate finder, and the shared plumbing (token, guard, error envelope).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import { db } from "../server/db.js";
import { addDays, today, daysSince, nextBirthday } from "../server/dates.js";
import { calendarFeed } from "../server/calendar.js";
import { parseIcs } from "../server/hoard-commons/ics.js";
import { normalizeHandle, findHandle, findAnyHandle } from "../server/handles.js";
import { findDuplicatePeople } from "../server/duplicates.js";
import { contactEmails, personOfAddress } from "../server/mailsync.js";
import { fold } from "../server/text.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

// ------------------------------------------------------------------ dates and text
test("addDays, daysSince and birthdays use the family's date arithmetic", () => {
  assert.equal(addDays("2026-02-27", 3), "2026-03-02");
  assert.equal(addDays("2027-12-31", 1), "2028-01-01");
  assert.equal(daysSince("2026-09-20", "2026-10-02"), 12);
  assert.equal(daysSince("2026-10-05", "2026-10-02"), 0, "a date in the future is zero days ago");
  assert.equal(daysSince(null), null);
  assert.deepEqual(nextBirthday("--02-29", "2027-03-01"), { date: "2028-02-29", daysUntil: 365, turningAge: null });
});

test("fold keeps its trimmed, accent-free, lowercase form", () => {
  assert.equal(fold("  José Ñandú "), "jose nandu");
  assert.equal(fold(null), "");
});

test("commitments read spoken due dates with the shared parser: weekdays, relative words, abbreviated months; vague words stay words", async () => {
  const day = today();
  const add = async (due_text) => (await s.agent("commitment_add", { direction: "i_owe", text: `tarea ${due_text}`, person: "Alguien Nuevo", due_text })).body;
  assert.equal((await add("mañana")).commitment.due, addDays(day, 1));
  assert.equal((await add("en dos semanas")).commitment.due, addDays(day, 14));
  const nov = (await add("3 nov")).commitment.due;
  assert.match(nov, /^\d{4}-11-03$/);
  assert.ok(nov >= day);
  const vague = (await add("la semana que viene")).commitment;
  assert.equal(vague.due, null);
  assert.equal(vague.due_text, "la semana que viene");
});

// ------------------------------------------------------------------ iCalendar
test("the calendar export is the shared buildIcs: yearly all-day birthdays that parse back", () => {
  const ana = people.createPerson({ name: "Ana, Cumple; Prueba", birthday: "1990-10-02" });
  people.createPerson({ name: "Bisiesta", birthday: "--02-29" });
  const { text, birthdays } = calendarFeed({ from: "2026-09-27", generatedAt: new Date("2026-09-27T12:00:00Z") });
  assert.ok(birthdays >= 2);
  assert.match(text, /PRODID:-\/\/People's Hoard\/\/Calendar Export\/\/ES/);
  assert.match(text, /X-WR-CALNAME:People's Hoard/);
  assert.match(text, /DTSTAMP:20260927T120000Z/);
  const events = parseIcs(text);
  const mine = events.find((e) => e.uid === `birthday-${ana.id}@peoples-hoard.local`);
  assert.ok(mine, "UID stays what subscribers already have");
  assert.equal(mine.rrule, "FREQ=YEARLY");
  assert.equal(mine.all_day, true);
  assert.equal(mine.start, "2026-10-02");
  assert.equal(mine.summary, "Cumpleaños de Ana, Cumple; Prueba");
  assert.equal(events.find((e) => e.summary === "Cumpleaños de Bisiesta").start, "2028-02-29");
  assert.ok(text.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
});

// ------------------------------------------------------------------ handles
test("handles are compared by their normal form: e-mail without +tag, phone in international form", () => {
  assert.equal(normalizeHandle("email", "Marta.Lozano+news@Example.TEST"), "marta.lozano@example.test");
  assert.equal(normalizeHandle("email", "Ana <ana@example.test>"), "ana@example.test");
  assert.equal(normalizeHandle("phone", "600 11 22 33"), "+34600112233");
  assert.equal(normalizeHandle("phone", "+34 600-112-233"), "+34600112233");
  assert.equal(normalizeHandle("whatsapp", "Marta WA"), "marta wa", "a WhatsApp display name is folded, not read as a number");
  assert.equal(normalizeHandle("whatsapp", "0034 600 11 22 33"), "+34600112233");
  assert.equal(normalizeHandle("handle", "@Marta_G"), "marta_g");
});

test("an alias is found whatever its spelling, and one handle still belongs to one person", () => {
  const ana = people.createPerson({ name: "Ana Handles" });
  const luis = people.createPerson({ name: "Luis Handles" });
  const first = aliases.addAlias(ana.id, { kind: "email", value: "Ana.Handles+news@Example.TEST" });
  assert.equal(first.value, "Ana.Handles+news@Example.TEST", "the value is kept as typed");
  assert.equal(db().prepare("SELECT norm FROM aliases WHERE id = ?").get(first.id).norm, "ana.handles@example.test");
  assert.equal(aliases.addAlias(ana.id, { kind: "email", value: "ana.handles@example.test" }).id, first.id, "the same mailbox is not added twice");
  assert.throws(() => aliases.addAlias(luis.id, { kind: "email", value: "ANA.HANDLES@example.test" }), /ya pertenece a otra persona/);
  const phone = aliases.addAlias(ana.id, { kind: "phone", value: "600 11 22 44" });
  assert.throws(() => aliases.addAlias(luis.id, { kind: "phone", value: "+34 600112244" }), /ya pertenece/);
  assert.equal(findHandle("phone", "0034600112244").id, phone.id);
  assert.equal(people.resolvePersonRef("ana.handles@example.test").person.id, ana.id);
  assert.equal(people.resolvePersonRef("+34600112244").person.id, ana.id);
  assert.equal(findAnyHandle("nadie@example.test"), null);
  // the same mailbox can be another kind of handle for someone else: kinds do not mix
  assert.ok(aliases.addAlias(luis.id, { kind: "other", value: "ana.handles@example.test" }));
  // changing an alias moves its key
  const moved = aliases.updateAlias(first.id, { value: "otra.direccion@example.test" });
  assert.equal(db().prepare("SELECT norm FROM aliases WHERE id = ?").get(moved.id).norm, "otra.direccion@example.test");
  assert.equal(moved.kind, "email", "changing only the value keeps the kind");
  assert.equal(findHandle("email", "otra.direccion+x@example.test").id, first.id);
});

test("mail addresses: one mailbox is registered once, and mail from a tagged address finds its person", () => {
  const eva = people.createPerson({ name: "Eva Correo" });
  db().prepare("INSERT INTO aliases (id, person_id, kind, value, norm, created_at) VALUES ('legacy-1', ?, 'email', 'Eva@Example.TEST', NULL, '2026-01-01T00:00:00Z')").run(eva.id);
  aliases.addAlias(eva.id, { kind: "email", value: "eva+listas@example.test" });
  const mine = contactEmails({ limit: 1000 }).filter((e) => e.person_id === eva.id);
  assert.equal(mine.length, 1, "Eva@Example.TEST and eva+listas@example.test are one mailbox");
  assert.equal(personOfAddress("Eva Correo <eva+otra@example.test>").id, eva.id);
  assert.equal(personOfAddress("EVA@example.test").id, eva.id, "a row without a key is still found by its value");
});

// ------------------------------------------------------------------ duplicates
test("find_duplicate_people suggests pairs by name, shared handle and birthday, and never merges", async () => {
  const a = people.createPerson({ name: "Carmen Ruiz Dupe", birthday: "1980-05-05" });
  const b = people.createPerson({ name: "Carmen Ruiz Dupe", birthday: "1980-05-05" });
  const c = people.createPerson({ name: "C. Ruiz Dupe", birthday: "1980-05-05" });
  const d = people.createPerson({ name: "Pedro Otro Dupe" });
  const e = people.createPerson({ name: "Mauricio Distinto" });
  aliases.addAlias(d.id, { kind: "email", value: "mismo.buzon@example.test" });
  // two people with one mailbox can only come from data written before the keys existed
  db().prepare("INSERT INTO aliases (id, person_id, kind, value, norm, created_at) VALUES ('dupe-e', ?, 'email', 'Mismo.Buzon+x@example.test', 'mismo.buzon@example.test', '2025-01-01T00:00:00Z')").run(e.id);
  aliases.addAlias(a.id, { kind: "email", value: "carmen@example.test" });
  people.createPerson({ name: "Leopoldo Unico" });
  const out = (await s.agent("find_duplicate_people", {})).body;
  const find = (x, y) => out.pairs.find((p) => [p.a.id, p.b.id].sort().join() === [x.id, y.id].sort().join());
  const same = find(a, b);
  assert.ok(same, JSON.stringify(out.pairs.map((p) => [p.a.name, p.b.name, p.score])));
  assert.equal(same.score, 1);
  assert.ok(same.reasons.includes("mismo nombre"));
  assert.ok(same.reasons.some((r) => r.startsWith("mismo cumpleaños")));
  const initials = find(a, c);
  assert.ok(initials && initials.score >= 0.7, "an initial matches the full first name and the same birthday raises it");
  const mailbox = find(d, e);
  assert.ok(mailbox, "different names, the same mailbox");
  assert.equal(mailbox.score, 1);
  assert.ok(mailbox.reasons.some((r) => r.startsWith("mismo correo")));
  assert.ok(!out.pairs.some((p) => [p.a.name, p.b.name].includes("Leopoldo Unico")));
  // the one with more history is suggested to keep
  await s.agent("add_fact", { person: b.id, key: "trabajo", value: "médica" });
  const fresh = (await s.agent("find_duplicate_people", {})).body.pairs.find((p) => [p.a.id, p.b.id].sort().join() === [a.id, b.id].sort().join());
  assert.equal(fresh.suggested_keep_id, b.id);
  assert.equal(fresh.suggested_drop_id, a.id);
  // nothing was merged
  assert.ok(people.getPerson(a.id) && people.getPerson(b.id));
  const rest = await s.call("GET", "/api/people/duplicates?min_score=0.95&limit=2");
  assert.equal(rest.status, 200);
  assert.ok(rest.body.pairs.length <= 2 && rest.body.pairs.every((p) => p.score >= 0.95));
  assert.equal(findDuplicatePeople({ minScore: 1.01 }).pairs.length, 0);
});

// ------------------------------------------------------------------ plumbing
test("unknown routes and tools, bad JSON, the token and bad arguments answer with the family's error envelope", async () => {
  const miss = await s.call("GET", "/api/nope");
  assert.equal(miss.status, 404);
  assert.equal(miss.body.code, "not_found");
  const noToken = await s.call("POST", "/api/agent/call", { name: "list_people" });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.code, "unauthorized");
  const unknown = await s.agent("no_such_tool", {});
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /no_such_tool/);
  const bad = await fetch(`${s.base}/api/agent/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_json");
  const invalid = await s.agent("commitment_add", {});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "invalid_arguments");
  assert.ok(Array.isArray(invalid.body.issues));
  const ambiguous = await s.agent("get_person", { person: "Dupe" });
  assert.equal(ambiguous.status, 400);
  assert.ok(Array.isArray(ambiguous.body.candidates), "candidates survive the envelope");
});
