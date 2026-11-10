import { z } from "zod";
import { db, transaction } from "./db.js";
import { getPerson, createPerson, updatePerson } from "./people.js";
import { isValidBirthday } from "./dates.js";
import { findHandle } from "./handles.js";
import { addAlias } from "./aliases.js";
import { addFact } from "./facts.js";
import { addPersonDate } from "./person-dates.js";
import { fold as foldText } from "./text.js";
import { nameSimilarity } from "./hoard-commons/text.js";

export const vcardSelection = z.object({ person_ids: z.array(z.string().trim().min(1)).min(1) });

// RFC 6350: escape TEXT values before joining structured/list components.
const text = (value) => String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function fold(line) {
  const lines = [];
  let current = "", bytes = 0;
  for (const character of line) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > 75) { lines.push(current); current = " "; bytes = 1; }
    current += character; bytes += width;
  }
  lines.push(current);
  return lines.join("\r\n");
}

export function exportPeopleVcard(input) {
  const { person_ids } = vcardSelection.parse(input);
  const ids = [...new Set(person_ids)];
  const cards = ids.map((id) => {
    const person = getPerson(id);
    if (!person) throw Object.assign(new Error("Una persona seleccionada ya no existe. Actualiza la lista."), { status: 404 });
    // Read stored values directly: alias normalization is unrelated to export.
    const aliases = db().prepare("SELECT kind, value FROM aliases WHERE person_id = ? ORDER BY created_at, id").all(id);
    const lines = ["BEGIN:VCARD", "VERSION:4.0", `UID;VALUE=text:people:${text(id)}`, `FN:${text(person.name)}`];
    if (person.nickname) lines.push(`NICKNAME:${text(person.nickname)}`);
    for (const alias of aliases) {
      if (alias.kind === "email") lines.push(`EMAIL:${text(alias.value)}`);
      if (alias.kind === "phone") lines.push(`TEL;VALUE=text:${text(alias.value)}`);
    }
    if (person.birthday) lines.push(isValidBirthday(person.birthday)
      ? `BDAY:${person.birthday.startsWith("--") ? "--" + person.birthday.slice(2).replace(/-/g, "") : person.birthday.replace(/-/g, "")}`
      : `BDAY;VALUE=text:${text(person.birthday)}`);
    if (person.location) lines.push(`ADR:;;;${text(person.location)};;;`);
    if (person.circles.length) lines.push(`CATEGORIES:${person.circles.map(text).join(",")}`);
    lines.push("END:VCARD");
    return lines.map(fold).join("\r\n");
  });
  return { text: cards.join("\r\n") + "\r\n", count: ids.length, person_ids: ids, version: "4.0",
    filename: ids.length === 1 ? `contacto-${ids[0].replace(/[^a-zA-Z0-9_-]/g, "_")}.vcf` : "contactos.vcf", media_type: "text/vcard; charset=utf-8" };
}

// ------------------------------------------------------------------ import --
// A .vcf from a phone or another address book (vCard 2.1, 3.0 or 4.0). Each card is matched to someone already in the book
// (by the UID this app writes, then by any e-mail or phone, then by the exact name when only one person has it) or becomes a
// new person. What the card adds to someone already here only fills what is empty (birthday, nickname, place), adds the
// circles, e-mails and phones that are missing, and keeps the organisation, job title and note as facts; nothing is
// overwritten. `apply: false` (the default) only says what would happen.

export const vcardImportInput = z.object({
  text: z.string().min(1, "El archivo está vacío.").max(5 * 1024 * 1024, "El archivo es demasiado grande (máximo 5 MB)."),
  apply: z.boolean().default(false),
});
const MAX_CARDS = 3000;

const unescapeText = (value) => String(value).replace(/\\n/gi, "\n").replace(/\\([,;:\\])/g, "$1").trim();

function decodeQuotedPrintable(value) {
  const bytes = [];
  const text = value.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(text[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Split structured values on unescaped separators. */
function splitOn(value, sep) {
  const out = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) { current += value[i] + value[i + 1]; i++; continue; }
    if (value[i] === sep) { out.push(current); current = ""; continue; }
    current += value[i];
  }
  out.push(current);
  return out;
}

function vcardDate(value) {
  const v = String(value || "").trim().replace(/T.*$/, "");
  let m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (m) { const d = `${m[1]}-${m[2]}-${m[3]}`; return isValidBirthday(d) ? (m[1] === "1604" ? `--${m[2]}-${m[3]}` : d) : null; }
  m = v.match(/^--(\d{2})-?(\d{2})$/);
  if (m) { const d = `--${m[1]}-${m[2]}`; return isValidBirthday(d) ? d : null; }
  return null;
}

/** The cards of a .vcf as plain objects: { uid, name, nickname, emails, phones, birthday, anniversary, location, circles, org, title, note }. */
export function parseVcards(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else if (unfolded.length && /=$/.test(unfolded[unfolded.length - 1]) && /QUOTED-PRINTABLE/i.test(unfolded[unfolded.length - 1])) unfolded[unfolded.length - 1] += `\n${line}`;
    else unfolded.push(line);
  }
  const cards = [];
  let card = null;
  for (const line of unfolded) {
    if (/^BEGIN:VCARD$/i.test(line.trim())) { card = { uid: "", name: "", structured: "", nickname: "", emails: [], phones: [], birthday: null, anniversary: null, location: "", circles: [], org: "", title: "", note: "" }; continue; }
    if (/^END:VCARD$/i.test(line.trim())) { if (card) cards.push(card); card = null; continue; }
    if (!card) continue;
    const colon = splitOn(line, ":");
    if (colon.length < 2) continue;
    const head = colon[0];
    let value = colon.slice(1).join(":");
    const [rawProp, ...params] = splitOn(head, ";");
    const prop = rawProp.replace(/^item\d+\./i, "").toUpperCase();
    if (params.some((p) => /QUOTED-PRINTABLE/i.test(p))) value = decodeQuotedPrintable(value);
    switch (prop) {
      case "UID": card.uid = value.trim(); break;
      case "FN": card.name = unescapeText(value); break;
      case "N": {
        const [family, given, middle] = splitOn(value, ";").map(unescapeText);
        card.structured = [given, middle, family].filter(Boolean).join(" ");
        break;
      }
      case "NICKNAME": card.nickname = unescapeText(splitOn(value, ",")[0] || ""); break;
      case "EMAIL": { const v = unescapeText(value).replace(/^mailto:/i, ""); if (v) card.emails.push(v); break; }
      case "TEL": { const v = unescapeText(value).replace(/^tel:/i, ""); if (v) card.phones.push(v); break; }
      case "BDAY": card.birthday = vcardDate(value); break;
      case "ANNIVERSARY": card.anniversary = vcardDate(value); break;
      case "ADR": if (!card.location) { const parts = splitOn(value, ";").map(unescapeText); card.location = parts[3] || parts.filter(Boolean).join(", "); } break;
      case "CATEGORIES": card.circles.push(...splitOn(value, ",").map(unescapeText).filter(Boolean)); break;
      case "ORG": card.org = splitOn(value, ";").map(unescapeText).filter(Boolean).join(", "); break;
      case "TITLE": card.title = unescapeText(value); break;
      case "NOTE": card.note = unescapeText(value); break;
      default: break;
    }
  }
  return cards.map(({ structured, ...c }) => ({ ...c, name: (c.name || structured || c.nickname || c.emails[0] || c.phones[0] || "").slice(0, 120) }))
    .filter((c) => c.name);
}

/** Who a card is in the book: { person, by } or null. */
function matchCard(card) {
  const own = /^people:(.+)$/.exec(card.uid);
  if (own && getPerson(own[1])) return { person: getPerson(own[1]), by: "uid" };
  for (const email of card.emails) { const a = findHandle("email", email); if (a) return { person: getPerson(a.person_id), by: "email" }; }
  for (const phone of card.phones) {
    for (const kind of ["phone", "whatsapp"]) { const a = findHandle(kind, phone); if (a) return { person: getPerson(a.person_id), by: "phone" }; }
  }
  const named = db().prepare("SELECT id, name FROM people").all().filter((p) => foldText(p.name) === foldText(card.name));
  if (named.length === 1) return { person: getPerson(named[0].id), by: "name" };
  return null;
}

/** What importing one card would change: the fields it fills, the handles it adds and those that belong to someone else. */
function planCard(card, match) {
  const person = match?.person || null;
  const fill = {};
  if (person) {
    if (card.nickname && !person.nickname) fill.nickname = card.nickname.slice(0, 80);
    if (card.birthday && !person.birthday) fill.birthday = card.birthday;
    if (card.location && !person.location) fill.location = card.location.slice(0, 120);
    const circles = card.circles.filter((c) => !person.circles.some((have) => foldText(have) === foldText(c)));
    if (circles.length) fill.circles = [...person.circles, ...circles].slice(0, 30);
  }
  const aliases = [];
  const conflicts = [];
  const seen = new Set();
  for (const [kind, values] of [["email", card.emails], ["phone", card.phones]]) {
    for (const value of values) {
      const key = `${kind}:${value.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const owner = findHandle(kind, value);
      if (!owner) aliases.push({ kind, value: value.slice(0, 200) });
      else if (!person || owner.person_id !== person.id) conflicts.push({ kind, value, person_id: owner.person_id, person_name: getPerson(owner.person_id)?.name || "" });
    }
  }
  const facts = [];
  if (card.org) facts.push({ key: "trabaja en", value: card.org.slice(0, 2000) });
  if (card.title) facts.push({ key: "puesto", value: card.title.slice(0, 2000) });
  if (card.note) facts.push({ key: "nota del contacto", value: card.note.slice(0, 2000) });
  const changes = Object.keys(fill).length + aliases.length + facts.length + (card.anniversary ? 1 : 0);
  // joined by an e-mail or a phone under a quite different name ("Mamá" and "María López"): said, so the preview can show it
  const nameDiffers = !!person && ["email", "phone"].includes(match.by)
    && Math.max(nameSimilarity(card.name, person.name), person.nickname ? nameSimilarity(card.name, person.nickname) : 0) < 0.5;
  return {
    name: card.name, action: person ? (changes ? "update" : "unchanged") : "create", person_id: person?.id || null,
    person_name: person?.name || null, matched_by: match?.by || null, name_differs: nameDiffers, fill, aliases, conflicts, facts, anniversary: card.anniversary,
    card: person ? null : { name: card.name, nickname: card.nickname.slice(0, 80), birthday: card.birthday, location: card.location.slice(0, 120), circles: card.circles.slice(0, 30) },
  };
}

/**
 * Import a .vcf. Returns { applied, cards, create, update, unchanged, conflicts, items }: one item per card with what was (or
 * would be) done. A handle that already belongs to someone else is never moved: it is listed under conflicts.
 */
export function importPeopleVcard(input) {
  const { text, apply } = vcardImportInput.parse(input);
  const cards = parseVcards(text);
  if (!cards.length) throw Object.assign(new Error("No he encontrado ninguna tarjeta vCard en el archivo."), { status: 400 });
  if (cards.length > MAX_CARDS) throw Object.assign(new Error(`El archivo tiene ${cards.length} tarjetas; el máximo es ${MAX_CARDS}.`), { status: 400 });
  const run = () => {
    const items = [];
    const createdByName = new Map(); // two cards for the same new name in one file become one person
    for (const card of cards) {
      let match = matchCard(card);
      if (!match && createdByName.has(foldText(card.name))) match = { person: getPerson(createdByName.get(foldText(card.name))), by: "file" };
      const plan = planCard(card, match);
      if (apply) {
        let personId = plan.person_id;
        if (plan.action === "create") {
          personId = createPerson(plan.card).id;
          createdByName.set(foldText(card.name), personId);
          plan.person_id = personId;
        } else if (Object.keys(plan.fill).length) updatePerson(personId, plan.fill);
        for (const alias of plan.aliases) {
          try { addAlias(personId, alias); } catch { plan.conflicts.push({ ...alias, person_id: null, person_name: "" }); }
        }
        for (const fact of plan.facts) addFact(personId, fact);
        if (plan.anniversary) addPersonDate(personId, { label: "Aniversario", date: plan.anniversary, yearly: true });
      }
      const { card: _card, ...shown } = plan;
      items.push(shown);
    }
    return items;
  };
  const items = apply ? transaction(run) : run();
  const count = (action) => items.filter((i) => i.action === action).length;
  return {
    applied: apply, cards: cards.length, create: count("create"), update: count("update"), unchanged: count("unchanged"),
    conflicts: items.reduce((n, i) => n + i.conflicts.length, 0), items,
  };
}
