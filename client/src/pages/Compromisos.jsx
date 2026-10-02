import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, Field, useAction } from "../components/ui.jsx";
import { CommitmentItem, CommitmentForm, ReviewCard } from "../components/Commitments.jsx";

const STATUS = { open: "Abiertos", done: "Cumplidos", dropped: "Descartados", all: "Todos" };
const DIRECTIONS = [["", "Todos"], ["i_owe", "Yo debo"], ["owed_to_me", "Me deben"]];

const SYNC_WORDS = {
  idle: "al día", processed: "actas leídas", baseline: "esperando nuevas actas", hub_down: "el hub no responde",
  stalled: "reintentando un acta", off: "automático desactivado", never: "aún sin sondear", error: "error", busy: "ocupado",
};

function IngestPanel({ onDone, notify }) {
  const [sessionId, setSessionId] = useState("");
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [replace, setReplace] = useState(false);
  const [run, busy] = useAction(notify);
  const [outcome, setOutcome] = useState(null);

  const ingest = async (e) => {
    e.preventDefault();
    const out = await run(() => api.commitments.ingest(sessionId.trim(), false, replace), null);
    if (!out) return;
    const words = {
      ingested: `Acta leída: ${out.created} compromisos nuevos y ${out.queued} para revisar${out.duplicates ? `, ${out.duplicates} ya conocidos` : ""}${out.replaced ? ` (se quitaron ${out.replaced.commitments} compromisos y ${out.replaced.review} propuestas sin tocar para releerlos)` : ""}.`,
      no_model: "Funes no tiene ningún modelo cargado para escribir el acta. Carga uno y vuelve a intentarlo.",
      hub_down: "No se puede contactar con el hub de Hoard Link.",
      tool_missing: out.detail,
      unknown_session: "Funes no conoce esa sesión.",
      funes_error: `Funes respondió con un error: ${out.detail}`,
    };
    setOutcome({ ok: out.status === "ingested", text: words[out.status] || out.detail || out.status });
    if (out.status === "ingested") { setSessionId(""); onDone(); }
  };
  const extract = async (e) => {
    e.preventDefault();
    const out = await run(() => api.commitments.extract(text, hint.trim()), null);
    if (!out) return;
    const words = {
      proposed: out.proposals.length
        ? `${out.proposals.length} propuestas para revisar${out.dropped ? ` (${out.dropped} descartadas por no tener cita literal)` : ""}.`
        : out.duplicates ? "Esas propuestas ya se habían hecho antes (anotadas, descartadas o a la espera)." : "No he encontrado compromisos en ese texto.",
      no_model: "No hay ningún modelo disponible. Carga uno en tu servidor local y vuelve a intentarlo.",
      hub_down: "No se puede contactar con el hub de Hoard Link.",
      error: out.detail || "El modelo no respondió bien.",
    };
    setOutcome({ ok: out.status === "proposed", text: words[out.status] || out.detail });
    if (out.status === "proposed") { setText(""); onDone(); }
  };
  return (
    <Section title="Traer compromisos">
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={ingest} className="grid content-start gap-2" aria-label="Desde una reunión">
          <h3 className="text-[13px] font-semibold">Desde una reunión de Funes</h3>
          <p className="help">Las actas nuevas se leen solas. Para una anterior, pega el identificador de la sesión (aparece en la dirección de la sesión en Funes).</p>
          <Field label="Sesión de Funes"><input className="field field-sm" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="Identificador de la sesión" required /></Field>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-[3px]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>Releer y sustituir lo que no hayas tocado <span className="help block">Quita los compromisos y propuestas de esa reunión que sigan sin editar y los vuelve a leer; lo cumplido, descartado o editado se queda.</span></span>
          </label>
          <button type="submit" className="btn btn-sm justify-self-start" disabled={busy}>Leer el acta</button>
        </form>
        <form onSubmit={extract} className="grid content-start gap-2" aria-label="Desde un texto">
          <h3 className="text-[13px] font-semibold">Desde un texto</h3>
          <p className="help">Pega un correo o una conversación: el modelo local propone los compromisos y tú decides cuáles valen.</p>
          <Field label="Texto"><textarea className="field" style={{ minHeight: 84 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pega aquí el correo o la conversación" required minLength={12} /></Field>
          <Field label="Con quién (opcional)"><input className="field field-sm" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Nombre de la otra persona" maxLength={120} /></Field>
          <button type="submit" className="btn btn-sm justify-self-start" disabled={busy}>{busy ? "Buscando…" : "Buscar compromisos"}</button>
        </form>
      </div>
      {outcome && <p className="mt-3 text-[13px]" role="status" style={{ color: outcome.ok ? "var(--ok-ink)" : "var(--danger-ink)" }}>{outcome.text}</p>}
    </Section>
  );
}

export default function Compromisos() {
  const { notify, refresh } = useApp();
  const [filter, setFilter] = useState({ direction: "", status: "open", person: "", overdue: false, q: "" });
  const [list, setList] = useState(null);
  const [review, setReview] = useState([]);
  const [people, setPeople] = useState([]);
  const [sync, setSync] = useState(null);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      const [mine, queue] = await Promise.all([
        api.commitments.list({ direction: filter.direction, status: filter.status, person: filter.person, overdue: filter.overdue ? "1" : "", q: filter.q }),
        api.commitments.review(),
      ]);
      setList(mine.commitments);
      setReview(queue.review);
      refresh();
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [filter, notify, refresh]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.people.list({}).then(setPeople).catch(() => {});
    api.commitments.sync().then(setSync).catch(() => {});
  }, []);

  const syncNow = async () => {
    const out = await run(() => api.commitments.syncNow(), null);
    if (out) { setSync(out.sync); load(); notify({ kind: out.result.status === "hub_down" ? "error" : "ok", text: `Sincronización: ${SYNC_WORDS[out.result.status] || out.result.status}.` }); }
  };

  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const overdueCount = list ? list.filter((c) => c.overdue).length : 0;

  return (
    <Page
      title="Compromisos"
      description="Quién prometió qué a quién y para cuándo. Las reuniones de Funes y los textos que pegues traen propuestas; nada entra sin pasar por ti cuando hay dudas."
      actions={<a className="btn btn-sm" href="/api/calendar.ics" download="peoples-hoard-calendar.ics">Descargar calendario</a>}
    >
      {review.length > 0 && (
        <div className="mb-4">
          <Section title="Por revisar" aside={<span className="chip chip-warn" data-testid="review-count">{review.length}</span>}>
            <p className="help mb-1">Propuestas que no se han anotado porque falta una decisión tuya.</p>
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {review.map((item) => <ReviewCard key={item.id} item={item} people={people} onChange={load} notify={notify} />)}
            </ul>
          </Section>
        </div>
      )}

      <Section title="Lista" aside={<span className="help">{list ? `${list.length} compromisos${overdueCount ? ` · ${overdueCount} vencidos` : ""}` : ""}</span>}>
        <div className="mb-3 flex flex-wrap items-end gap-3" role="search" aria-label="Filtros de compromisos">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quién debe">
            {DIRECTIONS.map(([value, label]) => (
              <button key={value || "all"} type="button" className="circle-filter" aria-pressed={filter.direction === value} onClick={() => setFilter((f) => ({ ...f, direction: value }))}>{label}</button>
            ))}
          </div>
          <Field label="Estado"><select className="field field-sm w-[130px]" value={filter.status} onChange={set("status")}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Persona">
            <select className="field field-sm w-[170px]" value={filter.person} onChange={set("person")}>
              <option value="">Todas</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Buscar"><input className="field field-sm w-[160px]" value={filter.q} onChange={set("q")} placeholder="Texto…" /></Field>
          <label className="flex items-center gap-2 pb-2 text-[13px]"><input type="checkbox" checked={filter.overdue} onChange={(e) => setFilter((f) => ({ ...f, overdue: e.target.checked }))} /> Solo vencidos</label>
        </div>
        {!list ? <p className="help">Cargando…</p> : list.length ? (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {list.map((c) => <CommitmentItem key={c.id} c={c} onChange={load} notify={notify} />)}
          </ul>
        ) : <Empty text={filter.status === "open" && !filter.q && !filter.person && !filter.direction && !filter.overdue ? "Sin compromisos abiertos: nadie te debe nada ni tú a nadie." : "Ningún compromiso coincide con estos filtros."} />}
      </Section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Anotar uno">
          <CommitmentForm people={people} onAdded={load} notify={notify} />
        </Section>
        <IngestPanel onDone={load} notify={notify} />
      </div>

      <p className="help mt-4" data-testid="sync-status">
        Actas de Funes: {sync ? (SYNC_WORDS[sync.last_status] || sync.last_status) : "…"}
        {sync?.enabled === false && " (PEOPLE_COMMITMENTS_AUTO=0)"}
        {sync?.last_error ? ` · ${sync.last_error}` : ""}
        {" "}<button type="button" className="btn-link" onClick={syncNow} disabled={busy}>Sondear ahora</button>
      </p>
    </Page>
  );
}
