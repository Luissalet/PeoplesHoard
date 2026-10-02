// Who is probably the same person twice: similar names (the family's nameSimilarity: word sets, initials), the same e-mail or
// phone under another spelling (handles.js), the same birthday. It only suggests; merge_people does the merge after the user agrees.
import { db } from "./db.js";
import { nameSimilarity, tokens } from "./hoard-commons/text.js";
import { ensureNorms } from "./handles.js";

const COMMON_TOKEN_LIMIT = 40; // a word shared by more people than this ("de", "garcia") does not pair people on its own

/** @returns {{ pairs: Array, scanned: number }} pairs sorted by score, best first. */
export function findDuplicatePeople({ minScore = 0.7, limit = 20, includeArchived = false } = {}) {
  ensureNorms();
  const rows = db().prepare(
    `SELECT id, name, nickname, birthday, archived, created_at FROM people ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY created_at, id`).all();
  const byId = new Map(rows.map((p) => [p.id, { ...p, handles: [], facts: 0, interactions: 0 }]));
  for (const a of db().prepare("SELECT person_id, kind, value, norm FROM aliases WHERE norm IS NOT NULL AND norm <> ''").all()) {
    if (a.kind !== "email" && a.kind !== "phone" && a.kind !== "whatsapp") continue;
    byId.get(a.person_id)?.handles.push({ kind: a.kind, norm: a.norm, value: a.value });
  }
  for (const r of db().prepare("SELECT person_id, COUNT(*) AS n FROM facts GROUP BY person_id").all()) if (byId.has(r.person_id)) byId.get(r.person_id).facts = r.n;
  for (const r of db().prepare("SELECT person_id, COUNT(*) AS n FROM interactions GROUP BY person_id").all()) if (byId.has(r.person_id)) byId.get(r.person_id).interactions = r.n;

  // candidate pairs: people sharing a word of the name, or a handle
  const pairKeys = new Set();
  const add = (a, b) => { if (a !== b) pairKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`); };
  const byToken = new Map();
  const byHandle = new Map();
  for (const p of byId.values()) {
    for (const t of new Set([...tokens(p.name), ...tokens(p.nickname)])) {
      if (t.length < 2) continue;
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(p.id);
    }
    for (const h of p.handles) {
      const key = `${h.kind === "email" ? "email" : "phone"}:${h.norm}`;
      if (!byHandle.has(key)) byHandle.set(key, []);
      byHandle.get(key).push(p.id);
    }
  }
  for (const ids of byToken.values()) {
    if (ids.length > COMMON_TOKEN_LIMIT) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j]);
  }
  for (const ids of byHandle.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j]);

  const pairs = [];
  for (const key of pairKeys) {
    const [ida, idb] = key.split("|");
    const a = byId.get(ida);
    const b = byId.get(idb);
    const reasons = [];
    let score = Math.max(
      nameSimilarity(a.name, b.name),
      a.nickname ? nameSimilarity(a.nickname, b.name) : 0,
      b.nickname ? nameSimilarity(a.name, b.nickname) : 0,
    );
    if (score >= 1) reasons.push("mismo nombre");
    else if (score > 0) reasons.push(`nombre parecido (${score.toFixed(2)})`);
    const shared = a.handles.filter((h) => b.handles.some((o) => o.norm === h.norm && (o.kind === "email") === (h.kind === "email")));
    for (const h of shared) reasons.push(`${h.kind === "email" ? "mismo correo" : "mismo teléfono"}: ${h.value}`);
    if (shared.length) score = 1;
    if (a.birthday && a.birthday === b.birthday && score >= 0.5) { reasons.push(`mismo cumpleaños (${a.birthday})`); score = Math.min(1, score + 0.2); }
    if (score < minScore) continue;
    const weight = (p) => p.interactions * 2 + p.facts;
    const keep = weight(b) > weight(a) ? b : a; // the entry with more history; the older one on a tie
    pairs.push({
      score: Math.round(score * 100) / 100,
      reasons,
      a: { id: a.id, name: a.name, nickname: a.nickname, birthday: a.birthday, facts: a.facts, interactions: a.interactions },
      b: { id: b.id, name: b.name, nickname: b.nickname, birthday: b.birthday, facts: b.facts, interactions: b.interactions },
      suggested_keep_id: keep.id,
      suggested_drop_id: keep.id === a.id ? b.id : a.id,
    });
  }
  pairs.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
  return { pairs: pairs.slice(0, Math.max(1, limit)), total: pairs.length, scanned: byId.size };
}
