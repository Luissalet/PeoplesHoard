// Last contact from mail. The hub reads the inbox once for the whole family; People's Hoard tells it which addresses it
// cares about (the e-mails of the people in the book) and, every so often, reads what came from them. For each mail from
// a known person it keeps the date, the channel ("email", shown as correo) and the subject as a one-line note: never the
// body, and the mail is not claimed (it is not "owned" by this app, other apps may want it too).
// Everything here happens only while the hub's mail gateway answers (`mailAvailable()`); without it nothing changes.
import crypto from "node:crypto";
import { db, getSetting, setSetting } from "./db.js";
import { getPerson } from "./people.js";
import { createInteraction } from "./interactions.js";
import * as family from "./hoard-link.js";

export const MAX_ADDRESSES = 300;
export const PAGE_SIZE = 100;
const MAX_PAGES = 20;
export const KEYS = { enabled: "mail_sync_enabled", since: "mail_since_id", hash: "mail_interest_hash" };

const info = { running: false, last_run_at: null, last_status: "never", last_error: "", read: 0, logged: 0 };
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

export const mailSyncEnabled = () => getSetting(KEYS.enabled, true) !== false;
export function setMailSyncEnabled(value) {
  if (typeof value !== "boolean") fail("mail_sync debe ser true o false.");
  return setSetting(KEYS.enabled, value);
}

/** The e-mail aliases of people who are not archived (the addresses mail is read for), oldest first, at most `limit`. */
export function contactEmails({ limit = MAX_ADDRESSES } = {}) {
  const rows = db().prepare(
    `SELECT a.value AS value, a.person_id AS person_id FROM aliases a JOIN people p ON p.id = a.person_id
     WHERE a.kind = 'email' AND p.archived = 0 ORDER BY a.created_at, a.id`).all();
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const email = String(row.value).trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, person_id: row.person_id });
    if (out.length >= limit) break;
  }
  return out;
}

export const interestSpec = (emails = contactEmails()) => ({ from_addresses: emails.map((e) => e.email) });
const hashOf = (emails) => crypto.createHash("sha1").update(emails.map((e) => e.email).sort().join("\n")).digest("hex");

/** The person whose e-mail address this is (not archived), or null. */
export function personOfAddress(address) {
  const email = String(address || "").trim().toLowerCase().replace(/^.*<|>.*$/g, "");
  if (!email) return null;
  const row = db().prepare("SELECT person_id FROM aliases WHERE kind = 'email' AND value = ? COLLATE NOCASE").get(email);
  const person = row ? getPerson(row.person_id) : null;
  return person && !person.archived ? person : null;
}

const oneLine = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);

/** One mail from a person: a "correo" line on their timeline with the subject. At most one per person and day. */
export function noteMail(message) {
  if (!message || message.from_self) return { status: "skipped" };
  const person = personOfAddress(message.from_address || message.from_addr);
  if (!person) return { status: "unknown_sender" };
  const when = message.ts ? new Date(Number(message.ts) * 1000) : new Date();
  const at = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const key = String(message.message_id || message.id || "").trim();
  const ref = key ? `mail:${key}`.slice(0, 200) : null;
  if (ref && db().prepare("SELECT 1 FROM interactions WHERE person_id = ? AND ref = ?").get(person.id, ref)) return { status: "duplicate", person_id: person.id };
  const sameDay = db().prepare("SELECT 1 FROM interactions WHERE person_id = ? AND source = 'mail' AND date(at, 'localtime') = date(?, 'localtime')").get(person.id, at);
  if (sameDay) return { status: "same_day", person_id: person.id };
  const subject = oneLine(message.subject);
  createInteraction(person.id, { at, channel: "email", summary: subject ? `Correo: ${subject}` : "Correo", source: "mail" }, { ref });
  return { status: "logged", person_id: person.id };
}

/** Register the interest when the set of addresses changed since last time. Returns { ok, changed, addresses, detail? }. */
export async function refreshInterest({ force = false } = {}) {
  const emails = contactEmails();
  const hash = hashOf(emails);
  const previous = getSetting(KEYS.hash, null);
  if (!force && previous === hash) return { ok: true, changed: false, addresses: emails.length };
  const reply = await family.mailRegisterInterest(interestSpec(emails));
  if (!reply.ok) return { ok: false, changed: false, addresses: emails.length, detail: reply.error || `HTTP ${reply.status}` };
  setSetting(KEYS.hash, hash);
  // the hub re-matches the stored mail with the new set: read it from the start so addresses added later find their old mail too
  if (previous !== null) setSetting(KEYS.since, 0);
  return { ok: true, changed: true, addresses: emails.length };
}

/**
 * One pass: register what is wanted, read what the hub has from those addresses since last time and note it.
 * Returns { status: off | mail_unavailable | no_addresses | register_failed | ok, ... } and never throws for the hub.
 */
export async function syncMail({ force = false } = {}) {
  if (!force && !mailSyncEnabled()) return { status: "off" };
  if (!(await family.mailAvailable())) return { status: "mail_unavailable" };
  const emails = contactEmails();
  if (!emails.length) return { status: "no_addresses", addresses: 0 };
  const registered = await refreshInterest();
  if (!registered.ok) return { status: "register_failed", detail: registered.detail, addresses: registered.addresses };
  const out = { status: "ok", addresses: emails.length, registered: registered.changed, read: 0, logged: 0, skipped: 0 };
  let since = Number(getSetting(KEYS.since, 0)) || 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const reply = await family.mailMessages({ sinceId: since, limit: PAGE_SIZE, full: false });
    if (!reply.ok) return { ...out, status: "read_failed", detail: reply.error || "" };
    const messages = reply.messages || [];
    for (const message of messages) {
      out.read++;
      const noted = noteMail(message);
      if (noted.status === "logged") out.logged++; else out.skipped++;
    }
    const next = Number(reply.last_id);
    if (Number.isFinite(next) && next > since) { since = next; setSetting(KEYS.since, since); }
    if (messages.length < PAGE_SIZE) break;
  }
  return out;
}

/** The same, with its outcome kept for the settings page. */
export async function runMailSync(options = {}) {
  if (info.running) return { status: "busy" };
  info.running = true;
  try {
    const result = await syncMail(options);
    info.last_run_at = new Date().toISOString();
    info.last_status = result.status;
    info.last_error = result.detail || "";
    info.read += result.read || 0;
    info.logged += result.logged || 0;
    return result;
  } catch (error) {
    info.last_status = "error";
    info.last_error = String(error?.message || error);
    return { status: "error", detail: info.last_error };
  } finally {
    info.running = false;
  }
}

export const mailSyncStatus = () => ({
  ...info, enabled: mailSyncEnabled(), since_id: Number(getSetting(KEYS.since, 0)) || 0, addresses: contactEmails().length,
});

// "refresh when contacts change": an address added, changed or removed re-registers the interest soon (debounced), if the gateway is there.
let refreshTimer = null;
export function contactsChanged({ delayMs = 5000 } = {}) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      if (mailSyncEnabled() && (await family.mailAvailable())) await refreshInterest();
    } catch { /* the next pass tries again */ }
  }, delayMs);
  refreshTimer.unref();
}
export function stopRefreshTimer() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}
