// The core module: people CRUD, fuzzy resolution/search, the hand-maintained
// FTS5 index and merge. Other domain modules (aliases, facts, interactions)
// import reindexPerson/recomputeLastContact from here; this module never
// imports them back, so there is no cycle.
import { z } from "zod";
import { db, uid, now, transaction } from "./db.js";
import { fold, ftsPrefixQuery } from "./text.js";
import { isValidBirthday, daysSince } from "./dates.js";

export const ALIAS_KINDS = ["whatsapp", "email", "phone", "handle", "other"];

const birthdayField = z
  .string()
  .refine(isValidBirthday, "Fecha no válida. Usa YYYY-MM-DD o --MM-DD si no sabes el año.")
  .nullable();

const personShape = {
  name: z.string().trim().min(1).max(120),
  nickname: z.string().trim().max(80),
  circles: z.array(z.string().trim().min(1).max(40)).max(30),
  birthday: birthdayField,
  location: z.string().trim().max(120),
  how_met: z.string().trim().max(2000),
  summary: z.string().trim().max(4000),
  notes: z.string().max(20000),
  contact_every_days: z.number().int().positive().max(3650).nullable(),
  last_contact_at: z.string().nullable(),
  archived: z.boolean(),
};
export const personInput = z.object({
  ...personShape,
  nickname: personShape.nickname.default(""),
  circles: personShape.circles.default([]),
  birthday: personShape.birthday.default(null),
  location: personShape.location.default(""),
  how_met: personShape.how_met.default(""),
  summary: personShape.summary.default(""),
  notes: personShape.notes.default(""),
  contact_every_days: personShape.contact_every_days.default(null),
  last_contact_at: personShape.last_contact_at.default(null),
  archived: personShape.archived.default(false),
});
// .partial() would keep the defaults above, so patches use the bare shape.
export const personPatch = z.object(personShape).partial();

const present = (r) =>
  r
    ? {
        ...r,
        circles: JSON.parse(r.circles || "[]"),
        archived: !!r.archived,
      }
    : null;

function rawPeople({ includeArchived = true } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM people ORDER BY name COLLATE NOCASE"
    : "SELECT * FROM people WHERE archived = 0 ORDER BY name COLLATE NOCASE";
  return db().prepare(sql).all().map(present);
}

export function getPerson(id) {
  if (!id) return null;
  return present(db().prepare("SELECT * FROM people WHERE id = ?").get(id));
}

// ---------- FTS5 upkeep ----------

function ftsBlobFor(id) {
  const p = db().prepare("SELECT name, nickname, summary, notes FROM people WHERE id = ?").get(id);
  if (!p) return null;
  const aliases = db().prepare("SELECT value FROM aliases WHERE person_id = ?").all(id).map((r) => r.value).join(" ");
  const facts = db().prepare("SELECT key, value FROM facts WHERE person_id = ?").all(id)
    .map((r) => `${r.key}: ${r.value}`).join(" · ");
  return { ...p, aliases, facts };
}

export function reindexPerson(id) {
  db().prepare("DELETE FROM people_fts WHERE person_id = ?").run(id);
  const blob = ftsBlobFor(id);
  if (!blob) return;
  db()
    .prepare(
      "INSERT INTO people_fts (person_id, name, nickname, aliases, summary, notes, facts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, blob.name, blob.nickname, blob.aliases, blob.summary, blob.notes, blob.facts);
}

/** Recompute a person's cached last_contact_at from their interactions. */
export function recomputeLastContact(personId) {
  const row = db().prepare("SELECT MAX(at) AS m FROM interactions WHERE person_id = ?").get(personId);
  db().prepare("UPDATE people SET last_contact_at = ?, updated_at = ? WHERE id = ?").run(row?.m || null, now(), personId);
}

// ---------- CRUD ----------

export function createPerson(input) {
  const data = personInput.parse(input);
  const id = uid();
  const ts = now();
  db()
    .prepare(
      `INSERT INTO people (id, name, nickname, circles, birthday, location, how_met, summary, notes, contact_every_days, last_contact_at, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      data.nickname,
      JSON.stringify(data.circles),
      data.birthday,
      data.location,
      data.how_met,
      data.summary,
      data.notes,
      data.contact_every_days,
      data.last_contact_at,
      data.archived ? 1 : 0,
      ts,
      ts,
    );
  reindexPerson(id);
  return getPerson(id);
}

export function updatePerson(id, patch) {
  const current = getPerson(id);
  if (!current) return null;
  const data = personPatch.parse(patch);
  const next = { ...current, ...data };
  db()
    .prepare(
      `UPDATE people SET name = ?, nickname = ?, circles = ?, birthday = ?, location = ?, how_met = ?, summary = ?, notes = ?,
       contact_every_days = ?, last_contact_at = ?, archived = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      next.name,
      next.nickname,
      JSON.stringify(next.circles),
      next.birthday,
      next.location,
      next.how_met,
      next.summary,
      next.notes,
      next.contact_every_days,
      next.last_contact_at,
      next.archived ? 1 : 0,
      now(),
      id,
    );
  reindexPerson(id);
  return getPerson(id);
}

export function deletePerson(id) {
  const changes = db().prepare("DELETE FROM people WHERE id = ?").run(id).changes;
  db().prepare("DELETE FROM people_fts WHERE person_id = ?").run(id);
  return changes > 0;
}

export function getPersonFull(id, { interactionsLimit = null } = {}) {
  const person = getPerson(id);
  if (!person) return null;
  const aliases = db().prepare("SELECT * FROM aliases WHERE person_id = ? ORDER BY created_at").all(id);
  const facts = db().prepare("SELECT * FROM facts WHERE person_id = ? ORDER BY created_at").all(id);
  let sql = "SELECT * FROM interactions WHERE person_id = ? ORDER BY at DESC";
  const params = [id];
  if (interactionsLimit) {
    sql += " LIMIT ?";
    params.push(interactionsLimit);
  }
  const interactions = db().prepare(sql).all(...params);
  const reminders = db().prepare("SELECT * FROM reminders WHERE person_id = ? ORDER BY done, due").all(id)
    .map((r) => ({ ...r, done: !!r.done }));
  return {
    ...person,
    aliases,
    facts,
    interactions,
    reminders,
    days_since_contact: daysSince(person.last_contact_at),
  };
}

// ---------- Listing / filtering ----------

export function listPeople({ q = "", circle = "", archived = "false" } = {}) {
  let rows = rawPeople({ includeArchived: true });
  if (archived === "false") rows = rows.filter((p) => !p.archived);
  else if (archived === "true") rows = rows.filter((p) => p.archived);
  // archived === "all" -> no filter

  if (circle) {
    const needle = fold(circle);
    rows = rows.filter((p) => p.circles.some((c) => fold(c) === needle));
  }

  if (q && q.trim()) {
    const ranked = findPeople(q, { limit: 500, includeArchived: true });
    const order = new Map(ranked.map((m, i) => [m.id, i]));
    rows = rows.filter((p) => order.has(p.id)).sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return rows;
}

/**
 * Fuzzy, accent-insensitive, partial-name search with scores. Combines a
 * fold-based substring pass over names/nicknames/aliases (which catches
 * mid-word partials FTS5's prefix matching cannot) with an FTS5 pass over
 * summary/notes/facts for broader recall.
 */
export function findPeople(query, { limit = 10, includeArchived = false } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const needle = fold(q);
  const pool = rawPeople({ includeArchived });
  const byId = new Map(pool.map((p) => [p.id, p]));
  const scored = new Map();
  const bump = (id, score) => {
    const cur = scored.get(id);
    if (!cur || cur < score) scored.set(id, score);
  };

  for (const p of pool) {
    const foldedName = fold(p.name);
    const foldedNick = p.nickname ? fold(p.nickname) : "";
    if (foldedName === needle) bump(p.id, 1);
    else if (foldedNick && foldedNick === needle) bump(p.id, 0.95);
    else if (foldedName.startsWith(needle)) bump(p.id, 0.8);
    else if (foldedNick && foldedNick.startsWith(needle)) bump(p.id, 0.78);
    else if (foldedName.includes(needle)) bump(p.id, 0.65);
    else if (foldedNick && foldedNick.includes(needle)) bump(p.id, 0.6);
  }

  const aliasRows = db().prepare("SELECT person_id, value FROM aliases").all();
  for (const a of aliasRows) {
    if (!byId.has(a.person_id)) continue;
    const foldedValue = fold(a.value);
    if (foldedValue === needle) bump(a.person_id, 0.9);
    else if (foldedValue.includes(needle)) bump(a.person_id, 0.55);
  }

  try {
    const matchQuery = ftsPrefixQuery(q);
    if (matchQuery) {
      const rows = db()
        .prepare("SELECT person_id FROM people_fts WHERE people_fts MATCH ? LIMIT ?")
        .all(matchQuery, limit * 4);
      for (const r of rows) if (byId.has(r.person_id)) bump(r.person_id, Math.max(scored.get(r.person_id) || 0, 0.4));
    }
  } catch {
    // Malformed FTS query (stray punctuation etc.) — the fold-based pass above still applies.
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const p = byId.get(id);
      return { id: p.id, name: p.name, nickname: p.nickname, circles: p.circles, summary: p.summary, score };
    });
}

/**
 * Resolve a reference to one person: id, then exact name (may be ambiguous
 * if two people share a name), then exact alias, then fuzzy search. Returns
 * { person, candidates } so callers can ask instead of guessing.
 */
export function resolvePersonRef(ref) {
  if (!ref) return { person: null, candidates: [] };
  const text = String(ref).trim();
  const byId = getPerson(text);
  if (byId) return { person: byId, candidates: [] };

  const exactMatches = db().prepare("SELECT * FROM people WHERE name = ? COLLATE NOCASE").all(text).map(present);
  if (exactMatches.length === 1) return { person: exactMatches[0], candidates: [] };
  if (exactMatches.length > 1) {
    return { person: null, candidates: exactMatches.map((p) => ({ id: p.id, name: p.name, nickname: p.nickname, circles: p.circles, score: 1 })) };
  }

  const aliasRow = db().prepare("SELECT person_id FROM aliases WHERE value = ? COLLATE NOCASE").get(text);
  if (aliasRow) {
    const p = getPerson(aliasRow.person_id);
    if (p) return { person: p, candidates: [] };
  }

  const candidates = findPeople(text, { limit: 5 });
  if (candidates.length === 1 && candidates[0].score >= 0.6) return { person: getPerson(candidates[0].id), candidates: [] };
  return { person: null, candidates };
}

/** upsert_person: by id or exact name; creates a new person when not found. */
export function upsertPerson(ref, patch = {}) {
  if (ref) {
    let person = getPerson(ref);
    if (!person) {
      const matches = db().prepare("SELECT * FROM people WHERE name = ? COLLATE NOCASE").all(ref).map(present);
      if (matches.length > 1) {
        throw Object.assign(new Error(`Hay varias personas llamadas "${ref}". Indica el id.`), {
          status: 400,
          candidates: matches.map((p) => ({ id: p.id, name: p.name, nickname: p.nickname, circles: p.circles })),
        });
      }
      person = matches[0] || null;
    }
    if (person) return { created: false, person: updatePerson(person.id, patch) };
  }
  const name = (patch.name || ref || "").toString().trim();
  if (!name) throw Object.assign(new Error("Falta el nombre para crear la persona."), { status: 400 });
  return { created: true, person: createPerson({ ...patch, name }) };
}

/** Merge dropId into keepId: linked rows move, circles are unioned, dropId is deleted. */
export function mergePeople(keepId, dropId) {
  if (keepId === dropId) throw Object.assign(new Error("Selecciona dos personas distintas."), { status: 400 });
  const keep = getPerson(keepId);
  const drop = getPerson(dropId);
  if (!keep || !drop) throw Object.assign(new Error("Persona no encontrada."), { status: 404 });
  return transaction(() => {
    db().prepare("UPDATE facts SET person_id = ? WHERE person_id = ?").run(keepId, dropId);
    db().prepare("UPDATE interactions SET person_id = ? WHERE person_id = ?").run(keepId, dropId);
    db().prepare("UPDATE reminders SET person_id = ? WHERE person_id = ?").run(keepId, dropId);
    const dropAliases = db().prepare("SELECT * FROM aliases WHERE person_id = ?").all(dropId);
    for (const a of dropAliases) {
      try {
        db().prepare("UPDATE aliases SET person_id = ? WHERE id = ?").run(keepId, a.id);
      } catch {
        // kind+value already used by keep (or another person) — drop the duplicate.
        db().prepare("DELETE FROM aliases WHERE id = ?").run(a.id);
      }
    }
    const circles = Array.from(new Set([...keep.circles, ...drop.circles]));
    db().prepare("UPDATE people SET circles = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(circles), now(), keepId);
    db().prepare("DELETE FROM people WHERE id = ?").run(dropId);
    db().prepare("DELETE FROM people_fts WHERE person_id = ?").run(dropId);
    recomputeLastContact(keepId);
    reindexPerson(keepId);
    return getPerson(keepId);
  });
}

export function circleCounts() {
  const counts = new Map();
  for (const p of rawPeople({ includeArchived: false })) {
    for (const c of p.circles) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
}
