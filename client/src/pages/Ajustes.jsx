import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { Page, Section, useAction } from "../components/ui.jsx";

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
        notify({ kind: "ok", text: `Importadas ${out.people} personas, ${out.aliases} alias, ${out.facts} datos, ${out.interactions} contactos y ${out.reminders} recordatorios.` });
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
          <p className="help mb-3">Exporta toda tu agenda (personas, alias, datos, línea de tiempo y recordatorios) a un archivo JSON, o impórtala de vuelta. Importar siempre crea personas nuevas; no sobrescribe las existentes.</p>
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
    </Page>
  );
}
