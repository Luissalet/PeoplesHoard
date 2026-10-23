// The contact timeline. Every write recomputes the person's cached
// last_contact_at from MAX(at), so edits and deletes stay consistent.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { recomputeLastContact, getPerson } from "./people.js";
import { localDate } from "./dates.js";
import * as family from "./hoard-link.js";
import { fold } from "./text.js";

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

const searchInstant = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const historyFilters = {
  q: z.string().trim().max(200).default(""),
  person_id: z.string().trim().min(1).optional(),
  channel: z.enum(CHANNELS).optional(),
  from: searchInstant.optional(),
  to: searchInstant.optional(),
  include_archived: z.boolean().default(false),
};
const orderedDates = (value) => !value.from || !value.to || value.from <= value.to;
const dateError = {
  message: "La fecha desde no puede ser posterior a hasta.",
};
export const interactionSearch = z.object({
  ...historyFilters,
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
}).strict().refine(orderedDates, dateError);
export const interactionExport = z.object({
  ...historyFilters,
  format: z.enum(["json", "csv"]).default("json"),
}).strict().refine(orderedDates, dateError);

/** Search the complete recorded history, not just each person's recent contacts. */
function matchingInteractions(filter) {
  const where = [], params = [];
  if (!filter.include_archived) where.push("p.archived = 0");
  if (filter.person_id) { where.push("i.person_id = ?"); params.push(filter.person_id); }
  if (filter.channel) { where.push("i.channel = ?"); params.push(filter.channel); }
  if (filter.from) { where.push("julianday(i.at) >= julianday(?)"); params.push(filter.from); }
  if (filter.to) { where.push("julianday(i.at) <= julianday(?)"); params.push(filter.to); }
  const rows = db().prepare(`SELECT i.*, p.name AS person_name, p.nickname AS person_nickname, p.archived AS person_archived
    FROM interactions i JOIN people p ON p.id = i.person_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY julianday(i.at) DESC, i.id DESC`).all(...params);
  const words = fold(filter.q).split(/\s+/).filter(Boolean);
  const matches = words.length ? rows.filter((row) => {
    const text = fold([row.summary, row.person_name, row.person_nickname].join(" "));
    return words.every((word) => text.includes(word));
  }) : rows;
  return matches.map((row) => ({
    ...row, person_archived: Boolean(row.person_archived),
  }));
}

export function searchInteractions(input = {}) {
  const filter = interactionSearch.parse(input);
  const matches = matchingInteractions(filter);
  return { interactions: matches.slice(filter.offset, filter.offset + filter.limit),
    total: matches.length, filters: filter, offset: filter.offset, limit: filter.limit,
    has_more: filter.offset + filter.limit < matches.length };
}

/** An in-memory snapshot of all matching saved rows, independent of search pagination. */
export function exportInteractions(input = {}) {
  const { format, ...filters } = interactionExport.parse(input);
  const rows = matchingInteractions(filters);
  const exported_at = now();
  const columns = ["id", "person_id", "person_name", "person_nickname", "person_archived", "at", "channel", "summary", "source", "ref", "created_at"];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const text = format === "json"
    ? JSON.stringify({ exported_at, filters, count: rows.length, interactions: rows }, null, 2) + "\n"
    : "\uFEFF" + [columns, ...rows.map((row) => columns.map((key) => row[key]))].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
  return { format, filename: `contact-history-${exported_at.slice(0, 10)}.${format}`,
    media_type: format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    count: rows.length, filters, exported_at, text };
}

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
