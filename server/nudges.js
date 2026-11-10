// What the address book reminds the user of on its own: commitments that fall due today or have just gone overdue (both ways),
// reminders for today, birthdays and special dates a week ahead and on the day, and the people a relationship is cooling with
// ("hace 5 meses que no hablas con…"). `nudgesReport` is what is pending now; `nudgeSweep` sends each line once to the hub as a
// `digest.item` event (the hub's daily digest lists them under news) and remembers it only when the hub took it.
import { db, getSetting, setSetting } from "./db.js";
import { listPeople } from "./people.js";
import { listCommitments, eventText } from "./commitments.js";
import { listReminders } from "./reminders.js";
import { upcomingPersonDates, personDateTitle } from "./person-dates.js";
import { nextBirthday, daysSince, localDate, today as todayLocal, addDays } from "./dates.js";
import { getPublicUrl } from "./agenda.js";
import * as family from "./hoard-link.js";

export const KEYS = { enabled: "nudges_enabled", cooling: "cooling_days", sent: "nudges_sent", last: "nudges_last_run" };
export const COOLING_DEFAULT = 90;
export const WEEK_AHEAD = 7;
const KEEP_SENT_DAYS = 400;

const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }); };

export const nudgesEnabled = () => getSetting(KEYS.enabled, true) !== false;
export function setNudgesEnabled(value) {
  if (typeof value !== "boolean") fail("nudges debe ser true o false.");
  return setSetting(KEYS.enabled, value);
}
/** Days without talking after which someone without a cadence counts as cooling; 0 switches that warning off. */
export const coolingDays = () => {
  const value = Number(getSetting(KEYS.cooling, COOLING_DEFAULT));
  return Number.isInteger(value) && value >= 0 ? Math.min(3650, value) : COOLING_DEFAULT;
};
export function setCoolingDays(days) {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 0 || value > 3650) fail("cooling_days debe ser un número entero de 0 a 3650 días.");
  return setSetting(KEYS.cooling, value);
}

/** «3 semanas», «5 meses», «más de un año»: how long it has been, in the words a person would use. */
export function sinceWords(days) {
  if (days === null || days === undefined) return "nunca";
  if (days < 14) return `${days} ${days === 1 ? "día" : "días"}`;
  if (days < 60) return `${Math.floor(days / 7)} semanas`;
  if (days < 365) return `${Math.floor(days / 30)} meses`;
  const years = Math.floor(days / 365);
  return years === 1 ? "más de un año" : `más de ${years} años`;
}

/**
 * People the user used to talk to and has not for `days` days: not archived, no cadence of their own (those are the "neglected"
 * of the agenda), at least two contacts on the timeline (a contact imported once is not a relationship), last contact long ago.
 */
export function coolingContacts({ today = todayLocal(), days = coolingDays() } = {}) {
  if (!days) return [];
  const counts = new Map(db().prepare("SELECT person_id, COUNT(*) AS n FROM interactions GROUP BY person_id").all().map((r) => [r.person_id, r.n]));
  const out = [];
  for (const p of listPeople({ archived: "false" })) {
    if (p.contact_every_days || !p.last_contact_at || (counts.get(p.id) || 0) < 2) continue;
    const since = daysSince(p.last_contact_at, today);
    if (since === null || since < days) continue;
    out.push({ person_id: p.id, name: p.name, nickname: p.nickname, last_contact_at: p.last_contact_at, days_since_contact: since,
      interactions: counts.get(p.id), words: `hace ${sinceWords(since)} que no hablas con ${p.name}` });
  }
  return out.sort((a, b) => b.days_since_contact - a.days_since_contact);
}

const personUrl = (base, id) => (base ? `${base}/#/personas/${id}` : "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const whenWords = (n) => (n === 0 ? "hoy" : n === 1 ? "mañana" : `en ${n} días`);

/** The commitment in words for the digest; a promise read in a chat is named by its action only (see commitments.eventText). */
function commitmentWords(c) {
  const what = eventText(c).slice(0, 140);
  return c.direction === "i_owe" ? `Le debes a ${c.person_name || "alguien"}: ${what}` : `${c.person_name || "Alguien"} te debe: ${what}`;
}

/**
 * Everything that deserves a word today, each with the key it is sent under (a key is sent once: the same commitment overdue
 * again after a new day gets a new key, a person cooling again after a new contact too).
 */
export function nudgesReport({ today = todayLocal(), baseUrl = getPublicUrl() } = {}) {
  const items = [];
  const open = listCommitments({ status: "open", today, limit: 2000 });
  const dueToday = open.filter((c) => c.due === today);
  const overdue = open.filter((c) => c.overdue);
  for (const c of dueToday) {
    items.push({ key: `commitment-today:${c.id}:${c.due}`, kind: "commitment", person_id: c.person_id,
      title: `Vence hoy · ${commitmentWords(c)}`, url: c.person_id ? personUrl(baseUrl, c.person_id) : baseUrl ? `${baseUrl}/#/compromisos` : "" });
  }
  for (const c of overdue) {
    items.push({ key: `commitment-overdue:${c.id}:${c.due}`, kind: "commitment", person_id: c.person_id,
      title: `Vencido hace ${plural(-c.days_until_due, "día", "días")} · ${commitmentWords(c)}`,
      url: c.person_id ? personUrl(baseUrl, c.person_id) : baseUrl ? `${baseUrl}/#/compromisos` : "" });
  }
  const people = listPeople({ archived: "false" });
  const byId = new Map(people.map((p) => [p.id, p]));
  const reminders = listReminders({ done: false, due_before: today }).filter((r) => r.due === today);
  for (const r of reminders) {
    const who = r.person_id ? byId.get(r.person_id)?.name : null;
    items.push({ key: `reminder:${r.id}:${r.due}`, kind: "reminder", person_id: r.person_id,
      title: `Recordatorio${who ? ` · ${who}` : ""}: ${r.text}`.slice(0, 200), url: r.person_id ? personUrl(baseUrl, r.person_id) : "" });
  }
  const birthdays = [];
  for (const p of people) {
    const next = p.birthday ? nextBirthday(p.birthday, today) : null;
    if (!next || next.daysUntil > WEEK_AHEAD) continue;
    birthdays.push({ person_id: p.id, name: p.name, date: next.date, days_until: next.daysUntil, turning_age: next.turningAge });
    const stage = next.daysUntil === 0 ? "day" : "week";
    items.push({ key: `birthday:${p.id}:${next.date}:${stage}`, kind: "birthday", person_id: p.id,
      title: `Cumpleaños de ${p.name} ${whenWords(next.daysUntil)}${next.turningAge ? ` (cumple ${next.turningAge})` : ""}`, url: personUrl(baseUrl, p.id) });
  }
  const dates = upcomingPersonDates({ from: today, days: WEEK_AHEAD });
  for (const d of dates) {
    const stage = d.days_until === 0 ? "day" : "week";
    items.push({ key: `date:${d.id}:${d.date}:${stage}`, kind: "date", person_id: d.person_id,
      title: `${personDateTitle(d)} ${whenWords(d.days_until)}`, url: personUrl(baseUrl, d.person_id) });
  }
  const cooling = coolingContacts({ today });
  for (const c of cooling) {
    items.push({ key: `cooling:${c.person_id}:${localDate(c.last_contact_at)}`, kind: "cooling", person_id: c.person_id,
      title: `Hace ${sinceWords(c.days_since_contact)} que no hablas con ${c.name}`, url: personUrl(baseUrl, c.person_id) });
  }
  const sent = getSetting(KEYS.sent, {}) || {};
  for (const item of items) item.sent = !!sent[item.key];
  return {
    as_of: today, enabled: nudgesEnabled(), cooling_days: coolingDays(),
    commitments: { due_today: dueToday, overdue }, reminders, birthdays, dates, cooling,
    items, pending: items.filter((i) => !i.sent).length, last_run: getSetting(KEYS.last, null),
  };
}

/** Lines that only differ by person are grouped: more than this many people cooling at once go out as one line. */
const COOLING_GROUP = 3;

/**
 * Send what was not sent yet as `digest.item` events (watch "people"). Each key is remembered only once the hub took it, so a hub
 * that was away gets them on the next pass. Returns { status, sent, pending }: status is off (switched off), nothing, sent or hub_down.
 */
export async function nudgeSweep({ today = todayLocal(), baseUrl = getPublicUrl(), force = false } = {}) {
  const record = (status, sent, pending) => {
    const out = { status, sent, pending, at: new Date().toISOString() };
    setSetting(KEYS.last, out);
    return out;
  };
  if (!nudgesEnabled() && !force) return record("off", 0, 0);
  const report = nudgesReport({ today, baseUrl });
  const sent = getSetting(KEYS.sent, {}) || {};
  const limit = addDays(today, -KEEP_SENT_DAYS);
  const kept = Object.fromEntries(Object.entries(sent).filter(([, day]) => typeof day === "string" && day >= limit));
  const fresh = report.items.filter((i) => !kept[i.key]);
  if (!fresh.length) { setSetting(KEYS.sent, kept); return record("nothing", 0, 0); }
  if (!family.status().enabled) return record("events_off", 0, fresh.length); // HOARD_EVENTS=0: nothing goes to the hub
  const cooling = fresh.filter((i) => i.kind === "cooling");
  const groups = fresh.filter((i) => i.kind !== "cooling").map((i) => [i]);
  if (cooling.length > COOLING_GROUP) {
    const names = cooling.slice(0, 8).map((i) => i.title.replace(/^Hace (.*) que no hablas con (.*)$/, "$2 ($1)"));
    groups.push([{ ...cooling[0], person_id: null, url: baseUrl ? `${baseUrl}/#/agenda` : "",
      title: `Hace tiempo que no hablas con: ${names.join(", ")}${cooling.length > 8 ? ` y ${cooling.length - 8} más` : ""}`.slice(0, 200) }, ...cooling.slice(1)]);
  } else groups.push(...cooling.map((i) => [i]));
  let count = 0;
  let down = false;
  for (const group of groups) {
    const head = group[0];
    const ok = await family.emit("digest.item", {
      title: head.title.slice(0, 200), url: head.url, watch: "people", kind: head.kind, ...(head.person_id ? { person_id: head.person_id } : {}),
    }, { block: true });
    if (!ok) { down = true; break; }
    for (const item of (head.kind === "cooling" && group.length > 1 ? cooling : group)) kept[item.key] = today;
    count++;
  }
  setSetting(KEYS.sent, kept);
  return record(down ? "hub_down" : "sent", count, fresh.filter((i) => !kept[i.key]).length);
}
