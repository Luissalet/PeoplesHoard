// datetime-local belongs to the browser's zone, never the server's zone.
export function interactionTime(localAt) {
  if (!localAt) return null;
  const date = new Date(localAt);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = -date.getTimezoneOffset();
  const pad = (value) => String(value).padStart(2, "0");
  return {
    at: date.toISOString(),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utc_offset: `UTC${minutes >= 0 ? "+" : "−"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`,
    label: new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date),
  };
}

export function interactionBody({ channel, summary, local_at }) {
  const time = interactionTime(local_at);
  if (local_at && !time) throw new Error("Fecha/hora no válida.");
  return { channel, summary, ...(time ? { at: time.at } : {}) };
}
