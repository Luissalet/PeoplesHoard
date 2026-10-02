// The four repeatable sections of a person's page: facts, aliases,
// interactions and reminders. Each keeps its own small add-form and calls
// back into Persona.jsx to reload the record after a write.
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, useAction } from "./ui.jsx";
import { CHANNELS, ALIAS_KINDS, REMINDER_KINDS, dateLabel, dateTimeLabel } from "../format.js";

export function FactsSection({ person, reload, notify }) {
  const [form, setForm] = useState({ key: "", value: "" });
  const [run, busy] = useAction(notify);
  const add = async (e) => {
    e.preventDefault();
    if (!form.key.trim() || !form.value.trim()) return;
    const out = await run(() => api.facts.add(person.id, form), "Dato guardado.");
    if (out) { setForm({ key: "", value: "" }); reload(); }
  };
  const remove = async (id) => { if (await run(() => api.facts.remove(id), "Dato borrado.")) reload(); };
  return (
    <div>
      {person.facts.length ? (
        <ul className="mb-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {person.facts.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-2 py-2 text-[13px]">
              <div><span className="font-semibold">{f.key}:</span> {f.value}</div>
              <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(f.id)}>Borrar</button>
            </li>
          ))}
        </ul>
      ) : <p className="help mb-3">Sin datos guardados todavía.</p>}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Clave"><input className="field field-sm" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} placeholder="le gusta" maxLength={80} /></Field>
        <Field label="Valor"><input className="field field-sm" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder="el senderismo" maxLength={2000} /></Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Añadir</button>
      </form>
    </div>
  );
}

export function AliasesSection({ person, reload, notify }) {
  const [form, setForm] = useState({ kind: "whatsapp", value: "" });
  const [run, busy] = useAction(notify);
  const add = async (e) => {
    e.preventDefault();
    if (!form.value.trim()) return;
    const out = await run(() => api.aliases.add(person.id, form), "Alias guardado.");
    if (out) { setForm({ kind: "whatsapp", value: "" }); reload(); }
  };
  const remove = async (id) => { if (await run(() => api.aliases.remove(id), "Alias borrado.")) reload(); };
  return (
    <div>
      {person.aliases.length ? (
        <ul className="mb-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {person.aliases.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <div><span className="chip">{ALIAS_KINDS[a.kind] || a.kind}</span> <span className="ml-1">{a.value}</span></div>
              <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(a.id)}>Borrar</button>
            </li>
          ))}
        </ul>
      ) : <p className="help mb-3">Sin alias: así se resuelven mensajes de WhatsApp, correo o teléfono a esta persona.</p>}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Tipo">
          <select className="field field-sm" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {Object.entries(ALIAS_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Valor"><input className="field field-sm" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder="nombre en el chat, correo o teléfono" maxLength={200} /></Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Añadir</button>
      </form>
    </div>
  );
}

export function InteractionsSection({ person, reload, notify }) {
  const [form, setForm] = useState({ channel: "whatsapp", summary: "" });
  const [run, busy] = useAction(notify);
  const add = async (e) => {
    e.preventDefault();
    const out = await run(() => api.interactions.add(person.id, form), "Contacto apuntado.");
    if (out) { setForm({ channel: "whatsapp", summary: "" }); reload(); }
  };
  const remove = async (id) => { if (await run(() => api.interactions.remove(id), "Borrado.")) reload(); };
  return (
    <div>
      <form onSubmit={add} className="mb-4 grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-end">
        <Field label="Canal">
          <select className="field field-sm" value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
            {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Qué hablasteis"><input className="field field-sm" value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} placeholder="Un resumen breve" maxLength={2000} /></Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>He hablado hoy</button>
      </form>
      {person.interactions.length ? (
        <ul className="space-y-4">
          {person.interactions.map((i) => (
            <li key={i.id} className="timeline-item">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="chip">{CHANNELS[i.channel] || i.channel}</span>{" "}
                  <span className="help">{dateTimeLabel(i.at)}</span>
                  {i.summary && <p className="mt-1 text-[13px]">{i.summary}</p>}
                </div>
                <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(i.id)}>Borrar</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="help">Sin contactos registrados todavía.</p>}
    </div>
  );
}

export function RemindersSection({ person, reload, notify }) {
  const [form, setForm] = useState({ due: "", text: "", kind: "custom" });
  const [run, busy] = useAction(notify);
  const add = async (e) => {
    e.preventDefault();
    if (!form.due || !form.text.trim()) return;
    const out = await run(() => api.reminders.add(person.id, form), "Recordatorio creado.");
    if (out) { setForm({ due: "", text: "", kind: "custom" }); reload(); }
  };
  const toggle = async (r) => { if (await run(() => api.reminders.update(r.id, { done: !r.done }), null)) reload(); };
  const remove = async (id) => { if (await run(() => api.reminders.remove(id), "Recordatorio borrado.")) reload(); };
  const open = person.reminders.filter((r) => !r.done);
  const done = person.reminders.filter((r) => r.done);
  return (
    <div>
      <form onSubmit={add} className="mb-4 grid gap-2 sm:grid-cols-[140px_1fr_130px_auto] sm:items-end">
        <Field label="Fecha"><input type="date" className="field field-sm" value={form.due} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} required /></Field>
        <Field label="Texto"><input className="field field-sm" value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} placeholder="Qué recordar" maxLength={2000} required /></Field>
        <Field label="Tipo">
          <select className="field field-sm" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {Object.entries(REMINDER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Añadir</button>
      </form>
      {open.length > 0 && (
        <ul className="mb-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {open.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2 text-[13px]">
              <input type="checkbox" checked={false} onChange={() => toggle(r)} aria-label={`Marcar «${r.text}» como hecho`} />
              <span className="help num w-[80px] shrink-0">{dateLabel(r.due)}</span>
              <span className="flex-1">{r.text}</span>
              <span className="chip">{REMINDER_KINDS[r.kind] || r.kind}</span>
              <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(r.id)}>Borrar</button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details>
          <summary className="help cursor-pointer">{done.length} completados</summary>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
            {done.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2 text-[13px]" style={{ opacity: 0.6 }}>
                <input type="checkbox" checked onChange={() => toggle(r)} aria-label={`Marcar «${r.text}» como pendiente`} />
                <span className="help num w-[80px] shrink-0">{dateLabel(r.due)}</span>
                <span className="flex-1 line-through">{r.text}</span>
                <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(r.id)}>Borrar</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!person.reminders.length && <p className="help">Sin recordatorios.</p>}
    </div>
  );
}

const WATCH_PROBLEMS = {
  hub_down: "No se puede contactar con el hub de Hoard Link.",
  tool_missing: "Esta versión de Tantalus no sabe vigilar productos por ahora.",
  tantalus_unavailable: "Tantalus no está en marcha.",
  tantalus_error: "Tantalus no pudo crear el vigilante.",
};

/** Gift ideas of one person: add, mark as given or dropped, ask Tantalus to watch the price, delete. */
export function GiftsSection({ person, notify }) {
  const [gifts, setGifts] = useState(null);
  const [form, setForm] = useState({ idea: "", url: "", budget: "" });
  const [run, busy] = useAction(notify);
  const load = useCallback(async () => {
    try { setGifts((await api.gifts.list({ person: person.id, status: "all" })).gifts); } catch (e) { notify({ kind: "error", text: e.message }); }
  }, [person.id, notify]);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    if (!form.idea.trim()) return;
    const body = { idea: form.idea, url: form.url, budget: form.budget === "" ? null : Number(form.budget) };
    const out = await run(() => api.gifts.add(person.id, body), "Idea guardada.");
    if (out) { setForm({ idea: "", url: "", budget: "" }); load(); }
  };
  const setStatus = async (g, status, message) => { if (await run(() => api.gifts.update(g.id, { status }), message)) load(); };
  const remove = async (g) => { if (await run(() => api.gifts.remove(g.id), "Idea borrada.")) load(); };
  const watch = async (g) => {
    try {
      const out = await api.gifts.watch(g.id);
      if (out.ok) notify({ kind: "ok", text: out.existing ? "Ya se está vigilando en Tantalus." : "Tantalus vigila esta idea." });
      else notify({ kind: "error", text: WATCH_PROBLEMS[out.status] || out.detail || "No se pudo vigilar." });
      load();
    } catch (e) { notify({ kind: "error", text: e.message }); }
  };
  const open = (gifts || []).filter((g) => g.status === "idea");
  const closed = (gifts || []).filter((g) => g.status !== "idea");
  return (
    <div>
      <form onSubmit={add} className="mb-4 grid gap-2 sm:grid-cols-[2fr_2fr_100px_auto] sm:items-end">
        <Field label="Idea"><input className="field field-sm" value={form.idea} onChange={(e) => setForm((f) => ({ ...f, idea: e.target.value }))} placeholder="Qué le regalarías" maxLength={300} required /></Field>
        <Field label="Página (opcional)"><input className="field field-sm" type="url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" maxLength={2000} /></Field>
        <Field label="Máximo (€)"><input className="field field-sm" type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} /></Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Guardar idea</button>
      </form>
      {gifts === null ? <p className="help">Cargando…</p> : open.length ? (
        <ul className="mb-3 divide-y" style={{ borderColor: "var(--line)" }} data-testid="gift-list">
          {open.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
              <span className="flex-1 min-w-[160px]">
                {g.url ? <a href={g.url} target="_blank" rel="noreferrer noopener" className="btn-link">{g.idea}</a> : g.idea}
                {g.budget !== null && <span className="help"> · hasta {g.budget} €</span>}
                {g.watched && <span className="chip ml-2" title="Tantalus vigila esta idea">Vigilada</span>}
              </span>
              {!g.watched && <button type="button" className="btn-link shrink-0" onClick={() => watch(g)}>Vigilar precio</button>}
              <button type="button" className="btn-link shrink-0" onClick={() => setStatus(g, "bought", "Marcada como regalada.")}>Ya regalado</button>
              <button type="button" className="btn-link shrink-0" onClick={() => setStatus(g, "dropped", "Idea descartada.")}>Descartar</button>
              <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(g)}>Borrar</button>
            </li>
          ))}
        </ul>
      ) : <p className="help mb-3">Sin ideas pendientes. Unos días antes de su cumpleaños te las recordaré en el resumen diario.</p>}
      {closed.length > 0 && (
        <details>
          <summary className="help cursor-pointer">{closed.length} regaladas o descartadas</summary>
          <ul className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
            {closed.map((g) => (
              <li key={g.id} className="flex items-center gap-2 py-2 text-[13px]" style={{ opacity: 0.6 }}>
                <span className="flex-1">{g.idea}</span>
                <span className="chip">{g.status === "bought" ? "Regalada" : "Descartada"}</span>
                <button type="button" className="btn-link shrink-0" onClick={() => setStatus(g, "idea", "Idea recuperada.")}>Recuperar</button>
                <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(g)}>Borrar</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
