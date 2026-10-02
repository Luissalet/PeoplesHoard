// Downloadable iCalendar snapshot of the address book's dated events.
import { listPeople } from "./people.js";
import { listReminders } from "./reminders.js";
import { listCommitments } from "./commitments.js";
import { parseBirthday, today } from "./dates.js";
import { parseIso } from "./hoard-commons/dates.js";
import { buildIcs } from "./hoard-commons/ics.js";

function nextRealBirthday(birthday, from) {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  const mmdd = `${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  for (let year = Number(from.slice(0, 4)); year <= Number(from.slice(0, 4)) + 4; year++) {
    const date = `${year}-${mmdd}`;
    if (date >= from && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
        && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date) return date;
  }
  return null;
}

/** The address book's dated events as one iCalendar text (the family's buildIcs: CRLF, folded at 75 octets, escaped). Birthdays repeat yearly. */
export function calendarFeed({ from = today(), generatedAt = new Date() } = {}) {
  const events = [];
  const people = listPeople({ archived: "false" });
  const byId = new Map(people.map((person) => [person.id, person]));
  let birthdays = 0, reminders = 0, commitments = 0;
  for (const person of people) {
    if (!person.birthday) continue;
    const date = nextRealBirthday(person.birthday, from);
    if (!date) continue;
    events.push({ uid: `birthday-${person.id}@peoples-hoard.local`, start: date, all_day: true, rrule: "FREQ=YEARLY", summary: `Cumpleaños de ${person.name}` });
    birthdays++;
  }
  for (const reminder of listReminders({ done: false })) {
    if (parseIso(reminder.due) !== reminder.due) continue;
    const person = byId.get(reminder.person_id);
    events.push({ uid: `reminder-${reminder.id}@peoples-hoard.local`, start: reminder.due, all_day: true, summary: reminder.text,
      ...(person ? { description: `Contacto: ${person.name}` } : {}) });
    reminders++;
  }
  for (const c of listCommitments({ status: "open" })) {
    if (!c.due || parseIso(c.due) !== c.due) continue;
    const person = c.person_id ? byId.get(c.person_id) : null;
    const who = person?.name || c.person_name;
    const summary = c.direction === "i_owe" ? `Debo${who ? ` a ${who}` : ""}: ${c.text}` : `${who || "Alguien"} me debe: ${c.text}`;
    events.push({ uid: `commitment-${c.id}@peoples-hoard.local`, start: c.due, all_day: true, summary, categories: ["Compromiso"] });
    commitments++;
  }
  const text = buildIcs(events, { name: "People's Hoard", prodid: "-//People's Hoard//Calendar Export//ES", now: generatedAt });
  return { text, birthdays, reminders, commitments };
}
