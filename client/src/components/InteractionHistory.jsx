import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Field } from "./ui.jsx";
import { historyQuery } from "../history-filters.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

const blank = { q: "", person_id: "", channel: "", from: "", to: "", include_archived: false, limit: "25" };
const channels = { whatsapp: "WhatsApp", email: "Correo", call: "Llamada", meet: "Reunión", message: "Mensaje", other: "Otro" };
const sources = { manual: "Manual", agent: "Agente", mail: "Correo" };
const momentLabel = (value) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });

export default function InteractionHistory({ visible }) {
  const [form, setForm] = useState(blank);
  const [people, setPeople] = useState([]);
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => { if (visible) api.people.list({ archived: "all" }).then(setPeople).catch(() => {}); }, [visible]);
  useCopilotContext(() => visible ? { editors: [{ kind: "interaction-history", object_id: null,
    dirty: JSON.stringify(form) !== JSON.stringify(blank), fields: form }],
    view: { interaction_history: { applied, total: result?.total ?? null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } } } : {});
  useCopilotRefresh(() => { if (visible && applied && !busy) search(applied); });

  function change(key, value) {
    generation.current += 1;
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null); setApplied(null); setError(""); setBusy(false);
  }
  async function search(query) {
    const request = ++generation.current;
    setBusy(true); setError(""); setResult(null);
    try {
      const answer = await api.interactions.search(query);
      if (request === generation.current) { setResult(answer); setApplied(query); }
    } catch (failure) { if (request === generation.current) setError(failure.message); }
    finally { if (request === generation.current) setBusy(false); }
  }
  const submit = (event) => {
    event.preventDefault();
    try { search(historyQuery(form)); }
    catch (failure) { setResult(null); setApplied(null); setError(failure.message); }
  };
  return <section className="panel mb-4" aria-labelledby="interaction-history-title">
    <h2 id="interaction-history-title" className="text-[17px] font-semibold">Historial de contactos</h2>
    <p className="help mt-2">Busca en todos los contactos registrados, también los antiguos. Estos filtros son independientes de la búsqueda y los círculos de Personas.</p>
    <form onSubmit={submit} className="mt-4">
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Texto del historial"><input className="field" value={form.q} maxLength={200} onChange={(e) => change("q", e.target.value)} placeholder="Resumen, nombre o apodo" /></Field>
        <Field label="Persona del historial"><select className="field" value={form.person_id} onChange={(e) => change("person_id", e.target.value)}><option value="">Todas</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.archived ? " · Archivada" : ""}</option>)}</select></Field>
        <Field label="Canal del contacto"><select className="field" value={form.channel} onChange={(e) => change("channel", e.target.value)}><option value="">Todos</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Desde el día"><input type="date" className="field" value={form.from} onChange={(e) => change("from", e.target.value)} /></Field>
        <Field label="Hasta el día"><input type="date" className="field" value={form.to} onChange={(e) => change("to", e.target.value)} /></Field>
        <Field label="Contactos por página"><select className="field" value={form.limit} onChange={(e) => change("limit", e.target.value)}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.include_archived} onChange={(e) => change("include_archived", e.target.checked)} />Incluir personas archivadas</label>
        <div className="flex flex-wrap gap-2"><button type="submit" className="btn btn-primary">{busy ? "Consultando…" : "Buscar contactos"}</button><button className="btn" type="button" onClick={() => { generation.current += 1; setForm(blank); setResult(null); setApplied(null); setError(""); }}>Limpiar filtros</button></div>
      </fieldset>
    </form>
    <p className="help mt-3">Días completos en {Intl.DateTimeFormat().resolvedOptions().timeZone}. Se consultan los resúmenes guardados; no se leen mensajes externos.</p>
    {error && <p role="alert" className="help mt-3">{error} Revisa los filtros o vuelve a intentarlo.</p>}
    <p role="status" className="help mt-3">{busy ? "Consultando el historial…" : result ? `Contactos encontrados: ${result.total} · Mostrados: ${result.interactions.length ? result.offset + 1 : 0}–${result.offset + result.interactions.length}.` : "Aplica los filtros para consultar el historial."}</p>
    {result && !result.interactions.length && <p className="mt-3">No hay contactos registrados que coincidan con estos filtros.</p>}
    {result?.interactions.length > 0 && <ol className="mt-4 divide-y" style={{ borderColor: "var(--line)" }}>{result.interactions.map((row) => <li key={row.id} className="min-w-0 py-4 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><a className="font-semibold break-words" href={`#/personas/${row.person_id}`}>{row.person_name}</a><time className="help" dateTime={row.at}>{momentLabel(row.at)}</time></div>
      <p className="help mt-1">{channels[row.channel] || row.channel} · {sources[row.source] || row.source}{row.person_archived ? " · Persona archivada" : ""}</p>
      <p className="mt-2 whitespace-pre-wrap break-words">{row.summary || "Sin resumen registrado."}</p>
    </li>)}</ol>}
    {result && <div className="mt-4 flex flex-wrap gap-3"><button className="btn" type="button" disabled={busy || result.offset === 0} onClick={() => search({ ...applied, offset: Math.max(0, result.offset - result.limit) })}>Anteriores</button><button className="btn" type="button" disabled={busy || !result.has_more} onClick={() => search({ ...applied, offset: result.offset + result.limit })}>Siguientes</button></div>}
  </section>;
}
