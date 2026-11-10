// «Prepárame para ver a X»: a short written catch-up before meeting someone. What is known is gathered here (the person brief:
// last contacts, facts, open commitments both ways, reminders; plus gift ideas and the next birthday or special date) and the
// family's model, through the hub, writes it as a few lines. The same material always comes back as a plain outline, so the
// answer is useful even when no model is serving (status no_model / hub_down / error, with the outline).
import { personBrief } from "./brief.js";
import { listGifts } from "./gifts.js";
import { listPersonDates, nextOccurrence } from "./person-dates.js";
import { nextBirthday, today as todayLocal } from "./dates.js";
import { sinceWords } from "./nudges.js";
import * as family from "./hoard-link.js";

const SYSTEM = [
  "Eres el asistente de una agenda personal. Preparas al dueño de la agenda para ver a una persona.",
  "Escribe en castellano de España, en segunda persona («le debes», «te debe»), sin saludo ni despedida.",
  "Usa SOLO los datos que te dan; no inventes nada ni supongas sentimientos. Si un dato falta, no lo menciones.",
  "Formato: entre 3 y 7 viñetas que empiezan por «- », de una o dos frases cada una, en este orden cuando haya datos:",
  "de qué hablasteis la última vez y cuándo; qué le debes y qué te debe (con fechas y si está vencido); temas pendientes",
  "y recordatorios; algo que conviene preguntarle o recordar (familia, gustos, fechas próximas). Termina con una línea",
  "«Para abrir: …» con una pregunta concreta para empezar la conversación basada en los datos.",
].join(" ");

const day = (iso) => String(iso || "").slice(0, 10);

/** Everything known about the person that matters before seeing them, as plain lines (also what the model reads). */
export function prepareMaterial(personId, { today = todayLocal() } = {}) {
  const brief = personBrief(personId);
  if (!brief) return null;
  const { person } = brief;
  const lines = [];
  lines.push(`Persona: ${person.name}${person.nickname ? ` («${person.nickname}»)` : ""}${person.summary ? `. ${person.summary}` : ""}`);
  if (person.location) lines.push(`Vive en: ${person.location}`);
  lines.push(person.last_contact_at
    ? `Último contacto: hace ${sinceWords(person.days_since_last_contact)} (${day(person.last_contact_at)})`
    : "Último contacto: no hay ninguno registrado");
  for (const item of brief.recent_interactions) lines.push(`Contacto ${day(item.at)} (${item.channel}): ${item.summary || "sin resumen"}`);
  for (const fact of brief.facts.slice(0, 12)) lines.push(`Dato: ${fact.key}: ${fact.value}`);
  const due = (c) => (c.due ? (c.overdue ? `venció el ${c.due}` : `para el ${c.due}`) : c.due_text ? `«${c.due_text}»` : "sin fecha");
  for (const c of brief.open_commitments.i_owe) lines.push(`Le debes: ${c.text} (${due(c)})`);
  for (const c of brief.open_commitments.owed_to_me) lines.push(`Te debe: ${c.text} (${due(c)})`);
  for (const r of brief.open_reminders) lines.push(`Recordatorio ${r.due}: ${r.text}`);
  const birthday = person.birthday ? nextBirthday(person.birthday, today) : null;
  if (birthday && birthday.daysUntil <= 60) lines.push(`Cumpleaños: ${birthday.date}, dentro de ${birthday.daysUntil} días${birthday.turningAge ? ` (cumple ${birthday.turningAge})` : ""}`);
  for (const d of listPersonDates(personId)) {
    const next = nextOccurrence(d, today);
    if (next && next.days_until <= 60) lines.push(`Fecha señalada: ${d.label}, ${next.date}, dentro de ${next.days_until} días`);
  }
  const ideas = listGifts({ person_id: personId, status: "idea", limit: 5 });
  if (ideas.length) lines.push(`Ideas de regalo guardadas: ${ideas.map((g) => g.idea).join("; ")}`);
  return { person: { id: person.id, name: person.name }, lines, counts: {
    i_owe: brief.open_commitments.i_owe.length, owed_to_me: brief.open_commitments.owed_to_me.length,
    reminders: brief.open_reminders.length, interactions: brief.interaction_count } };
}

/**
 * The written preparation. Returns { status: "ok", text, model, outline, person, counts } or, without a model, the same with
 * status no_model / hub_down / error and `detail`, and the outline alone. null when the person does not exist.
 */
export async function prepareToMeet(personId, { chat = family.chat, today = todayLocal() } = {}) {
  const material = prepareMaterial(personId, { today });
  if (!material) return null;
  const base = { person: material.person, outline: material.lines, counts: material.counts, as_of: today };
  const reply = await chat({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Hoy es ${today}. Datos de la agenda:\n${material.lines.map((l) => `- ${l}`).join("\n")}` },
    ],
    effort: "low", maxTokens: 700, temperature: 0.2, timeoutMs: 120000,
  });
  if (!reply.ok) {
    const status = reply.error === "no_model" ? "no_model" : reply.error === "hub_down" ? "hub_down" : "error";
    return { status, detail: reply.detail || reply.error || "", text: "", ...base };
  }
  const text = String(reply.text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) return { status: "error", detail: "El modelo respondió vacío.", text: "", ...base };
  return { status: "ok", text, model: reply.model || null, ...base };
}
