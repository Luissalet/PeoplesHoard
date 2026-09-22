// Free-form key/value facts about a person ("trabaja en", "hijos",
// "alergias", "le gusta"...). Idempotent on person+key+value.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { reindexPerson, getPerson } from "./people.js";

export const factInput = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(2000),
});
export const factPatch = factInput.partial();

export function listFacts(personId) {
  return db().prepare("SELECT * FROM facts WHERE person_id = ? ORDER BY created_at").all(personId);
}

export function getFact(id) {
  return db().prepare("SELECT * FROM facts WHERE id = ?").get(id) || null;
}

function findExact(personId, key, value) {
  return db()
    .prepare("SELECT * FROM facts WHERE person_id = ? AND key = ? COLLATE NOCASE AND value = ? COLLATE NOCASE")
    .get(personId, key, value) || null;
}

export function addFact(personId, input) {
  if (!getPerson(personId)) throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const data = factInput.parse(input);
  const existing = findExact(personId, data.key, data.value);
  if (existing) return existing;
  const id = uid();
  db().prepare("INSERT INTO facts (id, person_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, personId, data.key, data.value, now());
  reindexPerson(personId);
  return getFact(id);
}

export function updateFact(id, patch) {
  const current = getFact(id);
  if (!current) return null;
  const data = factPatch.parse(patch);
  const next = { ...current, ...data };
  db().prepare("UPDATE facts SET key = ?, value = ? WHERE id = ?").run(next.key, next.value, id);
  reindexPerson(current.person_id);
  return getFact(id);
}

export function deleteFact(id) {
  const current = getFact(id);
  if (!current) return false;
  db().prepare("DELETE FROM facts WHERE id = ?").run(id);
  reindexPerson(current.person_id);
  return true;
}
