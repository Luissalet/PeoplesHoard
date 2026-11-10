// GET /api/upcoming and the `upcoming` agent tool: birthdays in the window,
// reminders due, and people overdue for contact ("neglected").
import { listPeople } from "./people.js";
import { listReminders } from "./reminders.js";
import { listCommitments } from "./commitments.js";
import { nextBirthday, daysSince, today, addDays } from "./dates.js";
import { upcomingPersonDates } from "./person-dates.js";
import { coolingContacts, coolingDays } from "./nudges.js";

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

  const horizon = addDays(from, window);
  const commitments = listCommitments({ status: "open", today: from }).filter((c) => c.overdue || (c.due && c.due <= horizon));

  // special dates (anniversaries and the like) in the same window, and the people a relationship is cooling with (no cadence)
  const dates = upcomingPersonDates({ from, days: window });
  const cooling = coolingContacts({ today: from });

  return { days: window, birthdays, dates, reminders, neglected, cooling, cooling_days: coolingDays(), commitments,
    summary: summarize(birthdays, reminders, neglected, commitments, dates, cooling) };
}

function summarize(birthdays, reminders, neglected, commitments, dates = [], cooling = []) {
  const parts = [
    birthdays.length ? `${birthdays.length} cumpleaños próximos` : "sin cumpleaños próximos",
    ...(dates.length ? [`${dates.length} ${dates.length === 1 ? "fecha señalada" : "fechas señaladas"}`] : []),
    reminders.length ? `${reminders.length} ${reminders.length === 1 ? "recordatorio pendiente" : "recordatorios pendientes"}` : "sin recordatorios pendientes",
    neglected.length ? `${neglected.length} ${neglected.length === 1 ? "persona con la que toca hablar" : "personas con las que toca hablar"}` : "nadie abandonado",
    ...(cooling.length ? [`${cooling.length} ${cooling.length === 1 ? "relación que se enfría" : "relaciones que se enfrían"}`] : []),
    commitments.length ? `${commitments.length} ${commitments.length === 1 ? "compromiso vencido o próximo" : "compromisos vencidos o próximos"}` : "sin compromisos vencidos ni próximos",
  ];
  return `${parts.join(", ")}.`;
}
