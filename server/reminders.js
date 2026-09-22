// Reminders, optionally tied to a person. `kind` is a hint for the UI/agent
// (birthday/followup/custom); nothing here auto-creates birthday reminders —
// those are computed live in upcoming.js from the birthday field.
import { z } from "zod";
import { db, uid, now } from "./db.js";

export const REMINDER_KINDS = ["birthday", "followup", "custom"];
const dueField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.");

export const reminderInput = z.object({
  person_id: z.string().nullable().default(null),
  due: dueField,
  text: z.string().trim().min(1).max(2000),
  kind: z.enum(REMINDER_KINDS).default("custom"),
});
export const reminderPatch = z.object({
  due: dueField.optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  kind: z.enum(REMINDER_KINDS).optional(),
  done: z.boolean().optional(),
});

const row = (r) => (r ? { ...r, done: !!r.done } : null);

export function listReminders({ person_id, done, due_before, due_after } = {}) {
  const clauses = [];
  const params = [];
  if (person_id !== undefined) {
    clauses.push("person_id = ?");
    params.push(person_id);
  }
  if (done !== undefined) {
    clauses.push("done = ?");
    params.push(done ? 1 : 0);
  }
  if (due_before) {
    clauses.push("due <= ?");
    params.push(due_before);
  }
  if (due_after) {
    clauses.push("due >= ?");
    params.push(due_after);
  }
  const sql = `SELECT * FROM reminders${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY due`;
  return db().prepare(sql).all(...params).map(row);
}

export function getReminder(id) {
  return row(db().prepare("SELECT * FROM reminders WHERE id = ?").get(id));
}

export function createReminder(input) {
  const data = reminderInput.parse(input);
  if (data.person_id && !db().prepare("SELECT 1 FROM people WHERE id = ?").get(data.person_id))
    throw Object.assign(new Error("La persona no existe."), { status: 400 });
  const id = uid();
  db()
    .prepare("INSERT INTO reminders (id, person_id, due, text, done, kind, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .run(id, data.person_id, data.due, data.text, data.kind, now());
  return getReminder(id);
}

export function updateReminder(id, patch) {
  const current = getReminder(id);
  if (!current) return null;
  const data = reminderPatch.parse(patch);
  const next = { ...current, ...data };
  db().prepare("UPDATE reminders SET due = ?, text = ?, kind = ?, done = ? WHERE id = ?")
    .run(next.due, next.text, next.kind, next.done ? 1 : 0, id);
  return getReminder(id);
}

export function completeReminder(id) {
  return updateReminder(id, { done: true });
}

export function deleteReminder(id) {
  return db().prepare("DELETE FROM reminders WHERE id = ?").run(id).changes > 0;
}
