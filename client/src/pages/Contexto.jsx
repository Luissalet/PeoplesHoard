// La ficha de un contexto: lo abierto por tipo, lo hecho, las fechas de la persona, los compromisos abiertos y el aviso
// de «sin contestar». Sirve igual para una persona y para un grupo.
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, useAction, ConfirmDialog } from "../components/ui.jsx";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";
import { dateLabel, daysAgoLabel, daysUntilLabel, birthdayLabel, commitmentDue, DIRECTION_CHIP } from "../format.js";
import { ITEM_KINDS } from "./Contextos.jsx";

const GROUPS = ["idea", "wish", "plan", "pending", "taste", "place", "note"];

function ItemForm({ contextId, notify, onDone }) {
  const [form, setForm] = useState({ kind: "idea", text: "", url: "", budget: "", due: "", remind_days_before: "" });
  const [run, busy] = useAction(notify);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  useCopilotContext(() => ({ editors: form.text.trim() ? [{ kind: "context-item-new", object_id: contextId, dirty: true, fields: form }] : [] }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.text.trim()) return;
    const body = {
      kind: form.kind, text: form.text, url: form.url,
      budget: form.budget === "" ? null : Number(form.budget),
      due: form.due || null,
      remind_days_before: form.remind_days_before === "" ? null : Number(form.remind_days_before),
    };
    const out = await run(() => api.contexts.addItem(contextId, body), "Añadido a la ficha.");
    if (out) { setForm({ kind: form.kind, text: "", url: "", budget: "", due: "", remind_days_before: "" }); onDone(); }
  };
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[150px_2fr_2fr_100px_150px_120px_auto] sm:items-end" data-testid="context-item-form">
      <Field label="Tipo">
        <select className="field field-sm" value={form.kind} onChange={set("kind")}>
          {Object.entries(ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Qué"><input className="field field-sm" value={form.text} onChange={set("text")} placeholder="Qué apuntar" maxLength={500} required /></Field>
      <Field label="Página (opcional)"><input className="field field-sm" type="url" value={form.url} onChange={set("url")} placeholder="https://…" maxLength={2000} /></Field>
      <Field label="Máximo (€)"><input className="field field-sm" type="number" min="0" step="0.01" value={form.budget} onChange={set("budget")} /></Field>
      <Field label="Día (opcional)"><input className="field field-sm" type="date" value={form.due} onChange={set("due")} /></Field>
      <Field label="Avisar antes" help="Días"><input className="field field-sm" type="number" min="0" max="365" value={form.remind_days_before} onChange={set("remind_days_before")} placeholder="21" /></Field>
      <button type="submit" className="btn btn-sm" disabled={busy}>Añadir</button>
    </form>
  );
}

function ItemRow({ item, notify, reload }) {
  const [run, busy] = useAction(notify);
  const setStatus = async (status, message) => { if (await run(() => api.contexts.updateItem(item.id, { status }), message)) reload(); };
  const remove = async () => { if (await run(() => api.contexts.removeItem(item.id), "Borrado de la ficha.")) reload(); };
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-[13px]" data-testid="context-item">
      <span className="flex-1 min-w-[160px]">
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer noopener" className="btn-link">{item.text}</a> : item.text}
        {item.budget !== null && item.budget !== undefined && <span className="help"> · hasta {item.budget} €</span>}
        {item.due && <span className="help"> · {dateLabel(item.due)}</span>}
      </span>
      <button type="button" className="btn-link shrink-0" disabled={busy} onClick={() => setStatus("done", "Marcado como hecho.")}>Hecho</button>
      <button type="button" className="btn-link shrink-0" disabled={busy} onClick={() => setStatus("dropped", "Descartado.")}>Descartar</button>
      <button type="button" className="btn-link shrink-0" style={{ color: "var(--danger-ink)" }} disabled={busy} onClick={remove}>Borrar</button>
    </li>
  );
}

export default function Contexto({ id }) {
  const { notify } = useApp();
  const [card, setCard] = useState(null);
  const [missing, setMissing] = useState(false);
  const [notesDraft, setNotesDraft] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      setCard(await api.contexts.get(id));
      setMissing(false);
    } catch (e) {
      if (/no existe/i.test(e.message)) setMissing(true);
      else notify({ kind: "error", text: e.message });
    }
  }, [id, notify]);
  useEffect(() => { load(); }, [load]);
  useCopilotRefresh(() => { load(); });
  useCopilotContext(() => ({ editors: card && notesDraft !== null ? [{ kind: "context-notes", object_id: card.context.id, dirty: notesDraft !== card.context.notes, fields: { notes: notesDraft } }] : [] }));

  if (missing) {
    return (
      <Page title="Contexto no encontrado">
        <div className="panel">
          <p className="mb-3 text-[13px]">Esta ficha ya no existe: puede que se borrara.</p>
          <a href="#/contextos" className="btn">Volver a Contextos</a>
        </div>
      </Page>
    );
  }
  if (!card) return <p className="help p-8">Cargando…</p>;

  const saveNotes = async () => {
    if (notesDraft === null || notesDraft === card.context.notes) return setNotesDraft(null);
    const sent = notesDraft;
    const out = await run(() => api.contexts.update(card.context.id, { notes: sent }), "Notas guardadas.");
    if (!out) return;
    setNotesDraft((current) => current === sent ? null : current);
    load();
  };
  const markReply = async (since) => { if (await run(() => api.contexts.reply(card.context.id, since), since ? "Apuntado que esperas respuesta." : "Aviso de respuesta quitado.")) load(); };
  const removeContext = async () => {
    setConfirmingDelete(false);
    if (await run(() => api.contexts.remove(card.context.id), "Contexto borrado.")) window.location.hash = "#/contextos";
  };

  return (
    <Page
      title={<span><a href="#/contextos" className="btn-link mr-2 text-[13px]" style={{ color: "var(--supporting-ink)" }}>← Contextos</a><br className="sm:hidden" />{card.context.name}</span>}
      description={card.context.kind === "person" ? "Ficha de una persona" : "Ficha de un grupo"}
      actions={
        <>
          {card.person && <a href={`#/personas/${card.person.id}`} className="btn">Ver persona</a>}
          {card.awaiting_reply_since
            ? <button type="button" className="btn" disabled={busy} onClick={() => markReply(null)}>Ya he contestado</button>
            : <button type="button" className="btn" disabled={busy} onClick={() => markReply(new Date().toISOString().slice(0, 10))}>Espero respuesta</button>}
          <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Borrar contexto</button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="chip">{card.open_count} abiertos</span>
        {card.person?.birthday && <span className="chip">🎂 {birthdayLabel(card.person.birthday)}</span>}
        {card.person && <span className="help">· Último contacto {daysAgoLabel(card.person.days_since_contact)}</span>}
        {card.members.length > 0 && <span className="help">· {card.members.map((m) => m.name).join(", ")}</span>}
        {card.awaiting_reply_since && <span className="chip chip-warn">Sin contestar desde {dateLabel(card.awaiting_reply_since)} ({card.awaiting_reply_days} {card.awaiting_reply_days === 1 ? "día" : "días"})</span>}
      </div>

      <div className="mb-4"><Section title="Añadir a la ficha"><ItemForm contextId={card.context.id} notify={notify} onDone={load} /></Section></div>

      {card.dates.length > 0 && (
        <div className="mb-4">
          <Section title="Fechas">
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {card.dates.map((d) => (
                <li key={`${d.kind}-${d.label}-${d.date}`} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="flex-1">{d.label}{d.years ? ` (${d.years} ${d.years === 1 ? "año" : "años"})` : ""}</span>
                  <span className="help">{dateLabel(d.date)} · {daysUntilLabel(d.days_until)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((kind) => (
          <Section key={kind} title={ITEM_KINDS[kind]} aside={<span className="help">{card.items[kind].length}</span>}>
            {card.items[kind].length ? (
              <ul className="divide-y" style={{ borderColor: "var(--line)" }} data-testid={`context-group-${kind}`}>
                {card.items[kind].map((item) => <ItemRow key={item.id} item={item} notify={notify} reload={load} />)}
              </ul>
            ) : <p className="help">Nada apuntado.</p>}
          </Section>
        ))}
      </div>

      {card.commitments.length > 0 && (
        <div className="mt-4">
          <Section title="Compromisos abiertos">
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {card.commitments.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="chip">{DIRECTION_CHIP[c.direction] || c.direction}</span>
                  <span className="flex-1 min-w-[160px]">{c.text}</span>
                  <span className="help">{commitmentDue(c)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Notas">
          <textarea
            className="field"
            style={{ minHeight: 100 }}
            value={notesDraft ?? card.context.notes}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            placeholder="Lo que conviene recordar de este contexto."
          />
        </Section>
        <Section title="Hecho y descartado" aside={<span className="help">{card.done.length}</span>}>
          {card.done.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {card.done.map((item) => (
                <li key={item.id} className="flex items-center gap-2 py-2 text-[13px]" style={{ opacity: 0.65 }}>
                  <span className="chip">{ITEM_KINDS[item.kind] || item.kind}</span>
                  <span className="flex-1">{item.text}</span>
                  <span className="help">{item.status === "done" ? "Hecho" : "Descartado"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="help">Nada cerrado todavía.</p>}
        </Section>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Borrar contexto"
        text={`Se borrará «${card.context.name}» con todo lo apuntado en él. La persona y sus datos no se tocan. Esta acción no se puede deshacer.`}
        onConfirm={removeContext}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Page>
  );
}