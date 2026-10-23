import React, { useState } from "react";
import { api } from "../api.js";
import { Field } from "./ui.jsx";
import { birthdayLabel } from "../format.js";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

export default function DuplicatePeople({ visible }) {
  const [minScore, setMinScore] = useState("0.7");
  const [limit, setLimit] = useState("20");
  const [archived, setArchived] = useState(false);
  const [result, setResult] = useState(null);
  const [query, setQuery] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filters = { min_score: Number(minScore), limit: Number(limit), archived };
  useCopilotContext(() => visible ? { editors: [{ kind: "people-duplicates", object_id: null,
    dirty: minScore !== "0.7" || limit !== "20" || archived, fields: filters }] } : {});
  useCopilotRefresh(() => { if (visible && query && !busy) search(query); });

  function clear() { setResult(null); setQuery(null); setError(""); }
  async function search(requested) {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api.people.duplicates(requested)); setQuery(requested); }
    catch (failure) { setError(`No se pudieron buscar coincidencias. ${failure.message}`); }
    finally { setBusy(false); }
  }

  return <section className="panel mb-4" aria-labelledby="people-duplicates-title">
    <h2 id="people-duplicates-title" className="text-[17px] font-semibold">Posibles duplicados</h2>
    <p className="help mt-2">Coincidencias orientativas por nombre, correo, teléfono y cumpleaños. Busca en toda la libreta, sin aplicar la búsqueda ni el círculo de Personas.</p>
    <form className="mt-4" onSubmit={(event) => { event.preventDefault(); search(filters); }} onChange={clear}>
      <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label="Similitud mínima"><select className="field" value={minScore} onChange={(event) => setMinScore(event.target.value)}>
          <option value="0.5">50 %</option><option value="0.7">70 %</option><option value="0.85">85 %</option><option value="1">100 %</option>
        </select></Field>
        <Field label="Máximo de parejas"><input className="field" type="number" min={1} max={100} step={1} required value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
        <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Incluir archivados</label>
        <button className="btn btn-primary" type="submit">{busy ? "Buscando…" : "Buscar coincidencias"}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="help mt-3">{error} Vuelve a intentarlo.</p>}
    <div role="status" aria-live="polite" className="help mt-3">
      {busy ? "Consultando coincidencias…" : result
        ? `${result.pairs.length} de ${result.total} parejas candidatas · ${result.scanned} personas examinadas.`
        : "La consulta no fusiona ni elimina personas."}
    </div>
    {result && !result.pairs.length && <p className="mt-3">No se encontraron coincidencias con estos filtros.</p>}
    {result?.pairs.length > 0 && <ol className="mt-4 divide-y" style={{ borderColor: "var(--line)" }}>
      {result.pairs.map((pair) => <li key={`${pair.a.id}:${pair.b.id}`} className="py-4 first:pt-0">
        <p className="font-semibold">Similitud: {Math.round(pair.score * 100)} %</p>
        <ul className="help mt-2 list-disc pl-5 break-words">{pair.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {[pair.a, pair.b].map((person) => <div key={person.id} className="min-w-0">
            <a href={`#/personas/${person.id}`} className="font-semibold break-words">{person.name}</a>
            {person.nickname && <p className="help break-words">«{person.nickname}»</p>}
            <p className="help mt-1">{person.facts} datos · {person.interactions} contactos</p>
            {person.birthday && <p className="help">Cumpleaños: {birthdayLabel(person.birthday)}</p>}
            {person.id === pair.suggested_keep_id && <p className="help mt-2">Sugerencia del motor para conservar, basada en datos y contactos registrados.</p>}
          </div>)}
        </div>
      </li>)}
    </ol>}
    {result?.pairs.length > 0 && <p className="help mt-3">Abre ambas fichas para revisarlas. La fusión manual sigue disponible en cada ficha.</p>}
  </section>;
}
