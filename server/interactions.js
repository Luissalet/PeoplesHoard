// The contact timeline. Every write recomputes the person's cached
// last_contact_at from MAX(at), so edits and deletes stay consistent.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { recomputeLastContact, getPerson } from "./people.js";
import { localDate } from "./dates.js";
import * as family from "./hoard-link.js";

export const CHANNELS = ["whatsapp", "email", "call", "meet", "message", "other"];

const atField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha/hora no válida.")
  .transform((v) => new Date(v).toISOString());

const interactionShape = {
  at: atField,
  channel: z.enum(CHANNELS),
  summary: z.string().trim().max(2000),
  source: z.enum(["manual", "agent", "mail"]),
};
export const interactionInput = z.object({
  ...interactionShape,
  at: atField.default(() => new Date().toISOString()),
  channel: interactionShape.channel.default("other"),
  summary: interactionShape.summary.default(""),
  source: interactionShape.source.default("manual"),
});
export const interactionPatch = z.object(interactionShape).partial();

export function listInteractions(personId, { limit = null } = {}) {
  let sql = "SELECT * FROM interactions WHERE person_id = ? ORDER BY at DESC";
  const params = [personId];
  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  }
  return db().prepare(sql).all(...params);
}

export function getInteraction(id) {
  return db().prepare("SELECT * FROM interactions WHERE id = ?").get(id) || null;
}

/** `ref` (optional) names where the interaction came from; the same person and ref never get a second one. */
export function createInteraction(personId, input, { ref = null } = {}) {
  if (!getPerson(personId)) throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const data = interactionInput.parse(input);
  const id = uid();
  db()
    .prepare("INSERT INTO interactions (id, person_id, at, channel, summary, source, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, personId, data.at, data.channel, data.summary, data.source, ref, now());
  recomputeLastContact(personId);
  return getInteraction(id);
}

/**
 * "Reunión: <title>" on a person's timeline, once per meeting: the same ref, or the same title on the same day (a meeting
 * read by two paths, with the exact time or only the day), never twice. `at` is an ISO time or a bare "YYYY-MM-DD".
 * Returns the interaction made, or null when it was already there.
 */
export function logMeetingOnce(personId, { title, at, ref = null } = {}) {
  const clean = String(title || "").trim();
  if (!clean) return null;
  const summary = `Reunión: ${clean}`.slice(0, 2000);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(String(at || "")) ? new Date(`${at}T12:00:00`) : new Date(at || Date.now());
  const iso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const day = localDate(iso);
  if (ref && db().prepare("SELECT 1 FROM interactions WHERE person_id = ? AND ref = ?").get(personId, ref)) return null;
  const same = db().prepare("SELECT at FROM interactions WHERE person_id = ? AND summary = ?").all(personId, summary);
  if (same.some((row) => row.at === iso || localDate(row.at) === day)) return null;
  const made = createInteraction(personId, { at: iso, channel: "meet", summary, source: "agent" }, { ref });
  if (ref) {
    family.refsLink(`hoard://people/person/${personId}`, ref, "meeting", {
      fromLabel: getPerson(personId)?.name || "", toLabel: clean.slice(0, 120),
    }).catch(() => {});
  }
  return made;
}

export function updateInteraction(id, patch) {
  const current = getInteraction(id);
  if (!current) return null;
  const data = interactionPatch.parse(patch);
  const next = { ...current, ...data };
  db().prepare("UPDATE interactions SET at = ?, channel = ?, summary = ? WHERE id = ?")
    .run(next.at, next.channel, next.summary, id);
  recomputeLastContact(current.person_id);
  return getInteraction(id);
}

export function deleteInteraction(id) {
  const current = getInteraction(id);
  if (!current) return false;
  db().prepare("DELETE FROM interactions WHERE id = ?").run(id);
  recomputeLastContact(current.person_id);
  return true;
}
