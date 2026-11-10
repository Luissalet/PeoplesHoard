import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, Field, useAction } from "../components/ui.jsx";
import { useCopilotContext, useCopilotRefresh } from "../copilot-hooks.js";

const MAIL_STATUS = {
  never: "Aún no ha leído el correo.",
  ok: "Correo leído.",
  off: "Desactivado.",
  mail_unavailable: "El hub no tiene el correo activado (pestaña Correo del hub).",
  no_addresses: "Ninguna persona tiene un correo guardado como alias.",
  register_failed: "El hub no aceptó la lista de direcciones.",
  read_failed: "No se pudo leer el correo del hub.",
  busy: "Ya está leyendo.",
  error: "Error al leer el correo.",
};

function HubSection({ notify }) {
  const [settings, setSettings] = useState(null);
  const [sync, setSync] = useState(null);
  const [days, setDays] = useState("21");
  const [cooling, setCooling] = useState("90");
  const [run, busy] = useAction(notify);
  const load = async () => {
    try {
      const [s, m] = await Promise.all([api.settings.get(), api.mailSync.status()]);
      setSettings(s); setSync(m); setDays(String(s.gift_days_before)); setCooling(String(s.cooling_days));
    } catch (e) { notify({ kind: "error", text: e.message }); }
  };
  useEffect(() => { load(); }, []);
  useCopilotRefresh(() => { load(); });
  useCopilotContext(() => ({ editors: settings ? [{ kind: "settings-form", object_id: null,
    dirty: days !== String(settings.gift_days_before) || cooling !== String(settings.cooling_days), fields: { gift_days_before: days, cooling_days: cooling } }] : [] }));
  const save = async (patch, message) => { if (await run(() => api.settings.save(patch), message)) load(); };
  const readNow = async () => {
    const out = await run(() => api.mailSync.run(), null);
    if (out) {
      const r = out.result;
      notify({ kind: r.status === "ok" ? "ok" : "error", text: r.status === "ok" ? `Correo leído: ${r.read} mensajes, ${r.logged} contactos nuevos.` : (MAIL_STATUS[r.status] || r.status) });
      load();
    }
  };
  if (!settings) return null;
  return (
    <Section title="Con el resto de la familia">
      <label className="mb-3 flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={settings.mail_sync} onChange={(e) => save({ mail_sync: e.target.checked }, e.target.checked ? "Lectura del correo activada." : "Lectura del correo desactivada.")} disabled={busy} />
        <span>Actualizar el último contacto con el correo que ya lee el hub (cada 30 minutos). Solo se guarda la fecha, el canal y el asunto de los correos de personas con un alias de correo; nunca el texto.</span>
      </label>
      {sync && (
        <p className="help mb-3">
          {sync.addresses} {sync.addresses === 1 ? "dirección" : "direcciones"} · {MAIL_STATUS[sync.last_status] || sync.last_status}
          {sync.last_run_at ? ` · ${new Date(sync.last_run_at).toLocaleString("es-ES")}` : ""}
          {" "}<button type="button" className="btn-link" onClick={readNow} disabled={busy}>Leer ahora</button>
        </p>
      )}
      <label className="mb-3 flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={settings.whatsapp_last_contact} onChange={(e) => save({ whatsapp_last_contact: e.target.checked }, e.target.checked ? "WhatsApp actualiza el último contacto." : "WhatsApp ya no actualiza el último contacto.")} disabled={busy} />
        <span>Actualizar el último contacto con los mensajes de WhatsApp que Faustus pasa para los compromisos (solo de los chats que activaste allí). Se apunta una línea «Mensajes de WhatsApp» por persona y día; nunca el texto.</span>
      </label>
      <label className="mb-3 flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={settings.nudges} onChange={(e) => save({ nudges: e.target.checked }, e.target.checked ? "Avisos activados." : "Avisos desactivados.")} disabled={busy} />
        <span>Enviar avisos al resumen diario del hub: compromisos que vencen hoy o han vencido, recordatorios de hoy, cumpleaños y fechas señaladas (una semana antes y el día) y personas con las que se enfría la relación. Cada aviso sale una sola vez.</span>
      </label>
      <form onSubmit={(e) => { e.preventDefault(); save({ gift_days_before: Number(days), cooling_days: Number(cooling) }, "Guardado."); }} className="flex flex-wrap items-end gap-3">
        <Field label="Ideas de regalo en el resumen, días antes del cumpleaños">
          <input className="field field-sm" style={{ width: 90 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Avisar si no hablas con alguien en (días; 0 = nunca)">
          <input className="field field-sm" style={{ width: 90 }} inputMode="numeric" value={cooling} onChange={(e) => setCooling(e.target.value)} aria-label="Días sin hablar para avisar" />
        </Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Guardar</button>
      </form>
      <p className="help mt-2">El aviso de «se enfría» es para quien no tiene cadencia propia y con quien has hablado al menos dos veces; quien tiene «Hablar cada (días)» sale en «Abandonados» de la Agenda.</p>
    </Section>
  );
}

export default function Ajustes() {
  const { dataDir, version, refresh, notify } = useApp();
  const [run, busy] = useAction(notify);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const exportBackup = async () => {
    await run(async () => {
      const response = await fetch("/api/export");
      if (!response.ok) throw new Error((await response.json()).error || "No se pudo exportar.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `peoples-hoard-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, "Copia de seguridad descargada.");
  };

  const importBackup = async (file) => {
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const out = await run(() => api.importBackup(data), null);
      if (out) {
        notify({ kind: "ok", text: `Importadas ${out.people} personas, ${out.aliases} alias, ${out.facts} datos, ${out.interactions} contactos, ${out.reminders} recordatorios, ${out.commitments ?? 0} compromisos, ${out.gift_ideas ?? 0} ideas de regalo y ${out.person_dates ?? 0} fechas señaladas.` });
        refresh();
      }
    } catch (e) {
      notify({ kind: "error", text: e.message || "El archivo no es un JSON válido." });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Page title="Ajustes" description="Copia de seguridad y datos de la instalación.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Copia de seguridad">
          <p className="help mb-3">Exporta toda tu agenda (personas, alias, datos, línea de tiempo, recordatorios, compromisos, ideas de regalo y fechas señaladas) a un archivo JSON, o impórtala de vuelta. Importar siempre crea personas nuevas; no sobrescribe las existentes.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={exportBackup} disabled={busy}>Exportar JSON</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy || importing}>Importar JSON</button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && importBackup(e.target.files[0])} />
          </div>
        </Section>
        <Section title="Instalación">
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
            <dt className="help">Versión</dt><dd>{version}</dd>
            <dt className="help">Carpeta de datos</dt><dd className="break-all font-mono text-[12px]">{dataDir}</dd>
            <dt className="help">Base de datos</dt><dd className="font-mono text-[12px]">peoples-hoard.db (SQLite, WAL, FTS5)</dd>
            <dt className="help">Puente MCP</dt><dd className="font-mono text-[12px]">server/mcp.js · token en {"<datos>"}/mcp-token</dd>
          </dl>
          <p className="help mt-3">Para cambiar la carpeta, arranca la aplicación con la variable de entorno <code>PEOPLE_DATA_DIR</code>. El asistente se conecta con <code>npm run mcp</code> o mediante el manifiesto <code>faustus-plugin.json</code>.</p>
        </Section>
      </div>
      <div className="mt-4"><HubSection notify={notify} /></div>
    </Page>
  );
}
