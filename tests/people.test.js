// Domain-level tests against server/people.js directly (no HTTP), covering
// fuzzy resolve, FTS search, merge and upsert idempotency.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init, close } from "../server/db.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import * as facts from "../server/facts.js";

let dataDir;
before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "peoples-hoard-domain-"));
  init(dataDir);
});
after(() => {
  close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Tests below build on each other in order (node:test runs a file's tests
// sequentially), reusing jose/maria/ana across the fuzzy-search and
// resolve tests so we are not reindexing the same fixtures twice.
let jose, maria, ana;

test("createPerson + FTS/fuzzy search: accents, partial names, alias", () => {
  jose = people.createPerson({ name: "José Ramírez", nickname: "Pepe", circles: ["amigos"], summary: "Compañero de piso en la universidad." });
  maria = people.createPerson({ name: "María Fernández", circles: ["trabajo"] });
  ana = people.createPerson({ name: "Ana García", nickname: "Anita", circles: ["familia", "amigos"] });
  aliases.addAlias(jose.id, { kind: "whatsapp", value: "Pepe R." });

  // Accent-insensitive: typing without accents still finds "José" / "María".
  assert.equal(people.findPeople("jose")[0].id, jose.id);
  assert.equal(people.findPeople("maria")[0].id, maria.id);

  // Partial, mid-word substrings.
  const midWord = people.findPeople("amir"); // inside "Ramírez"
  assert.ok(midWord.some((c) => c.id === jose.id), "matches a substring in the middle of the surname");

  // Nickname and alias matches.
  assert.equal(people.findPeople("Anita")[0].id, ana.id);
  assert.equal(people.findPeople("Pepe R.")[0].id, jose.id, "alias resolves");

  // Free-text over summary via FTS.
  const bySummary = people.findPeople("compañero piso");
  assert.ok(bySummary.some((c) => c.id === jose.id), "FTS matches summary text");

  // No spurious matches.
  assert.equal(people.findPeople("xyz-nadie").length, 0);
});

test("resolvePersonRef: id, exact name, alias, unambiguous fuzzy, and ambiguity", () => {
  const byId = people.resolvePersonRef(jose.id);
  assert.equal(byId.person.id, jose.id);

  const byExactName = people.resolvePersonRef("José Ramírez");
  assert.equal(byExactName.person.id, jose.id);

  const byFoldedName = people.resolvePersonRef("jose ramirez");
  assert.equal(byFoldedName.person.id, jose.id, "exact match ignores accents via COLLATE NOCASE + fallback fuzzy");

  const byAlias = people.resolvePersonRef("Pepe R.");
  assert.equal(byAlias.person.id, jose.id);

  const nobody = people.resolvePersonRef("Nadie Inventado");
  assert.equal(nobody.person, null);
  assert.equal(nobody.candidates.length, 0);

  // Two people sharing a first name are ambiguous.
  const carlos1 = people.createPerson({ name: "Carlos Ruiz" });
  const carlos2 = people.createPerson({ name: "Carlos Ruiz" });
  const ambiguous = people.resolvePersonRef("Carlos Ruiz");
  assert.equal(ambiguous.person, null);
  assert.equal(ambiguous.candidates.length, 2);
  people.deletePerson(carlos1.id);
  people.deletePerson(carlos2.id);
});

test("upsert_person is idempotent by exact name and partial on patch", () => {
  const created = people.upsertPerson("Nuevo Contacto Ejemplo", { circles: ["trabajo"] });
  assert.equal(created.created, true);
  assert.equal(created.person.circles.length, 1);

  const updated = people.upsertPerson("Nuevo Contacto Ejemplo", { location: "Valencia" });
  assert.equal(updated.created, false);
  assert.equal(updated.person.id, created.person.id, "same person, not a duplicate");
  assert.equal(updated.person.location, "Valencia");
  assert.equal(updated.person.circles.length, 1, "untouched field kept");

  people.deletePerson(created.person.id);
});

test("addAlias is idempotent for the same person, and rejects a clash with someone else", () => {
  const first = aliases.addAlias(jose.id, { kind: "email", value: "pepe@example.test" });
  const again = aliases.addAlias(jose.id, { kind: "email", value: "pepe@example.test" });
  assert.equal(again.id, first.id, "no duplicate row created");

  assert.throws(() => aliases.addAlias(maria.id, { kind: "email", value: "pepe@example.test" }), /ya pertenece a otra persona/);
});

test("addFact is idempotent on person+key+value", () => {
  const first = facts.addFact(jose.id, { key: "le gusta", value: "el fútbol" });
  const again = facts.addFact(jose.id, { key: "le gusta", value: "el fútbol" });
  assert.equal(again.id, first.id);
  const different = facts.addFact(jose.id, { key: "le gusta", value: "la escalada" });
  assert.notEqual(different.id, first.id);
});

test("mergePeople moves facts/aliases/interactions/reminders and unions circles", () => {
  const keep = people.createPerson({ name: "Persona Uno", circles: ["amigos"] });
  const drop = people.createPerson({ name: "Persona Dos (duplicada)", circles: ["trabajo"] });
  facts.addFact(drop.id, { key: "trabaja en", value: "Empresa Ejemplo" });
  aliases.addAlias(drop.id, { kind: "phone", value: "+34 600 000 000" });

  const merged = people.mergePeople(keep.id, drop.id);
  assert.equal(merged.id, keep.id);
  assert.deepEqual(merged.circles.sort(), ["amigos", "trabajo"]);
  assert.equal(people.getPerson(drop.id), null, "the duplicate is gone");

  const full = people.getPersonFull(keep.id);
  assert.equal(full.facts.some((f) => f.value === "Empresa Ejemplo"), true);
  assert.equal(full.aliases.some((a) => a.value === "+34 600 000 000"), true);
});
