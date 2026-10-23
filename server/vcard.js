import { z } from "zod";
import { db } from "./db.js";
import { getPerson } from "./people.js";
import { isValidBirthday } from "./dates.js";

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
