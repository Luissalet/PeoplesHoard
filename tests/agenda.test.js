// The family agenda: birthdays, follow-ups by cadence and commitments with a day, over the contract's route and token.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { today, addDays } from "../server/dates.js";
import * as people from "../server/people.js";
import * as interactions from "../server/interactions.js";
import * as commitments from "../server/commitments.js";
import { agendaItems, setPublicUrl } from "../server/agenda.js";

let s, ana, luis, sin, archived;
const T = today();
before(async () => {
  s = await bootServer();
  setPublicUrl("http://127.0.0.1:5999");
  ana = people.createPerson({ name: "Ana Torres", birthday: `1985-${addDays(T, 9).slice(5)}`, contact_every_days: 30 });
  luis = people.createPerson({ name: "Luis Prieto", birthday: `--${addDays(T, 400).slice(5)}`, contact_every_days: 10 });
  sin = people.createPerson({ name: "Nunca Hablados", contact_every_days: 15 });
  archived = people.createPerson({ name: "Archivado Perez", birthday: `1990-${addDays(T, 3).slice(5)}`, contact_every_days: 5, archived: true });
  interactions.createInteraction(ana.id, { at: `${addDays(T, -26)}T10:00:00`, channel: "whatsapp" });   // due in 4 days
  interactions.createInteraction(luis.id, { at: `${addDays(T, -50)}T10:00:00`, channel: "call" });      // overdue by 40
});
after(async () => { await s.stop(); });

const ask = async (query, token = s.token) => {
  const r = await fetch(`${s.base}/api/family/agenda${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json() };
};
const kinds = (items, kind) => items.filter((i) => i.kind === kind);

test("the route answers the contract with the app's own token and refuses anything else", async () => {
  assert.equal((await ask(`?from=${T}&to=${addDays(T, 30)}`, "")).status, 401);
  assert.equal((await ask(`?from=${T}&to=${addDays(T, 30)}`, "nope")).status, 401);
  const r = await ask(`?from=${addDays(T, -7)}&to=${addDays(T, 30)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.items.length >= 3);
  for (const item of r.body.items) {
    assert.match(item.id, /^people:(birthday|followup|commitment):/);
    assert.equal(item.all_day, true);
    assert.match(item.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(item.url, /^http:\/\/127\.0\.0\.1:5999\/#\/(personas|compromisos)/);
  }
});

test("birthdays: inside the window only, with the age when the year is known, never for archived people", () => {
  const items = agendaItems(T, addDays(T, 30), "");
  const birthdays = kinds(items, "birthday");
  assert.equal(birthdays.length, 1);
  assert.equal(birthdays[0].title, "Cumpleaños de Ana Torres");
  assert.equal(birthdays[0].start, addDays(T, 9));
  assert.equal(birthdays[0].detail, `Cumple ${Number(addDays(T, 9).slice(0, 4)) - 1985}`);
  assert.equal(birthdays[0].id, `people:birthday:${ana.id}:${addDays(T, 9).slice(0, 4)}`);
  assert.equal(kinds(agendaItems(T, addDays(T, 5)), "birthday").length, 0);
  const wide = kinds(agendaItems(T, addDays(T, 420)), "birthday");
  assert.ok(wide.some((b) => b.title.includes("Luis Prieto") && b.detail === ""));
  assert.ok(!wide.some((b) => b.title.includes("Archivado")));
});

test("follow-ups are due at last contact plus the cadence; an overdue one stays on the first day of the window", () => {
  const items = kinds(agendaItems(addDays(T, -7), addDays(T, 30)), "followup");
  const byName = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byName["Hablar con Ana Torres"].start, addDays(T, 4));
  assert.equal(byName["Hablar con Ana Torres"].priority, "normal");
  assert.match(byName["Hablar con Ana Torres"].detail, /quería hablar cada 30 días/);
  assert.equal(byName["Hablar con Luis Prieto"].start, addDays(T, -7), "overdue by 40 days: shown at the start of the window");
  assert.equal(byName["Hablar con Luis Prieto"].priority, "high");
  assert.equal(byName["Hablar con Nunca Hablados"].start, T, "never talked to: due today");
  assert.match(byName["Hablar con Nunca Hablados"].detail, /Sin contacto registrado/);
  assert.ok(!byName["Hablar con Archivado Perez"]);
  assert.equal(byName["Hablar con Nunca Hablados"].id, `people:followup:${sin.id}:never`);
  assert.equal(kinds(agendaItems(addDays(T, 10), addDays(T, 30)), "followup").filter((i) => i.title.includes("Ana")).length, 0);
});

test("commitments with a day are deadlines in both directions; overdue ones show; closed or dateless ones do not", () => {
  const mine = commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Enviar el presupuesto", due: addDays(T, 6) }).commitment;
  const theirs = commitments.addCommitment({ direction: "owed_to_me", person_id: luis.id, text: "Devolver el libro", due: addDays(T, -3) }).commitment;
  commitments.addCommitment({ direction: "i_owe", person_name_raw: "Alguien Suelto", text: "Llamar al gremio", due: addDays(T, 2) });
  commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Sin día", due_text: "algún día" });
  const closed = commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Ya hecho", due: addDays(T, 1) }).commitment;
  commitments.completeCommitment(closed.id);
  const items = kinds(agendaItems(addDays(T, -7), addDays(T, 30)), "deadline");
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId[`people:commitment:${mine.id}`].title, "Debo a Ana Torres: Enviar el presupuesto");
  assert.equal(byId[`people:commitment:${mine.id}`].start, addDays(T, 6));
  assert.equal(byId[`people:commitment:${mine.id}`].priority, "high");
  assert.equal(byId[`people:commitment:${theirs.id}`].title, "Luis Prieto me debe: Devolver el libro");
  assert.equal(byId[`people:commitment:${theirs.id}`].start, addDays(T, -3));
  assert.match(byId[`people:commitment:${theirs.id}`].detail, /^Venció el /);
  assert.ok(items.some((i) => i.title === "Debo a Alguien Suelto: Llamar al gremio"));
  assert.equal(items.length, 3);
  // a promise long overdue is kept on the first day of the window
  const old = commitments.addCommitment({ direction: "i_owe", person_id: ana.id, text: "Antigua", due: addDays(T, -90) }).commitment;
  assert.equal(kinds(agendaItems(addDays(T, -7), addDays(T, 30)), "deadline").find((i) => i.id === `people:commitment:${old.id}`).start, addDays(T, -7));
});

test("a window with nothing in it is an empty list, and bad dates fall back to the default window", async () => {
  assert.deepEqual(agendaItems("2020-01-01", "2020-01-02"), []);
  const r = await ask("?from=nonsense&to=");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});
