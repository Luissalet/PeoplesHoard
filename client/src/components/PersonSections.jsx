// The four repeatable sections of a person's page: facts, aliases,
// interactions and reminders. Each keeps its own small add-form and calls
// back into Persona.jsx to reload the record after a write.
import React, { useState } from "react";
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
