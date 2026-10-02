// A meeting from Funes onto the contact book: who was there (by name, alias or e-mail) gets "Reunión: <title>" on that
// day's line of their timeline. The commitments side of the same meeting lives in commitments.js (ingestMinutes); this
// only answers "who did I meet", so it is safe to run on top of it: the same meeting never lands twice on a timeline.
import { findHandle } from "./handles.js";
import { getPerson } from "./people.js";
import { resolveName } from "./commitments.js";
import { logMeetingOnce } from "./interactions.js";
import * as family from "./hoard-link.js";

export const minutesRef = (id) => `hoard://funes/minutes/${id}`;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const dayOf = (value) => {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
};

/** The attendee as a person: an e-mail goes through the aliases, a name through the usual resolution. */
export function matchAttendee(raw) {
  const name = clean(raw);
  if (!name) return { state: "none", candidates: [] };
  if (name.includes("@")) {
    const row = findHandle("email", name.replace(/^.*<|>.*$/g, "").trim());
    const person = row ? getPerson(row.person_id) : null;
    return person ? { state: "person", person, candidates: [] } : { state: "unknown", candidates: [] };
  }
  return resolveName(name);
}

/** What `scribe_minutes` answers, reshaped like `minutes_get`, for a Funes that does not have `minutes_get` yet. */
function fromScribeMinutes(result) {
  const minutes = result?.minutes || {};
  const names = [...(minutes.participants || [])];
  for (const item of minutes.action_items || []) names.push(item.owner || "", item.counterpart || "");
  const attendees = [];
  for (const name of names) {
    const text = clean(name);
    if (text && !["yo", "i", "me"].includes(text.toLowerCase()) && !attendees.some((a) => a.toLowerCase() === text.toLowerCase())) attendees.push(text);
  }
  return { ok: true, status: "ready", minutes_id: minutes.session_id || "", title: minutes.title || "", date: dayOf(minutes.started_at), attendees };
}

/** Funes's minutes of one meeting, or `{ status }` saying why not. Never throws for "the other side is down". */
export async function fetchMinutes(minutesId, { generate = false, timeoutMs = 15 * 60 * 1000 } = {}) {
  let response = await family.call("funes", "minutes_get", { minutes_id: minutesId, generate: !!generate }, { timeoutMs });
  if (response.status === null || response.status === undefined) return { status: "hub_down", detail: response.error || "No se puede contactar con el hub de Hoard Link." };
  if (!response.ok && /unknown tool|herramienta desconocida/i.test(String(response.error || ""))) {
    // an older Funes: the same minutes through scribe_minutes (it writes them when none exist, so only when asked to)
    if (!generate) return { status: "tool_missing", detail: "Esta versión de Funes todavía no tiene minutes_get." };
    response = await family.call("funes", "scribe_minutes", { session_id: minutesId }, { timeoutMs });
    if (response.status === null || response.status === undefined) return { status: "hub_down", detail: response.error || "" };
    if (response.ok && response.result?.status === "ready") return { status: "ready", minutes: fromScribeMinutes(response.result) };
  }
  if (!response.ok) {
    const detail = String(response.error || `HTTP ${response.status}`);
    if (response.status === 404 && /session|minutes/i.test(detail)) return { status: "unknown_minutes", detail };
    return { status: "funes_error", detail, http: response.status };
  }
  const result = response.result;
  if (!result || typeof result !== "object") return { status: "funes_error", detail: "Funes no devolvió un acta." };
  if (result.ok === false) return { status: result.status || "funes_error", detail: result.detail || "" };
  return { status: "ready", minutes: result };
}

/**
 * Log "Reunión: <title>" on the day of the meeting for each attendee that is in the book. Idempotent per meeting and person.
 * `minutes` may be given (tests, or a caller that already has them); otherwise Funes is asked through the hub.
 */
export async function peopleFromMinutes(minutesId, { minutes = null, generate = false } = {}) {
  const id = clean(minutesId);
  if (!id) throw Object.assign(new Error("Falta minutes_id."), { status: 400 });
  let data = minutes;
  if (!data) {
    const got = await fetchMinutes(id, { generate });
    if (got.status !== "ready") return { ok: false, status: got.status, minutes_id: id, detail: got.detail || "" };
    data = got.minutes;
  }
  const title = clean(data.title);
  const date = dayOf(data.date);
  const out = { ok: true, status: "ok", minutes_id: id, title, date, attendees: 0, matched: [], unmatched: [], ambiguous: [], logged: 0, already: 0 };
  if (!title) return { ...out, ok: false, status: "no_title", detail: "El acta no trae título: no hay nada que apuntar." };
  const seen = new Set();
  for (const raw of Array.isArray(data.attendees) ? data.attendees : []) {
    const name = clean(raw);
    if (!name) continue;
    out.attendees++;
    const named = matchAttendee(name);
    if (named.state === "none") continue; // "yo", "otros": nobody to log
    if (named.state === "ambiguous") { out.ambiguous.push({ attendee: name, candidates: named.candidates.map((c) => ({ id: c.id, name: c.name })) }); continue; }
    if (named.state === "unknown") { out.unmatched.push(name); continue; }
    const person = named.person;
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    const made = logMeetingOnce(person.id, { title, at: date || undefined, ref: minutesRef(id) });
    if (made) out.logged++; else out.already++;
    out.matched.push({ attendee: name, person_id: person.id, person: person.name, logged: !!made });
  }
  return out;
}
