import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, useAction } from "../components/ui.jsx";

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
  const [run, busy] = useAction(notify);
  const load = async () => {
    try {
      const [s, m] = await Promise.all([api.settings.get(), api.mailSync.status()]);
      setSettings(s); setSync(m); setDays(String(s.gift_days_before));
    } catch (e) { notify({ kind: "error", text: e.message }); }
  };
  useEffect(() => { load(); }, []);
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
          {sync.addresses} direcciones · {MAIL_STATUS[sync.last_status] || sync.last_status}
          {sync.last_run_at ? ` · ${new Date(sync.last_run_at).toLocaleString("es-ES")}` : ""}
          {" "}<button type="button" className="btn-link" onClick={readNow} disabled={busy}>Leer ahora</button>
        </p>
      )}
      <form onSubmit={(e) => { e.preventDefault(); save({ gift_days_before: Number(days) }, "Guardado."); }} className="flex flex-wrap items-end gap-2">
        <Field label="Ideas de regalo en el resumen, días antes del cumpleaños">
          <input className="field field-sm" style={{ width: 90 }} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-sm" disabled={busy}>Guardar</button>
      </form>
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
        notify({ kind: "ok", text: `Importadas ${out.people} personas, ${out.aliases} alias, ${out.facts} datos, ${out.interactions} contactos, ${out.reminders} recordatorios y ${out.commitments ?? 0} compromisos.` });
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
          <p className="help mb-3">Exporta toda tu agenda (personas, alias, datos, línea de tiempo, recordatorios y compromisos) a un archivo JSON, o impórtala de vuelta. Importar siempre crea personas nuevas; no sobrescribe las existentes.</p>
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
