// Tools exposed to the assistant. One list drives /api/agent/call and the
// MCP bridge (server/mcp.js). Descriptions end with a "Sinónimos:" line of
// Spanish words for the client's tool index.
import { z } from "zod";
import * as people from "./people.js";
import * as aliases from "./aliases.js";
import * as facts from "./facts.js";
import * as interactions from "./interactions.js";
import * as reminders from "./reminders.js";
import { upcomingReport } from "./upcoming.js";
import { daysSince } from "./dates.js";

export const AGENT_INSTRUCTIONS = `People's Hoard is the user's private address book: who people are, what to remember about them, and when they last spoke.
Resolve ambiguous names by asking the user which person they mean — never guess when find_people or get_person returns several candidates; two people can share a first name.
Never invent facts, birthdays or relationships. Only record what the user actually told you, with add_fact, add_alias or upsert_person.
When logging an interaction from a chat or e-mail, summarize the gist in one short line with log_interaction; never paste the private message content itself.
Birthdays without a known year are fine: store them as --MM-DD (month and day only).
Call find_people or get_person before writing, so a fact, alias or interaction lands on the right person.
Who the person is goes in "summary" ("vecina del cuarto", "compañero del máster", "amigo de la infancia") and their group in "circles" (familia, amigos, trabajo, vecinos, ...); tastes, children, jobs and similar go in facts. When the user describes a new person, fill summary and circles in the same upsert_person call.
merge_people and delete_person are irreversible: confirm with the user before calling them.`;

const fail = (message, opts = {}) => {
  throw Object.assign(new Error(message), { status: 400, ...opts });
};

function resolveOrFail(ref) {
  const { person, candidates } = people.resolvePersonRef(ref);
  if (person) return person;
  if (candidates.length) fail(`No sé a quién te refieres con "${ref}". ¿Es alguna de estas personas?`, { candidates });
  fail(`No encuentro a "${ref}" en la agenda.`);
}

const tool = (name, description, schema, hints, run) => ({
  name,
  description,
  schema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...hints },
  run,
});
const RO = { readOnlyHint: true, idempotentHint: true };

const personRef = z.string().trim().min(1).max(200).describe("Person id, exact name or a close match");

export const TOOLS = [
  tool(
    "find_people",
    "Search the address book by name, nickname or alias (fuzzy). Sinónimos: quién es, busca a, contacto\nSearch the address book by name, nickname or alias: fuzzy, accent-insensitive, matches partial names anywhere in the word. Returns candidates ranked by score; ask the user when more than one is plausible.\nSinónimos: quién es, buscar persona, contacto, amigo, familia, compañero de",
    z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(30).default(8) }),
    RO,
    ({ query, limit }) => ({ candidates: people.findPeople(query, { limit }) }),
  ),

  tool(
    "get_person",
    "Full record of one person: facts, interactions, reminders, last contact. Sinónimos: ficha de, qué sé de\nGet the full record for one person: facts, last 10 interactions, open reminders and days since last contact. Accepts an id or a name; ambiguous names return candidates instead of guessing.\nSinónimos: quién es, ficha de, contacto, información sobre",
    z.object({ person: personRef }),
    RO,
    ({ person: ref }) => {
      const person = resolveOrFail(ref);
      const full = people.getPersonFull(person.id, { interactionsLimit: 10 });
      return { ...full, reminders: full.reminders.filter((r) => !r.done), days_since_last_contact: daysSince(person.last_contact_at) };
    },
  ),

  tool(
    "upsert_person",
    "Create or update a person; partial fields. Sinónimos: apunta a, nueva persona, actualiza el contacto\nCreate or update a person. With person set, updates the matching id or exact name (ambiguous exact names return candidates); without a match, or without person, creates a new person from name. All fields besides name are partial and only change what you pass.\nSinónimos: nuevo contacto, añade a mi agenda, actualiza los datos de, guarda a",
    z.object({
      person: z.string().trim().max(200).optional().describe("Existing person id or exact name; omit to always create"),
      name: z.string().trim().min(1).max(120).optional(),
      nickname: z.string().trim().max(80).optional(),
      circles: z.array(z.string().trim().min(1).max(40)).max(30).optional().describe('e.g. ["familia","amigos","trabajo"]'),
      birthday: z.string().nullable().optional().describe("YYYY-MM-DD, or --MM-DD if the year is unknown"),
      location: z.string().trim().max(120).optional(),
      how_met: z.string().trim().max(2000).optional(),
      summary: z.string().trim().max(4000).optional().describe("One paragraph: who this is"),
      notes: z.string().max(20000).optional(),
      contact_every_days: z.number().int().positive().max(3650).nullable().optional().describe("Desired contact cadence in days"),
    }),
    { idempotentHint: true },
    ({ person: ref, ...patch }) => people.upsertPerson(ref, patch),
  ),

  tool(
    "add_alias",
    "Add a contact handle (WhatsApp name, e-mail, phone) to a person. Sinónimos: su número, su correo, alias\nAdd a contact handle to a person (WhatsApp display name, e-mail, phone or other identifier) so future messages from that handle resolve to them. Idempotent: the same kind+value on the same person is a no-op; on someone else it fails.\nSinónimos: apunta el whatsapp de, guarda el teléfono de, guarda el correo de, apodo en",
    z.object({ person: personRef, kind: z.enum(people.ALIAS_KINDS).default("other"), value: z.string().trim().min(1).max(200) }),
    { idempotentHint: true },
    ({ person: ref, kind, value }) => ({ alias: aliases.addAlias(resolveOrFail(ref).id, { kind, value }) }),
  ),

  tool(
    "add_fact",
    'Record a key/value fact about a person (job, kids, likes). Sinónimos: apunta que, recuerda que, dato de\nRecord a free-form fact about a person as a key/value pair: job, kids, allergies, likes, dislikes... Idempotent on the same key+value ("trabaja en" / "Acme").\nSinónimos: apunta que, le gusta, no le gusta, trabaja en, alergia a, hijos de, cumpleaños de su',
    z.object({ person: personRef, key: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(2000) }),
    { idempotentHint: true },
    ({ person: ref, key, value }) => ({ fact: facts.addFact(resolveOrFail(ref).id, { key, value }) }),
  ),

  tool(
    "log_interaction",
    "Log a message, call or meeting with a person (one-line summary). Sinónimos: hablé con, llamé a, reunión con\nLog a contact with a person (message, call or meeting) and update when you last spoke. Summarize in one short line — never paste the private message content.\nSinónimos: hace cuánto no hablo con, he hablado con, hablé con, quedé con, llamé a, escribí a",
    z.object({
      person: personRef,
      channel: z.enum(interactions.CHANNELS).default("other"),
      summary: z.string().trim().max(2000).default(""),
      at: z.string().optional().describe("ISO datetime; default now"),
    }),
    {},
    ({ person: ref, channel, summary, at }) => ({
      interaction: interactions.createInteraction(resolveOrFail(ref).id, { channel, summary, at, source: "agent" }),
    }),
  ),

  tool(
    "add_reminder",
    "Create a reminder due on a date, optionally tied to a person.\nSinónimos: recuérdame, avísame el, recordatorio para, apunta para recordar",
    z.object({
      person: z.string().trim().max(200).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD."),
      text: z.string().trim().min(1).max(2000),
      kind: z.enum(reminders.REMINDER_KINDS).default("custom"),
    }),
    {},
    ({ person: ref, due, text, kind }) => ({
      reminder: reminders.createReminder({ person_id: ref ? resolveOrFail(ref).id : null, due, text, kind }),
    }),
  ),

  tool(
    "complete_reminder",
    "Mark a reminder as done by id.\nSinónimos: ya lo hice, hecho, completado, marca el recordatorio",
    z.object({ id: z.string().min(1) }),
    { idempotentHint: true },
    ({ id }) => {
      const reminder = reminders.completeReminder(id);
      if (!reminder) fail("Ese recordatorio no existe.", { status: 404 });
      return { reminder };
    },
  ),

  tool(
    "upcoming",
    "Birthdays, reminders due and people not contacted lately, next N days. Sinónimos: cumpleaños, a quién escribo\nLook ahead N days (default 30): birthdays with age, reminders due and people you have not contacted within their desired cadence, with a one-line summary.\nSinónimos: cumpleaños, felicitar, hace cuánto no hablo con, qué tengo pendiente, próximos días, agenda",
    z.object({ days: z.number().int().min(1).max(365).default(30) }),
    RO,
    ({ days }) => upcomingReport({ days }),
  ),

  tool(
    "list_people",
    "List people, optionally filtered by circle, up to limit.\nSinónimos: contactos, agenda, mis amigos, mi familia, mis compañeros de",
    z.object({ circle: z.string().max(40).optional(), limit: z.number().int().min(1).max(200).default(50) }),
    RO,
    ({ circle, limit }) => ({ people: people.listPeople({ circle: circle || "", archived: "false" }).slice(0, limit) }),
  ),

  tool(
    "merge_people",
    "Merge two duplicate people into one (irreversible; confirm first). Sinónimos: fusionar, duplicados, unir\nMerge two duplicate people into one: facts, aliases, interactions and reminders move to keep_id; circles are combined; drop_id is deleted. Irreversible; confirm with the user first.\nSinónimos: fusionar, están duplicados, es la misma persona, unir contactos",
    z.object({ keep_id: z.string().min(1), drop_id: z.string().min(1) }),
    { destructiveHint: true },
    ({ keep_id, drop_id }) => ({ person: people.mergePeople(keep_id, drop_id) }),
  ),

  tool(
    "delete_person",
    "Delete a person and everything linked (irreversible; confirm first). Sinónimos: borrar contacto, eliminar\nDelete a person and everything linked to them (aliases, facts, interactions, reminders). Irreversible; confirm with the user first.\nSinónimos: borra a, elimina el contacto de, quita de mi agenda",
    z.object({ id: z.string().min(1) }),
    { destructiveHint: true, idempotentHint: true },
    ({ id }) => {
      const person = people.getPerson(id);
      if (!person) fail("Esa persona no existe.", { status: 404 });
      people.deletePerson(id);
      return { deleted: person };
    },
  ),
];

export function findTool(name) {
  return TOOLS.find((t) => t.name === name);
}

export async function callTool(name, args) {
  const t = findTool(name);
  if (!t) throw Object.assign(new Error("Herramienta desconocida."), { status: 404 });
  return await t.run(t.schema.parse(args || {}));
}
