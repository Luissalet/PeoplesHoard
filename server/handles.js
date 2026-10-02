// How a contact handle (e-mail, phone, WhatsApp name, other) is compared. The rules are the family's (hoard-commons/text.js:
// normalizeEmail drops "+tag" and Gmail dots, normalizePhone gives "+34600111222"); this module only decides which one applies to
// which kind of alias. Aliases keep the value as the person typed it and a `norm` column with the comparison key. Rows written
// before that column existed are filled in the first time they are looked at (ensureNorms), so old data stays findable.
import { db } from "./db.js";
import { normalizeEmail, normalizePhone, fold } from "./hoard-commons/text.js";

const PHONE_LIKE = /^\+?[\d\s().-]{6,}$/;

/** The comparison key of a handle: "Marta.Lozano+news@Example.test" -> "marta.lozano@example.test", "600 11 22 33" -> "+34600112233". */
export function normalizeHandle(kind, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (kind === "email") return normalizeEmail(text) || fold(text).trim();
  if (kind === "phone" || kind === "whatsapp") {
    if (PHONE_LIKE.test(text)) { const phone = normalizePhone(text); if (phone) return phone; }
    return fold(text).trim();
  }
  if (kind === "handle") return fold(text).trim().replace(/^@/, "");
  return fold(text).trim();
}

const filled = new WeakSet();

/** Give every alias without a key its key. Runs once per open database (and is a single cheap query afterwards). */
export function ensureNorms() {
  const conn = db();
  if (filled.has(conn)) return 0;
  const rows = conn.prepare("SELECT id, kind, value FROM aliases WHERE norm IS NULL").all();
  const update = conn.prepare("UPDATE aliases SET norm = ? WHERE id = ?");
  for (const row of rows) update.run(normalizeHandle(row.kind, row.value), row.id);
  filled.add(conn);
  return rows.length;
}

/** The alias row of this handle (same kind) whatever its spelling, or null. */
export function findHandle(kind, value) {
  ensureNorms();
  const norm = normalizeHandle(kind, value);
  if (!norm) return null;
  return db().prepare("SELECT * FROM aliases WHERE kind = ? AND (norm = ? OR value = ? COLLATE NOCASE) ORDER BY created_at LIMIT 1").get(kind, norm, String(value).trim()) || null;
}

/** The alias row of text that may be any kind of handle (a name, an address, a number), or null. */
export function findAnyHandle(text) {
  ensureNorms();
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const norms = [...new Set(["email", "phone", "whatsapp", "handle", "other"].map((k) => normalizeHandle(k, raw)).filter(Boolean))];
  const marks = norms.map(() => "?").join(",");
  return db().prepare(`SELECT * FROM aliases WHERE norm IN (${marks}) OR value = ? COLLATE NOCASE ORDER BY created_at LIMIT 1`).get(...norms, raw) || null;
}
