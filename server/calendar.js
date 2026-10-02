// Downloadable iCalendar snapshot of the address book's dated events.
import { listPeople } from "./people.js";
import { listReminders } from "./reminders.js";
import { listCommitments } from "./commitments.js";
import { addDays, parseBirthday, today } from "./dates.js";

const compact = (date) => date.replaceAll("-", "");
const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const escapeText = (value) => String(value || "").replace(/\\/g, "\\\\")
  .replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function fold(line) {
  const out = [];
  let part = "";
  for (const char of line) {
    if (Buffer.byteLength(part + char, "utf8") > (out.length ? 74 : 75)) {
      out.push(part);
      part = char;
    } else part += char;
  }
  out.push(part);
  return out.join("\r\n ");
}

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

export function calendarFeed({ from = today(), generatedAt = new Date() } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//People's Hoard//Calendar Export//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:People's Hoard"];
  const people = listPeople({ archived: "false" });
  const byId = new Map(people.map((person) => [person.id, person]));
  let birthdays = 0, reminders = 0, commitments = 0;
  for (const person of people) {
    if (!person.birthday) continue;
    const date = nextRealBirthday(person.birthday, from);
    if (!date) continue;
    lines.push("BEGIN:VEVENT", `UID:birthday-${person.id}@peoples-hoard.local`, `DTSTAMP:${stamp(generatedAt)}`,
      `DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      "RRULE:FREQ=YEARLY", `SUMMARY:${escapeText(`Cumpleaños de ${person.name}`)}`, "END:VEVENT");
    birthdays++;
  }
  for (const reminder of listReminders({ done: false })) {
    const parsedDue = new Date(`${reminder.due}T00:00:00Z`);
    if (Number.isNaN(parsedDue.getTime()) || parsedDue.toISOString().slice(0, 10) !== reminder.due) continue;
    const person = byId.get(reminder.person_id);
    lines.push("BEGIN:VEVENT", `UID:reminder-${reminder.id}@peoples-hoard.local`, `DTSTAMP:${stamp(generatedAt)}`,
      `DTSTART;VALUE=DATE:${compact(reminder.due)}`, `DTEND;VALUE=DATE:${compact(addDays(reminder.due, 1))}`,
      `SUMMARY:${escapeText(reminder.text)}`,
      ...(person ? [`DESCRIPTION:${escapeText(`Contacto: ${person.name}`)}`] : []), "END:VEVENT");
    reminders++;
  }
  for (const c of listCommitments({ status: "open" })) {
    if (!c.due) continue;
    const person = c.person_id ? byId.get(c.person_id) : null;
    const who = person?.name || c.person_name;
    const summary = c.direction === "i_owe" ? `Debo${who ? ` a ${who}` : ""}: ${c.text}` : `${who || "Alguien"} me debe: ${c.text}`;
    lines.push("BEGIN:VEVENT", `UID:commitment-${c.id}@peoples-hoard.local`, `DTSTAMP:${stamp(generatedAt)}`,
      `DTSTART;VALUE=DATE:${compact(c.due)}`, `DTEND;VALUE=DATE:${compact(addDays(c.due, 1))}`,
      `SUMMARY:${escapeText(summary)}`, "CATEGORIES:Compromiso", "END:VEVENT");
    commitments++;
  }
  lines.push("END:VCALENDAR");
  return { text: lines.map(fold).join("\r\n") + "\r\n", birthdays, reminders, commitments };
}
