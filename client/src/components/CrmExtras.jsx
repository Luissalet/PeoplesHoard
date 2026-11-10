// The pieces that let the address book work on its own: special dates on a person, «Prepárame» before seeing someone,
// the vCard import with its preview, and the «Qué debo / Qué me deben» balance of open commitments.
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, Section, useAction } from "./ui.jsx";
import { birthdayLabel, commitmentDue, daysUntilBirthday } from "../format.js";
import { useCopilotContext } from "../copilot-hooks.js";

const blankDate = { label: "", day: "", noYear: false, yearly: true };

/** Special dates of one person (anniversary, saint's day…): add, list, remove. */
export function DatesSection({ person, reload, notify }) {
  const [form, setForm] = useState(blankDate);
  const [run, busy] = useAction(notify);
  useCopilotContext(() => ({ editors: form.label.trim() || form.day ? [{ kind: "person-date-new", object_id: null, person_id: person.id, dirty: true, fields: form }] : [] }));
  const add = async (e) => {
    e.preventDefault();
    if (!form.label.trim() || !form.day) return;
    const date = form.noYear ? `--${form.day.slice(5)}` : form.day;
    const out = await run(() => api.dates.add(person.id, { label: form.label.trim(), date, yearly: form.noYear || form.yearly }), "Fecha guardada.");
    if (out) { setForm(blankDate); reload(); }
  };
  const remove = async (id) => { if (await run(() => api.dates.remove(id), "Fecha borrada.")) reload(); };
  const dates = person.dates || [];
  return (
    <div>
      <form onSubmit={add} className="mb-3 grid gap-2 sm:grid-cols-[1fr_150px_auto] sm:items-end" aria-label="Nueva fecha señalada">
        <Field label="Qué"><input className="field field-sm" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Aniversario de boda, santo…" maxLength={120} required /></Field>
        <Field label="Día"><input type="date" className="field field-sm" value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))} required /></Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Añadir</button>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] sm:col-span-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.yearly || form.noYear} disabled={form.noYear} onChange={(e) => setForm((f) => ({ ...f, yearly: e.target.checked }))} /> Se repite cada año</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.noYear} onChange={(e) => setForm((f) => ({ ...f, noYear: e.target.checked }))} /> No sé el año</label>
        </div>
      </form>
      {dates.length ? (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {dates.map((d) => {
            const soon = d.yearly ? daysUntilBirthday(d.date) : null;
            return (
              <li key={d.id} className="flex items-center gap-2 py-2 text-[13px]" data-testid="person-date">
                <span className="flex-1">{d.label}</span>
                <span className="help">{birthdayLabel(d.date)}{d.yearly ? " · cada año" : ""}</span>
                {soon !== null && soon <= 30 && <span className="chip chip-warn">{soon === 0 ? "hoy" : `en ${soon} d`}</span>}
                <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} onClick={() => remove(d.id)} disabled={busy}>Borrar</button>
              </li>
            );
          })}
        </ul>
      ) : <p className="help">Sin fechas señaladas. Salen en la agenda, en el calendario y en el resumen diario una semana antes y el mismo día.</p>}
    </div>
  );
}

const PREPARE_PROBLEMS = {
  no_model: "No hay ningún modelo de la familia disponible ahora; aquí tienes lo que hay en la agenda.",
  hub_down: "No se puede contactar con el hub de Hoard Link; aquí tienes lo que hay en la agenda.",
  error: "El modelo no respondió bien; aquí tienes lo que hay en la agenda.",
};

/** «Prepárame»: the family model writes a short catch-up; the plain outline is the fallback. */
export function PreparePanel({ person, notify, onClose }) {
  const [result, setResult] = useState(null);
  const [run, busy] = useAction(notify);
  const prepare = async () => {
    setResult(null);
    const out = await run(() => api.people.prepare(person.id), null);
    if (out) setResult(out);
  };
  useEffect(() => { prepare(); }, [person.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = result?.status === "ok" ? result.text.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  return (
    <Section title={`Prepárame para ver a ${person.name}`} aside={
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={prepare} disabled={busy}>{busy ? "Preparando…" : "Volver a preparar"}</button>
        <button type="button" className="btn btn-sm" onClick={onClose}>Cerrar</button>
      </div>
    }>
      <div data-testid="prepare" aria-live="polite">
        {!result && <p className="help">{busy ? "Leyendo la ficha y escribiendo la preparación con el modelo de la familia…" : ""}</p>}
        {result?.status === "ok" && (
          <>
            <ul className="space-y-2 text-[14px]">
              {lines.map((line, i) => <li key={i} className={/^para abrir/i.test(line) ? "font-semibold" : undefined}>{line.replace(/^[-*•]\s*/, "")}</li>)}
            </ul>
            <p className="help mt-3">Escrito con {result.model || "el modelo de la familia"} a partir de la ficha.</p>
          </>
        )}
        {result && result.status !== "ok" && (
          <>
            <p className="mb-2 text-[13px]" style={{ color: "var(--danger-ink)" }} role="status">{PREPARE_PROBLEMS[result.status] || result.detail}</p>
            <ul className="space-y-1 text-[13px]">{result.outline.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </>
        )}
      </div>
    </Section>
  );
}

const ACTION_WORDS = { create: "Nueva", update: "Completa a", unchanged: "Sin cambios" };

/** Import a .vcf: read the file, show what would happen, then import on a click. */
export function VcardImport({ notify, onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [run, busy] = useAction(notify);
  useCopilotContext(() => ({ editors: file ? [{ kind: "vcard-import", object_id: null, dirty: true, fields: { file: file.name, cards: preview?.cards ?? null } }] : [] }));
  const choose = async (f) => {
    setPreview(null);
    if (!f) return setFile(null);
    const text = await f.text();
    setFile({ name: f.name, text });
    const out = await run(() => api.people.importVcard(text, false), null);
    if (out) setPreview(out);
  };
  const apply = async () => {
    const out = await run(() => api.people.importVcard(file.text, true), null);
    if (!out) return;
    notify({ kind: "ok", text: `Importado: ${out.create} ${out.create === 1 ? "persona nueva" : "personas nuevas"} y ${out.update} ${out.update === 1 ? "completada" : "completadas"}${out.conflicts ? `; ${out.conflicts} datos de contacto ya eran de otra persona y no se han movido` : ""}.` });
    setFile(null); setPreview(null); onDone();
  };
  const changes = (item) => [
    ...Object.keys(item.fill).map((k) => ({ birthday: "cumpleaños", nickname: "apodo", location: "ubicación", circles: "círculos" }[k] || k)),
    ...item.aliases.map((a) => a.value),
    ...item.facts.map((f) => f.key),
    ...(item.anniversary ? ["aniversario"] : []),
  ];
  return (
    <div className="panel mb-4" data-testid="vcard-import">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="font-semibold">Importar contactos (.vcf)</h2>
        <button type="button" className="btn btn-sm" onClick={onClose}>Cerrar</button>
      </div>
      <p className="help mb-3">Un archivo .vcf del móvil o de otra agenda. Cada contacto se une a quien ya tenga ese correo o teléfono (o el mismo nombre exacto) y solo completa lo que falta; nada se sobrescribe. Primero ves lo que va a pasar.</p>
      <input type="file" accept=".vcf,text/vcard,text/x-vcard" aria-label="Archivo vCard" onChange={(e) => choose(e.target.files[0])} disabled={busy} />
      {busy && !preview && <p className="help mt-2">Leyendo…</p>}
      {preview && (
        <div className="mt-3">
          <p className="text-[13px]" role="status">{preview.cards} {preview.cards === 1 ? "contacto" : "contactos"}: {preview.create} {preview.create === 1 ? "nuevo" : "nuevos"}, {preview.update} {preview.update === 1 ? "completa" : "completan"} a alguien, {preview.unchanged} sin cambios{preview.conflicts ? `, ${preview.conflicts} datos ya son de otra persona` : ""}.</p>
          <ul className="mt-2 max-h-[320px] divide-y overflow-auto" style={{ borderColor: "var(--line)" }}>
            {preview.items.map((item, i) => (
              <li key={i} className="py-2 text-[13px]">
                <span className={`chip ${item.action === "create" ? "chip-ok" : item.action === "update" ? "chip-circle" : ""}`}>{ACTION_WORDS[item.action]}</span>{" "}
                {item.action === "create" ? <strong>{item.name}</strong> : <><strong>{item.person_name}</strong>{item.name !== item.person_name && <span className="help"> (en el archivo: {item.name})</span>}</>}
                {item.name_differs && <span className="chip chip-warn ml-1" title="Se une por el correo o el teléfono aunque el nombre es distinto">nombre distinto</span>}
                {changes(item).length > 0 && <span className="help"> · añade {changes(item).join(", ")}</span>}
                {item.conflicts.map((c, j) => <div key={j} className="help" style={{ color: "var(--danger-ink)" }}>{c.value} ya es de {c.person_name || "otra persona"}: no se mueve.</div>)}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !(preview.create + preview.update)}>Importar {preview.create + preview.update}</button>
            <button type="button" className="btn" onClick={() => { setFile(null); setPreview(null); }}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Open commitments grouped by person, both ways: what I owe and what I am owed. */
export function CommitmentBalance({ open, onPick }) {
  if (!open) return null;
  const side = (direction) => {
    const groups = new Map();
    for (const c of open.filter((x) => x.direction === direction)) {
      const key = c.person_id || `raw:${c.person_name || ""}`;
      if (!groups.has(key)) groups.set(key, { person_id: c.person_id, name: c.person_name || "Sin persona", items: [] });
      groups.get(key).items.push(c);
    }
    return [...groups.values()].sort((a, b) => b.items.filter((c) => c.overdue).length - a.items.filter((c) => c.overdue).length || b.items.length - a.items.length);
  };
  const column = (direction, title, empty) => {
    const groups = side(direction);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const late = groups.reduce((n, g) => n + g.items.filter((c) => c.overdue).length, 0);
    return (
      <div data-testid={`balance-${direction}`}>
        <h3 className="mb-2 text-[14px] font-semibold">{title} <span className="help num">{total}{late ? ` · ${late} vencidos` : ""}</span></h3>
        {groups.length ? (
          <ul className="space-y-3">
            {groups.map((g) => (
              <li key={g.person_id || g.name} className="text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  {g.person_id ? <a href={`#/personas/${g.person_id}`} className="font-semibold" style={{ color: "var(--accent)" }}>{g.name}</a> : <span className="font-semibold">{g.name}</span>}
                  {g.person_id && <button type="button" className="btn-link shrink-0" onClick={() => onPick({ person: g.person_id, direction })}>Ver en la lista</button>}
                </div>
                <ul className="mt-1 space-y-[2px]">
                  {g.items.slice(0, 4).map((c) => (
                    <li key={c.id} className="flex flex-wrap gap-x-2"><span>{c.text}</span><span className={c.overdue ? "chip chip-danger" : "help"}>{commitmentDue(c)}</span></li>
                  ))}
                  {g.items.length > 4 && <li className="help">y {g.items.length - 4} más</li>}
                </ul>
              </li>
            ))}
          </ul>
        ) : <p className="help">{empty}</p>}
      </div>
    );
  };
  return (
    <Section title="Balance">
      <div className="grid gap-5 md:grid-cols-2">
        {column("i_owe", "Qué debo", "No le debes nada a nadie.")}
        {column("owed_to_me", "Qué me deben", "Nadie te debe nada.")}
      </div>
    </Section>
  );
}
