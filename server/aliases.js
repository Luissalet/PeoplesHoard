// Contact handles (WhatsApp display name, e-mail, phone, other) that let a
// future message resolve to a person. kind+value is globally unique, so one
// handle can only ever mean one person: "Ana@Example.com" and "ana+news@example.com" are one e-mail, "600 11 22 33" and
// "+34 600112233" one phone (the family's normalizeEmail / normalizePhone, see handles.js). The value is kept as typed.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { reindexPerson, ALIAS_KINDS, getPerson } from "./people.js";
import { contactsChanged } from "./mailsync.js";
import { normalizeHandle, findHandle, ensureNorms } from "./handles.js";

export const aliasInput = z.object({
  kind: z.enum(ALIAS_KINDS).default("other"),
  value: z.string().trim().min(1).max(200),
});
// no default for kind here: changing only the value must not turn an e-mail into an "other" handle
export const aliasPatch = z.object({ kind: z.enum(ALIAS_KINDS), value: aliasInput.shape.value }).partial();

export function listAliases(personId) {
  ensureNorms();
  return db().prepare("SELECT * FROM aliases WHERE person_id = ? ORDER BY created_at").all(personId);
}

export function getAlias(id) {
  return db().prepare("SELECT * FROM aliases WHERE id = ?").get(id) || null;
}

const findExact = findHandle;

/** Idempotent on kind+value: adding the same handle to the same person is a no-op. */
export function addAlias(personId, input) {
  ensureNorms();
  if (!getPerson(personId)) throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const data = aliasInput.parse(input);
  const existing = findExact(data.kind, data.value);
  if (existing) {
    if (existing.person_id === personId) return existing;
    throw Object.assign(new Error(`Ese ${data.kind} ya pertenece a otra persona.`), { status: 409 });
  }
  const id = uid();
  db().prepare("INSERT INTO aliases (id, person_id, kind, value, norm, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, personId, data.kind, data.value, normalizeHandle(data.kind, data.value), now());
  reindexPerson(personId);
  if (data.kind === "email") contactsChanged();
  return getAlias(id);
}

export function updateAlias(id, patch) {
  ensureNorms();
  const current = getAlias(id);
  if (!current) return null;
  const data = aliasPatch.parse(patch);
  const next = { ...current, ...data };
  const clash = findExact(next.kind, next.value);
  if (clash && clash.id !== id) throw Object.assign(new Error(`Ese ${next.kind} ya pertenece a otra persona.`), { status: 409 });
  db().prepare("UPDATE aliases SET kind = ?, value = ?, norm = ? WHERE id = ?").run(next.kind, next.value, normalizeHandle(next.kind, next.value), id);
  reindexPerson(current.person_id);
  if (current.kind === "email" || next.kind === "email") contactsChanged();
  return getAlias(id);
}

export function deleteAlias(id) {
  const current = getAlias(id);
  if (!current) return false;
  db().prepare("DELETE FROM aliases WHERE id = ?").run(id);
  reindexPerson(current.person_id);
  if (current.kind === "email") contactsChanged();
  return true;
}
