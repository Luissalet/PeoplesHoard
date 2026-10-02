import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, useAction } from "./ui.jsx";
import { commitmentDue, DIRECTION_LABELS, SOURCE_LABELS } from "../format.js";

/** One promise: text, who, when, where it came from, and the three things you do with it. */
export function CommitmentItem({ c, showPerson = true, onChange, notify, busy }) {
  const [run, working] = useAction(notify);
  const [moving, setMoving] = useState(false);
  const [day, setDay] = useState(c.due || "");
  const open = c.status === "open";
  const apply = async (patch, ok) => { if (await run(() => api.commitments.update(c.id, patch), ok)) { setMoving(false); onChange(); } };
  const remove = async () => { if (await run(() => api.commitments.remove(c.id), "Compromiso borrado.")) onChange(); };
  const disabled = busy || working;
  return (
    <li className="py-3 text-[13px]" data-testid="commitment" data-status={c.status}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-2">
        {open && <input type="checkbox" className="mt-[3px]" checked={false} disabled={disabled} onChange={() => apply({ status: "done" }, "Compromiso cumplido.")} aria-label={`Marcar «${c.text}» como cumplido`} />}
        <div className="min-w-0 flex-1">
          <div className={open ? "" : "line-through"} style={open ? undefined : { opacity: 0.6 }}>{c.text}</div>
          <div className="help mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`chip ${c.direction === "i_owe" ? "chip-warn" : "chip-circle"}`}>{DIRECTION_LABELS[c.direction]}</span>
            {showPerson && (c.person_id
              ? <a href={`#/personas/${c.person_id}`} style={{ color: "var(--accent)" }}>{c.person_name}</a>
              : <span>{c.person_name || "sin persona"}</span>)}
            <span className={c.overdue ? "chip chip-danger" : undefined}>{commitmentDue(c)}</span>
            <span className="chip" title={c.source.quote ? `«${c.source.quote}»` : undefined}>{SOURCE_LABELS[c.source.kind] || c.source.kind}</span>
            {!open && <span className="chip">{c.status === "done" ? "Cumplido" : "Descartado"}</span>}
          </div>
          {c.source.quote && <details className="mt-1"><summary className="help cursor-pointer">Lo que se dijo</summary><blockquote className="help mt-1 border-l-2 pl-2" style={{ borderColor: "var(--line)" }}>«{c.source.quote}»</blockquote></details>}
          {moving && (
            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (day) apply({ due: day }, "Fecha cambiada."); }}>
              <input type="date" className="field field-sm w-[150px]" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Nueva fecha" required />
              <button type="submit" className="btn btn-sm" disabled={disabled}>Guardar fecha</button>
              <button type="button" className="btn-link" onClick={() => setMoving(false)}>Cancelar</button>
            </form>
          )}
        </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 sm:justify-end">
          {open ? (
            <>
              <button type="button" className="btn-link" onClick={() => setMoving((v) => !v)} aria-expanded={moving}>Cambiar fecha</button>
              <button type="button" className="btn-link" disabled={disabled} onClick={() => apply({ status: "dropped" }, "Compromiso descartado.")}>Descartar</button>
            </>
          ) : (
            <button type="button" className="btn-link" disabled={disabled} onClick={() => apply({ status: "open" }, "Compromiso reabierto.")}>Reabrir</button>
          )}
          <button type="button" className="btn-link" style={{ color: "var(--danger-ink)" }} disabled={disabled} onClick={remove}>Borrar</button>
        </div>
      </div>
    </li>
  );
}

/** Add a promise by hand. With `person` fixed it is for them; otherwise the person is picked from `people`. */
export function CommitmentForm({ person = null, people = [], onAdded, notify }) {
  const blank = { direction: "i_owe", person_id: person?.id || "", text: "", due: "", due_text: "" };
  const [form, setForm] = useState(blank);
  const [run, busy] = useAction(notify);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.text.trim()) return;
    const body = { direction: form.direction, text: form.text, person_id: person?.id || form.person_id || null };
    if (form.due) body.due = form.due; else if (form.due_text.trim()) body.due_text = form.due_text;
    const out = await run(() => api.commitments.add(body), "Compromiso anotado.");
    if (out) { setForm(blank); onAdded(); }
  };
  return (
    <form onSubmit={submit} className="mb-4 grid gap-2 sm:grid-cols-[130px_1fr_150px] sm:items-start" aria-label="Nuevo compromiso">
      <Field label="Quién debe">
        <select className="field field-sm" value={form.direction} onChange={set("direction")}>
          <option value="i_owe">Yo debo</option>
          <option value="owed_to_me">Me deben</option>
        </select>
      </Field>
      <Field label="Qué"><input className="field field-sm" value={form.text} onChange={set("text")} placeholder="Qué se prometió" maxLength={2000} required /></Field>
      <Field label="Para cuándo"><input type="date" className="field field-sm" value={form.due} onChange={set("due")} /></Field>
      {!person && (
        <Field label="Persona" className="sm:col-span-2">
          <select className="field field-sm" value={form.person_id} onChange={set("person_id")}>
            <option value="">Sin persona</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="O con palabras" className={person ? "sm:col-span-2" : ""} help="«el viernes», «en dos semanas»: se convierte en fecha si se puede">
        <input className="field field-sm" value={form.due_text} onChange={set("due_text")} placeholder="el viernes" maxLength={120} disabled={!!form.due} />
      </Field>
      <button type="submit" className="btn btn-sm sm:justify-self-start" disabled={busy}>Añadir</button>
    </form>
  );
}

/** The "Compromisos" section of a person's page: what I owe them, what they owe me, and the closed ones. */
export function PersonCommitments({ person, reload, notify }) {
  const [list, setList] = useState(null);
  const load = async () => {
    try { setList((await api.commitments.list({ person: person.id, status: "all" })).commitments); } catch (e) { notify({ kind: "error", text: e.message }); }
  };
  useEffect(() => { load(); }, [person.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); reload?.(); };
  if (!list) return <p className="help">Cargando…</p>;
  const open = list.filter((c) => c.status === "open");
  const closed = list.filter((c) => c.status !== "open");
  const owe = open.filter((c) => c.direction === "i_owe");
  const owed = open.filter((c) => c.direction === "owed_to_me");
  const group = (title, items) => (
    <div>
      <h3 className="mb-1 text-[13px] font-semibold">{title} <span className="help num">{items.length}</span></h3>
      {items.length ? <ul className="divide-y" style={{ borderColor: "var(--line)" }}>{items.map((c) => <CommitmentItem key={c.id} c={c} showPerson={false} onChange={changed} notify={notify} />)}</ul> : <p className="help">Nada pendiente.</p>}
    </div>
  );
  return (
    <div>
      <CommitmentForm person={person} onAdded={changed} notify={notify} />
      <div className="grid gap-4 md:grid-cols-2">
        {group("Le debo", owe)}
        {group("Me debe", owed)}
      </div>
      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="help cursor-pointer">{closed.length} cerrados</summary>
          <ul className="mt-1 divide-y" style={{ borderColor: "var(--line)" }}>{closed.map((c) => <CommitmentItem key={c.id} c={c} showPerson={false} onChange={changed} notify={notify} />)}</ul>
        </details>
      )}
    </div>
  );
}

const REASONS = {
  ambiguous: (p) => `El nombre «${p.person_name_raw}» coincide con varias personas.`,
  unknown: (p) => `«${p.person_name_raw}» no está en la agenda.`,
  third_party: (p) => `Lo promete «${p.person_name_raw}» a «${p.counterpart}»: ninguno eres tú.`,
  unassigned: () => "El acta no dice quién se compromete.",
  proposed: () => "Propuesto por el modelo a partir de un texto que pegaste: confírmalo.",
};

/** One proposal waiting for a decision. Every button settles it at once. */
export function ReviewCard({ item, people, onChange, notify }) {
  const { proposal } = item;
  const [run, busy] = useAction(notify);
  const [direction, setDirection] = useState(proposal.direction || "");
  const [other, setOther] = useState("");
  const settle = async (body, ok) => {
    if (!direction && body.action === "accept") return notify({ kind: "error", text: "Elige antes si debes tú o te deben." });
    if (await run(() => api.commitments.resolve(item.id, { ...body, ...(body.action === "accept" ? { direction } : {}) }), ok)) onChange();
  };
  const reason = (REASONS[item.reason] || (() => ""))(proposal);
  return (
    <li className="py-3 text-[13px]" data-testid="review-item" data-reason={item.reason}>
      <div className="font-semibold">{proposal.text}</div>
      <div className="help mt-1">{reason}</div>
      <div className="help mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="chip">{SOURCE_LABELS[proposal.source.kind] || proposal.source.kind}</span>
        {proposal.meeting?.title && <span>{proposal.meeting.title}</span>}
        {proposal.due ? <span>para el {proposal.due.split("-").reverse().join("/")}</span> : proposal.due_text ? <span>«{proposal.due_text}»</span> : <span>sin fecha</span>}
      </div>
      {proposal.source.quote && <blockquote className="help mt-1 border-l-2 pl-2" style={{ borderColor: "var(--line)" }}>«{proposal.source.quote}»</blockquote>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="field field-sm w-[140px]" value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Quién debe">
          <option value="">¿Quién debe?</option>
          <option value="i_owe">Yo debo</option>
          <option value="owed_to_me">Me deben</option>
        </select>
        {item.candidates.map((p) => (
          <button key={p.id} type="button" className="btn btn-sm" disabled={busy} onClick={() => settle({ action: "accept", person_id: p.id }, "Compromiso anotado.")}>
            Es {p.name}{p.circles.length ? ` (${p.circles[0]})` : ""}
          </button>
        ))}
        {proposal.person_name_raw && !item.candidates.length && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => settle({ action: "accept", create_person: true }, "Persona creada y compromiso anotado.")}>
            Crear a «{proposal.person_name_raw}»
          </button>
        )}
        <select className="field field-sm w-[170px]" value={other} onChange={(e) => { const id = e.target.value; setOther(""); if (id) settle({ action: "accept", person_id: id }, "Compromiso anotado."); }} aria-label="Elegir otra persona">
          <option value="">Otra persona…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => settle({ action: "accept", no_person: true }, "Compromiso anotado sin persona.")}>Sin persona</button>
        <button type="button" className="btn-link" disabled={busy} onClick={() => settle({ action: "discard" }, "Propuesta descartada.")}>Descartar</button>
      </div>
    </li>
  );
}
