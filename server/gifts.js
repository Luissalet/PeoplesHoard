// Gift ideas per person. An idea can be watched by Tantalus (price drops, restocks) and, some days before a birthday,
// the saved ideas go to the daily digest.
import { z } from "zod";
import { db, uid, now, getSetting, setSetting } from "./db.js";
import { getPerson, listPeople } from "./people.js";
import { nextBirthday, today as todayLocal, addDays } from "./dates.js";
import * as family from "./hoard-link.js";

export const GIFT_STATUSES = ["idea", "bought", "dropped"];
export const GIFT_DAYS_KEY = "gift_days_before";
export const GIFT_DAYS_DEFAULT = 21;
const SENT_KEY = "gift_digest_sent";

const fail = (message, opts = {}) => {
  throw Object.assign(new Error(message), { status: 400, ...opts });
};

export const giftInput = z.object({
  idea: z.string().trim().min(1).max(300),
  url: z.string().trim().max(2000).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "La dirección debe empezar por http:// o https://.").default(""),
  budget: z.number().nonnegative().max(1e9).nullable().default(null),
});
export const giftPatch = z.object({
  idea: z.string().trim().min(1).max(300).optional(),
  url: giftInput.shape.url.optional(),
  budget: z.number().nonnegative().max(1e9).nullable().optional(),
  status: z.enum(GIFT_STATUSES).optional(),
});

export const giftRef = (id) => `hoard://people/gift/${id}`;

const present = (row) => row && ({
  id: row.id, person_id: row.person_id, person_name: getPerson(row.person_id)?.name || "", idea: row.idea, url: row.url,
  budget: row.budget, status: row.status, watcher_id: row.watcher_id || null, watched: !!row.watcher_id, ref: giftRef(row.id),
  created_at: row.created_at, updated_at: row.updated_at,
});

export const getGift = (id) => present(db().prepare("SELECT * FROM gift_ideas WHERE id = ?").get(id));

/** Ideas, newest first; `status` default "idea" (still to give), "all" for every one. */
export function listGifts({ person_id, status = "idea", limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (person_id) { where.push("person_id = ?"); params.push(person_id); }
  if (status && status !== "all") {
    if (!GIFT_STATUSES.includes(status)) fail("status debe ser idea, bought, dropped o all.");
    where.push("status = ?"); params.push(status);
  }
  const rows = db().prepare(`SELECT * FROM gift_ideas${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, Math.max(1, Math.min(1000, Number(limit) || 200)));
  return rows.map(present);
}

/** The same idea (same text, case aside) for the same person is not added twice: it is returned with `created: false`. */
export function addGift(personId, input) {
  if (!getPerson(personId)) fail("La persona no existe.");
  const data = giftInput.parse(input);
  const same = db().prepare("SELECT * FROM gift_ideas WHERE person_id = ? AND status = 'idea' AND idea = ? COLLATE NOCASE").get(personId, data.idea);
  if (same) return { created: false, gift: present(same) };
  const id = uid();
  const ts = now();
  db().prepare("INSERT INTO gift_ideas (id, person_id, idea, url, budget, status, watcher_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'idea', '', ?, ?)")
    .run(id, personId, data.idea, data.url, data.budget, ts, ts);
  return { created: true, gift: getGift(id) };
}

export function updateGift(id, patch) {
  const current = db().prepare("SELECT * FROM gift_ideas WHERE id = ?").get(id);
  if (!current) return null;
  const data = giftPatch.parse(patch);
  const next = { ...current, ...data };
  db().prepare("UPDATE gift_ideas SET idea = ?, url = ?, budget = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(next.idea, next.url, next.budget, next.status, now(), id);
  return getGift(id);
}

export const deleteGift = (id) => db().prepare("DELETE FROM gift_ideas WHERE id = ?").run(id).changes > 0;

/**
 * Ask Tantalus (through the hub) to watch the idea: its text, its page and its budget as the price limit. The watcher id
 * is kept, so asking again answers the same watcher. Never throws for "the other side is down".
 */
export async function watchGift(id, { timeoutMs = 60000 } = {}) {
  const row = db().prepare("SELECT * FROM gift_ideas WHERE id = ?").get(id);
  if (!row) return null;
  if (row.watcher_id) return { ok: true, existing: true, watcher_id: row.watcher_id, gift: present(row) };
  const args = { name: row.idea.slice(0, 200), source_ref: giftRef(row.id) };
  if (row.url) args.url = row.url;
  if (row.budget !== null && row.budget !== undefined) args.budget = row.budget;
  const response = await family.call("tantalus", "watcher_add", args, { timeoutMs });
  if (response.status === null || response.status === undefined) return { ok: false, status: "hub_down", detail: response.error || "No se puede contactar con el hub de Hoard Link." };
  if (!response.ok) {
    const detail = String(response.error || `HTTP ${response.status}`);
    if (/unknown tool|herramienta desconocida/i.test(detail)) return { ok: false, status: "tool_missing", detail: "Esta versión de Tantalus no tiene watcher_add." };
    if (response.status === 404 || /not installed|unknown app|no such app/i.test(detail)) return { ok: false, status: "tantalus_unavailable", detail };
    return { ok: false, status: "tantalus_error", detail, http: response.status };
  }
  const watcherId = String(response.result?.watcher_id || "");
  if (!watcherId) return { ok: false, status: "tantalus_error", detail: "Tantalus no devolvió el id del vigilante." };
  db().prepare("UPDATE gift_ideas SET watcher_id = ?, updated_at = ? WHERE id = ?").run(watcherId, now(), id);
  return { ok: true, existing: false, watcher_id: watcherId, gift: getGift(id) };
}

// ------------------------------------------------------- before a birthday --

export const giftDaysBefore = () => {
  const value = Number(getSetting(GIFT_DAYS_KEY, GIFT_DAYS_DEFAULT));
  return Number.isFinite(value) && value >= 0 ? Math.min(365, Math.round(value)) : GIFT_DAYS_DEFAULT;
};
export const setGiftDaysBefore = (days) => {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 0 || value > 365) fail("gift_days_before debe ser un número entero de 0 a 365 días.");
  return setSetting(GIFT_DAYS_KEY, value);
};

const inDays = (n) => (n === 0 ? "hoy" : n === 1 ? "en 1 día" : `en ${n} días`);

/** The line the digest carries for one birthday: "Cumpleaños de X en 21 días: ideas guardadas: a; b". */
export function birthdayGiftLine(name, daysUntil, ideas) {
  return `Cumpleaños de ${name} ${inDays(daysUntil)}: ideas guardadas: ${ideas.map((g) => g.idea).join("; ")}`.slice(0, 300);
}

/**
 * For every birthday that is `gift_days_before` days away (or closer, if the app was not running on the exact day) of a person
 * with saved ideas, send one `digest.item` event, once per person and birthday. Remembered only when the hub took the event, so a
 * hub that was away gets it on the next sweep. Returns how many were sent.
 */
export async function giftSweep({ today = todayLocal(), baseUrl = "" } = {}) {
  const days = giftDaysBefore();
  const sent = getSetting(SENT_KEY, {}) || {};
  const limit = addDays(today, -400);
  const kept = Object.fromEntries(Object.entries(sent).filter(([key]) => key.split(":").pop() >= limit));
  let count = 0;
  for (const person of listPeople({ archived: "false" })) {
    if (!person.birthday) continue;
    const next = nextBirthday(person.birthday, today);
    if (!next || next.daysUntil > days) continue;
    const key = `${person.id}:${next.date}`;
    if (kept[key]) continue;
    const ideas = listGifts({ person_id: person.id, status: "idea" }).reverse(); // in the order they were saved
    if (!ideas.length) continue;
    const ok = await family.emit("digest.item", {
      title: birthdayGiftLine(person.name, next.daysUntil, ideas), url: baseUrl ? `${baseUrl}/#/personas/${person.id}` : "",
      watch: "people", kind: "gift", person_id: person.id, birthday: next.date,
    }, { block: true });
    if (!ok) continue;
    kept[key] = true;
    count++;
  }
  setSetting(SENT_KEY, kept);
  return count;
}
