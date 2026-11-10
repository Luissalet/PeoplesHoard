import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Empty, useAction } from "../components/ui.jsx";
import { dateLabel, daysAgoLabel, daysUntilLabel, commitmentDue, DIRECTION_LABELS } from "../format.js";

const NUDGE_STATUS = {
  sent: "enviados", nothing: "nada nuevo que enviar", hub_down: "el hub no responde; se reintentará", off: "desactivados en Ajustes",
  events_off: "eventos apagados (HOARD_EVENTS=0)",
};

/** Whole months or days since: «5 meses», «3 semanas». */
function sinceWords(days) {
  if (days < 14) return `${days} ${days === 1 ? "día" : "días"}`;
  if (days < 60) return `${Math.floor(days / 7)} semanas`;
  if (days < 365) return `${Math.floor(days / 30)} meses`;
  return Math.floor(days / 365) === 1 ? "más de un año" : `más de ${Math.floor(days / 365)} años`;
}
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

export default function Agenda() {
  const { notify } = useApp();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [nudges, setNudges] = useState(null);
  const [run, busy] = useAction(notify);

  const load = useCallback(async () => {
    try {
      const [next, pending] = await Promise.all([api.upcoming(days), api.nudges.get()]);
      setReport(next);
      setNudges(pending);
    } catch (e) {
      notify({ kind: "error", text: e.message });
    }
  }, [days, notify]);
  useEffect(() => { load(); }, [load]);
  useCopilotRefresh(() => { load(); });
  useCopilotContext(() => ({ view: { days } }));

  const talkedToday = async (personId) => {
    const out = await run(() => api.interactions.add(personId, { channel: "other", summary: "Contacto rápido desde la agenda." }), "Apuntado como hablado hoy.");
    if (out) load();
  };
  const completeReminder = async (id) => {
    const out = await run(() => api.reminders.update(id, { done: true }), "Recordatorio completado.");
    if (out) load();
  };

  const sendNudges = async () => {
    const out = await run(() => api.nudges.send(), null);
    if (!out) return;
    notify({ kind: out.result.status === "hub_down" ? "error" : "ok", text: out.result.status === "sent" ? `Avisos enviados al resumen: ${out.result.sent}.` : `Avisos: ${NUDGE_STATUS[out.result.status] || out.result.status}.` });
    setNudges(out.report);
  };

  const finishCommitment = async (id) => {
    const out = await run(() => api.commitments.update(id, { status: "done" }), "Compromiso cumplido.");
    if (out) load();
  };

  if (!report) return <p className="help p-8">Cargando…</p>;
  const dates = report.dates || [];
  const cooling = report.cooling || [];
  const commitments = report.commitments || [];
  const overdueCommitments = commitments.filter((c) => c.overdue);
  const weekCommitments = commitments.filter((c) => !c.overdue && c.days_until_due <= 7);
  const laterCommitments = commitments.filter((c) => !c.overdue && c.days_until_due > 7);
  const commitmentList = (items) => (
    <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
      {items.map((c) => (
        <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-[13px]" data-testid="agenda-commitment">
          <div>
            <div>{c.text}</div>
            <div className="help">
              {DIRECTION_LABELS[c.direction]}
              {c.person_name && <> · {c.person_id ? <a href={`#/personas/${c.person_id}`} style={{ color: "var(--accent)" }}>{c.person_name}</a> : c.person_name}</>}
              {" · "}{commitmentDue(c)}
            </div>
          </div>
          <button type="button" className="btn btn-sm shrink-0" disabled={busy} onClick={() => finishCommitment(c.id)}>Cumplido</button>
        </li>
      ))}
    </ul>
  );

  return (
    <Page
      title="Agenda"
      description={report.summary}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select className="field field-sm w-[160px]" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Ventana de días">
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
            <option value={365}>1 año</option>
          </select>
          <a className="btn btn-sm" href="/api/calendar.ics" download="peoples-hoard-calendar.ics">Descargar calendario</a>
        </div>
      }
    >
      {nudges && (
        <p className="help mb-4 flex flex-wrap items-center gap-x-2" data-testid="nudges-status">
          <span>Avisos al resumen diario del hub: {nudges.enabled ? `${nudges.items.length} hoy, ${nudges.pending} sin enviar` : "desactivados en Ajustes"}{nudges.last_run ? ` · último envío ${new Date(nudges.last_run.at).toLocaleString("es-ES")} (${NUDGE_STATUS[nudges.last_run.status] || nudges.last_run.status})` : ""}.</span>
          {nudges.pending > 0 && <button type="button" className="btn-link" onClick={sendNudges} disabled={busy}>Enviar ahora</button>}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Section title="Cumpleaños y fechas">
          {report.birthdays.length || dates.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {report.birthdays.map((b) => (
                <li key={b.person_id} className="py-2 text-[13px]">
                  <a href={`#/personas/${b.person_id}`} className="font-semibold" style={{ color: "var(--accent)" }}>{b.name}</a>
                  <div className="help">{dateLabel(b.date)} · {daysUntilLabel(b.days_until)}{b.turning_age != null ? ` · cumple ${b.turning_age}` : ""}</div>
                </li>
              ))}
              {dates.map((d) => (
                <li key={`${d.id}:${d.date}`} className="py-2 text-[13px]" data-testid="agenda-date">
                  <a href={`#/personas/${d.person_id}`} className="font-semibold" style={{ color: "var(--accent)" }}>{d.name}</a> · {d.label}
                  <div className="help">{dateLabel(d.date)} · {daysUntilLabel(d.days_until)}{d.years ? ` · ${d.years} ${d.years === 1 ? "año" : "años"}` : ""}</div>
                </li>
              ))}
            </ul>
          ) : <Empty text="Sin cumpleaños ni fechas señaladas en esta ventana." />}
        </Section>

        <Section title="Recordatorios">
          {report.reminders.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {report.reminders.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2 text-[13px]">
                  <div>
                    <div>{r.text}</div>
                    <div className="help">
                      {dateLabel(r.due)}
                      {r.person_name && <> · <a href={`#/personas/${r.person_id}`} style={{ color: "var(--accent)" }}>{r.person_name}</a></>}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm shrink-0" disabled={busy} onClick={() => completeReminder(r.id)}>Hecho</button>
                </li>
              ))}
            </ul>
          ) : <Empty text="Sin recordatorios pendientes." />}
        </Section>

        <Section title="Abandonados" aside={<span className="help">no hablas desde hace tiempo</span>}>
          {report.neglected.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {report.neglected.map((n) => (
                <li key={n.person_id} className="flex items-start justify-between gap-2 py-2 text-[13px]">
                  <div>
                    <a href={`#/personas/${n.person_id}`} className="font-semibold" style={{ color: "var(--accent)" }}>{n.name}</a>
                    <div className="help">{daysAgoLabel(n.days_since_contact)} · cadencia {n.contact_every_days}d</div>
                  </div>
                  <button type="button" className="btn btn-sm shrink-0" disabled={busy} onClick={() => talkedToday(n.person_id)}>He hablado hoy</button>
                </li>
              ))}
            </ul>
          ) : <Empty text="Nadie abandonado: vas al día." />}
        </Section>

        <Section title="Se enfrían" aside={<span className="help">{report.cooling_days ? `más de ${report.cooling_days} días` : "aviso apagado"}</span>}>
          {cooling.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {cooling.slice(0, 12).map((c) => (
                <li key={c.person_id} className="flex items-start justify-between gap-2 py-2 text-[13px]" data-testid="agenda-cooling">
                  <div>
                    <a href={`#/personas/${c.person_id}`} className="font-semibold" style={{ color: "var(--accent)" }}>{c.name}</a>
                    <div className="help">hace {sinceWords(c.days_since_contact)} que no habláis</div>
                  </div>
                  <button type="button" className="btn btn-sm shrink-0" disabled={busy} onClick={() => talkedToday(c.person_id)}>He hablado hoy</button>
                </li>
              ))}
              {cooling.length > 12 && <li className="help py-2">y {cooling.length - 12} más</li>}
            </ul>
          ) : <Empty text={report.cooling_days ? "Nadie con quien se esté perdiendo el contacto." : "Activa el aviso en Ajustes."} />}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="Compromisos" aside={<a href="#/compromisos" className="btn-link">Ver todos</a>}>
          {commitments.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-1 text-[13px] font-semibold">Vencidos <span className="help num">{overdueCommitments.length}</span></h3>
                {overdueCommitments.length ? commitmentList(overdueCommitments) : <p className="help">Ninguno vencido.</p>}
              </div>
              <div>
                <h3 className="mb-1 text-[13px] font-semibold">Esta semana <span className="help num">{weekCommitments.length}</span></h3>
                {weekCommitments.length ? commitmentList(weekCommitments) : <p className="help">Nada para los próximos 7 días.</p>}
                {laterCommitments.length > 0 && <p className="help mt-2">{laterCommitments.length} más dentro de la ventana elegida.</p>}
              </div>
            </div>
          ) : <Empty text="Sin compromisos vencidos ni próximos en esta ventana." action={<a href="#/compromisos" className="btn btn-sm">Ir a Compromisos</a>} />}
        </Section>
      </div>
    </Page>
  );
}
