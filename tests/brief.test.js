import { test } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

test("conversation brief reflects edits and cites original records", async () => {
  const s = await bootServer();
  try {
    const created = await s.agent("upsert_person", { person: "Irene Prueba", summary: "Compañera del taller." });
    const id = created.body.person.id;
    const first = await s.agent("add_fact", { person: id, key: "trabaja en", value: "Museo Norte" });
    const second = await s.agent("add_fact", { person: id, key: "Trabaja en", value: "Museo Sur" });
    const meeting = await s.agent("log_interaction", { person: id, channel: "meet", summary: "Hablamos del proyecto Atlas.", at: "2026-08-11T10:00:00Z" });
    const reminder = await s.agent("add_reminder", { person: id, due: "2026-10-01", text: "Preguntar por Atlas." });

    const brief = await s.agent("prepare_person_chat", { person: id });
    assert.equal(brief.status, 200);
    assert.equal(brief.body.person.summary, "Compañera del taller.");
    assert.deepEqual(brief.body.conflicting_facts[0].sources, [`fact:${first.body.fact.id}`, `fact:${second.body.fact.id}`]);
    assert.equal(brief.body.recent_interactions[0].source, `interaction:${meeting.body.interaction.id}`);
    assert.equal(brief.body.open_reminders[0].source, `reminder:${reminder.body.reminder.id}`);
    assert.equal(brief.body.open_reminders[0].days_until_due,
      Math.round((Date.parse("2026-10-01T00:00:00Z") - Date.parse(`${brief.body.as_of}T00:00:00Z`)) / 86400000));
    assert.equal(brief.body.interaction_count, 1);

    await s.call("DELETE", `/api/facts/${second.body.fact.id}`);
    await s.agent("complete_reminder", { id: reminder.body.reminder.id });
    const refreshed = await s.call("GET", `/api/people/${id}/brief`);
    assert.equal(refreshed.status, 200);
    assert.deepEqual(refreshed.body.conflicting_facts, []);
    assert.equal(refreshed.body.facts.length, 1);
    assert.deepEqual(refreshed.body.open_reminders, []);
    assert.equal((await s.call("GET", "/api/people/nonexistent/brief")).status, 404);
  } finally {
    await s.stop();
  }
});
