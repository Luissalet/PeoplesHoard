// The contact timeline. Every write recomputes the person's cached
// last_contact_at from MAX(at), so edits and deletes stay consistent.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { recomputeLastContact, getPerson } from "./people.js";

export const CHANNELS = ["whatsapp", "email", "call", "meet", "message", "other"];

const atField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha/hora no válida.")
  .transform((v) => new Date(v).toISOString());

const interactionShape = {
  at: atField,
  channel: z.enum(CHANNELS),
  summary: z.string().trim().max(2000),
  source: z.enum(["manual", "agent"]),
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

export function createInteraction(personId, input) {
  if (!getPerson(personId)) throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const data = interactionInput.parse(input);
  const id = uid();
  db()
    .prepare("INSERT INTO interactions (id, person_id, at, channel, summary, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, personId, data.at, data.channel, data.summary, data.source, now());
  recomputeLastContact(personId);
  return getInteraction(id);
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
