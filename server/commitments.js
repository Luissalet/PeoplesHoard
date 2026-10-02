// Commitments: who promised what to whom, and by when.
//
// A commitment is either something I owe a person ("i_owe") or something a person
// owes me ("owed_to_me"). They come from four places: typed by hand, the assistant
// (a chat), the minutes of a meeting that Funes wrote (hub proxy, never by reading
// Funes's files) and text the user pasted (a mail, a chat). Anything that needs a
// human decision — a name that matches nobody or several people, a promise between
// two third parties, a proposal written by a model — waits in a review queue and
// becomes a commitment only when the user says so. Nothing here invents a date: a
// due day is kept only if it is a valid day, or if spoken words name exactly one.
import crypto from "node:crypto";
import { z } from "zod";
import { db, uid, now, getSetting, setSetting } from "./db.js";
import { fold } from "./text.js";
import { today as todayLocal, addDays, localDate } from "./dates.js";
import { resolveDue } from "./due.js";
import { getPerson, createPerson, resolvePersonRef } from "./people.js";
import { logMeetingOnce } from "./interactions.js";
import * as family from "./hoard-link.js";

export const DIRECTIONS = ["i_owe", "owed_to_me"];
export const STATUSES = ["open", "done", "dropped"];
export const SOURCE_KINDS = ["funes", "chat", "manual", "text", "mail"];

const fail = (message, opts = {}) => {
  throw Object.assign(new Error(message), { status: 400, ...opts });
};

const ME = new Set(["yo", "i", "me", "myself", "mi"]);
const OTHERS = new Set(["otros", "otro", "otra", "others", "other", "ellos", "alguien", "null", "none", "unknown", "desconocido"]);
const isMe = (name) => ME.has(fold(name));
const LABEL = /^(?:s\d+|speaker\s*\d*|hablante\s*\d*|spk\s*\d*)$/i;
const isLabel = (name) => LABEL.test(String(name || "").trim());
const isAnonymous = (name) => !String(name || "").trim() || OTHERS.has(fold(name));

export const normText = (text) => fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const dedupeKey = (kind, ref, text) => (ref ? `${kind}:${ref}:${normText(text)}` : null);

const dueField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.").refine(
  (value) => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "Fecha no válida.");

export const commitmentInput = z.object({
  direction: z.enum(DIRECTIONS),
  person_id: z.string().nullable().default(null),
  person_name_raw: z.string().trim().max(120).default(""),
  text: z.string().trim().min(1).max(2000),
  due: dueField.nullable().default(null),
  due_text: z.string().trim().max(120).default(""),
  source_kind: z.enum(SOURCE_KINDS).default("manual"),
  source_ref: z.string().trim().max(200).default(""),
  source_quote: z.string().trim().max(1000).default(""),
});
export const commitmentPatch = z.object({
  direction: z.enum(DIRECTIONS).optional(),
  person_id: z.string().nullable().optional(),
  person_name_raw: z.string().trim().max(120).optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  due: dueField.nullable().optional(),
  due_text: z.string().trim().max(120).optional(),
  status: z.enum(STATUSES).optional(),
});

// ---------------------------------------------------------------- reading --

function present(row, { today = todayLocal() } = {}) {
  if (!row) return null;
  const person = row.person_id ? getPerson(row.person_id) : null;
  const open = row.status === "open";
  return {
    id: row.id,
    direction: row.direction,
    person_id: row.person_id,
    person_name: person ? person.name : row.person_name_raw,
    person_name_raw: row.person_name_raw,
    text: row.text,
    due: row.due,
    due_text: row.due_text,
    status: row.status,
    source: { kind: row.source_kind, ref: row.source_ref, quote: row.source_quote },
    created_at: row.created_at,
    updated_at: row.updated_at,
    done_at: row.done_at,
    last_nudged_at: row.last_nudged_at,
    overdue: open && !!row.due && row.due < today,
    days_until_due: open && row.due ? daysBetween(today, row.due) : null,
  };
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function getCommitment(id, opts) {
  return present(db().prepare("SELECT * FROM commitments WHERE id = ?").get(id), opts);
}

/** Filters: person (id), direction, status (default open; "all" for every one), overdue, due_before, q. */
export function listCommitments({ person, direction, status = "open", overdue, due_before, q, limit = 500, today = todayLocal() } = {}) {
  const where = [];
  const params = [];
  if (person) { where.push("person_id = ?"); params.push(person); }
  if (direction) {
    if (!DIRECTIONS.includes(direction)) fail("direction debe ser i_owe o owed_to_me.");
    where.push("direction = ?"); params.push(direction);
  }
  if (status && status !== "all") {
    if (!STATUSES.includes(status)) fail("status debe ser open, done, dropped o all.");
    where.push("status = ?"); params.push(status);
  }
  if (overdue) { where.push("status = 'open' AND due IS NOT NULL AND due < ?"); params.push(today); }
  if (due_before) { where.push("due IS NOT NULL AND due <= ?"); params.push(due_before); }
  const rows = db().prepare(
    `SELECT * FROM commitments${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due IS NULL, due, created_at DESC LIMIT ?`,
  ).all(...params, Math.max(1, Math.min(2000, Number(limit) || 500)));
  let out = rows.map((row) => present(row, { today }));
  if (q && q.trim()) {
    const needle = fold(q);
    out = out.filter((c) => fold(`${c.text} ${c.person_name} ${c.source.quote}`).includes(needle));
  }
  return out;
}

// --------------------------------------------------------------- writing --

const commitmentRef = (id) => `hoard://people/commitment/${id}`;

/** A commitment the user owns (`i_owe`), still open, with a day: the kind that becomes a deadline elsewhere. */
export const isOwnDeadline = (c) => !!c && c.direction === "i_owe" && c.status === "open" && !!c.due;

function emitEvent(type, c) {
  const base = {
    id: c.id, direction: c.direction, person_id: c.person_id, person: c.person_name,
    text: c.text.slice(0, 120), due: c.due, source: c.source.kind,
  };
  if (type !== "people.commitment.added") return family.emit(type, base);
  // `people.commitment.added` is the one the hub turns into a deadline in the paperwork app, so it is only sent for what
  // the user owes and has a day for, with the keys that rule reads: `title`, `due`, `ref` and `person`. Any other new
  // commitment (someone owes me, or no day yet) is announced as `people.commitment.noted`, with the same data as before.
  if (!isOwnDeadline(c)) return family.emit("people.commitment.noted", base);
  const who = c.person_name ? ` (${c.person_name})` : "";
  return family.emit("people.commitment.added", { ...base, title: `${c.text.slice(0, 160)}${who}`, ref: commitmentRef(c.id) });
}

function findByKey(key) {
  return key ? db().prepare("SELECT * FROM commitments WHERE dedupe_key = ?").get(key) : null;
}

/**
 * Create a commitment. `due_text` alone is resolved against `today` ("el martes"); if it names
 * no single day the words are kept and `due` stays empty. With a `dedupeKey` an existing
 * commitment with that key is returned instead (`created: false`), whatever its status.
 * `resolve: false` keeps the words as they are (used when the source already did the date work).
 */
export function addCommitment(input, { dedupe = null, today = todayLocal(), emit = true, resolve = true } = {}) {
  const data = commitmentInput.parse(input);
  if (data.person_id && !getPerson(data.person_id)) fail("La persona no existe.");
  const existing = findByKey(dedupe);
  if (existing) return { created: false, commitment: present(existing, { today }) };
  let due = data.due;
  if (!due && data.due_text && resolve) due = resolveDue(data.due_text, today);
  const id = uid();
  const ts = now();
  db().prepare(
    `INSERT INTO commitments (id, direction, person_id, person_name_raw, text, due, due_text, status, source_kind, source_ref, source_quote, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.direction, data.person_id, data.person_name_raw, data.text, due, data.due_text, data.source_kind, data.source_ref,
    data.source_quote, dedupe, ts, ts);
  const commitment = getCommitment(id, { today });
  if (emit) emitEvent("people.commitment.added", commitment);
  return { created: true, commitment };
}

export function updateCommitment(id, patch, { today = todayLocal(), emit = true } = {}) {
  const current = db().prepare("SELECT * FROM commitments WHERE id = ?").get(id);
  if (!current) return null;
  const data = commitmentPatch.parse(patch);
  if (data.person_id && !getPerson(data.person_id)) fail("La persona no existe.");
  const next = { ...current, ...data };
  if (data.due === undefined && data.due_text && data.due_text !== current.due_text) {
    const resolved = resolveDue(data.due_text, today);
    if (resolved) next.due = resolved;
  }
  if (data.person_id) next.person_name_raw = "";
  const closing = data.status && data.status !== current.status;
  const doneAt = closing ? (data.status === "done" ? now() : null) : current.done_at;
  db().prepare(
    `UPDATE commitments SET direction = ?, person_id = ?, person_name_raw = ?, text = ?, due = ?, due_text = ?, status = ?, done_at = ?, updated_at = ?,
     last_nudged_at = ? WHERE id = ?`,
  ).run(next.direction, next.person_id, next.person_name_raw, next.text, next.due, next.due_text, next.status, doneAt, now(),
    // a new deadline earns a new nudge
    data.due !== undefined || (data.due_text && data.due_text !== current.due_text) ? null : current.last_nudged_at, id);
  const commitment = getCommitment(id, { today });
  if (emit && closing && data.status === "done") emitEvent("people.commitment.done", commitment);
  // a commitment that only now is mine with a day (the review queue, a day added later) becomes a deadline then
  if (emit && !closing && isOwnDeadline(commitment) && !isOwnDeadline(present(current, { today }))) emitEvent("people.commitment.added", commitment);
  return commitment;
}

/**
 * `addCommitment` for callers that name the person in words (the assistant, the UI): `person` is an
 * id, a name or a nickname. A name that matches one person links to them; one that matches several is
 * refused with the candidates (never guessed); one that matches nobody is kept as written, with a warning.
 */
export function addCommitmentByRef({ person, ...input }, { today = todayLocal() } = {}) {
  let warning = null;
  if (person && !input.person_id) {
    const named = resolveName(person);
    if (named.state === "person") input.person_id = named.person.id;
    else if (named.state === "ambiguous") fail(`No sé a quién te refieres con "${person}". ¿Es alguna de estas personas?`, { candidates: named.candidates });
    else {
      input.person_name_raw = String(person).trim();
      warning = `"${person}" no está en la agenda: el compromiso queda con ese nombre sin enlazar a nadie.`;
    }
  }
  const key = input.source_ref ? dedupeKey(input.source_kind || "manual", input.source_ref, input.text) : null;
  const result = addCommitment(input, { today, dedupe: key });
  return warning ? { ...result, warning } : result;
}

/** `updateCommitment` where `person` may be a name instead of an id (same rules as addCommitmentByRef). */
export function updateCommitmentByRef(id, { person, ...patch }, { today = todayLocal() } = {}) {
  let warning = null;
  if (person && !patch.person_id) {
    const named = resolveName(person);
    if (named.state === "person") patch.person_id = named.person.id;
    else if (named.state === "ambiguous") fail(`No sé a quién te refieres con "${person}". ¿Es alguna de estas personas?`, { candidates: named.candidates });
    else {
      patch.person_id = null;
      patch.person_name_raw = String(person).trim();
      warning = `"${person}" no está en la agenda: queda como nombre sin enlazar.`;
    }
  }
  const commitment = updateCommitment(id, patch, { today });
  return commitment && warning ? { ...commitment, warning } : commitment;
}

export const completeCommitment = (id, opts) => updateCommitment(id, { status: "done" }, opts);
export const dropCommitment = (id, opts) => updateCommitment(id, { status: "dropped" }, opts);
export const deleteCommitment = (id) => db().prepare("DELETE FROM commitments WHERE id = ?").run(id).changes > 0;

// ------------------------------------------------------ name resolution --

/** Who a spoken or written name is: a person, an ambiguous set of candidates, nobody, or no name at all. */
export function resolveName(name) {
  const text = String(name || "").trim();
  if (isAnonymous(text) || isMe(text)) return { state: "none", candidates: [] };
  const { person, candidates } = resolvePersonRef(text);
  if (person) return { state: "person", person, candidates: [] };
  return { state: candidates.length ? "ambiguous" : "unknown", candidates };
}

// ---------------------------------------------------------- review queue --

const presentReview = (row) => row && ({
  id: row.id,
  kind: row.kind,
  reason: row.reason,
  status: row.status,
  proposal: JSON.parse(row.proposal),
  candidates: JSON.parse(row.candidates || "[]").filter((c) => getPerson(c.id)),
  commitment_id: row.commitment_id,
  created_at: row.created_at,
  resolved_at: row.resolved_at,
});

export function listReview({ status = "pending", limit = 200 } = {}) {
  const rows = status === "all"
    ? db().prepare("SELECT * FROM commitment_review ORDER BY created_at DESC LIMIT ?").all(limit)
    : db().prepare("SELECT * FROM commitment_review WHERE status = ? ORDER BY created_at LIMIT ?").all(status, limit);
  return rows.map(presentReview);
}

export const pendingReviewCount = () => db().prepare("SELECT COUNT(*) AS n FROM commitment_review WHERE status = 'pending'").get().n;

function queueReview({ kind, reason, proposal, candidates = [], dedupe }) {
  if (dedupe && db().prepare("SELECT 1 FROM commitment_review WHERE dedupe_key = ?").get(dedupe)) return null;
  const id = uid();
  db().prepare(
    "INSERT INTO commitment_review (id, kind, reason, status, proposal, candidates, dedupe_key, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
  ).run(id, kind, reason, JSON.stringify(proposal), JSON.stringify(candidates.slice(0, 6).map((c) => ({ id: c.id, name: c.name, nickname: c.nickname || "", circles: c.circles || [] }))), dedupe, now());
  return presentReview(db().prepare("SELECT * FROM commitment_review WHERE id = ?").get(id));
}

/**
 * Settle a queued proposal. action "discard" drops it (and it is never proposed again);
 * "accept" makes the commitment, with the person picked (`person_id`), created on the spot
 * (`create_person`: true for the proposed name, or a name), or none (`no_person: true`).
 * `direction`, `text`, `due` and `due_text` override the proposal.
 */
export function resolveReview(id, body = {}, { today = todayLocal() } = {}) {
  const row = db().prepare("SELECT * FROM commitment_review WHERE id = ?").get(id);
  if (!row) return null;
  if (row.status !== "pending") fail("Esta propuesta ya está resuelta.", { status: 409 });
  const action = body.action;
  if (action === "discard") {
    db().prepare("UPDATE commitment_review SET status = 'discarded', resolved_at = ? WHERE id = ?").run(now(), id);
    return { review: presentReview(db().prepare("SELECT * FROM commitment_review WHERE id = ?").get(id)), commitment: null };
  }
  if (action !== "accept") fail('action debe ser "accept" o "discard".');
  const proposal = JSON.parse(row.proposal);
  const direction = body.direction || proposal.direction;
  if (!DIRECTIONS.includes(direction)) fail("Indica direction: i_owe (yo debo) u owed_to_me (me deben).");
  let personId = null;
  let nameRaw = proposal.person_name_raw || "";
  if (body.person_id) {
    if (!getPerson(body.person_id)) fail("La persona no existe.");
    personId = body.person_id;
  } else if (body.create_person) {
    const name = (typeof body.create_person === "string" ? body.create_person : nameRaw).trim();
    if (!name) fail("Indica el nombre de la persona nueva.");
    personId = createPerson({ name }).id;
  } else if (!body.no_person) {
    fail("Elige una persona (person_id), crea una nueva (create_person) o indica no_person.");
  }
  if (personId) nameRaw = "";
  const result = addCommitment({
    direction,
    person_id: personId,
    person_name_raw: nameRaw,
    text: body.text || proposal.text,
    due: body.due !== undefined ? body.due : proposal.due || null,
    due_text: body.due_text !== undefined ? body.due_text : proposal.due_text || "",
    source_kind: proposal.source.kind,
    source_ref: proposal.source.ref,
    source_quote: proposal.source.quote,
  }, { dedupe: dedupeKey(proposal.source.kind, proposal.source.ref, body.text || proposal.text), today, resolve: body.due_text !== undefined });
  if (personId && proposal.meeting) logMeeting(personId, proposal.meeting);
  db().prepare("UPDATE commitment_review SET status = 'resolved', commitment_id = ?, resolved_at = ? WHERE id = ?").run(result.commitment.id, now(), id);
  return { review: presentReview(db().prepare("SELECT * FROM commitment_review WHERE id = ?").get(id)), commitment: result.commitment, created: result.created };
}

// ---------------------------------------------------- ingest from minutes --

/**
 * Forget what an earlier reading of a meeting produced and the user has not touched, so the minutes can be read again
 * (after a fix, or a wrong direction): open commitments from that session never edited nor chosen by the user in the review queue, proposals still waiting, and
 * settled proposals whose commitment is gone. What the user did decide stays: done, dropped or edited commitments, and
 * proposals discarded on purpose.
 */
export function clearUntouched(sessionId) {
  const like = `${sessionId.replace(/[\\%_]/g, "\\$&")}@%`;
  const commitments = db().prepare(
    `DELETE FROM commitments WHERE source_kind = 'funes' AND source_ref LIKE ? ESCAPE '\\' AND status = 'open'
     AND done_at IS NULL AND updated_at = created_at
     AND id NOT IN (SELECT commitment_id FROM commitment_review WHERE commitment_id IS NOT NULL)`).run(like).changes; // a proposal the user settled is a decision of theirs
  const review = db().prepare(
    `DELETE FROM commitment_review WHERE kind = 'minutes' AND dedupe_key LIKE ? ESCAPE '\\'
     AND (status = 'pending' OR (status = 'resolved' AND (commitment_id IS NULL OR commitment_id NOT IN (SELECT id FROM commitments))))`)
    .run(`funes:${like}`).changes;
  return { commitments: Number(commitments), review: Number(review) };
}

/** "Reunión: <title>" on the person's timeline, once per meeting (see interactions.logMeetingOnce). */
function logMeeting(personId, meeting) {
  if (!meeting || !meeting.title) return false;
  const ref = meeting.session_id ? `hoard://funes/minutes/${meeting.session_id}` : null;
  return !!logMeetingOnce(personId, { title: meeting.title, at: meeting.at, ref });
}

const dueOf = (item) => (item.due_date && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) ? item.due_date : null);

/**
 * Turn the action items of one meeting's minutes (the result of Funes's scribe_minutes) into
 * commitments. Owner "yo" is something I owe (the counterpart is the person); any other owner
 * is something that person owes me. Names resolve like everywhere else (exact, alias, fuzzy);
 * ambiguous and unknown names, an owner nobody said and promises between two third parties go
 * to the review queue. Safe to run again: the same session and text never makes a second
 * commitment or review item.
 */
export function ingestMinutes(minutes, { today = todayLocal(), replace = false } = {}) {
  const sessionId = String(minutes?.session_id || "");
  if (!sessionId) fail("Las actas no traen session_id.");
  const meeting = { title: String(minutes.title || "").trim(), at: minutes.started_at || null, session_id: sessionId };
  const result = { session_id: sessionId, title: meeting.title, items: 0, created: 0, queued: 0, duplicates: 0, interactions: 0, commitments: [], review: [] };
  if (replace) result.replaced = clearUntouched(sessionId);
  const met = new Set();
  for (const item of Array.isArray(minutes.action_items) ? minutes.action_items : []) {
    const text = String(item.action || "").trim();
    if (!text) continue;
    result.items++;
    const evidence = item.evidence || {};
    const ref = `${sessionId}@${Math.floor(Number(evidence.start_s) || 0)}`;
    const source = { kind: "funes", ref, quote: String(evidence.quote || "").slice(0, 1000) };
    const key = dedupeKey("funes", ref, text);
    const owner = String(item.owner || "").trim();
    const counterpart = String(item.counterpart || "").trim();
    const base = { text, due: dueOf(item), due_text: String(item.due_text || ""), source, meeting };

    // Nothing goes straight into the list unless both the direction and the person are certain:
    //   owner "yo"      -> i_owe, and the counterpart must resolve to one person;
    //   owner a person  -> owed_to_me, resolved by name (a promise between two third parties waits);
    //   anything else (no owner, "otros", a speaker label, an unknown or ambiguous name) waits for the user.
    let direction = null;
    let nameRaw = "";
    let reason = null;
    let named;
    if (isMe(owner)) {
      direction = "i_owe";
      nameRaw = isAnonymous(counterpart) || isMe(counterpart) || isLabel(counterpart) ? "" : counterpart;
      named = resolveName(nameRaw);
      if (!nameRaw) reason = "no_person"; // a promise I made, but the minutes do not say to whom
    } else if (owner && !isAnonymous(owner) && !isLabel(owner)) {
      direction = "owed_to_me";
      nameRaw = owner;
      named = resolveName(nameRaw);
      if (!isAnonymous(counterpart) && !isMe(counterpart) && !isLabel(counterpart)) reason = "third_party"; // between two other people
    } else {
      // The minutes could not say who commits. The counterpart, if it is a person, is offered as the likely one.
      reason = "unassigned";
      nameRaw = isAnonymous(counterpart) || isMe(counterpart) || isLabel(counterpart) ? "" : counterpart;
      named = resolveName(nameRaw);
    }
    if (reason || named.state === "ambiguous" || named.state === "unknown" || named.state === "none") {
      const review = queueReview({
        kind: "minutes",
        reason: reason || (named.state === "none" ? "no_person" : named.state),
        proposal: { ...base, direction, person_name_raw: nameRaw, counterpart },
        candidates: named.state === "person" ? [named.person] : named.candidates,
        dedupe: key,
      });
      if (review) { result.queued++; result.review.push(review.id); } else result.duplicates++;
      continue;
    }
    const personId = named.person.id;
    const added = addCommitment({
      direction, person_id: personId, person_name_raw: "", text, due: base.due, due_text: base.due_text,
      source_kind: "funes", source_ref: ref, source_quote: source.quote,
    }, { dedupe: key, today, resolve: false }); // Funes resolved the day against the meeting date; "el viernes" stays words if it could not
    if (!added.created) { result.duplicates++; continue; }
    result.created++;
    result.commitments.push(added.commitment.id);
    if (personId && !met.has(personId)) {
      met.add(personId);
      if (logMeeting(personId, meeting)) result.interactions++;
    }
  }
  return result;
}

/** Ask Funes (through the hub) for the minutes of a session and ingest them. Never throws for "the other side is down". */
export async function ingestFromFunes(sessionId, { regenerate = false, replace = false, today = todayLocal(), timeoutMs = 15 * 60 * 1000 } = {}) {
  const id = String(sessionId || "").trim();
  if (!id) fail("Falta session_id.");
  const response = await family.call("funes", "scribe_minutes", { session_id: id, regenerate: !!regenerate }, { timeoutMs });
  if (response.status === null || response.status === undefined) {
    return { status: "hub_down", detail: response.error || "No se puede contactar con el hub de Hoard Link." };
  }
  if (!response.ok) {
    const detail = String(response.error || `HTTP ${response.status}`);
    if (/unknown tool|herramienta desconocida/i.test(detail)) return { status: "tool_missing", detail: "Esta versión de Funes todavía no sabe escribir actas (falta scribe_minutes)." };
    if (response.status === 404 && /session/i.test(detail)) return { status: "unknown_session", detail };
    return { status: "funes_error", detail, http: response.status };
  }
  const minutes = response.result;
  if (!minutes || typeof minutes !== "object") return { status: "funes_error", detail: "Funes no devolvió un acta." };
  if (minutes.status !== "ready") return { status: minutes.status || "funes_error", detail: minutes.detail || "" };
  return { status: "ingested", cached: !!minutes.cached, ...ingestMinutes(minutes.minutes, { today, replace }) };
}

// ------------------------------------------------------ extract from text --

const EXTRACT_SYSTEM = [
  "You find commitments (promises and agreed tasks with a person) in a text the user pasted: a mail, a chat, notes.",
  "Write in the language of the text. Use only what the text says; never invent a person, a task or a date.",
  "direction is `i_owe` when the user (the person who owns this address book, usually the writer of the mail or the lines marked as",
  "'yo' / 'me') promises or must do something for someone, and `owed_to_me` when someone else promises something to the user.",
  "`person` is the other person's name as written. `quote` is the exact words of the text that show the commitment, copied character by",
  "character. `due_text` is the deadline in the words used (or empty); `due_date` only if it is an exact calendar day, else null.",
  "If there are no commitments, return an empty list.",
].join(" ");

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    commitments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["i_owe", "owed_to_me"] },
          person: { type: "string" },
          action: { type: "string" },
          due_text: { type: "string" },
          due_date: { type: ["string", "null"] },
          quote: { type: "string" },
        },
        required: ["direction", "action", "quote"],
      },
    },
  },
  required: ["commitments"],
};

const squash = (text) => String(text || "").replace(/\s+/g, " ").trim();

/** The quote as it literally appears in the text (case and spacing aside), or null. */
export function locateQuote(text, quote) {
  const haystack = squash(text);
  const wanted = squash(quote).replace(/^["'“”«»…\s]+|["'“”«»…\s]+$/g, "");
  if (wanted.length < 6) return null;
  let index = haystack.indexOf(wanted);
  if (index < 0 && haystack.toLowerCase().length === haystack.length) index = haystack.toLowerCase().indexOf(wanted.toLowerCase());
  return index < 0 ? null : haystack.slice(index, index + wanted.length);
}

/**
 * Propose commitments from pasted text with the local model (through the hub). The proposals go to
 * the review queue — never straight in. Each keeps the quote that supports it, verified against the
 * text; proposals without a literal quote are dropped and counted.
 */
export async function extractFromText({ text, person_hint = "", today = todayLocal(), chat = family.chat } = {}) {
  const body = String(text || "");
  if (body.trim().length < 12) fail("Pega un texto con algo más de contenido.");
  if (body.length > 40000) fail("El texto es demasiado largo (máximo 40000 caracteres); pega un fragmento.");
  const hint = person_hint ? `\nThe other person is probably: ${person_hint}.` : "";
  const reply = await chat({
    messages: [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: `Today is ${today}.${hint}\n\nTEXT:\n${body}` },
    ],
    json: EXTRACT_SCHEMA, effort: "low", maxTokens: 2500, temperature: 0.1, timeoutMs: 180000,
  });
  if (!reply.ok) {
    const state = reply.error === "no_model" ? "no_model" : reply.error === "hub_down" ? "hub_down" : "error";
    return { status: state, detail: reply.detail || reply.error || "", proposals: [] };
  }
  const list = reply.json && Array.isArray(reply.json.commitments) ? reply.json.commitments : null;
  if (!list) return { status: "error", detail: "El modelo no devolvió el JSON esperado.", proposals: [], model: reply.model };
  const ref = crypto.createHash("sha1").update(squash(body)).digest("hex").slice(0, 12);
  const proposals = [];
  let dropped = 0;
  let duplicates = 0;
  for (const entry of list.slice(0, 40)) {
    const action = squash(entry?.action);
    const quote = locateQuote(body, entry?.quote);
    if (!action || !quote || !DIRECTIONS.includes(entry?.direction)) { dropped++; continue; }
    const dueText = squash(entry.due_text);
    const claimed = typeof entry.due_date === "string" && dueField.safeParse(entry.due_date).success ? entry.due_date : null;
    let due = (dueText && resolveDue(dueText, today)) || claimed;
    if (due && due < today) due = null; // a past day is a misreading, not a deadline
    const name = squash(entry.person) || squash(person_hint);
    const named = resolveName(name);
    const sourceRef = `${ref}@${normText(action).slice(0, 40)}`;
    const review = queueReview({
      kind: "text",
      reason: "proposed",
      proposal: { direction: entry.direction, text: action, due, due_text: dueText, person_name_raw: name, source: { kind: "text", ref: sourceRef, quote } },
      candidates: named.state === "person" ? [named.person] : named.candidates,
      dedupe: dedupeKey("text", ref, action),
    });
    if (review) proposals.push(review); else duplicates++;
  }
  return { status: "proposed", model: reply.model, proposals, dropped, duplicates };
}

// ----------------------------------------------------------------- digest --

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function dueWords(c) {
  if (!c.due) return c.due_text ? `«${c.due_text}»` : "sin fecha";
  if (c.overdue) return `venció el ${c.due}, hace ${plural(-c.days_until_due, "día", "días")}`;
  if (c.days_until_due === 0) return "para hoy";
  if (c.days_until_due === 1) return "para mañana";
  return `para el ${c.due}`;
}

export const commitmentLine = (c) => (c.direction === "i_owe"
  ? `Le debes a ${c.person_name || "alguien"}: ${c.text} (${dueWords(c)})`
  : `${c.person_name || "Alguien"} te debe: ${c.text} (${dueWords(c)})`);

/** Overdue and due within `days` days (default 7), grouped by person, in the words a person would use. */
export function commitmentsDigest({ days = 7, today = todayLocal() } = {}) {
  const horizon = addDays(today, Math.max(1, Math.min(365, Number(days) || 7)));
  const open = listCommitments({ status: "open", today });
  const relevant = open.filter((c) => c.overdue || (c.due && c.due <= horizon));
  const groups = new Map();
  for (const c of relevant) {
    const key = c.person_id || `raw:${fold(c.person_name_raw)}`;
    if (!groups.has(key)) groups.set(key, { person_id: c.person_id, person_name: c.person_name || null, i_owe: [], owed_to_me: [] });
    groups.get(key)[c.direction].push(c);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const first = (g) => [...g.i_owe, ...g.owed_to_me].map((c) => c.due || "9999-12-31").sort()[0];
    return first(a).localeCompare(first(b));
  });
  const overdue = relevant.filter((c) => c.overdue);
  const upcoming = relevant.filter((c) => !c.overdue);
  const lines = ordered.flatMap((g) => [...g.i_owe, ...g.owed_to_me].map(commitmentLine));
  const summary = relevant.length
    ? `${plural(overdue.length, "compromiso vencido", "compromisos vencidos")} y ${plural(upcoming.length, "próximo", "próximos")} en ${plural(days, "día", "días")}.`
    : `Nada vencido ni próximo en ${plural(days, "día", "días")}.`;
  return {
    as_of: today, days: Number(days) || 7, overdue_count: overdue.length, upcoming_count: upcoming.length,
    open_total: open.length, pending_review: pendingReviewCount(), groups: ordered, overdue, upcoming, lines, summary,
  };
}

/** Numbers for the navigation badge: open, overdue and proposals waiting for a decision. */
export function counts({ today = todayLocal() } = {}) {
  const row = db().prepare(
    "SELECT COUNT(*) AS open, COALESCE(SUM(due IS NOT NULL AND due < ?), 0) AS overdue FROM commitments WHERE status = 'open'").get(today);
  return { open: row.open, overdue: Number(row.overdue), pending_review: pendingReviewCount() };
}

/** For a person's brief: their open commitments both ways, with source ids. */
export function openCommitmentsFor(personId, { today = todayLocal() } = {}) {
  const list = listCommitments({ person: personId, status: "open", today });
  const view = (c) => ({ id: c.id, text: c.text, due: c.due, due_text: c.due_text, days_until_due: c.days_until_due, overdue: c.overdue, source: `commitment:${c.id}` });
  return {
    i_owe: list.filter((c) => c.direction === "i_owe").map(view),
    owed_to_me: list.filter((c) => c.direction === "owed_to_me").map(view),
  };
}

// ---------------------------------------------------------------- nudging --

/** Emit `people.commitment.overdue` once for each open commitment whose day has passed. Returns how many. */
export async function nudgeOverdue({ today = todayLocal() } = {}) {
  let sent = 0;
  for (const c of listCommitments({ overdue: true, today })) {
    if (c.last_nudged_at) continue;
    const ok = await family.emit("people.commitment.overdue", {
      id: c.id, direction: c.direction, person_id: c.person_id, person: c.person_name, text: c.text.slice(0, 120), due: c.due,
      days_overdue: -c.days_until_due,
    }, { block: true });
    if (!ok) break; // the hub is not listening: try again on the next sweep rather than lose them
    db().prepare("UPDATE commitments SET last_nudged_at = ? WHERE id = ?").run(now(), c.id);
    sent++;
  }
  return sent;
}

// --------------------------------------------------------- hub poller state --

export const POLL_SINCE_KEY = "commitments_events_since_id";
export const pollState = () => ({ since_id: getSetting(POLL_SINCE_KEY, null) });
export const setPollSince = (id) => setSetting(POLL_SINCE_KEY, id);

export { localDate };
