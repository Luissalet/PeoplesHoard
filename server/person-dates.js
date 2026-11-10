// Special dates of a person besides the birthday: a wedding anniversary, a saint's day, the day a baby is due. A label and a day
// written like birthdays ("YYYY-MM-DD", or "--MM-DD" when the year is not known); yearly ones come back every year (and say how
// many years it makes when the year is known), a one-off day needs its year and is gone once it has passed.
import { z } from "zod";
import { db, uid, now } from "./db.js";
import { getPerson, listPeople } from "./people.js";
import { parseBirthday, nextBirthday, today as todayLocal, daysBetween } from "./dates.js";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

const dateField = z.string().trim().refine((v) => parseBirthday(v) !== null, "Fecha no válida. Usa AAAA-MM-DD, o --MM-DD si no sabes el año.");
export const personDateInput = z.object({
  label: z.string().trim().min(1).max(120),
  date: dateField,
  yearly: z.boolean().default(true),
});
export const personDatePatch = z.object({ label: personDateInput.shape.label, date: dateField, yearly: z.boolean() }).partial();

const present = (r) => (r ? { ...r, yearly: !!r.yearly } : null);

function check({ date, yearly }) {
  if (!yearly && parseBirthday(date)?.year == null) fail("Una fecha que no se repite necesita el año (AAAA-MM-DD).");
}

export const getPersonDate = (id) => present(db().prepare("SELECT * FROM person_dates WHERE id = ?").get(id));

export function listPersonDates(personId) {
  return db().prepare("SELECT * FROM person_dates WHERE person_id = ? ORDER BY substr(date, -5), label").all(personId).map(present);
}

/** Idempotent: the same label and day on the same person is returned instead of saved twice. */
export function addPersonDate(personId, input) {
  if (!getPerson(personId)) fail("La persona no existe.");
  const data = personDateInput.parse(input);
  check(data);
  const existing = db().prepare("SELECT * FROM person_dates WHERE person_id = ? AND label = ? COLLATE NOCASE AND date = ?").get(personId, data.label, data.date);
  if (existing) return { created: false, date: present(existing) };
  const id = uid();
  db().prepare("INSERT INTO person_dates (id, person_id, label, date, yearly, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, personId, data.label, data.date, data.yearly ? 1 : 0, now());
  return { created: true, date: getPersonDate(id) };
}

export function updatePersonDate(id, patch) {
  const current = getPersonDate(id);
  if (!current) return null;
  const next = { ...current, ...personDatePatch.parse(patch) };
  check(next);
  db().prepare("UPDATE person_dates SET label = ?, date = ?, yearly = ? WHERE id = ?").run(next.label, next.date, next.yearly ? 1 : 0, id);
  return getPersonDate(id);
}

export const deletePersonDate = (id) => db().prepare("DELETE FROM person_dates WHERE id = ?").run(id).changes > 0;

/** The next time a special date falls on or after `from`: { date, days_until, years } or null (a one-off day already past). */
export function nextOccurrence(entry, from = todayLocal()) {
  if (entry.yearly) {
    const next = nextBirthday(entry.date, from);
    return next ? { date: next.date, days_until: next.daysUntil, years: next.turningAge } : null;
  }
  if (entry.date < from) return null;
  return { date: entry.date, days_until: daysBetween(from, entry.date), years: null };
}

/** Every special date of the people still in the book that falls within `days` days from `from`, soonest first. */
export function upcomingPersonDates({ from = todayLocal(), days = 30 } = {}) {
  const window = Math.max(0, Math.min(366, Number(days) || 0));
  const people = new Map(listPeople({ archived: "false" }).map((p) => [p.id, p]));
  const out = [];
  for (const row of db().prepare("SELECT * FROM person_dates").all().map(present)) {
    const person = people.get(row.person_id);
    if (!person) continue;
    const next = nextOccurrence(row, from);
    if (!next || next.days_until > window) continue;
    out.push({ id: row.id, person_id: person.id, name: person.name, label: row.label, yearly: row.yearly, stored: row.date, ...next });
  }
  return out.sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name, "es"));
}

/** "Aniversario de boda de Ana (10 años)" — what an agenda line or a digest says. */
export const personDateTitle = (item) => `${item.label} · ${item.name}${item.years ? ` (${item.years} ${item.years === 1 ? "año" : "años"})` : ""}`;
