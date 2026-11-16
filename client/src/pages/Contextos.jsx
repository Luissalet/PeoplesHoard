// Contextos: una ficha viva por persona o por grupo. La lista con la captura rápida arriba (solo el texto) y lo que se
// acerca con fecha. Cada ficha se abre en #/contextos/<id>.
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, useAction } from "../components/ui.jsx";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";
import { dateLabel, daysUntilLabel } from "../format.js";

export const ITEM_KINDS = {
  idea: "Idea de regalo",
  wish: "Lista de deseos",
  plan: "Plan",
  pending: "Pendiente",
  taste: "Gusto",
  place: "Lugar",
  note: "Nota",
};

function CaptureForm({ contexts, notify, onDone }) {
  const [form, setForm] = useState({ text: "", kind: "idea", target: "", due: "" });
  const [run, busy] = useAction(notify);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  useCopilotContext(() => ({ editors: form.text.trim() ? [{ kind: "context-capture", object_id: null, dirty: true, fields: form }] : [] }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.text.trim()) return;
    const body = { text: form.text, kind: form.kind };
    if (form.target) body.context = form.target;
    if (form.due) body.due = form.due;
    const out = await run(() => api.contexts.capture(body), "Apuntado.");
    if (out) { setForm({ text: "", kind: form.kind, target: form.target, due: "" }); onDone(); }
  };
  return (
    <form onSubmit={submit} className="panel grid gap-2 sm:grid-cols-[2fr_150px_180px_150px_auto] sm:items-end" data-testid="context-capture">
      <Field label="Apuntar algo"><input className="field field-sm" value={form.text} onChange={set("text")} placeholder="Una idea, un plan, algo pendiente…" maxLength={500} required /></Field>
      <Field label="Tipo">
        <select className="field field-sm" value={form.kind} onChange={set("kind")}>
          {Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Contexto" help="Vacío = Sin asignar">
        <select className="field field-sm" value={form.target} onChange={set("target")}>
          <option value="">Sin asignar</option>
          {contexts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Día (opcional)"><input className="field field-sm" type="date" value={form.due} onChange={set("due")} /></Field>
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>Apuntar</button>
    </form>
  );
}

function NewContextForm({ notify, onDone }) {
  const [form, setForm] = useState({ name: "", people: "", notes: "" });
  const [run, busy] = useAction(notify);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const people = form.people.split(",").map((p) => p.trim()).filter(Boolean);
    const out = await run(() => api.contexts.create({ name: form.name, kind: "group", people, notes: form.notes }), "Contexto creado.");
    if (out) { setForm({ name: "", people: "", notes: "" }); onDone(); }
  };
  return (
    <form onSubmit={submit} className="panel grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field label="Nombre"><input className="field field-sm" value={form.name} onChange={set("name")} placeholder="La casa, el equipo, los del pádel" maxLength={120} required /></Field>
      <Field label="Personas" help="Separadas por comas"><input className="field field-sm" value={form.people} onChange={set("people")} placeholder="Marta, Pedro" /></Field>
      <Field label="Notas"><input className="field field-sm" value={form.notes} onChange={set("notes")} maxLength={4000} /></Field>
      <button type="submit" className="btn btn-sm" disabled={busy}>Crear contexto</button>
    </form>
  );
}

export default function Contextos() {
  const { notify } = useApp();
  const [contexts, setContexts] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, next] = await Promise.all([api.contexts.list({ q }), api.contexts.upcoming(60)]);
      setContexts(list.contexts);
      setUpcoming(next.items);
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [q, notify]);
  useEffect(() => { load(); }, [load]);
  useCopilotRefresh(() => { load(); });
  useCopilotContext(() => ({ view: { filters: q ? { q } : {} } }));

  return (
    <Page
      title="Contextos"
      description="Una ficha por persona o por grupo: ideas de regalo y lista de deseos, planes con fecha, pendientes y promesas, gustos y lugares."
      actions={!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Nuevo contexto</button>}
    >
      {creating && <div className="mb-4"><NewContextForm notify={notify} onDone={() => { setCreating(false); load(); }} /></div>}
      <div className="mb-4"><CaptureForm contexts={contexts || []} notify={notify} onDone={load} /></div>
      <div className="mb-4">
        <input className="field sm:max-w-[420px]" placeholder="Buscar contexto…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar contextos" />
      </div>

      {upcoming.length > 0 && (
        <div className="mb-4">
          <Section title="Lo que se acerca" aside={<span className="help">{upcoming.length}</span>}>
            <ul className="divide-y" style={{ borderColor: "var(--line)" }} data-testid="context-upcoming">
              {upcoming.slice(0, 12).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="chip">{ITEM_KINDS[item.kind] || item.kind}</span>
                  <a href={`#/contextos/${item.context_id}`} className="btn-link flex-1 min-w-[160px]">{item.text}</a>
                  <span className="help">{item.context_name}</span>
                  <span className="help">{dateLabel(item.due)} · {daysUntilLabel(item.days_until)}</span>
                  {item.remind_now && <span className="chip chip-warn">Aviso abierto</span>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <Section aside={<span className="help">{contexts ? `${contexts.length} ${contexts.length === 1 ? "contexto" : "contextos"}` : ""}</span>}>
        {contexts === null ? <p className="help">Cargando…</p> : contexts.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="context-list">
            {contexts.map((c) => (
              <a key={c.id} href={`#/contextos/${c.id}`} className="card block no-underline" style={{ color: "inherit" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold">{c.name}</div>
                    <div className="help">{c.kind === "person" ? "Persona" : "Grupo"}</div>
                  </div>
                  <span className="chip shrink-0">{c.open_items} abiertos</span>
                </div>
                {c.members.length > 0 && <div className="help mt-2 truncate">{c.members.map((m) => m.name).join(", ")}</div>}
                {c.awaiting_reply_since && <div className="chip chip-warn mt-2">Sin contestar desde {dateLabel(c.awaiting_reply_since)}</div>}
              </a>
            ))}
          </div>
        ) : (
          <Empty text={q ? "Ningún contexto coincide con la búsqueda." : "Apunta algo arriba o crea un contexto para una persona o un grupo."} />
        )}
      </Section>
    </Page>
  );
}