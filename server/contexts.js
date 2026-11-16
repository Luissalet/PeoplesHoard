// Contextos: una ficha viva por persona o por grupo (la casa, el equipo, los del pádel) donde se apuntan las cosas que no
// conviene olvidar: ideas de regalo y lista de deseos, planes con fecha y aviso con antelación, pendientes y promesas,
// gustos y lugares candidatos. La captura rápida (`capture`) acepta solo el texto y busca o crea el contexto, para que
// Faustus, el MCP o el propio WhatsApp puedan apuntar una idea en el momento en que surge.
import { z } from "zod";
import { db, uid, now, transaction } from "./db.js";
import { getPerson, resolvePersonRef } from "./people.js";
import { parseBirthday, nextBirthday, today as todayLocal, daysBetween, daysSince } from "./dates.js";
import { listPersonDates, nextOccurrence } from "./person-dates.js";
import { listCommitments } from "./commitments.js";

export const CONTEXT_KINDS = ["person", "group"];
export const ITEM_KINDS = ["idea", "wish", "plan", "pending", "taste", "place", "note"];
export const ITEM_STATUSES = ["open", "done", "dropped"];
export const ITEM_KIND_LABELS = {
  idea: "Idea de regalo",
  wish: "Lista de deseos",
  plan: "Plan",
  pending: "Pendiente",
  taste: "Gusto",
  place: "Lugar",
  note: "Nota",
};
export const DEFAULT_REMIND_DAYS = 21;

const fail = (message, opts = {}) => { throw Object.assign(new Error(message), { status: 400, ...opts }); };

const dayField = z.string().trim().refine((v) => parseBirthday(v)?.year != null, "Fecha no válida. Usa AAAA-MM-DD.");

export const contextInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(CONTEXT_KINDS).default("group"),
  person: z.string().trim().min(1).max(200).optional(),
  people: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
  notes: z.string().max(4000).default(""),
});
export const contextPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).optional(),
  people: z.array(z.string().trim().min(1).max(200)).max(60).optional(),
});

export const itemInput = z.object({
  kind: z.enum(ITEM_KINDS).default("note"),
  text: z.string().trim().min(1).max(500),
  url: z.string().trim().max(2000).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "La dirección debe empezar por http:// o https://.").default(""),
  budget: z.number().nonnegative().max(1e9).nullable().default(null),
  due: dayField.nullable().default(null),
  remind_days_before: z.number().int().min(0).max(365).nullable().default(null),
  source: z.string().trim().max(40).default("manual"),
});
export const itemPatch = z.object({
  kind: z.enum(ITEM_KINDS).optional(),
  text: z.string().trim().min(1).max(500).optional(),
  url: itemInput.shape.url.optional(),
  budget: z.number().nonnegative().max(1e9).nullable().optional(),
  due: dayField.nullable().optional(),
  remind_days_before: z.number().int().min(0).max(365).nullable().optional(),
  status: z.enum(ITEM_STATUSES).optional(),
});

export const contextRef = (id) => `hoard://people/context/${id}`;
export const itemRef = (id) => `hoard://people/context-item/${id}`;

// ------------------------------------------------------------------ contexts --

const presentContext = (row) => row && {
  id: row.id, name: row.name, kind: row.kind, person_id: row.person_id || null,
  person_name: row.person_id ? getPerson(row.person_id)?.name || "" : "",
  notes: row.notes, awaiting_reply_since: row.awaiting_reply_since || null,
  ref: contextRef(row.id), created_at: row.created_at, updated_at: row.updated_at,
};

const presentItem = (row) => row && {
  id: row.id, context_id: row.context_id, kind: row.kind, text: row.text, url: row.url,
  budget: row.budget, due: row.due || null, remind_days_before: row.remind_days_before,
  status: row.status, source: row.source, ref: itemRef(row.id),
  created_at: row.created_at, updated_at: row.updated_at, done_at: row.done_at || null,
};

export const getContext = (id) => presentContext(db().prepare("SELECT * FROM contexts WHERE id = ?").get(id));
export const getItem = (id) => presentItem(db().prepare("SELECT * FROM context_items WHERE id = ?").get(id));

export function contextMembers(contextId) {
  return db().prepare(`SELECT p.id, p.name, p.nickname FROM context_members m JOIN people p ON p.id = m.person_id
    WHERE m.context_id = ? ORDER BY p.name COLLATE NOCASE`).all(contextId);
}

function setMembers(contextId, refs) {
  db().prepare("DELETE FROM context_members WHERE context_id = ?").run(contextId);
  for (const ref of refs) {
    const { person, candidates } = resolvePersonRef(ref);
    if (!person) {
      if (candidates.length) fail(`No sé a quién te refieres con "${ref}". ¿Es alguna de estas personas?`, { candidates });
      fail(`No encuentro a "${ref}" en la agenda.`);
    }
    db().prepare("INSERT OR IGNORE INTO context_members (context_id, person_id) VALUES (?, ?)").run(contextId, person.id);
  }
}

/** The context of a person, created the first time it is needed. */
export function ensurePersonContext(personId) {
  const person = getPerson(personId);
  if (!person) fail("La persona no existe.");
  const existing = db().prepare("SELECT * FROM contexts WHERE person_id = ?").get(personId);
  if (existing) return presentContext(existing);
  const id = uid();
  const ts = now();
  db().prepare("INSERT INTO contexts (id, name, kind, person_id, notes, created_at, updated_at) VALUES (?, ?, 'person', ?, '', ?, ?)")
    .run(id, person.name, personId, ts, ts);
  return getContext(id);
}

export function createContext(input) {
  const data = contextInput.parse(input);
  if (data.kind === "person") {
    if (!data.person) fail("Un contexto de persona necesita a quién pertenece (person).");
    const { person, candidates } = resolvePersonRef(data.person);
    if (!person) {
      if (candidates.length) fail(`No sé a quién te refieres con "${data.person}". ¿Es alguna de estas personas?`, { candidates });
      fail(`No encuentro a "${data.person}" en la agenda.`);
    }
    const context = ensurePersonContext(person.id);
    if (data.notes) updateContext(context.id, { notes: data.notes });
    return { created: false, context: getContext(context.id) };
  }
  const same = db().prepare("SELECT * FROM contexts WHERE kind = 'group' AND name = ? COLLATE NOCASE").get(data.name);
  if (same) return { created: false, context: presentContext(same) };
  const id = uid();
  const ts = now();
  transaction(() => {
    db().prepare("INSERT INTO contexts (id, name, kind, person_id, notes, created_at, updated_at) VALUES (?, ?, 'group', NULL, ?, ?, ?)")
      .run(id, data.name, data.notes, ts, ts);
    setMembers(id, data.people);
  });
  return { created: true, context: getContext(id) };
}

export function updateContext(id, patch) {
  const current = getContext(id);
  if (!current) return null;
  const data = contextPatch.parse(patch);
  transaction(() => {
    const next = { ...current, ...data };
    db().prepare("UPDATE contexts SET name = ?, notes = ?, updated_at = ? WHERE id = ?").run(next.name, next.notes, now(), id);
    if (data.people) setMembers(id, data.people);
  });
  return getContext(id);
}

export const deleteContext = (id) => db().prepare("DELETE FROM contexts WHERE id = ?").run(id).changes > 0;

/** Contexts with how much is open in each, newest activity first. */
export function listContexts({ q = "", kind = "", limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (kind) {
    if (!CONTEXT_KINDS.includes(kind)) fail("kind debe ser person o group.");
    where.push("kind = ?");
    params.push(kind);
  }
  if (q) { where.push("name LIKE ?"); params.push(`%${q}%`); }
  const rows = db().prepare(`SELECT * FROM contexts${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC LIMIT ?`).all(...params, Math.max(1, Math.min(1000, Number(limit) || 200)));
  const counts = new Map(db().prepare("SELECT context_id, COUNT(*) AS n FROM context_items WHERE status = 'open' GROUP BY context_id")
    .all().map((r) => [r.context_id, r.n]));
  return rows.map((row) => ({ ...presentContext(row), open_items: counts.get(row.id) || 0, members: contextMembers(row.id) }));
}

/** Resolve a context by id, exact name, or the name of the person it belongs to. */
export function resolveContextRef(ref) {
  if (!ref) return { context: null, candidates: [] };
  const text = String(ref).trim();
  const byId = getContext(text);
  if (byId) return { context: byId, candidates: [] };
  const exact = db().prepare("SELECT * FROM contexts WHERE name = ? COLLATE NOCASE").all(text).map(presentContext);
  if (exact.length === 1) return { context: exact[0], candidates: [] };
  if (exact.length > 1) return { context: null, candidates: exact };
  const { person, candidates } = resolvePersonRef(text);
  if (person) return { context: ensurePersonContext(person.id), candidates: [] };
  const like = db().prepare("SELECT * FROM contexts WHERE name LIKE ? ORDER BY name COLLATE NOCASE LIMIT 5").all(`%${text}%`).map(presentContext);
  if (like.length === 1) return { context: like[0], candidates: [] };
  return { context: null, candidates: like.length ? like : candidates };
}

// --------------------------------------------------------------------- items --

export function listItems({ context_id, kind, status = "open", limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (context_id) { where.push("context_id = ?"); params.push(context_id); }
  if (kind) {
    if (!ITEM_KINDS.includes(kind)) fail(`kind debe ser ${ITEM_KINDS.join(", ")}.`);
    where.push("kind = ?");
    params.push(kind);
  }
  if (status && status !== "all") {
    if (!ITEM_STATUSES.includes(status)) fail("status debe ser open, done, dropped o all.");
    where.push("status = ?");
    params.push(status);
  }
  return db().prepare(`SELECT * FROM context_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(due, '9999-12-31'), created_at DESC LIMIT ?`)
    .all(...params, Math.max(1, Math.min(2000, Number(limit) || 500))).map(presentItem);
}

/** The same open item (same kind and text, case aside) in the same context is not saved twice. */
export function addItem(contextId, input) {
  if (!getContext(contextId)) fail("El contexto no existe.");
  const data = itemInput.parse(input);
  const same = db().prepare("SELECT * FROM context_items WHERE context_id = ? AND kind = ? AND status = 'open' AND text = ? COLLATE NOCASE")
    .get(contextId, data.kind, data.text);
  if (same) return { created: false, item: presentItem(same) };
  const id = uid();
  const ts = now();
  db().prepare(`INSERT INTO context_items (id, context_id, kind, text, url, budget, due, remind_days_before, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .run(id, contextId, data.kind, data.text, data.url, data.budget, data.due, data.remind_days_before, data.source, ts, ts);
  db().prepare("UPDATE contexts SET updated_at = ? WHERE id = ?").run(ts, contextId);
  return { created: true, item: getItem(id) };
}

export function updateItem(id, patch) {
  const current = getItem(id);
  if (!current) return null;
  const data = itemPatch.parse(patch);
  const next = { ...current, ...data };
  const doneAt = next.status === "done" ? current.done_at || now() : null;
  db().prepare(`UPDATE context_items SET kind = ?, text = ?, url = ?, budget = ?, due = ?, remind_days_before = ?, status = ?,
    done_at = ?, updated_at = ? WHERE id = ?`)
    .run(next.kind, next.text, next.url, next.budget, next.due, next.remind_days_before, next.status, doneAt, now(), id);
  db().prepare("UPDATE contexts SET updated_at = ? WHERE id = ?").run(now(), current.context_id);
  return getItem(id);
}

export const deleteItem = (id) => db().prepare("DELETE FROM context_items WHERE id = ?").run(id).changes > 0;

/**
 * Quick capture: only the text is required. `person` or `context` says where it goes (a person's context is created the
 * first time); without either it lands in the "Sin asignar" context, so nothing is lost and it can be filed later.
 */
export function capture(input) {
  const data = z.object({
    text: z.string().trim().min(1).max(500),
    kind: z.enum(ITEM_KINDS).default("idea"),
    person: z.string().trim().min(1).max(200).optional(),
    context: z.string().trim().min(1).max(200).optional(),
    url: itemInput.shape.url.optional(),
    budget: z.number().nonnegative().max(1e9).nullable().optional(),
    due: dayField.nullable().optional(),
    remind_days_before: z.number().int().min(0).max(365).nullable().optional(),
    source: z.string().trim().max(40).default("manual"),
  }).parse(input);
  let context;
  if (data.context) {
    const found = resolveContextRef(data.context);
    if (!found.context) {
      if (found.candidates.length) fail(`No sé a qué contexto te refieres con "${data.context}". ¿Es alguno de estos?`, { candidates: found.candidates });
      fail(`No encuentro el contexto "${data.context}".`);
    }
    context = found.context;
  } else if (data.person) {
    const { person, candidates } = resolvePersonRef(data.person);
    if (!person) {
      if (candidates.length) fail(`No sé a quién te refieres con "${data.person}". ¿Es alguna de estas personas?`, { candidates });
      fail(`No encuentro a "${data.person}" en la agenda.`);
    }
    context = ensurePersonContext(person.id);
  } else {
    context = inboxContext();
  }
  const out = addItem(context.id, {
    kind: data.kind, text: data.text, url: data.url || "", budget: data.budget ?? null,
    due: data.due ?? null, remind_days_before: data.remind_days_before ?? null, source: data.source,
  });
  return { ...out, context: getContext(context.id) };
}

export const INBOX_NAME = "Sin asignar";

/** Where a capture without a person or a context goes. */
export function inboxContext() {
  const existing = db().prepare("SELECT * FROM contexts WHERE kind = 'group' AND name = ? COLLATE NOCASE").get(INBOX_NAME);
  if (existing) return presentContext(existing);
  const id = uid();
  const ts = now();
  db().prepare("INSERT INTO contexts (id, name, kind, person_id, notes, created_at, updated_at) VALUES (?, ?, 'group', NULL, '', ?, ?)")
    .run(id, INBOX_NAME, ts, ts);
  return getContext(id);
}

// ---------------------------------------------------------------------- card --

const whenWords = (n) => (n === 0 ? "hoy" : n === 1 ? "mañana" : `en ${n} días`);

/**
 * The living card of one context: what is open grouped by kind, what is done, the next birthday and special dates of its
 * person, the open commitments both ways and how long since the last contact.
 */
export function contextCard(id, { today = todayLocal(), baseUrl = "" } = {}) {
  const context = getContext(id);
  if (!context) return null;
  const items = listItems({ context_id: id, status: "all", limit: 2000 });
  const open = items.filter((i) => i.status === "open");
  const groups = {};
  for (const kind of ITEM_KINDS) groups[kind] = open.filter((i) => i.kind === kind);
  const person = context.person_id ? getPerson(context.person_id) : null;
  const dates = [];
  if (person) {
    if (person.birthday) {
      const next = nextBirthday(person.birthday, today);
      if (next) dates.push({ kind: "birthday", label: "Cumpleaños", date: next.date, days_until: next.daysUntil, years: next.turningAge });
    }
    for (const row of listPersonDates(person.id)) {
      const next = nextOccurrence(row, today);
      if (next) dates.push({ kind: "date", label: row.label, date: next.date, days_until: next.days_until, years: next.years });
    }
    dates.sort((a, b) => a.days_until - b.days_until);
  }
  const commitments = person ? listCommitments({ person: person.id, status: "open", today, limit: 200 }) : [];
  return {
    context,
    members: contextMembers(id),
    person: person ? { id: person.id, name: person.name, nickname: person.nickname, birthday: person.birthday,
      last_contact_at: person.last_contact_at, days_since_contact: daysSince(person.last_contact_at, today) } : null,
    items: groups,
    open_count: open.length,
    done: items.filter((i) => i.status !== "open"),
    dates,
    commitments,
    awaiting_reply_since: context.awaiting_reply_since,
    awaiting_reply_days: context.awaiting_reply_since ? daysSince(context.awaiting_reply_since, today) : null,
    url: baseUrl ? `${baseUrl}/#/contextos/${id}` : "",
  };
}

/** "No has contestado a…": the day a reply is owed, or null to clear it. */
export function setAwaitingReply(id, since) {
  const context = getContext(id);
  if (!context) return null;
  const day = since ? dayField.parse(since) : null;
  db().prepare("UPDATE contexts SET awaiting_reply_since = ?, updated_at = ? WHERE id = ?").run(day, now(), id);
  return getContext(id);
}

// ------------------------------------------------------------------ reminders --

/**
 * Items whose reminder window is open: a plan or a pending thing with a day, from `remind_days_before` days before it
 * (21 by default) until it is done or dropped. Soonest first.
 */
export function upcomingContextItems({ today = todayLocal(), days = 60 } = {}) {
  const window = Math.max(0, Math.min(366, Number(days) || 0));
  const rows = db().prepare(`SELECT i.*, c.name AS context_name, c.person_id AS person_id FROM context_items i
    JOIN contexts c ON c.id = i.context_id WHERE i.status = 'open' AND i.due IS NOT NULL`).all();
  const out = [];
  for (const row of rows) {
    const daysUntil = daysBetween(today, row.due);
    if (daysUntil === null) continue;
    const lead = row.remind_days_before === null || row.remind_days_before === undefined ? DEFAULT_REMIND_DAYS : row.remind_days_before;
    if (daysUntil > Math.max(window, lead)) continue;
    out.push({ ...presentItem(row), context_name: row.context_name, person_id: row.person_id || null,
      days_until: daysUntil, remind_days_before: lead, remind_now: daysUntil <= lead });
  }
  return out.sort((a, b) => a.days_until - b.days_until || a.text.localeCompare(b.text, "es"));
}

/** The lines the daily digest carries for contexts: a plan or a pending thing inside its reminder window, once each. */
export function contextNudgeItems({ today = todayLocal(), baseUrl = "" } = {}) {
  const items = [];
  for (const item of upcomingContextItems({ today, days: 366 })) {
    if (!item.remind_now) continue;
    const what = ITEM_KIND_LABELS[item.kind] || "Pendiente";
    const when = item.days_until < 0 ? `venció hace ${-item.days_until} ${-item.days_until === 1 ? "día" : "días"}` : whenWords(item.days_until);
    items.push({
      key: `context:${item.id}:${item.due}`,
      kind: "context",
      person_id: item.person_id,
      title: `${what} · ${item.context_name}: ${item.text} (${when})`.slice(0, 200),
      url: baseUrl ? `${baseUrl}/#/contextos/${item.context_id}` : "",
    });
  }
  for (const row of db().prepare("SELECT * FROM contexts WHERE awaiting_reply_since IS NOT NULL").all()) {
    const context = presentContext(row);
    const days = daysSince(row.awaiting_reply_since, today);
    if (days === null) continue;
    items.push({
      key: `context-reply:${context.id}:${row.awaiting_reply_since}`,
      kind: "context",
      person_id: context.person_id,
      title: `Sin contestar a ${context.name} desde hace ${days} ${days === 1 ? "día" : "días"}`.slice(0, 200),
      url: baseUrl ? `${baseUrl}/#/contextos/${context.id}` : "",
    });
  }
  return items;
}

/** Plans with a day, for the family agenda (the hub's "Hoy" and the calendar export). */
export function agendaContextItems(from, to, { today = todayLocal(), baseUrl = "" } = {}) {
  const out = [];
  for (const item of upcomingContextItems({ today, days: 366 })) {
    if (item.kind !== "plan" && item.kind !== "pending") continue;
    const day = item.due >= from ? item.due : from <= today ? from : null;
    if (!day || day > to) continue;
    out.push({
      id: `people:context:${item.id}`, title: `${item.text} (${item.context_name})`, start: day, all_day: true,
      kind: "other", priority: item.due < today ? "high" : "normal",
      url: baseUrl ? `${baseUrl}/#/contextos/${item.context_id}` : "",
      detail: item.due < day ? `Era para el ${item.due}` : "",
    });
  }
  return out;
}

/** Kept for the export/import round trip: every context with its items. */
export function exportContexts() {
  const contexts = db().prepare("SELECT * FROM contexts ORDER BY created_at").all().map(presentContext);
  const items = db().prepare("SELECT * FROM context_items ORDER BY created_at").all().map(presentItem);
  const members = db().prepare("SELECT * FROM context_members").all();
  return { contexts, items, members };
}

/**
 * Restore contexts from a backup. `idMap` maps the old person ids to the new ones (the import creates people again); a
 * person's context is reused when it already exists, so importing twice does not duplicate cards.
 */
export function importContexts(data, idMap) {
  let importedContexts = 0;
  let importedItems = 0;
  const contextMap = new Map();
  for (const c of data.contexts || []) {
    const personId = c.person_id ? idMap.get(c.person_id) || null : null;
    let context;
    if (personId) {
      context = ensurePersonContext(personId);
      if (c.notes) updateContext(context.id, { notes: c.notes });
    } else {
      const created = createContext({ name: c.name, kind: "group", notes: c.notes || "" });
      context = created.context;
    }
    contextMap.set(c.id, context.id);
    if (c.awaiting_reply_since) setAwaitingReply(context.id, c.awaiting_reply_since);
    importedContexts++;
  }
  for (const m of data.members || []) {
    const contextId = contextMap.get(m.context_id);
    const personId = idMap.get(m.person_id);
    if (!contextId || !personId) continue;
    db().prepare("INSERT OR IGNORE INTO context_members (context_id, person_id) VALUES (?, ?)").run(contextId, personId);
  }
  for (const i of data.items || []) {
    const contextId = contextMap.get(i.context_id);
    if (!contextId) continue;
    try {
      const added = addItem(contextId, {
        kind: i.kind, text: i.text, url: i.url || "", budget: i.budget ?? null, due: i.due || null,
        remind_days_before: i.remind_days_before ?? null, source: i.source || "manual",
      });
      if (added.created && i.status && i.status !== "open") updateItem(added.item.id, { status: i.status });
      importedItems++;
    } catch {
      // an entry that does not validate is skipped rather than failing the whole import
    }
  }
  return { contexts: importedContexts, items: importedItems };
}

