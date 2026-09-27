// A compact, evidence-linked view for catching up before speaking to someone.
// Derived on every read, so edits, imports and merges are reflected immediately.
import { db } from "./db.js";
import { getPersonFull } from "./people.js";
import { daysSince, today } from "./dates.js";
import { fold } from "./text.js";

export function personBrief(personId) {
  const full = getPersonFull(personId, { interactionsLimit: 5 });
  if (!full) return null;
  const { aliases, facts, interactions, reminders, ...person } = full;
  const groups = new Map();
  for (const fact of facts) {
    const key = fold(fact.key);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }
  const conflictingFacts = [...groups.values()]
    .filter((items) => new Set(items.map((item) => fold(item.value))).size > 1)
    .map((items) => ({ key: items[0].key, sources: items.map((item) => `fact:${item.id}`) }));
  const count = db().prepare("SELECT COUNT(*) AS n FROM interactions WHERE person_id = ?").get(personId).n;
  const asOf = today();
  return {
    as_of: asOf,
    person: {
      id: person.id, name: person.name, nickname: person.nickname, circles: person.circles,
      summary: person.summary, birthday: person.birthday, location: person.location,
      last_contact_at: person.last_contact_at,
      days_since_last_contact: daysSince(person.last_contact_at),
      contact_every_days: person.contact_every_days,
      source: `person:${person.id}`,
    },
    facts: facts.map((fact) => ({ id: fact.id, key: fact.key, value: fact.value, source: `fact:${fact.id}` })),
    conflicting_facts: conflictingFacts,
    recent_interactions: interactions.map((item) => ({
      id: item.id, at: item.at, channel: item.channel, summary: item.summary,
      source: `interaction:${item.id}`,
    })),
    interaction_count: count,
    open_reminders: reminders.filter((item) => !item.done).map((item) => ({
      id: item.id, due: item.due, text: item.text,
      days_until_due: Math.round((Date.parse(`${item.due}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86400000),
      source: `reminder:${item.id}`,
    })),
  };
}
