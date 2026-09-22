import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, useAction, ConfirmDialog } from "../components/ui.jsx";
import { FactsSection, AliasesSection, InteractionsSection, RemindersSection } from "../components/PersonSections.jsx";
import { daysAgoLabel, birthdayLabel } from "../format.js";

function HeaderForm({ person, onSave, onCancel, busy }) {
  const [form, setForm] = useState({
    name: person.name,
    nickname: person.nickname,
    circles: person.circles.join(", "),
    birthday: person.birthday || "",
    location: person.location,
    how_met: person.how_met,
    contact_every_days: person.contact_every_days ?? "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    onSave({
      name: form.name,
      nickname: form.nickname,
      circles: form.circles.split(",").map((c) => c.trim()).filter(Boolean),
      birthday: form.birthday.trim() || null,
      location: form.location,
      how_met: form.how_met,
      contact_every_days: form.contact_every_days === "" ? null : Number(form.contact_every_days),
    });
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-2">
      <Field label="Nombre"><input className="field" value={form.name} onChange={set("name")} required maxLength={120} /></Field>
      <Field label="Apodo"><input className="field" value={form.nickname} onChange={set("nickname")} maxLength={80} /></Field>
      <Field label="Círculos" help="Separados por comas"><input className="field" value={form.circles} onChange={set("circles")} placeholder="familia, amigos, trabajo" /></Field>
      <Field label="Cumpleaños" help="AAAA-MM-DD, o --MM-DD si no sabes el año"><input className="field" value={form.birthday} onChange={set("birthday")} placeholder="1990-03-14 o --03-14" /></Field>
      <Field label="Ubicación"><input className="field" value={form.location} onChange={set("location")} maxLength={120} /></Field>
      <Field label="Cómo os conocisteis"><input className="field" value={form.how_met} onChange={set("how_met")} maxLength={2000} /></Field>
      <Field label="Hablar cada (días)" help="Vacío = sin recordatorio de contacto"><input className="field" inputMode="numeric" value={form.contact_every_days} onChange={set("contact_every_days")} placeholder="30" /></Field>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>Guardar datos</button>
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function MergePanel({ person, onDone, notify }) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [run, busy] = useAction(notify);
  const search = async (value) => {
    setQ(value);
    if (!value.trim()) return setCandidates([]);
    try {
      const results = await api.people.list({ q: value });
      setCandidates(results.filter((p) => p.id !== person.id));
    } catch { /* ignore transient search errors */ }
  };
  const merge = async (other) => {
    const out = await run(() => api.people.merge(person.id, other.id), `Fusionada con ${other.name}.`);
    if (out) onDone();
  };
  return (
    <div className="panel mt-3">
      <p className="help mb-2">Busca a la persona duplicada. Sus datos, alias, contactos y recordatorios pasarán aquí; ella se borrará.</p>
      <input className="field" value={q} onChange={(e) => search(e.target.value)} placeholder="Buscar persona duplicada…" autoFocus />
      {candidates.length > 0 && (
        <ul className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
              <span>{c.name} {c.nickname && <span className="help">«{c.nickname}»</span>}</span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => merge(c)}>Fusionar en esta persona</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Persona({ id }) {
  const { notify } = useApp();
  const [person, setPerson] = useState(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(null);
  const [notesDraft, setNotesDraft] = useState(null);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      setPerson(await api.people.get(id));
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [id, notify]);
  useEffect(() => { load(); }, [load]);

  if (!person) return <p className="help p-8">Cargando…</p>;

  const saveHeader = async (patch) => {
    const out = await run(() => api.people.update(id, patch), "Datos guardados.");
    if (out) { setEditing(false); load(); }
  };
  const saveSummary = async () => {
    if (summaryDraft === null || summaryDraft === person.summary) return setSummaryDraft(null);
    await run(() => api.people.update(id, { summary: summaryDraft }), "Resumen guardado.");
    setSummaryDraft(null);
    load();
  };
  const saveNotes = async () => {
    if (notesDraft === null || notesDraft === person.notes) return setNotesDraft(null);
    await run(() => api.people.update(id, { notes: notesDraft }), "Notas guardadas.");
    setNotesDraft(null);
    load();
  };
  const toggleArchive = async () => {
    const out = await run(() => api.people.update(id, { archived: !person.archived }), person.archived ? "Recuperada." : "Archivada.");
    if (out) load();
  };
  const confirmDelete = async () => {
    setConfirmingDelete(false);
    if (await run(() => api.people.remove(id), "Persona borrada.")) window.location.hash = "#/personas";
  };

  return (
    <Page
      title={
        <span>
          <a href="#/personas" className="btn-link mr-2 text-[13px]" style={{ color: "var(--supporting-ink)" }}>← Personas</a>
          <br className="sm:hidden" />
          {person.name}
        </span>
      }
      description={person.nickname ? `«${person.nickname}»` : undefined}
      actions={
        !editing && (
          <>
            <button type="button" className="btn" onClick={() => setEditing(true)}>Editar datos</button>
            <button type="button" className="btn" onClick={() => setMerging((v) => !v)} aria-expanded={merging}>Fusionar</button>
            <button type="button" className="btn" onClick={toggleArchive}>{person.archived ? "Recuperar" : "Archivar"}</button>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Borrar</button>
          </>
        )
      }
    >
      {editing ? (
        <div className="mb-4"><HeaderForm person={person} onSave={saveHeader} onCancel={() => setEditing(false)} busy={busy} /></div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
          {person.circles.map((c) => <span key={c} className="chip chip-circle">{c}</span>)}
          {person.birthday && <span className="chip">🎂 {birthdayLabel(person.birthday)}</span>}
          {person.location && <span className="help">{person.location}</span>}
          {person.archived && <span className="chip chip-warn">Archivada</span>}
          <span className="help">· Último contacto {daysAgoLabel(person.days_since_contact)}</span>
        </div>
      )}
      {merging && <MergePanel person={person} onDone={() => { setMerging(false); load(); }} notify={notify} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Resumen">
          <textarea
            className="field"
            style={{ minHeight: 100 }}
            value={summaryDraft ?? person.summary}
            onChange={(e) => setSummaryDraft(e.target.value)}
            onBlur={saveSummary}
            placeholder="Un párrafo: quién es esta persona."
          />
        </Section>
        <Section title="Notas">
          <textarea
            className="field"
            style={{ minHeight: 100 }}
            value={notesDraft ?? person.notes}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            placeholder="Notas libres en markdown."
          />
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Datos"><FactsSection person={person} reload={load} notify={notify} /></Section>
        <Section title="Alias"><AliasesSection person={person} reload={load} notify={notify} /></Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Línea de tiempo"><InteractionsSection person={person} reload={load} notify={notify} /></Section>
        <Section title="Recordatorios"><RemindersSection person={person} reload={load} notify={notify} /></Section>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Borrar persona"
        text={`Se borrará a "${person.name}" junto con sus alias, datos, contactos y recordatorios. Esta acción no se puede deshacer.`}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Page>
  );
}
