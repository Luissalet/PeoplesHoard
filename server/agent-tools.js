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
import { personBrief } from "./brief.js";
import * as commitments from "./commitments.js";

export const AGENT_INSTRUCTIONS = `People's Hoard is the user's private address book: who people are, what to remember about them, and when they last spoke.
Resolve ambiguous names by asking the user which person they mean — never guess when find_people or get_person returns several candidates; two people can share a first name.
Never invent facts, birthdays or relationships. Only record what the user actually told you, with add_fact, add_alias or upsert_person.
When logging an interaction from a chat or e-mail, summarize the gist in one short line with log_interaction; never paste the private message content itself.
Birthdays without a known year are fine: store them as --MM-DD (month and day only).
Call find_people or get_person before writing, so a fact, alias or interaction lands on the right person.
Who the person is goes in "summary" ("vecina del cuarto", "compañero del máster", "amigo de la infancia") and their group in "circles" (familia, amigos, trabajo, vecinos, ...); tastes, children, jobs and similar go in facts. When the user describes a new person, fill summary and circles in the same upsert_person call.
merge_people and delete_person are irreversible: confirm with the user before calling them.
Commitments are promises: "i_owe" is what the user must do for someone, "owed_to_me" is what someone owes the user. Record one with commitment_add only when the user said it (or confirms it), with the person and, if given, the day; never invent a deadline: pass due_text in the user's words ("el viernes") and let the server turn it into a date. Before saying what is pending, call commitments_digest or commitments_list; when the user asks how to catch up with someone, prepare_person_chat already lists the open commitments both ways. Meeting minutes from Funes come in with commitments_ingest_minutes (give the session id) and text the user pastes goes through commitments_extract_text: both only propose, and commitments_review shows what waits for a decision (a name that matches nobody, several people with the same name): ask the user before resolving it.`;

const fail = (message, opts = {}) => {
  throw Object.assign(new Error(message), { status: 400, ...opts });
};

function resolveOrFail(ref) {
  const { person, candidates } = people.resolvePersonRef(ref);
  if (person) return person;
  if (candidates.length) fail(`No sé a quién te refieres con "${ref}". ¿Es alguna de estas personas?`, { candidates });
  fail(`No encuentro a "${ref}" en la agenda.`);
}

// `timeoutMs` (in the hints) is how long the MCP bridge waits for the reply; the default suits instant tools.
const tool = (name, description, schema, { timeoutMs, ...hints }, run) => ({
  name,
  description,
  schema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...hints },
  ...(timeoutMs ? { timeoutMs } : {}),
  run,
});
const RO = { readOnlyHint: true, idempotentHint: true };

const personRef = z.string().trim().min(1).max(200).describe("Person id, exact name or a close match");

export const TOOLS = [
  tool(
    "find_people",
    "Search the address book by name, nickname or alias (fuzzy).\nSearch the address book by name, nickname or alias: fuzzy, accent-insensitive, matches partial names anywhere in the word. Returns candidates ranked by score; ask the user when more than one is plausible.\nSinónimos: quién es, buscar persona, contacto, amigo, familia, compañero de",
    z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(30).default(8) }),
    RO,
    ({ query, limit }) => ({ candidates: people.findPeople(query, { limit }) }),
  ),

  tool(
    "get_person",
    "Full record of one person: facts, interactions, reminders, last contact.\nGet the full record for one person: facts, last 10 interactions, open reminders, open commitments both ways and days since last contact. Accepts an id or a name; ambiguous names return candidates instead of guessing.\nSinónimos: quién es, ficha de, contacto, información sobre",
    z.object({ person: personRef }),
    RO,
    ({ person: ref }) => {
      const person = resolveOrFail(ref);
      const full = people.getPersonFull(person.id, { interactionsLimit: 10 });
      return {
        ...full,
        reminders: full.reminders.filter((r) => !r.done),
        days_since_last_contact: daysSince(person.last_contact_at),
        open_commitments: commitments.openCommitmentsFor(person.id),
      };
    },
  ),

  tool(
    "prepare_person_chat",
    "Prepare a sourced catch-up brief before speaking to someone.\nReturns a compact person brief with facts, five recent interactions, all open reminders, open commitments both ways (what I owe them, what they owe me) and source ids. as_of is today's local date; days_until_due is positive for future reminders and negative for overdue ones. Flags differing values under the same fact key instead of deciding which is current. Recomputed after every edit.\nSinónimos: preparar conversación, antes de hablar, puesta al día, qué recuerdo de",
    z.object({ person: personRef }),
    RO,
    ({ person: ref }) => personBrief(resolveOrFail(ref).id),
  ),

  tool(
    "upsert_person",
    "Create or update a person; partial fields.\nCreate or update a person. With person set, updates the matching id or exact name (ambiguous exact names return candidates); without a match, or without person, creates a new person from name. All fields besides name are partial and only change what you pass.\nSinónimos: nuevo contacto, añade a mi agenda, actualiza los datos de, guarda a",
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
    "Add a contact handle (WhatsApp name, e-mail, phone) to a person.\nAdd a contact handle to a person (WhatsApp display name, e-mail, phone or other identifier) so future messages from that handle resolve to them. Idempotent: the same kind+value on the same person is a no-op; on someone else it fails.\nSinónimos: apunta el whatsapp de, guarda el teléfono de, guarda el correo de, apodo en",
    z.object({ person: personRef, kind: z.enum(people.ALIAS_KINDS).default("other"), value: z.string().trim().min(1).max(200) }),
    { idempotentHint: true },
    ({ person: ref, kind, value }) => ({ alias: aliases.addAlias(resolveOrFail(ref).id, { kind, value }) }),
  ),

  tool(
    "add_fact",
    'Record a key/value fact about a person (job, kids, likes).\nRecord a free-form fact about a person as a key/value pair: job, kids, allergies, likes, dislikes... Idempotent on the same key+value ("trabaja en" / "Acme").\nSinónimos: apunta que, le gusta, no le gusta, trabaja en, alergia a, hijos de, cumpleaños de su',
    z.object({ person: personRef, key: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(2000) }),
    { idempotentHint: true },
    ({ person: ref, key, value }) => ({ fact: facts.addFact(resolveOrFail(ref).id, { key, value }) }),
  ),

  tool(
    "log_interaction",
    "Log a message, call or meeting with a person (one-line summary).\nLog a contact with a person (message, call or meeting) and update when you last spoke. Summarize in one short line — never paste the private message content.\nSinónimos: hace cuánto no hablo con, he hablado con, hablé con, quedé con, llamé a, escribí a",
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
    "Birthdays, reminders due and people not contacted lately, next N days.\nLook ahead N days (default 30): birthdays with age, reminders due, commitments overdue or due and people you have not contacted within their desired cadence, with a one-line summary.\nSinónimos: cumpleaños, felicitar, hace cuánto no hablo con, qué tengo pendiente, próximos días, agenda",
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

  // ------------------------------------------------------------ commitments --

  tool(
    "commitments_list",
    "List commitments (promises) both ways: who I owe and who owes me.\nList commitments, filtered by person, direction (i_owe | owed_to_me), status (open by default, done, dropped or all), overdue and due_before (YYYY-MM-DD). Each one has its person, text, due day or due_text, source (meeting, chat, text, manual) and overdue flag.\nSinónimos: qué me deben, qué debo, qué prometí, pendientes con, compromisos, promesas, vencidos",
    z.object({
      person: z.string().trim().max(200).optional().describe("Person id or name"),
      direction: z.enum(commitments.DIRECTIONS).optional().describe("i_owe = I must do it; owed_to_me = they must"),
      status: z.enum([...commitments.STATUSES, "all"]).default("open"),
      overdue: z.boolean().optional(),
      due_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.").optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    RO,
    ({ person, limit, ...filters }) => ({
      commitments: commitments.listCommitments({ ...filters, person: person ? resolveOrFail(person).id : undefined, limit }),
    }),
  ),

  tool(
    "commitment_add",
    "Record a promise: I owe someone something, or they owe me (compromiso, prometí, me debe).\nRecord a commitment. direction i_owe = the user must do it for the person; owed_to_me = the person must do it for the user. person is an id or name (several matches return candidates; a name not in the book is kept as written, with a warning). Give due (YYYY-MM-DD) or, better, due_text in the user's words (\"el viernes\", \"en dos semanas\"); a day that cannot be worked out stays as words. source_quote keeps what was said. With source_ref a repeat of the same text is a no-op.\nSinónimos: le prometí, me prometió, quedé en, me comprometí a, me debe, apunta que le debo, tengo que entregarle",
    z.object({
      direction: z.enum(commitments.DIRECTIONS),
      text: z.string().trim().min(1).max(2000).describe("What is promised, in one line"),
      person: z.string().trim().max(200).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.").optional(),
      due_text: z.string().trim().max(120).optional().describe('The deadline as said: "el martes", "antes de fin de mes"'),
      source_kind: z.enum(["chat", "manual", "text", "mail"]).default("chat"),
      source_ref: z.string().trim().max(200).optional().describe("A stable id of the origin (a message id) to avoid duplicates"),
      source_quote: z.string().trim().max(1000).optional().describe("The words that make the promise"),
    }),
    {},
    (args) => commitments.addCommitmentByRef(args),
  ),

  tool(
    "commitment_update",
    "Change a commitment: text, day, person or direction (cambiar compromiso).\nChange one commitment by id; only the fields you pass change. A new due_text is turned into a day when it names one. Returns the commitment as it is now.\nSinónimos: cambia la fecha de, pospón, aplaza, corrige el compromiso, ahora es para el",
    z.object({
      id: z.string().min(1),
      text: z.string().trim().min(1).max(2000).optional(),
      person: z.string().trim().max(200).optional(),
      direction: z.enum(commitments.DIRECTIONS).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.").nullable().optional(),
      due_text: z.string().trim().max(120).optional(),
    }),
    { idempotentHint: true },
    ({ id, ...patch }) => {
      const commitment = commitments.updateCommitmentByRef(id, patch);
      if (!commitment) fail("Ese compromiso no existe.", { status: 404 });
      return { commitment };
    },
  ),

  tool(
    "commitment_done",
    "Mark a commitment as fulfilled (cumplido, hecho, ya se lo di).\nMark one commitment done by id and stamp when. Idempotent. Returns the commitment.\nSinónimos: ya se lo envié, ya cumplí, me lo ha dado, ya me pagó, está hecho, cumplido",
    z.object({ id: z.string().min(1) }),
    { idempotentHint: true },
    ({ id }) => {
      const commitment = commitments.completeCommitment(id);
      if (!commitment) fail("Ese compromiso no existe.", { status: 404 });
      return { commitment };
    },
  ),

  tool(
    "commitment_drop",
    "Drop a commitment that no longer applies (cancelado, ya no hace falta).\nMark one commitment dropped by id: it stays in the history but leaves the open lists. Not the same as done. Returns the commitment.\nSinónimos: cancela el compromiso, ya no hace falta, déjalo, olvídalo, anula",
    z.object({ id: z.string().min(1) }),
    { idempotentHint: true },
    ({ id }) => {
      const commitment = commitments.dropCommitment(id);
      if (!commitment) fail("Ese compromiso no existe.", { status: 404 });
      return { commitment };
    },
  ),

  tool(
    "commitments_review",
    "List or settle proposed commitments waiting for a decision (revisar propuestas).\nThe review queue holds what could not be recorded safely: a name that matches nobody or several people, a promise between two third parties, an owner nobody said, and proposals from pasted text. action list (default) shows them with candidates. action resolve needs id and decision accept or discard; accept needs the person (person = id or name) or create_person (true, or the name) or no_person; direction, text, due and due_text may correct the proposal. Ask the user before resolving. Returns the commitment made.\nSinónimos: propuestas pendientes, qué falta por revisar, acepta la propuesta, descarta, cola de revisión",
    z.object({
      action: z.enum(["list", "resolve"]).default("list"),
      id: z.string().optional().describe("Review item id (resolve)"),
      decision: z.enum(["accept", "discard"]).optional(),
      person: z.string().trim().max(200).optional(),
      create_person: z.union([z.boolean(), z.string().trim().min(1).max(120)]).optional(),
      no_person: z.boolean().optional(),
      direction: z.enum(commitments.DIRECTIONS).optional(),
      text: z.string().trim().min(1).max(2000).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa YYYY-MM-DD.").nullable().optional(),
      due_text: z.string().trim().max(120).optional(),
    }),
    {},
    ({ action, id, decision, person, ...rest }) => {
      if (action === "list") return { review: commitments.listReview(), pending: commitments.pendingReviewCount() };
      if (!id || !decision) fail("Para resolver indica id y decision (accept o discard).");
      const body = { action: decision, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
      if (person) body.person_id = resolveOrFail(person).id;
      const out = commitments.resolveReview(id, body);
      if (!out) fail("Esa propuesta no existe.", { status: 404 });
      return { ...out, pending: commitments.pendingReviewCount() };
    },
  ),

  tool(
    "commitments_ingest_minutes",
    "Turn the minutes of a recorded meeting into commitments (acta, reunión, Funes).\nAsks Funes, through the hub, for the minutes of a session (it writes them if needed, which can take minutes) and records its action items: what the user said they would do is i_owe, what others said is owed_to_me. Names that do not resolve go to commitments_review. Safe to repeat. status is ingested, or no_model, hub_down, tool_missing, unknown_session, funes_error with a detail. Also happens by itself when Funes announces new minutes.\nSinónimos: compromisos de la reunión, qué quedó pendiente en la reunión, acta de la reunión, tareas de la reunión",
    z.object({ session_id: z.string().trim().min(1).max(100), regenerate: z.boolean().default(false) }),
    { openWorldHint: true, timeoutMs: 16 * 60 * 1000 },
    ({ session_id, regenerate }) => commitments.ingestFromFunes(session_id, { regenerate }),
  ),

  tool(
    "commitments_extract_text",
    "Propose commitments from pasted text (a mail, a chat); they wait for review (extraer compromisos).\nThe local model reads the text and proposes promises, each with the exact quote that supports it; proposals without a literal quote are dropped. Nothing is recorded: they go to commitments_review. status is proposed, or no_model, hub_down, error. person_hint names the other person when the text does not.\nSinónimos: qué me ha pedido, qué me prometió en este correo, saca las tareas de este mensaje, detecta compromisos",
    z.object({ text: z.string().min(12).max(40000), person_hint: z.string().trim().max(120).optional() }),
    { openWorldHint: true, timeoutMs: 4 * 60 * 1000 },
    ({ text, person_hint }) => commitments.extractFromText({ text, person_hint: person_hint || "" }),
  ),

  tool(
    "commitments_digest",
    "What is overdue and due soon, in words: you owe X, X owes you (qué debo, qué me deben).\nOverdue and upcoming commitments for the next N days (default 7), grouped by person, with ready-to-say lines (\"Le debes a Marta: …\", \"Pedro te debe: …\") and how many proposals await review.\nSinónimos: a quién le debo algo, quién me debe algo, qué tengo pendiente con la gente, resumen de compromisos, qué vence esta semana",
    z.object({ days: z.number().int().min(1).max(365).default(7) }),
    RO,
    ({ days }) => commitments.commitmentsDigest({ days }),
  ),

  tool(
    "merge_people",
    "Merge two duplicate people into one (irreversible; confirm first).\nMerge two duplicate people into one: facts, aliases, interactions, reminders and commitments move to keep_id; circles are combined; drop_id is deleted. Irreversible; confirm with the user first.\nSinónimos: fusionar, están duplicados, es la misma persona, unir contactos",
    z.object({ keep_id: z.string().min(1), drop_id: z.string().min(1) }),
    { destructiveHint: true },
    ({ keep_id, drop_id }) => ({ person: people.mergePeople(keep_id, drop_id) }),
  ),

  tool(
    "delete_person",
    "Delete a person and everything linked (irreversible; confirm first).\nDelete a person and everything linked to them (aliases, facts, interactions, reminders); their commitments stay, with the name as written. Irreversible; confirm with the user first.\nSinónimos: borra a, elimina el contacto de, quita de mi agenda",
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
