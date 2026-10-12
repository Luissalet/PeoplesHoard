// What the shared Faustus copilot asks this app for: the real objects open in the current view, the unsaved form fields,
// and a way to refresh the open view when the assistant finishes a turn. Nothing here renders anything.
import { api } from "./api.js";

const EVENT = "people:context-request";
const EDITOR_ORDER = { "person-form": 0, "commitment-form": 0, "person-summary": 0, "person-notes": 0 };
const MAX_FACTS = 10;
const MAX_REMINDERS = 8;
const MAX_COMMITMENTS = 8;
const MAX_GIFTS = 6;

// ---- partial saves -----------------------------------------------------------------------------------------------------

// Fields of `draft` whose value differs from `initial` (compared as JSON, so a cleared text counts as a change).
export function changedFields(initial, draft) {
  const base = initial || {};
  return Object.fromEntries(Object.entries(draft || {}).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])));
}

// A refreshed baseline arrives while the user is editing: fields the user did not touch follow the new baseline, touched ones stay.
export function rebaseForm(previousBase, nextBase, form) {
  const out = { ...nextBase };
  for (const key of Object.keys(form)) {
    if (JSON.stringify(form[key]) !== JSON.stringify(previousBase?.[key])) out[key] = form[key];
  }
  return out;
}

// ---- route and context --------------------------------------------------------------------------------------------------

export function parseRoute(hash) {
  const [path, query = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { page: parts[0] || "personas", param: parts[1] || null, query: new URLSearchParams(query) };
}

// Every mounted page and open form answers this event: `editor(snapshot)` for a form ({ kind, object_id, dirty, fields }),
// `view(partial)` for what the page shows (filters, window).
export function collectContext(target = globalThis.window) {
  const editors = [];
  const view = {};
  if (!target?.dispatchEvent) return { editors, view };
  target.dispatchEvent(new CustomEvent(EVENT, {
    detail: {
      editor: (snapshot) => { if (snapshot) editors.push(snapshot); },
      view: (partial) => { if (partial && typeof partial === "object") Object.assign(view, partial); },
    },
  }));
  editors.sort((a, b) => (EDITOR_ORDER[a.kind] ?? 9) - (EDITOR_ORDER[b.kind] ?? 9));
  return { editors, view };
}

// Answer the context request: `getter()` returns { editors?: [snapshot|null], view?: {...} } and is read at ask time.
export function registerProvider(getter, target = globalThis.window) {
  if (!target?.addEventListener) return () => {};
  const handler = (event) => {
    let out = null;
    try { out = getter(); } catch { out = null; }
    if (!out) return;
    for (const snapshot of out.editors || []) if (snapshot) event.detail.editor(snapshot);
    if (out.view) event.detail.view(out.view);
  };
  target.addEventListener(EVENT, handler);
  return () => target.removeEventListener(EVENT, handler);
}

const pick = (source, keys) => Object.fromEntries(keys.filter((k) => source?.[k] !== undefined && source[k] !== null && source[k] !== "").map((k) => [k, source[k]]));
const clip = (text, n) => (typeof text === "string" && text.length > n ? `${text.slice(0, n)}...` : text);

export const personObject = (p) => ({
  kind: "person", object_id: p.id, title: p.name,
  ...pick(p, ["nickname", "birthday", "location", "contact_every_days", "days_since_contact"]),
  ...(p.circles?.length ? { circles: p.circles } : {}),
  ...(p.archived ? { archived: true } : {}),
  ...(p.summary ? { summary: clip(p.summary, 400) } : {}),
  ...(Array.isArray(p.facts) ? { facts: p.facts.length } : {}),
  ...(Array.isArray(p.aliases) ? { aliases: p.aliases.length } : {}),
  ...(Array.isArray(p.interactions) ? { interactions: p.interactions.length } : {}),
  ...(Array.isArray(p.reminders) ? { open_reminders: p.reminders.filter((r) => !r.done).length } : {}),
});
export const factObject = (f, personId) => ({ kind: "fact", object_id: f.id, title: f.key, value: clip(f.value, 200), person_id: personId });
export const reminderObject = (r, personId) => ({ kind: "reminder", object_id: r.id, title: r.text, ...pick(r, ["due"]), ...(r.kind ? { reminder_kind: r.kind } : {}), person_id: personId });
export const commitmentObject = (c) => ({
  kind: "commitment", object_id: c.id, title: c.text,
  ...pick(c, ["direction", "status", "due", "person_id", "person_name"]),
  ...(c.overdue ? { overdue: true } : {}),
  ...(c.source?.kind ? { source_kind: c.source.kind } : {}),
});
export const giftObject = (g) => ({ kind: "gift", object_id: g.id, title: g.idea, ...pick(g, ["status", "budget", "person_id"]), ...(g.watched ? { watched: true } : {}) });

async function safe(fn) {
  try { return await fn(); } catch { return null; }
}

// Pure core (dependencies injected so it can be tested): never throws; unknown or "new" ids yield no object.
export async function buildContext({ hash, editors = [], view: viewInfo = {}, getPerson, getCommitment, listCommitments, listGifts }) {
  const route = parseRoute(hash);
  const known = { personas: route.param ? "person" : "people", agenda: "agenda", compromisos: "commitments", ajustes: "settings" };
  const page = known[route.page] || "people";
  const active = [];
  const seen = new Set();
  const add = (object) => { if (!object?.object_id) return; const key = `${object.kind}:${object.object_id}`; if (!seen.has(key)) { seen.add(key); active.push(object); } };
  const realId = (id) => (id && id !== "new" ? String(id) : null);

  const view = { page };

  if (page === "person") {
    const id = realId(route.param);
    const person = id ? await safe(() => getPerson(id)) : null;
    if (person?.id) {
      view.object_id = person.id;
      add(personObject(person));
      for (const f of (person.facts || []).slice(0, MAX_FACTS)) add(factObject(f, person.id));
      for (const r of (person.reminders || []).filter((x) => !x.done).slice(0, MAX_REMINDERS)) add(reminderObject(r, person.id));
      const open = await safe(() => listCommitments({ person: person.id, status: "open" }));
      for (const c of (open?.commitments || []).slice(0, MAX_COMMITMENTS)) add(commitmentObject(c));
      const gifts = await safe(() => listGifts({ person: person.id, status: "idea" }));
      for (const g of (gifts?.gifts || []).slice(0, MAX_GIFTS)) add(giftObject(g));
    }
  }

  if (page === "people" && viewInfo.filters && Object.keys(viewInfo.filters).length) view.filters = viewInfo.filters;
  if (page === "agenda" && viewInfo.days != null) view.days = viewInfo.days;

  if (page === "commitments") {
    if (viewInfo.filters && Object.keys(viewInfo.filters).length) view.filters = viewInfo.filters;
    if (viewInfo.review_count != null) view.review_count = viewInfo.review_count;
    const who = realId(viewInfo.filters?.person);
    if (who) { const person = await safe(() => getPerson(who)); if (person?.id) add(personObject(person)); }
  }

  // Objects behind the open forms (an edit form names its object; a creation form names none).
  for (const e of editors) {
    const id = realId(e.object_id);
    if (!id) continue;
    if (e.kind === "commitment-form") { const c = await safe(() => getCommitment(id)); if (c?.id) add(commitmentObject(c)); }
  }

  const editor = editors.find((e) => e.dirty) || editors[0];
  if (editor) view.editor = editor;
  if (editors.length > 1) view.editors = editors;
  return { active_objects: active, view };
}

export function context() {
  const { editors, view } = collectContext();
  return buildContext({
    hash: globalThis.window?.location?.hash,
    editors,
    view,
    getPerson: (id) => api.people.get(id),
    getCommitment: (id) => api.commitments.get(id),
    listCommitments: (filter) => api.commitments.list(filter),
    listGifts: (filter) => api.gifts.list(filter),
  });
}

// ---- refresh when the assistant finishes a turn --------------------------------------------------------------------------
const refreshers = new Set();
let timer = null;

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const fn of [...refreshers]) { try { fn(); } catch { /* a refresh must never break the page */ } }
  }, 250);
}

// A page registers what "reload what is on screen" means (it keeps the forms the user is editing untouched).
export function subscribeRefresh(fn) {
  refreshers.add(fn);
  return () => refreshers.delete(fn);
}

export const onTurnEnd = () => scheduleRefresh();

// Once at start: the object the launcher looks for, and the window event it dispatches on turn end (the debounce merges the two).
export function installCopilot(target = globalThis.window) {
  if (!target || target.hoardCopilot) return;
  target.hoardCopilot = { context, onTurnEnd };
  target.addEventListener("hoard:copilot-turn-end", scheduleRefresh);
}
