// GET /api/upcoming and the `upcoming` agent tool: birthdays in the window,
// reminders due, and people overdue for contact ("neglected").
import { listPeople } from "./people.js";
import { listReminders } from "./reminders.js";
import { nextBirthday, daysSince, today, addDays } from "./dates.js";

export function upcomingReport({ days = 30 } = {}) {
  const window = Math.max(1, Math.min(365, Number(days) || 30));
  const from = today();
  const people = listPeople({ archived: "false" });
  const byId = new Map(people.map((p) => [p.id, p]));

  const birthdays = [];
  for (const p of people) {
    if (!p.birthday) continue;
    const nb = nextBirthday(p.birthday, from);
    if (nb && nb.daysUntil <= window) {
      birthdays.push({
        person_id: p.id,
        name: p.name,
        nickname: p.nickname,
        date: nb.date,
        days_until: nb.daysUntil,
        turning_age: nb.turningAge,
      });
    }
  }
  birthdays.sort((a, b) => a.days_until - b.days_until);

  const reminders = listReminders({ done: false, due_before: addDays(from, window) })
    .map((r) => ({ ...r, person_name: r.person_id ? byId.get(r.person_id)?.name || null : null }));

  const neglected = [];
  for (const p of people) {
    if (!p.contact_every_days) continue;
    const since = daysSince(p.last_contact_at, from);
    if (since === null || since > p.contact_every_days) {
      neglected.push({
        person_id: p.id,
        name: p.name,
        nickname: p.nickname,
        days_since_contact: since,
        contact_every_days: p.contact_every_days,
        overdue_by: since === null ? null : since - p.contact_every_days,
      });
    }
  }
  neglected.sort((a, b) => (b.overdue_by ?? Infinity) - (a.overdue_by ?? Infinity));

  return { days: window, birthdays, reminders, neglected, summary: summarize(birthdays, reminders, neglected) };
}

function summarize(birthdays, reminders, neglected) {
  const parts = [
    birthdays.length ? `${birthdays.length} cumpleaños próximos` : "sin cumpleaños próximos",
    reminders.length ? `${reminders.length} recordatorios pendientes` : "sin recordatorios pendientes",
    neglected.length ? `${neglected.length} personas con las que toca hablar` : "nadie abandonado",
  ];
  return `${parts.join(", ")}.`;
}
