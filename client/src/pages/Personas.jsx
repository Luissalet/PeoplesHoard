import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, CircleChips, useAction } from "../components/ui.jsx";
import { daysAgoLabel, daysUntilBirthday, birthdayLabel } from "../format.js";

const blank = { name: "", nickname: "", circles: "", location: "" };

function NewPersonForm({ onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const circles = form.circles.split(",").map((c) => c.trim()).filter(Boolean);
    const ok = await onSubmit({ name: form.name, nickname: form.nickname, circles, location: form.location });
    if (ok) setForm(blank);
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
      <Field label="Nombre"><input className="field" value={form.name} onChange={set("name")} required maxLength={120} placeholder="Nombre y apellidos" autoFocus /></Field>
      <Field label="Apodo"><input className="field" value={form.nickname} onChange={set("nickname")} maxLength={80} placeholder="Cómo le llamas" /></Field>
      <Field label="Círculos" help="Separados por comas"><input className="field" value={form.circles} onChange={set("circles")} placeholder="familia, amigos" /></Field>
      <Field label="Ubicación"><input className="field" value={form.location} onChange={set("location")} maxLength={120} placeholder="Ciudad" /></Field>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>Crear</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

function PersonCard({ person }) {
  const soon = daysUntilBirthday(person.birthday);
  return (
    <a href={`#/personas/${person.id}`} className="card block no-underline" style={{ color: "inherit" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{person.name}</div>
          {person.nickname && <div className="help truncate">«{person.nickname}»</div>}
        </div>
        {soon !== null && soon <= 14 && (
          <span className="chip chip-warn shrink-0" title={birthdayLabel(person.birthday)}>
            🎂 {soon === 0 ? "hoy" : `${soon}d`}
          </span>
        )}
      </div>
      {person.circles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {person.circles.map((c) => <span key={c} className="chip chip-circle">{c}</span>)}
        </div>
      )}
      <div className="help mt-3 text-[12px]">
        {person.last_contact_at ? `Último contacto ${daysAgoLabel(daysSince(person.last_contact_at))}` : "Sin contacto registrado"}
      </div>
    </a>
  );
}

// Days since an ISO timestamp, computed client-side for the card (the API's
// full record includes days_since_contact; the list endpoint keeps the raw
// timestamp to stay lightweight, so cards derive it locally).
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso.slice(0, 10) + "T00:00:00Z").getTime();
  const now = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((now - then) / 86400000));
}

export default function Personas() {
  const { circles, refresh, notify } = useApp();
  const [q, setQ] = useState("");
  const [circle, setCircle] = useState("");
  const [people, setPeople] = useState([]);
  const [creating, setCreating] = useState(false);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      setPeople(await api.people.list({ q, circle }));
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [q, circle, notify]);
  useEffect(() => { load(); }, [load]);

  const create = async (data) => {
    const out = await run(() => api.people.create(data), "Persona creada.");
    if (out) { setCreating(false); await Promise.all([load(), refresh()]); }
    return !!out;
  };

  return (
    <Page
      title="Personas"
      description="Quién es quién, qué sabes de cada persona y cuándo hablasteis por última vez."
      actions={!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nueva persona</button>}
    >
      {creating && <div className="mb-4"><NewPersonForm onSubmit={create} onCancel={() => setCreating(false)} busy={busy} /></div>}
      <div className="mb-4 flex flex-col gap-3">
        <input className="field sm:max-w-[420px]" placeholder="Buscar por nombre, apodo o alias…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar personas" />
        <CircleChips circles={circles || []} active={circle} onToggle={setCircle} />
      </div>
      <Section aside={<span className="help">{people.length} {people.length === 1 ? "persona" : "personas"}</span>}>
        {people.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => <PersonCard key={p.id} person={p} />)}
          </div>
        ) : (
          <Empty
            text={q || circle ? "Ninguna persona coincide con la búsqueda." : "Añade tu primera persona para empezar tu agenda."}
            action={!creating && !q && !circle && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nueva persona</button>}
          />
        )}
      </Section>
    </Page>
  );
}
