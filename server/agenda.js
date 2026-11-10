// What People's Hoard puts on the family agenda (the hub's "Hoy" and the subscribable calendar):
// birthdays, follow-ups that are due by each person's cadence, and open commitments with a day.
import { listPeople } from "./people.js";
import { listCommitments } from "./commitments.js";
import { listReminders } from "./reminders.js";
import { upcomingPersonDates, personDateTitle } from "./person-dates.js";
import { parseBirthday, addDays, localDate, today as todayLocal } from "./dates.js";

let publicUrl = "http://127.0.0.1:5182";
export const setPublicUrl = (url) => { if (/^https?:\/\//.test(String(url || ""))) publicUrl = String(url).replace(/\/+$/, ""); };
export const getPublicUrl = () => publicUrl;

const personUrl = (id) => `${publicUrl}/#/personas/${id}`;
const inRange = (day, from, to) => day >= from && day <= to;
/** The day an item shows on: its own, or, when that is already past, the first day of a window that reaches back to today (none for a window wholly in the future). */
const overdueDay = (due, from, today) => (due >= from ? due : from <= today ? from : null);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Every real occurrence of an MM-DD birthday inside [from, to] (a Feb 29 birthday is kept on Feb 28 in common years). */
function birthdaysIn(birthday, from, to) {
  const parsed = parseBirthday(birthday);
  if (!parsed) return [];
  const out = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const day = parsed.month === 2 && parsed.day === 29 && !leap ? 28 : parsed.day;
    const date = `${year}-${String(parsed.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (inRange(date, from, to)) out.push({ date, age: parsed.year ? year - parsed.year : null });
  }
  return out;
}

/**
 * The provider for `installAgenda`: (from, to, sphere) with YYYY-MM-DD days. A follow-up or a commitment whose day is already
 * past is kept on the first day of a window that includes today, so what is overdue keeps showing instead of falling out of it.
 */
export function agendaItems(from, to, _sphere = "", { today = todayLocal() } = {}) {
  const items = [];
  const people = listPeople({ archived: "false" });
  const byId = new Map(people.map((p) => [p.id, p]));

  for (const person of people) {
    if (person.birthday) {
      for (const { date, age } of birthdaysIn(person.birthday, from, to)) {
        items.push({
          id: `people:birthday:${person.id}:${date.slice(0, 4)}`, title: `Cumpleaños de ${person.name}`, start: date, all_day: true, kind: "birthday",
          priority: "normal", url: personUrl(person.id), detail: age ? `Cumple ${age}` : "",
        });
      }
    }
    if (person.contact_every_days) {
      const last = person.last_contact_at ? localDate(person.last_contact_at) : null;
      const due = last ? addDays(last, person.contact_every_days) : today;
      const day = overdueDay(due, from, today);
      if (day && inRange(day, from, to)) {
        const late = daysBetween(due, today);
        items.push({
          id: `people:followup:${person.id}:${last || "never"}`, title: `Hablar con ${person.name}`, start: day, all_day: true, kind: "followup",
          priority: late > person.contact_every_days ? "high" : "normal", url: personUrl(person.id),
          detail: last ? `Último contacto ${last}; quería hablar cada ${person.contact_every_days} días` : `Sin contacto registrado; quería hablar cada ${person.contact_every_days} días`,
        });
      }
    }
  }

  // special dates (anniversaries and the like): the occurrences inside the window
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  if (span >= 0) {
    const seen = new Set();
    for (let start = from; start <= to; start = addDays(start, 366)) {
      for (const d of upcomingPersonDates({ from: start, days: Math.min(366, span) })) {
        if (d.date > to || seen.has(`${d.id}:${d.date}`)) continue;
        seen.add(`${d.id}:${d.date}`);
        items.push({ id: `people:date:${d.id}:${d.date}`, title: personDateTitle(d), start: d.date, all_day: true, kind: "other",
          priority: "normal", url: personUrl(d.person_id), detail: d.yearly ? "Cada año" : "" });
      }
    }
  }

  // open reminders with a day (one that is past stays on the first day of a window that reaches today)
  for (const r of listReminders({ done: false, due_before: to })) {
    const day = overdueDay(r.due, from, today);
    if (!day || !inRange(day, from, to)) continue;
    const who = r.person_id ? byId.get(r.person_id)?.name : null;
    items.push({ id: `people:reminder:${r.id}`, title: who ? `${r.text} (${who})` : r.text, start: day, all_day: true, kind: "followup",
      priority: r.due < today ? "high" : "normal", url: r.person_id ? personUrl(r.person_id) : `${publicUrl}/#/agenda`,
      detail: r.due < day ? `Era para el ${r.due}` : "" });
  }

  for (const c of listCommitments({ status: "open", today })) {
    if (!c.due) continue;
    const day = overdueDay(c.due, from, today);
    if (!day || !inRange(day, from, to)) continue;
    const who = c.person_id ? byId.get(c.person_id)?.name || c.person_name : c.person_name;
    items.push({
      id: `people:commitment:${c.id}`, title: c.direction === "i_owe" ? `Debo${who ? ` a ${who}` : ""}: ${c.text}` : `${who || "Alguien"} me debe: ${c.text}`,
      start: day, all_day: true, kind: "deadline", priority: c.direction === "i_owe" ? "high" : "normal",
      url: c.person_id ? personUrl(c.person_id) : `${publicUrl}/#/compromisos`,
      detail: c.due < from || c.overdue ? `Venció el ${c.due}` : (c.source?.quote ? `«${c.source.quote}»`.slice(0, 200) : ""),
    });
  }
  return items;
}
