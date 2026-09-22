// Date helpers. Interaction/reminder dates are plain "YYYY-MM-DD" or ISO
// datetimes; birthdays are "YYYY-MM-DD" (year known) or "--MM-DD" (year
// unknown, the ISO 8601 "reduced accuracy" convention).
const pad = (n) => String(n).padStart(2, "0");

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validMonthDay(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/** Parse a birthday string into { year, month, day } (year null if unknown), or null. */
export function parseBirthday(input) {
  if (typeof input !== "string") return null;
  let m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!validMonthDay(month, day)) return null;
    if (month === 2 && day === 29 && !isLeap(year)) return null;
    return { year, month, day };
  }
  m = input.match(/^--(\d{2})-(\d{2})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (!validMonthDay(month, day)) return null;
    return { year: null, month, day };
  }
  return null;
}

export function isValidBirthday(input) {
  return parseBirthday(input) !== null;
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000);
}

/** "YYYY-MM-DD" + n days (n may be negative). */
export function addDays(dateStr, n) {
  const d = new Date(toUTC(dateStr) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function safeDateStr(year, month, day) {
  // Feb 29 in a non-leap target year rolls back to Feb 28.
  if (month === 2 && day === 29 && !isLeap(year)) day = 28;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Next occurrence of a birthday on or after `from` (default today), handling
 * the Dec→Jan year boundary. Returns { date, daysUntil, turningAge } or null.
 */
export function nextBirthday(birthday, from = today()) {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  const fromYear = Number(from.slice(0, 4));
  let date = safeDateStr(fromYear, parsed.month, parsed.day);
  if (date < from) date = safeDateStr(fromYear + 1, parsed.month, parsed.day);
  const daysUntil = daysBetween(from, date);
  const turningAge = parsed.year != null ? Number(date.slice(0, 4)) - parsed.year : null;
  return { date, daysUntil, turningAge };
}

/** Whole days between a past ISO date/datetime and `from` (>= 0), or null. */
export function daysSince(iso, from = today()) {
  if (!iso) return null;
  const date = String(iso).slice(0, 10);
  return Math.max(0, daysBetween(date, from));
}
