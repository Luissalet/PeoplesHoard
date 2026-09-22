// Formatting helpers for the UI (Spanish conventions).
const pad = (n) => String(n).padStart(2, "0");

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateLabel(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function dateTimeLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateLabel(iso.slice(0, 10))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function daysAgoLabel(days) {
  if (days === null || days === undefined) return "sin contacto registrado";
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

export function daysUntilLabel(days) {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return `en ${days} días`;
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "1990-03-14" -> "14 mar 1990"; "--03-14" -> "14 mar". */
export function birthdayLabel(birthday) {
  if (!birthday) return "";
  const known = /^\d{4}-/.test(birthday);
  const [monthStr, dayStr] = (known ? birthday.slice(5) : birthday.slice(2)).split("-");
  const label = `${Number(dayStr)} ${MONTHS_SHORT[Number(monthStr) - 1]}`;
  return known ? `${label} ${birthday.slice(0, 4)}` : label;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days until the next occurrence of a "YYYY-MM-DD" or "--MM-DD" birthday, or null. */
export function daysUntilBirthday(birthday, from = today()) {
  if (!birthday) return null;
  const known = /^\d{4}-/.test(birthday);
  const mmdd = known ? birthday.slice(5) : birthday.slice(2);
  const [month, day0] = mmdd.split("-").map(Number);
  const fromYear = Number(from.slice(0, 4));
  const safe = (year) => {
    const d = month === 2 && day0 === 29 && !isLeap(year) ? 28 : day0;
    return `${year}-${pad(month)}-${pad(d)}`;
  };
  let date = safe(fromYear);
  if (date < from) date = safe(fromYear + 1);
  return dayDiff(from, date);
}

function dayDiff(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export const CHANNELS = { whatsapp: "WhatsApp", email: "Correo", call: "Llamada", meet: "En persona", message: "Mensaje", other: "Otro" };
export const ALIAS_KINDS = { whatsapp: "WhatsApp", email: "Correo", phone: "Teléfono", handle: "Usuario", other: "Otro" };
export const REMINDER_KINDS = { birthday: "Cumpleaños", followup: "Seguimiento", custom: "Personal" };
