// Commitments from chat messages (WhatsApp): "te lo mando el lunes", "me debes la factura", "I'll send it by Friday".
//
// The caller (Faustus, through the hub's tool proxy) hands over a batch of messages it already read, each with the chat, the
// sender (me | them), the text, the time and the message id. This module finds the promises in them with a deterministic pass
// (Spanish and English promise verbs plus time expressions, resolved against the day the message was written) and records each
// as a commitment with source "whatsapp": the sentence that makes it, the message time, the day it is due (only when the words
// name one) and who owes whom. Nothing here reads WhatsApp itself and nothing is ever sent anywhere: message bodies stay in this
// process, the bus only carries the usual commitment events.
//
// Safety rules, in order of importance:
//   - a sentence is a commitment only if the speaker (or the person addressed) is clearly bound: a promise verb in the first
//     person ("te mando", "I'll send"), "te debo", "me debes". Questions, conditionals ("si quieres te lo mando"), hedges
//     ("igual te lo mando"), negations, quoted or forwarded text and reported speech are left alone;
//   - weak verbs ("te llamo", "te escribo") count only with a day or a time expression;
//   - re-sending the same batch adds nothing (a ledger of message ids, plus the commitments' own dedupe key);
//   - the local model is optional (`refine`), off by default, and what it finds only goes to the review queue.
import crypto from "node:crypto";
import { z } from "zod";
import { db, now } from "./db.js";
import { fold } from "./text.js";
import { today as todayLocal, addDays, localDate } from "./dates.js";
import { parseDue } from "./hoard-commons/dates.js";
import { findAnyHandle } from "./handles.js";
import { getPerson } from "./people.js";
import * as commitments from "./commitments.js";
import * as family from "./hoard-link.js";

export const MAX_BATCH = 500;
const LEDGER_DAYS = 120;
const REFINE_MAX_MESSAGES = 60;

// ------------------------------------------------------------------ vocabulary --

// First-person present / future forms. Accents are kept on purpose: "te lo mandé" (past) must not match "te lo mando".
const ES_STRONG = {
  Mandar: ["mando", "mandaré", "mandare"],
  Enviar: ["envío", "envio", "enviaré", "enviare"],
  Reenviar: ["reenvío", "reenvio", "reenviaré", "reenviare"],
  Pasar: ["paso", "pasaré", "pasare"],
  Devolver: ["devuelvo", "devolveré", "devolvere"],
  Pagar: ["pago", "pagaré", "pagare"],
  Traer: ["traigo", "traeré", "traere"],
  Llevar: ["llevo", "llevaré", "llevare"],
  Dar: ["doy", "daré", "dare"],
  Hacer: ["hago", "haré", "hare"],
  Preparar: ["preparo", "prepararé", "preparare"],
  Comprar: ["compro", "compraré", "comprare"],
  Reservar: ["reservo", "reservaré", "reservare"],
  Entregar: ["entrego", "entregaré", "entregare"],
  Ingresar: ["ingreso", "ingresaré", "ingresare"],
  Transferir: ["transfiero", "transferiré", "transferire"],
  Recoger: ["recojo", "recogeré", "recogere"],
  Arreglar: ["arreglo", "arreglaré", "arreglare"],
  Subir: ["subo", "subiré", "subire"],
  Compartir: ["comparto", "compartiré", "compartire"],
  Buscar: ["busco", "buscaré", "buscare"],
  Prestar: ["presto", "prestaré", "prestare"],
  Revisar: ["reviso", "revisaré", "revisare"],
  Terminar: ["termino", "terminaré", "terminare"],
  Firmar: ["firmo", "firmaré", "firmare"],
};
// "te llamo luego" is a courtesy more often than a promise: these need a day or a time expression to count.
const ES_WEAK = {
  Llamar: ["llamo", "llamaré", "llamare"],
  Avisar: ["aviso", "avisaré", "avisare"],
  Confirmar: ["confirmo", "confirmaré", "confirmare"],
  Contestar: ["contesto", "contestaré", "contestare"],
};
const ES_INFINITIVES = [...Object.keys(ES_STRONG), ...Object.keys(ES_WEAK)].map((v) => v.toLowerCase());
const WEAK_INF = new Set(Object.keys(ES_WEAK).map((v) => v.toLowerCase()));
// "me lo mandas el lunes" (only after "quedamos en que ..."): second-person present
const ES_SECOND = {
  mandas: "mandar", envías: "enviar", envias: "enviar", pasas: "pasar", devuelves: "devolver", pagas: "pagar", traes: "traer",
  das: "dar", llevas: "llevar", haces: "hacer", entregas: "entregar", ingresas: "ingresar", transfieres: "transferir",
  preparas: "preparar", compras: "comprar", reservas: "reservar", firmas: "firmar", revisas: "revisar",
};

const EN_STRONG = ["send", "bring", "pay", "give", "forward", "return", "book", "buy", "fix", "share", "drop", "prepare", "finish",
  "review", "do", "make", "upload", "transfer", "reserve", "order", "deliver", "ship", "pick"];
const EN_WEAK = ["call", "text", "email", "message", "write", "ping", "let", "get", "check"];

const alt = (list) => [...new Set(list)].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const L = String.raw`(?<![\p{L}\d])`;
const R = String.raw`(?![\p{L}\d])`;
const rx = (source) => new RegExp(source, "iu");

const ES_FORM_TO_VERB = new Map();
for (const [label, forms] of Object.entries(ES_STRONG)) for (const form of forms) ES_FORM_TO_VERB.set(form, { label, weak: false });
for (const [label, forms] of Object.entries(ES_WEAK)) for (const form of forms) ES_FORM_TO_VERB.set(form, { label, weak: true });

const P_TE = rx(`${L}te\\s+(?:(?:lo|la|los|las|le)\\s+)?(${alt([...ES_FORM_TO_VERB.keys()])})${R}`);
const P_IRA_A = rx(`${L}te\\s+(?:(?:lo|la|los|las)\\s+)?voy\\s+a\\s+(${alt(ES_INFINITIVES)})${R}`);
const P_IRA_B = rx(`${L}voy\\s+a\\s+(${alt(ES_INFINITIVES)})te(?:lo|la|los|las)?${R}`);
const P_DEBO = rx(`${L}te\\s+debo${R}`);
const P_TENGO = rx(`${L}(?:tengo\\s+que|debo)\\s+(${alt(ES_INFINITIVES)})te(?:lo|la|los|las)?${R}`);
const P_ENCARGO = rx(`${L}(?:yo\\s+)?me\\s+(?:encargo|ocupo|hago\\s+cargo)${R}`);
const P_YO = rx(`${L}yo\\s+(?:lo\\s+|la\\s+)?(?:hago|llevo|traigo|compro|preparo|reservo|pago|invito)${R}|${L}(?:lo|la)\\s+(?:hago|llevo|traigo|compro|preparo|reservo|pago)\\s+yo${R}`);
const P_PROMETO = rx(`${L}(?:te\\s+)?prometo\\s+(?:que\\s+)?`);
const EN_ALL = alt([...EN_STRONG, ...EN_WEAK]);
const P_EN = rx(`${L}i(?:'ll|\\s+will|'m\\s+going\\s+to|\\s+am\\s+going\\s+to|\\s+gonna)\\s+(?:(?:definitely|also|just|then|still|really|surely)\\s+)?(${EN_ALL})${R}`);
const P_EN_OWE = rx(`${L}i\\s+owe\\s+you${R}`);

const C_DEBES = rx(`${L}me\\s+(?:debes|debeis|deb[eé]is)${R}`);
const C_EN_OWE = rx(`${L}you\\s+owe\\s+me${R}`);
const INF = alt(ES_INFINITIVES);
const C_TIENES_A = rx(`${L}me\\s+(?:tienes|teneis)\\s+que\\s+(${INF})${R}`);
const C_TIENES_B = rx(`${L}(?:tienes|teneis)\\s+que\\s+(${INF})me${R}`);
const C_TIENES_C = rx(`${L}(?:tienes|teneis)\\s+que\\s+me\\s+(${INF})${R}`);
const C_VAS_A = rx(`${L}me\\s+vas\\s+a\\s+(${INF})${R}`);
const C_VAS_B = rx(`${L}vas\\s+a\\s+(${INF})me${R}`);
const C_OLVIDES = rx(`${L}(?:no\\s+te\\s+olvides\\s+de|acuerdate\\s+de|recuerda)\\s+(${INF})me${R}`);
const C_MARKER = rx(`${L}(?:me\\s+prometiste|prometiste\\s+que|quedaste\\s+en|me\\s+dijiste\\s+que)${R}`);
const CTX_QUEDAMOS = rx(`${L}(?:quedamos|habiamos\\s+quedado)\\s+en(?:\\s+que)?${R}`);
const C_SECOND = rx(`${L}me\\s+(?:(?:lo|la|los|las)\\s+)?(${alt(Object.keys(ES_SECOND).map((k) => fold(k)))})${R}`);
const C_EN_NEED = rx(`${L}you\\s+(?:need|have|got)\\s+to\\s+(${EN_ALL})\\s+me${R}`);
const C_EN_WILL = rx(`${L}you(?:'ll|\\s+will|'re\\s+going\\s+to|\\s+are\\s+going\\s+to)\\s+(${EN_ALL})\\s+me${R}`);
const C_EN_FORGET = rx(`${L}don't\\s+forget\\s+to\\s+(${EN_ALL})\\s+me${R}`);
const C_EN_PROMISED = rx(`${L}you\\s+promised\\s+(?:me|to)${R}`);

// "te mando un abrazo", "te doy las gracias": courtesy, not a promise
const COURTESY = rx(String.raw`^\s*(?:(?:un|una|unos|unas|mil|muchos|muchas|mis|mi|el|la|las)\s+)*(?:abrazos?|besos?|besitos?|saludos?|recuerdos?|cari[ñn]os?|gracias|[áa]nimos?|fuerzas?|mimos?|enhorabuena|palabra|raz[óo]n|consejo|bendiciones|suerte|apoyo)`);
const BENIGN_NEG = /\bno\s+(?:te\s+preocupes|pasa\s+nada|hay\s+(?:problema|prisa)|problem|worries)\b|\bno\s+problem\b|\bno\s+worries\b/gi;
const NEGATION = /(?<![\p{L}\d])(?:no|nunca|jam[aá]s|tampoco|ni|not|never|won't|wont|can't|cant|don't|dont|couldn't|shouldn't)(?![\p{L}\d])|n't(?![\p{L}\d])/iu;
const CONDITIONAL = /(?<![\p{L}\d])(?:si|if|cuando|when|siempre\s+que|en\s+caso\s+de)(?![\p{L}\d])/iu;
const HEDGE = /(?<![\p{L}\d])(?:quiz[aá]s?|tal\s+vez|a\s+lo\s+mejor|puede\s+que|podr[ií]a|ojal[aá]|maybe|perhaps|might|igual(?!\s+que)|probablemente|probably|supongo\s+que)(?![\p{L}\d])/iu;
const REPORTED = /^\s*(?:dice|dijo|dicen|dec[ií]a|ha\s+dicho|me\s+ha\s+dicho|me\s+dijo|te\s+dijo|said|says|he\s+said|she\s+said|they\s+said)(?![\p{L}\d])/iu;

// ------------------------------------------------------------------ time words --

const WD = "lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTHS_RX = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december";
const WEEKDAY_INDEX = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const NUM_WORD = String.raw`\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|a|an|one|two|three|four|five|six|seven|eight|nine|ten`;

const weekdayOf = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
const endOfWeek = (iso, weeks = 0) => addDays(iso, 6 - weekdayOf(iso) + 7 * weeks); // the Sunday

// Each rule: a regex on the accent-folded sentence and what day it means relative to `base` (the day the message was written).
const TIME_RULES = [
  { rx: rx(`(?:${L}(?:el|para el|antes del|hasta el|dia|el dia|before the|by the|on the|by|before|until|on)\\s+)?${L}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(${MONTHS_RX})(?:\\s+(?:de|of)\\s+(\\d{4}))?${R}`),
    day: (m, base) => parseDue(`${m[1]} de ${m[2]}${m[3] ? ` de ${m[3]}` : ""}`, { today: base }) },
  { rx: rx(String.raw`(?<![\d/-])\d{4}-\d{2}-\d{2}(?![\d/-])`), day: (m, base) => parseDue(m[0], { today: base }) },
  { rx: rx(String.raw`(?<![\d/:.-])\d{1,2}/\d{1,2}(?:/\d{2,4})?(?![\d/:])`), day: (m, base) => parseDue(m[0], { today: base }) },
  { rx: rx(`${L}(?:el|para el|antes del|hasta el|dia|el dia|by the|before the|on the)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:/h]|[.,]\\d|\\s*(?:de|of|euros?|eur|€|%|\\$|horas?|h)\\b)`),
    day: (m, base) => (Number(m[1]) >= 1 && Number(m[1]) <= 31 ? parseDue(`el ${m[1]}`, { today: base }) : null) },
  { rx: rx(`${L}(?:(?:el|este|proximo|el proximo|este proximo|pasado|next|this|on|by|before|until|antes del|hasta el|para el)\\s+)?(${WD})${R}`),
    day: (m, base) => parseDue(m[1], { today: base }) },
  { rx: rx(`${L}pasado\\s+manana${R}|${L}day\\s+after\\s+tomorrow${R}`), day: (m, base) => addDays(base, 2) },
  { rx: rx(`(?<!${L}(?:por la|de la|en la|esta|a la|la)\\s)${L}manana${R}|${L}tomorrow${R}`), day: (m, base) => addDays(base, 1) },
  { rx: rx(`${L}hoy(?:\\s+mismo)?${R}|${L}today${R}|${L}esta\\s+(?:noche|tarde)${R}|${L}tonight${R}|${L}this\\s+(?:evening|afternoon)${R}`), day: (m, base) => base },
  { rx: rx(`${L}(?:en|dentro\\s+de|in)\\s+(?:(?:${NUM_WORD})\\s+)(?:dias?|semanas?|meses|mes|days?|weeks?|months?)${R}`), day: (m, base) => parseDue(m[0], { today: base }) },
  { rx: rx(`${L}esta\\s+semana${R}|${L}this\\s+week${R}|${L}(?:este\\s+)?fin\\s+de\\s+semana${R}|${L}el\\s+finde${R}|${L}this\\s+weekend${R}`), day: (m, base) => endOfWeek(base) },
  { rx: rx(`${L}(?:la\\s+)?semana\\s+que\\s+viene${R}|${L}(?:la\\s+)?proxima\\s+semana${R}|${L}next\\s+week${R}`), day: (m, base) => endOfWeek(base, 1) },
  { rx: rx(`${L}(?:a\\s+)?(?:fin|final|finales)\\s+de(?:l)?\\s+mes${R}|${L}end\\s+of\\s+(?:the\\s+)?month${R}|${L}(?:el\\s+)?mes\\s+que\\s+viene${R}|${L}(?:el\\s+)?proximo\\s+mes${R}|${L}next\\s+month${R}`),
    day: (m, base) => parseDue(m[0], { today: base, vague: true }) },
];

/** The first time expression of `sentence` (after `from` when there is one there), as { text, due } or null. */
function findTime(sentence, base, from = 0) {
  const f = fold(sentence);
  const found = [];
  for (const rule of TIME_RULES) {
    const m = rule.rx.exec(f);
    if (!m) continue;
    let due = null;
    try { due = rule.day(m, base) || null; } catch { due = null; }
    if (due && due < base) due = null;
    if (!due) continue;
    found.push({ index: m.index, end: m.index + m[0].length, text: sentence.slice(m.index, m.index + m[0].length).trim(), due });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.index - b.index);
  return found.find((t) => t.index >= from) || found[0];
}

// ------------------------------------------------------------------ extraction --

const squash = (text) => String(text || "").replace(/\s+/g, " ").trim();

/** The sentences of one message that can hold a promise: no questions, no quoted or forwarded text. */
function sentencesOf(text) {
  let body = String(text || "").replace(/[’‘]/g, "'").replace(/\r/g, "");
  if (/^\s*(?:reenviado|forwarded|fwd?\s*:)/i.test(body)) return [];
  body = body.split("\n").filter((line) => !/^\s*(?:>|┃|\|)/.test(line)).join("\n");
  body = body.replace(/“[^”]*”|«[^»]*»|"[^"\n]{3,}"/g, " "); // what somebody else said, quoted
  body = body.replace(/https?:\/\/\S+/gi, " ");
  body = body.replace(/¿[^?]*\?/g, " ");        // Spanish questions, with their marks
  body = body.replace(/[^.!?\n;]*\?/g, " ");    // anything else that ends in a question mark
  return body.split(/(?<=[.!])\s+|\n+|;\s*/).map((s) => s.trim()).filter((s) => s.length >= 6);
}

/** Where the clause that holds `index` begins (after the last comma, colon or dash before it). */
function clauseStart(sentence, index) {
  const head = sentence.slice(0, index);
  return Math.max(head.lastIndexOf(","), head.lastIndexOf(":"), head.lastIndexOf(";"), head.lastIndexOf(" - ")) + 1;
}

function restAfter(sentence, end, time) {
  let rest = sentence.slice(end);
  if (time && time.index >= end) rest = sentence.slice(end, time.index) + " " + sentence.slice(time.end);
  rest = squash(rest)
    .replace(/^(?:[,:;-]\s*)+/, "")
    .replace(/^(?:a\s+ti\s+)?(?:que\s+)?/i, "")
    .replace(/^(?:you|him|her|them|us)(?:\s+|$)/i, "")
    .replace(/(?:^|[\s,])\s*(?:vale|ok|okey|okay|por\s+favor|please|sin\s+falta|tranquilo|tranqui|jaja+|ja+ja+|gracias)(?![\p{L}\d]).*$/iu, "")
    .replace(/[\p{Extended_Pictographic}\s.,;:!¡-]+$/u, "")
    .replace(/(?:\s+(?:para|antes\s+de|before|by|on|el|en|a|de|hasta|until|y|and))+$/i, "")
    .trim();
  return rest.split(/,\s*(?=(?:y\s+)?te\s)/i)[0]; // a second promise after a comma is not part of this one
}

const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

const FIRST = (matches) => matches.filter(Boolean).sort((a, b) => a.index - b.index)[0] || null;

/** The promise or claim in one (lowercased) sentence, or null: { role, label?, weak, index, end, debt? }. */
function findPattern(sentence) {
  const s = sentence.toLowerCase();
  const f = fold(s);
  const hits = [];
  const add = (m, info) => { if (m) hits.push({ index: m.index, end: m.index + m[0].length, ...info(m) }); };

  // promises: the speaker binds themselves
  add(P_TE.exec(s), (m) => ({ role: "promise", ...ES_FORM_TO_VERB.get(m[1]) }));
  add(P_IRA_A.exec(f), (m) => ({ role: "promise", label: cap(m[1]), weak: WEAK_INF.has(m[1]) }));
  add(P_IRA_B.exec(f), (m) => ({ role: "promise", label: cap(m[1]), weak: WEAK_INF.has(m[1]) }));
  add(P_DEBO.exec(s), () => ({ role: "promise", debt: true, weak: false }));
  add(P_TENGO.exec(f), (m) => ({ role: "promise", label: cap(m[1]), weak: WEAK_INF.has(m[1]) }));
  add(P_ENCARGO.exec(s), () => ({ role: "promise", label: "Encargarme de", weak: false }));
  add(P_YO.exec(s), () => ({ role: "promise", label: "", weak: false, bare: true }));
  add(P_PROMETO.exec(s), () => ({ role: "promise", label: "", weak: false, minRest: 8 }));
  add(P_EN.exec(s), (m) => ({ role: "promise", label: cap(m[1]), weak: EN_WEAK.includes(m[1]) }));
  add(P_EN_OWE.exec(s), () => ({ role: "promise", debt: true, weak: false }));

  // claims: the person addressed is bound to the speaker
  add(C_DEBES.exec(f), () => ({ role: "claim", debt: true, weak: false }));
  add(C_EN_OWE.exec(s), () => ({ role: "claim", debt: true, weak: false }));
  for (const re of [C_TIENES_A, C_TIENES_B, C_TIENES_C, C_VAS_A, C_VAS_B, C_OLVIDES]) {
    add(re.exec(f), (m) => ({ role: "claim", label: cap(m[1]), weak: WEAK_INF.has(m[1]) }));
  }
  for (const re of [C_EN_NEED, C_EN_WILL, C_EN_FORGET]) add(re.exec(s), (m) => ({ role: "claim", label: cap(m[1]), weak: EN_WEAK.includes(m[1]) }));
  add(C_EN_PROMISED.exec(s), () => ({ role: "claim", label: "", weak: false, minRest: 6 }));
  const marker = C_MARKER.exec(f);
  if (marker && /(?<![\p{L}\d])me(?![\p{L}\d])/u.test(f.slice(marker.index + marker[0].length))) {
    hits.push({ index: marker.index, end: marker.index + marker[0].length, role: "claim", label: "", weak: false, whole: true });
  }
  // "quedamos en que me lo pasas el lunes": only inside an agreement
  const ctx = CTX_QUEDAMOS.exec(f);
  if (ctx) {
    const second = C_SECOND.exec(f.slice(ctx.index + ctx[0].length));
    if (second) {
      const at = ctx.index + ctx[0].length + second.index;
      const inf = Object.entries(ES_SECOND).find(([k]) => fold(k) === second[1])?.[1] || "";
      hits.push({ index: at, end: at + second[0].length, role: "claim", label: cap(inf), weak: WEAK_INF.has(inf), whole: true });
    }
  }
  // "prometo que te lo devuelvo": the verb says more than the promise word
  const specific = hits.filter((h) => !h.minRest || h.role !== "promise");
  return FIRST(specific.length ? specific : hits);
}

/**
 * The commitments in one message: [{ direction, role, text, quote, due, due_text }]. `sender` is "me" or "them"; `at` the time the
 * message was written (ISO or ms): relative days ("el lunes", "mañana") count from that day.
 */
export function extractCommitments(text, { sender = "them", at = Date.now() } = {}) {
  const base = localDate(new Date(at).toISOString());
  const out = [];
  for (const sentence of sentencesOf(text)) {
    if (REPORTED.test(sentence) || HEDGE.test(sentence)) continue;
    const hit = findPattern(sentence);
    if (!hit) continue;
    const lower = sentence.toLowerCase();
    const start = clauseStart(lower, hit.index);
    const clause = lower.slice(start, hit.index).replace(BENIGN_NEG, " ");
    if (NEGATION.test(clause) || CONDITIONAL.test(clause)) continue;
    // "no" right after the verb ("te debo no sé qué") or a negated object is not a promise either
    if (/^\s*(?:nada|ning[uú]n|ninguna)(?![\p{L}\d])/iu.test(lower.slice(hit.end))) continue;
    if (COURTESY.test(lower.slice(hit.end))) continue;
    const time = findTime(sentence, base, hit.end);
    if (hit.weak && !time) continue;
    let rest = restAfter(sentence, hit.end, time);
    if (hit.label === "Encargarme de") rest = rest.replace(/^de\s+/i, "");
    if (hit.minRest && rest.length < hit.minRest) continue;
    let action;
    const asSaid = () => restAfter(sentence, start, null) || squash(sentence); // the clause itself, without what came before the comma
    if (hit.whole || hit.bare || !rest && !hit.label) action = asSaid();
    else if (hit.debt) action = rest || asSaid();
    else if (!rest) action = hit.weak ? hit.label : asSaid(); // "te llamo el martes" -> "Llamar"; "te lo mando" stays as said
    else if (/^llegar(?![\p{L}\d])/iu.test(rest)) action = asSaid();
    else action = hit.label ? `${hit.label} ${rest}` : rest;
    const direction = hit.role === "promise" ? (sender === "me" ? "i_owe" : "owed_to_me") : (sender === "me" ? "owed_to_me" : "i_owe");
    out.push({
      direction, role: hit.role, text: cap(action).slice(0, 200), quote: squash(sentence).slice(0, 400),
      due: time ? time.due : null, due_text: time ? time.text.slice(0, 120) : "",
    });
  }
  return out;
}

// ------------------------------------------------------------------ batches --

const sha = (text) => crypto.createHash("sha1").update(text).digest("hex");

const batchInput = z.object({
  messages: z.array(z.record(z.string(), z.any())).min(1, "Faltan mensajes.").max(MAX_BATCH, `Máximo ${MAX_BATCH} mensajes por tanda.`),
  refine: z.boolean().default(false),
  reprocess: z.boolean().default(false),
});

function senderOf(m) {
  if (typeof m.from_me === "boolean") return m.from_me ? "me" : "them";
  const raw = fold(m.sender ?? "").trim();
  if (["me", "yo", "mine", "own", "self"].includes(raw)) return "me";
  if (["them", "other", "ellos", "el", "ella", "contact", "contacto"].includes(raw)) return "them";
  return null;
}

function millisOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : /^\d+(\.\d+)?$/.test(String(value).trim()) ? Number(value) : null;
  if (n !== null) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

const digitsPhone = (m) => {
  const raw = String(m.phone || "").trim() || (/^\d{6,}@(?:s\.whatsapp\.net|c\.us)$/.test(String(m.chat_id || "")) ? String(m.chat_id).split("@")[0] : "");
  return raw ? (raw.startsWith("+") ? raw : /^\d{9,}$/.test(raw) ? `+${raw}` : raw) : "";
};

/** Who the other side of a chat is: a person (by phone, then by name), several candidates, or nobody in the book. */
function matchContact(m, cache) {
  const phone = digitsPhone(m);
  const name = squash(m.contact_name || m.contact || m.chat_name || "");
  const key = `${phone}|${fold(name)}`;
  if (cache.has(key)) return cache.get(key);
  let out = { state: "unknown", person: null, candidates: [], name: name || phone, phone };
  if (phone) {
    const alias = findAnyHandle(phone);
    const person = alias ? getPerson(alias.person_id) : null;
    if (person) out = { ...out, state: "person", person };
  }
  if (out.state !== "person" && name) {
    const named = commitments.resolveName(name);
    if (named.state === "person") out = { ...out, state: "person", person: named.person };
    else if (named.state === "ambiguous") out = { ...out, state: "ambiguous", candidates: named.candidates };
  }
  cache.set(key, out);
  return out;
}

const seen = (key) => !!db().prepare("SELECT 1 FROM message_ledger WHERE key = ?").get(key);
const markSeen = (key) => db().prepare("INSERT OR IGNORE INTO message_ledger (key, seen_at) VALUES (?, ?)").run(key, now());
const pruneLedger = () => db().prepare("DELETE FROM message_ledger WHERE seen_at < ?").run(new Date(Date.now() - LEDGER_DAYS * 86400000).toISOString());

const REFINE_SYSTEM = [
  "You find promises (commitments) in WhatsApp messages between the owner of this address book ('yo') and one contact.",
  "Only report a commitment when somebody clearly binds themselves, or clearly says the other one owes something. Never invent; ignore",
  "questions, offers, hypotheticals and small talk. `message` is the number in brackets of the message that holds it.",
  "direction is `i_owe` when the owner must do something for the contact, `owed_to_me` when the contact must do something for the owner.",
  "`quote` is the exact words of that message that show it, copied character by character. `due_text` is the deadline in the words used, or empty.",
  "If there are none, return an empty list.",
].join(" ");
const REFINE_SCHEMA = {
  type: "object",
  properties: { commitments: { type: "array", items: { type: "object", properties: {
    message: { type: "integer" }, direction: { type: "string", enum: ["i_owe", "owed_to_me"] }, action: { type: "string" },
    due_text: { type: "string" }, quote: { type: "string" } }, required: ["message", "direction", "action", "quote"] } } },
  required: ["commitments"],
};

/**
 * Optional: the local model (through the hub) reads the messages the rules found nothing in. What it finds only goes to the review
 * queue, with the quote verified against the message; nothing is recorded without a yes.
 */
async function refine(unhit, { chat = family.chat, today }) {
  if (!unhit.length) return { status: "nothing_to_read", proposals: 0 };
  const byChat = new Map();
  for (const item of unhit.slice(0, REFINE_MAX_MESSAGES)) {
    if (!byChat.has(item.chatKey)) byChat.set(item.chatKey, []);
    byChat.get(item.chatKey).push(item);
  }
  let proposals = 0;
  let dropped = 0;
  let status = "ok";
  for (const items of byChat.values()) {
    const lines = items.map((item, i) => `[${i}] ${item.sender === "me" ? "yo" : item.contact.name || "contacto"} (${localDate(item.atIso)}): ${item.text.slice(0, 800)}`);
    const reply = await chat({
      messages: [{ role: "system", content: REFINE_SYSTEM }, { role: "user", content: `Today is ${today}.\n\nMESSAGES:\n${lines.join("\n")}` }],
      json: REFINE_SCHEMA, effort: "low", maxTokens: 1500, temperature: 0.1, timeoutMs: 180000,
    });
    if (!reply.ok) { status = reply.error === "no_model" ? "no_model" : reply.error === "hub_down" ? "hub_down" : "error"; break; }
    const list = reply.json && Array.isArray(reply.json.commitments) ? reply.json.commitments : [];
    for (const entry of list.slice(0, 20)) {
      const item = items[Number(entry?.message)];
      const action = squash(entry?.action);
      const quote = item ? commitments.locateQuote(item.text, entry.quote) : null;
      if (!item || !action || !quote || !commitments.DIRECTIONS.includes(entry.direction)) { dropped++; continue; }
      const dueText = squash(entry.due_text);
      const due = dueText ? (findTime(dueText, localDate(item.atIso))?.due ?? null) : null;
      const review = commitments.queueReview({
        kind: "text", reason: "model_whatsapp",
        proposal: { direction: entry.direction, text: action.slice(0, 200), due, due_text: dueText.slice(0, 120), person_name_raw: item.contact.name || "",
          source: { kind: "whatsapp", ref: item.ref, quote: quote.slice(0, 400), at: item.atIso } },
        candidates: item.contact.state === "person" ? [item.contact.person] : item.contact.candidates,
        dedupe: commitments.dedupeKey("whatsapp", item.ref, action),
      });
      if (review) proposals++;
    }
  }
  return { status, proposals, dropped };
}

/**
 * Read a batch of chat messages and record the promises in them. Each message: { id, chat_id, contact_name, phone, sender:
 * "me"|"them" (or from_me), text, timestamp (ISO or epoch), is_group? }. Group chats are skipped (who owes whom is not clear).
 * Safe to repeat: a message already read is skipped, and a promise already recorded is never recorded twice.
 */
export async function commitmentsFromMessages(input, { today = todayLocal(), chat = family.chat, emit = true } = {}) {
  const { messages, refine: wantRefine, reprocess } = batchInput.parse(input || {});
  pruneLedger();
  const result = {
    status: "ok", received: messages.length, read: 0, skipped: { seen: 0, group: 0, empty: 0, invalid: 0 },
    found: 0, created: 0, duplicates: 0, queued: 0, linked: 0, unlinked: 0, commitments: [], review: [],
  };
  const cache = new Map();
  const unhit = [];
  for (const m of messages) {
    const sender = senderOf(m);
    const ms = millisOf(m.timestamp ?? m.ts ?? m.at);
    const text = String(m.text ?? m.body ?? "");
    if (!sender || ms === null) { result.skipped.invalid++; continue; }
    if (m.is_group === true || /@g\.us$/.test(String(m.chat_id || ""))) { result.skipped.group++; continue; }
    if (text.trim().length < 6) { result.skipped.empty++; continue; }
    const chatKey = String(m.chat_id || digitsPhone(m) || fold(m.contact_name || m.contact || "") || "chat").slice(0, 120);
    const msgKey = String(m.id ?? m.message_id ?? "").trim() || sha(`${ms}|${text}`).slice(0, 16);
    const ledgerKey = sha(`${chatKey}|${msgKey}`);
    if (!reprocess && seen(ledgerKey)) { result.skipped.seen++; continue; }
    result.read++;
    const atIso = new Date(ms).toISOString();
    const ref = `${chatKey}|${msgKey}`.slice(0, 200);
    const contact = matchContact(m, cache);
    const found = extractCommitments(text, { sender, at: ms });
    result.found += found.length;
    for (const c of found) {
      const key = commitments.dedupeKey("whatsapp", ref, c.text);
      if (contact.state === "ambiguous") {
        const review = commitments.queueReview({
          kind: "text", reason: "ambiguous",
          proposal: { direction: c.direction, text: c.text, due: c.due, due_text: c.due_text, person_name_raw: contact.name.slice(0, 120),
            source: { kind: "whatsapp", ref, quote: c.quote, at: atIso } },
          candidates: contact.candidates, dedupe: key,
        });
        if (review) { result.queued++; result.review.push(review.id); } else result.duplicates++;
        continue;
      }
      const added = commitments.addCommitment({
        direction: c.direction, person_id: contact.person ? contact.person.id : null, person_name_raw: contact.person ? "" : contact.name.slice(0, 120),
        text: c.text, due: c.due, due_text: c.due_text, source_kind: "whatsapp", source_ref: ref, source_quote: c.quote, source_at: atIso,
      }, { dedupe: key, today, emit, resolve: false });
      if (!added.created) { result.duplicates++; continue; }
      result.created++;
      if (contact.person) result.linked++; else result.unlinked++;
      result.commitments.push({
        id: added.commitment.id, direction: added.commitment.direction, text: added.commitment.text, due: added.commitment.due,
        person_id: added.commitment.person_id, person_name: added.commitment.person_name,
      });
    }
    if (!found.length && wantRefine) unhit.push({ chatKey, ref, sender, text, atIso, contact });
    markSeen(ledgerKey);
  }
  if (wantRefine) {
    try { result.refine = await refine(unhit, { chat, today }); } catch (error) { result.refine = { status: "error", detail: String(error.message || error).slice(0, 200) }; }
    result.queued += result.refine.proposals || 0;
  }
  return result;
}
