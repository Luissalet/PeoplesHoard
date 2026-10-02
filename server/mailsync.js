// Last contact from mail. The hub reads the inbox once for the whole family; People's Hoard tells it which addresses it
// cares about (the e-mails of the people in the book) and, every so often, reads what came from them. For each mail from
// a known person it keeps the date, the channel ("email", shown as correo) and the subject as a one-line note: never the
// body, and the mail is not claimed (it is not "owned" by this app, other apps may want it too).
// Everything here happens only while the hub's mail gateway answers (`mailAvailable()`); without it nothing changes.
import crypto from "node:crypto";
import { db, getSetting, setSetting } from "./db.js";
import { getPerson } from "./people.js";
import { createInteraction } from "./interactions.js";
import { findHandle, ensureNorms, normalizeHandle } from "./handles.js";
import * as family from "./hoard-link.js";

export const MAX_ADDRESSES = 300;
export const PAGE_SIZE = 100;
const MAX_PAGES = 20;
export const KEYS = { enabled: "mail_sync_enabled", since: "mail_since_id", hash: "mail_interest_hash" };
// what a person's "last contact" ignores: bulk mail from a company address (a list header or a Gmail promotions/social/forums tab)
const BULK_TABS = new Set(["promotions", "social", "forums"]);

const info = { running: false, last_run_at: null, last_status: "never", last_error: "", read: 0, logged: 0 };
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

export const mailSyncEnabled = () => getSetting(KEYS.enabled, true) !== false;
export function setMailSyncEnabled(value) {
  if (typeof value !== "boolean") fail("mail_sync debe ser true o false.");
  return setSetting(KEYS.enabled, value);
}

/** The e-mail aliases of people who are not archived (the addresses mail is read for), oldest first, at most `limit`; one per mailbox. */
export function contactEmails({ limit = MAX_ADDRESSES } = {}) {
  ensureNorms();
  const rows = db().prepare(
    `SELECT a.value AS value, a.norm AS norm, a.person_id AS person_id FROM aliases a JOIN people p ON p.id = a.person_id
     WHERE a.kind = 'email' AND p.archived = 0 ORDER BY a.created_at, a.id`).all();
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const email = String(row.value).trim().toLowerCase();
    const key = row.norm || normalizeHandle("email", email);
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || seen.has(key)) continue;
    seen.add(key);
    out.push({ email, person_id: row.person_id });
    if (out.length >= limit) break;
  }
  return out;
}

export const interestSpec = (emails = contactEmails()) => ({ from_addresses: emails.map((e) => e.email) });
const hashOf = (emails) => crypto.createHash("sha1").update(emails.map((e) => e.email).sort().join("\n")).digest("hex");

// The family's mail router in hub-only mode: People never reads the inbox itself (no helper), so it asks the hub's gateway, which
// registers the interest (from_addresses) and pages from the watermark. `fields: ["headers"]` brings the list/category headers.
const router = family.famMailRouter({
  sourceGetter: () => "hub",
  interest: () => interestSpec(),
  watermarkGet: () => Number(getSetting(KEYS.since, 0)) || 0,
  watermarkSet: (value) => setSetting(KEYS.since, Number(value)),
  page: PAGE_SIZE,
  maxPages: MAX_PAGES,
});

/** The person whose e-mail address this is (not archived), or null. */
export function personOfAddress(address) {
  const email = String(address || "").trim().replace(/^.*<|>.*$/g, "");
  if (!email) return null;
  const row = findHandle("email", email);
  const person = row ? getPerson(row.person_id) : null;
  return person && !person.archived ? person : null;
}

const oneLine = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 140);

/** Mail that is not from the person themselves: a mailing list or a promotions/social tab of a mailbox. */
export const isBulk = (message) => {
  const headers = message?.headers && typeof message.headers === "object" ? message.headers : {};
  return Boolean(headers.list_unsubscribe || headers.one_click) || BULK_TABS.has(String(headers.gmail_category || "").toLowerCase());
};

/** One mail from a person: a "correo" line on their timeline with the subject. At most one per person and day. */
export function noteMail(message) {
  if (!message || message.from_self) return { status: "skipped" };
  if (isBulk(message)) return { status: "bulk" };
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

/**
 * Register the interest (the router sends it again only when the set of addresses changed or after 6 hours; `force` sends it now).
 * When the set changed since the last pass the stored mail is read again from the start, so an address added later finds its old
 * mail. Returns { ok, changed, addresses, detail? }.
 */
export async function refreshInterest({ force = false } = {}) {
  const emails = contactEmails();
  const registered = await router.ensureInterest({}, { force });
  if (!registered.ok) return { ok: false, changed: false, addresses: emails.length, detail: registered.error || "the hub refused the interest" };
  const hash = hashOf(emails);
  const previous = getSetting(KEYS.hash, null);
  if (previous === hash) return { ok: true, changed: false, addresses: emails.length };
  setSetting(KEYS.hash, hash);
  if (previous !== null) setSetting(KEYS.since, 0);
  return { ok: true, changed: true, addresses: emails.length };
}

/**
 * One pass: register what is wanted, read what the hub has from those addresses since last time and note it.
 * Returns { status: off | mail_unavailable | no_addresses | register_failed | read_failed | ok, ... } and never throws for the hub.
 */
export async function syncMail({ force = false } = {}) {
  if (!force && !mailSyncEnabled()) return { status: "off" };
  if (!(await family.mailAvailable())) return { status: "mail_unavailable" };
  const emails = contactEmails();
  if (!emails.length) return { status: "no_addresses", addresses: 0 };
  const registered = await refreshInterest();
  if (!registered.ok) return { status: "register_failed", detail: registered.detail, addresses: registered.addresses };
  const out = { status: "ok", addresses: emails.length, registered: registered.changed, read: 0, logged: 0, skipped: 0, bulk: 0 };
  // the whole history the hub holds is read the first time (the watermark is 0), PAGE_SIZE x MAX_PAGES messages per pass
  const answer = await router.scanEx({ limit: PAGE_SIZE * MAX_PAGES, sinceDays: 36500, skipOwn: true, fields: ["headers"] });
  if (!answer.ok) return { ...out, status: "read_failed", detail: answer.error || "" };
  for (const message of answer.messages) {
    const noted = noteMail(message);
    if (noted.status === "logged") out.logged++; else out.skipped++;
    if (noted.status === "bulk") out.bulk++;
  }
  out.read = answer.read ?? answer.messages.length;
  await router.commit();
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
