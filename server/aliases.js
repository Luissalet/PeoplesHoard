// Contact handles (WhatsApp display name, e-mail, phone, other) that let a
// future message resolve to a person. kind+value is globally unique, so one
// handle can only ever mean one person.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { reindexPerson, ALIAS_KINDS, getPerson } from "./people.js";

export const aliasInput = z.object({
  kind: z.enum(ALIAS_KINDS).default("other"),
  value: z.string().trim().min(1).max(200),
});
export const aliasPatch = aliasInput.partial();

export function listAliases(personId) {
  return db().prepare("SELECT * FROM aliases WHERE person_id = ? ORDER BY created_at").all(personId);
}

export function getAlias(id) {
  return db().prepare("SELECT * FROM aliases WHERE id = ?").get(id) || null;
}

function findExact(kind, value) {
  return db().prepare("SELECT * FROM aliases WHERE kind = ? AND value = ? COLLATE NOCASE").get(kind, value) || null;
}

/** Idempotent on kind+value: adding the same handle to the same person is a no-op. */
export function addAlias(personId, input) {
  if (!getPerson(personId)) throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const data = aliasInput.parse(input);
  const existing = findExact(data.kind, data.value);
  if (existing) {
    if (existing.person_id === personId) return existing;
    throw Object.assign(new Error(`Ese ${data.kind} ya pertenece a otra persona.`), { status: 409 });
  }
  const id = uid();
  db().prepare("INSERT INTO aliases (id, person_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, personId, data.kind, data.value, now());
  reindexPerson(personId);
  return getAlias(id);
}

export function updateAlias(id, patch) {
  const current = getAlias(id);
  if (!current) return null;
  const data = aliasPatch.parse(patch);
  const next = { ...current, ...data };
  const clash = findExact(next.kind, next.value);
  if (clash && clash.id !== id) throw Object.assign(new Error(`Ese ${next.kind} ya pertenece a otra persona.`), { status: 409 });
  db().prepare("UPDATE aliases SET kind = ?, value = ? WHERE id = ?").run(next.kind, next.value, id);
  reindexPerson(current.person_id);
  return getAlias(id);
}

export function deleteAlias(id) {
  const current = getAlias(id);
  if (!current) return false;
  db().prepare("DELETE FROM aliases WHERE id = ?").run(id);
  reindexPerson(current.person_id);
  return true;
}
