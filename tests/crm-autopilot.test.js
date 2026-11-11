// The address book working on its own: special dates, people cooling off, the daily nudges to the hub's digest, «prepárame»
// with the family model, the last contact from WhatsApp batches, vCard import and what a merge keeps. Fictional people only.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { today, addDays } from "../server/dates.js";
import * as people from "../server/people.js";
import * as interactions from "../server/interactions.js";
import * as commitments from "../server/commitments.js";
import { nudgeSweep, nudgesReport, coolingContacts, sinceWords } from "../server/nudges.js";
import { agendaItems } from "../server/agenda.js";
import { calendarFeed } from "../server/calendar.js";
import { db } from "../server/db.js";

let s, hub;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});
beforeEach(() => { hub.state.emitted.length = 0; hub.state.chats.length = 0; });

const T = today();
const daysAgo = (n) => new Date(Date.parse(`${addDays(T, -n)}T12:00:00`)).toISOString();
const digest = () => hub.state.emitted.filter((e) => e.type === "digest.item" && e.data.watch === "people");

test("special dates: saved once, a one-off day needs its year, shown on the record, the agenda and the calendar", async () => {
  const p = people.createPerson({ name: "Celia Ensayo" });
  const day = addDays(T, 3);
  const added = await s.agent("person_date_add", { person: "Celia Ensayo", label: "Aniversario de boda", date: `2016-${day.slice(5)}` });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.created, true);
  assert.equal((await s.agent("person_date_add", { person: p.id, label: "aniversario de boda", date: `2016-${day.slice(5)}` })).body.created, false);
  assert.equal((await s.call("POST", `/api/people/${p.id}/dates`, { label: "Mudanza", date: `--${day.slice(5)}`, yearly: false })).status, 400);
  assert.equal((await s.call("POST", `/api/people/${p.id}/dates`, { label: "Santo", date: "--13-40" })).status, 400);
  const full = await s.call("GET", `/api/people/${p.id}`);
  assert.equal(full.body.dates.length, 1);
  assert.equal(full.body.dates[0].yearly, true);
  const upcoming = await s.call("GET", "/api/upcoming?days=7");
  const mine = upcoming.body.dates.find((d) => d.person_id === p.id);
  assert.equal(mine.days_until, 3);
  assert.equal(mine.years, Number(day.slice(0, 4)) - 2016);
  const agenda = agendaItems(T, addDays(T, 10));
  assert.ok(agenda.some((i) => i.id.startsWith(`people:date:${added.body.date.id}`) && i.start === day && i.title.includes("Celia Ensayo")));
  assert.match(calendarFeed().text, /SUMMARY:Aniversario de boda · Celia Ensayo/);
  const patched = await s.call("PATCH", `/api/dates/${added.body.date.id}`, { label: "Aniversario" });
  assert.equal(patched.body.label, "Aniversario");
  assert.equal((await s.agent("person_date_remove", { id: added.body.date.id })).body.removed, true);
  assert.equal((await s.call("GET", `/api/people/${p.id}`)).body.dates.length, 0);
});

test("cooling: only people with a past relationship, no cadence of their own and a long silence", () => {
  const cold = people.createPerson({ name: "Rubén Silencio" });
  interactions.createInteraction(cold.id, { at: daysAgo(200), summary: "cena" });
  interactions.createInteraction(cold.id, { at: daysAgo(150), summary: "llamada" });
  const once = people.createPerson({ name: "Una Sola Vez" });
  interactions.createInteraction(once.id, { at: daysAgo(300) });
  const cadence = people.createPerson({ name: "Con Cadencia", contact_every_days: 30 });
  interactions.createInteraction(cadence.id, { at: daysAgo(200) });
  interactions.createInteraction(cadence.id, { at: daysAgo(180) });
  const recent = people.createPerson({ name: "Hablamos Ayer" });
  interactions.createInteraction(recent.id, { at: daysAgo(400) });
  interactions.createInteraction(recent.id, { at: daysAgo(1) });
  const list = coolingContacts({ days: 90 }).map((c) => c.name);
  assert.ok(list.includes("Rubén Silencio"));
  for (const name of ["Una Sola Vez", "Con Cadencia", "Hablamos Ayer"]) assert.ok(!list.includes(name), name);
  assert.equal(coolingContacts({ days: 0 }).length, 0);
  assert.equal(sinceWords(150), "5 meses");
  assert.equal(sinceWords(20), "2 semanas");
  assert.equal(sinceWords(800), "más de 2 años");
});

test("nudges: each line goes to the digest once, a hub that is away gets them later, and they can be switched off", async () => {
  const ana = people.createPerson({ name: "Ana Recado", birthday: `1988-${addDays(T, 2).slice(5)}` });
  commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Devolverle el libro", due: T }, { emit: false });
  commitments.addCommitment({ direction: "owed_to_me", person_id: ana.id, text: "Pagarme las entradas", due: addDays(T, -4) }, { emit: false });
  const report = await s.call("GET", "/api/nudges");
  assert.equal(report.status, 200);
  const kinds = new Set(report.body.items.map((i) => i.kind));
  for (const kind of ["commitment", "birthday", "cooling"]) assert.ok(kinds.has(kind), kind);
  assert.ok(report.body.items.some((i) => i.title === "Vence hoy · Le debes a Ana Recado: Devolverle el libro"));
  assert.ok(report.body.items.some((i) => /^Vencido hace 4 días · Ana Recado te debe: Pagarme las entradas$/.test(i.title)));
  assert.ok(report.body.items.some((i) => i.title === "Cumpleaños de Ana Recado en 2 días (cumple " + (Number(addDays(T, 2).slice(0, 4)) - 1988) + ")"));
  const first = await nudgeSweep();
  assert.equal(first.status, "sent");
  const titles = digest().map((e) => e.data.title);
  assert.ok(titles.includes("Vence hoy · Le debes a Ana Recado: Devolverle el libro"));
  assert.ok(titles.some((t) => t.startsWith("Hace 5 meses que no hablas con Rubén Silencio")));
  assert.ok(digest().every((e) => e.data.url.includes("/#/")));
  hub.state.emitted.length = 0;
  assert.equal((await nudgeSweep()).status, "nothing");
  assert.equal(digest().length, 0);
  assert.equal(nudgesReport().pending, 0);
  // a new commitment while the hub is away: kept for the next pass
  commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Llamar al fontanero", due: T }, { emit: false });
  process.env.HOARD_HUB_URL = "http://127.0.0.1:9";
  assert.equal((await nudgeSweep()).status, "hub_down");
  process.env.HOARD_HUB_URL = hub.url;
  assert.equal((await nudgeSweep()).status, "sent");
  assert.deepEqual(digest().map((e) => e.data.title), ["Vence hoy · Le debes a Ana Recado: Llamar al fontanero"]);
  // switched off from the settings: the background pass does nothing, the button still sends
  assert.equal((await s.call("POST", "/api/settings", { nudges: false, cooling_days: 120 })).body.nudges, false);
  commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Mandar la foto", due: T }, { emit: false });
  assert.equal((await nudgeSweep()).status, "off");
  const now = await s.call("POST", "/api/nudges/send", {});
  assert.equal(now.body.result.status, "sent");
  assert.equal((await s.call("GET", "/api/settings")).body.cooling_days, 120);
  assert.equal((await s.call("POST", "/api/settings", { cooling_days: -1 })).status, 400);
  await s.call("POST", "/api/settings", { nudges: true, cooling_days: 90 });
  const tool = await s.agent("people_nudges", {});
  assert.equal(tool.status, 200);
  assert.ok(tool.body.items.every((i) => i.sent));
});

test("prepare_to_meet: the family model writes it from the book's data; without a model the outline comes back", async () => {
  const p = people.createPerson({ name: "Gonzalo Prueba", summary: "Primo de Bilbao" });
  interactions.createInteraction(p.id, { at: daysAgo(20), channel: "call", summary: "Me contó que se muda a Valencia" });
  commitments.addCommitment({ direction: "i_owe", person_id: p.id, text: "Pasarle el contacto del notario", due: addDays(T, 2) }, { emit: false });
  hub.state.chat = { status: 200, body: { ok: true, text: "<think>x</think>- Hablasteis hace 3 semanas de su mudanza.\nPara abrir: ¿qué tal Valencia?", model: "fake-model" } };
  const out = await s.agent("prepare_to_meet", { person: "Gonzalo" });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.status, "ok");
  assert.equal(out.body.text, "- Hablasteis hace 3 semanas de su mudanza.\nPara abrir: ¿qué tal Valencia?");
  assert.equal(out.body.model, "fake-model");
  const sent = hub.state.chats.at(-1).messages.at(-1).content;
  assert.match(sent, /Le debes: Pasarle el contacto del notario/);
  assert.match(sent, /Me contó que se muda a Valencia/);
  assert.match(sent, /Primo de Bilbao/);
  hub.state.chat = { status: 503, body: { ok: false, error: "no_model" } };
  const fallback = await s.call("POST", `/api/people/${p.id}/prepare`, {});
  assert.equal(fallback.body.status, "no_model");
  assert.ok(fallback.body.outline.some((l) => l.startsWith("Le debes: Pasarle el contacto del notario")));
  assert.equal((await s.call("POST", "/api/people/nadie/prepare", {})).status, 404);
});

test("WhatsApp batches move the last contact: one line per person and day, never the words of a message", async () => {
  const p = people.createPerson({ name: "Lola Mensajes" });
  await s.call("POST", `/api/people/${p.id}/aliases`, { kind: "phone", value: "+34 611 22 33 44" });
  // Saved messages must be in the past even when the suite runs before noon.
  const day = addDays(T, -1);
  const at1 = Date.parse(`${day}T09:00:00`);
  const at2 = Date.parse(`${day}T11:30:00`);
  const msg = (id, ts, text, sender = "them") => ({ id, chat_id: "34611223344@s.whatsapp.net", contact_name: "Lola", phone: "+34611223344", sender, text, timestamp: ts });
  const first = await s.agent("commitments_from_messages", { messages: [msg("m1", at1, "ok"), msg("m2", at1 + 1000, "nos vemos pronto")] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.contacts_updated, 1);
  let rows = db().prepare("SELECT * FROM interactions WHERE person_id = ?").all(p.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "whatsapp");
  assert.equal(rows[0].summary, "Mensajes de WhatsApp");
  assert.equal(rows[0].at, new Date(at1 + 1000).toISOString());
  await s.agent("commitments_from_messages", { messages: [msg("m3", at2, "te escribo luego", "me")] });
  rows = db().prepare("SELECT * FROM interactions WHERE person_id = ?").all(p.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, new Date(at2).toISOString());
  assert.equal(people.getPerson(p.id).last_contact_at, new Date(at2).toISOString());
  // a number nobody has, a group and the setting off: nothing moves
  const stranger = await s.agent("commitments_from_messages", { messages: [{ ...msg("x1", at2, "hola"), phone: "+34699000000", chat_id: "34699000000@s.whatsapp.net", contact_name: "Desconocido" }] });
  assert.equal(stranger.body.contacts_updated, 0);
  const group = await s.agent("commitments_from_messages", { messages: [{ ...msg("g1", at2, "hola"), chat_id: "123@g.us", is_group: true }] });
  assert.equal(group.body.contacts_updated, 0);
  await s.call("POST", "/api/settings", { whatsapp_last_contact: false });
  const off = await s.agent("commitments_from_messages", { messages: [msg("m4", Date.parse(`${addDays(T, -1)}T10:00:00`), "vale")] });
  assert.equal(off.body.contacts_updated, 0);
  await s.call("POST", "/api/settings", { whatsapp_last_contact: true });
});

test("vCard import: preview first, fill only what is empty, never move a handle, and a second import changes nothing", async () => {
  const known = people.createPerson({ name: "Teresa Vcard", location: "Lugo" });
  await s.call("POST", `/api/people/${known.id}/aliases`, { kind: "email", value: "teresa@example.test" });
  const other = people.createPerson({ name: "Dueño Del Número" });
  await s.call("POST", `/api/people/${other.id}/aliases`, { kind: "phone", value: "+34 622 00 00 01" });
  const vcf = [
    "BEGIN:VCARD", "VERSION:3.0", "N:Vcard;Teresa;;;", "FN:Teresa V.", "EMAIL;TYPE=INTERNET:Teresa@Example.test", "TEL;TYPE=CELL:+34 622 00 00 02",
    "BDAY:1979-05-04", "ADR;TYPE=HOME:;;Calle Falsa 1;Madrid;;28001;España", "ORG:Ejemplo S.L.", "END:VCARD",
    "BEGIN:VCARD", "VERSION:2.1", "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;Jos=C3=A9;;;", "TEL;CELL:622 00 00 01",
    "NOTE:Conocido del gimnasio", "CATEGORIES:gimnasio,amigos", "BDAY:--0612", "END:VCARD",
    "BEGIN:VCARD", "VERSION:4.0", "FN:Nuevo Contacto", "EMAIL:nuevo@example.test", "ANNIVERSARY:20100918", "END:VCARD",
  ].join("\r\n");
  const preview = await s.agent("import_people_vcard", { text: vcf });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual([preview.body.cards, preview.body.create, preview.body.update, preview.body.applied], [3, 1, 2, false]);
  const teresa = preview.body.items[0];
  assert.equal(teresa.person_id, known.id);
  assert.equal(teresa.matched_by, "email");
  assert.deepEqual(teresa.fill, { birthday: "1979-05-04" }, "the place she already has is kept");
  assert.deepEqual(teresa.aliases, [{ kind: "phone", value: "+34 622 00 00 02" }]);
  assert.equal(teresa.name_differs, false);
  const jose = preview.body.items[1];
  assert.equal(jose.name, "José Muñoz", "N in quoted-printable UTF-8");
  assert.equal(jose.person_id, other.id, "the phone says who it is");
  assert.equal(jose.matched_by, "phone");
  assert.equal(jose.name_differs, true, "under a different name: the preview says so");
  assert.equal(people.listPeople({ q: "Nuevo Contacto" }).length, 0, "a preview writes nothing");
  const applied = await s.call("POST", "/api/people/import-vcard", { text: vcf, apply: true });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const t = (await s.call("GET", `/api/people/${known.id}`)).body;
  assert.equal(t.birthday, "1979-05-04");
  assert.equal(t.location, "Lugo");
  assert.ok(t.aliases.some((a) => a.kind === "phone" && a.value === "+34 622 00 00 02"));
  assert.ok(t.facts.some((f) => f.key === "trabaja en" && f.value === "Ejemplo S.L."));
  const j = (await s.call("GET", `/api/people/${other.id}`)).body;
  assert.equal(j.name, "Dueño Del Número", "a name is never overwritten");
  assert.equal(j.birthday, "--06-12");
  assert.deepEqual(j.circles, ["gimnasio", "amigos"]);
  assert.ok(j.facts.some((f) => f.key === "nota del contacto" && f.value === "Conocido del gimnasio"));
  // a handle that is someone else's is never moved
  const clash = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Teresa Vcard\r\nEMAIL:teresa@example.test\r\nTEL:+34 622 00 00 01\r\nEND:VCARD\r\n";
  const clashed = await s.call("POST", "/api/people/import-vcard", { text: clash, apply: true });
  assert.equal(clashed.body.items[0].person_id, known.id, "the e-mail says who it is");
  assert.equal(clashed.body.conflicts, 1);
  assert.equal(people.getPersonFull(other.id).aliases.length, 1);
  const nuevo = (await s.call("GET", `/api/people/${people.listPeople({ q: "Nuevo Contacto" })[0].id}`)).body;
  assert.equal(nuevo.dates[0].label, "Aniversario");
  assert.equal(nuevo.dates[0].date, "2010-09-18");
  const again = await s.call("POST", "/api/people/import-vcard", { text: vcf, apply: true });
  assert.equal(again.body.create, 0);
  // what this app exports comes back to the same people by its UID
  const own = await (await fetch(`${s.base}/api/people/${known.id}/vcard`)).text();
  const round = await s.call("POST", "/api/people/import-vcard", { text: own });
  assert.equal(round.body.items[0].matched_by, "uid");
  assert.equal(round.body.items[0].action, "unchanged");
  assert.equal((await s.call("POST", "/api/people/import-vcard", { text: "hola" })).status, 400);
});

test("merge keeps what only the duplicate knew, and its special dates", () => {
  const keep = people.createPerson({ name: "Iván Doble", notes: "Nota A" });
  const drop = people.createPerson({ name: "Ivan Doble", birthday: "--02-03", summary: "Amigo del máster", location: "Soria", notes: "Nota B", contact_every_days: 60 });
  db().prepare("INSERT INTO person_dates (id, person_id, label, date, yearly, created_at) VALUES ('d1', ?, 'Santo', '--03-19', 1, ?)").run(drop.id, new Date().toISOString());
  const merged = people.mergePeople(keep.id, drop.id);
  assert.equal(merged.birthday, "--02-03");
  assert.equal(merged.summary, "Amigo del máster");
  assert.equal(merged.location, "Soria");
  assert.equal(merged.contact_every_days, 60);
  assert.equal(merged.notes, "Nota A\n\nNota B");
  assert.equal(people.getPersonFull(keep.id).dates.length, 1);
});

test("open reminders are on the family agenda, and backups carry the special dates", async () => {
  const p = people.createPerson({ name: "Recordada Agenda" });
  await s.call("POST", `/api/people/${p.id}/reminders`, { due: addDays(T, 1), text: "Preguntar por el examen" });
  await s.call("POST", `/api/people/${p.id}/dates`, { label: "Santo", date: "--07-25" });
  const items = agendaItems(T, addDays(T, 5));
  assert.ok(items.some((i) => i.kind === "followup" && i.title === "Preguntar por el examen (Recordada Agenda)" && i.start === addDays(T, 1)));
  const backup = await s.call("GET", "/api/export");
  assert.ok(backup.body.person_dates.some((d) => d.label === "Santo" && d.date === "--07-25"));
  const restored = await s.call("POST", "/api/import", { ...backup.body, people: backup.body.people.filter((x) => x.id === p.id) });
  assert.equal(restored.body.person_dates, 1);
});
