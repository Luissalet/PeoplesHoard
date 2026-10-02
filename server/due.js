// Resolve spoken or written due dates ("el martes", "mañana", "en dos semanas",
// "15 de octubre") to a YYYY-MM-DD day, relative to a base day. Deterministic:
// the same words and base always give the same date. Returns null when the
// words do not name one specific day ("la semana que viene", "pronto"), so the
// caller keeps them as due_text instead of guessing.
import { fold } from "./text.js";
import { addDays } from "./dates.js";

const WEEKDAYS = {
  lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6,
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};
const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};
const NUMBER_WORDS = {
  un: 1, una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, quince: 15, veinte: 20,
};
const pad = (n) => String(n).padStart(2, "0");

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function nextOnOrAfter(base, month, day) {
  const baseYear = Number(base.slice(0, 4));
  for (const year of [baseYear, baseYear + 1]) {
    const candidate = validDate(year, month, day);
    if (candidate && candidate >= base) return candidate;
  }
  return null;
}

function addMonths(base, months) {
  const [y, m, d] = base.split("-").map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12 + 1;
  let day = d;
  while (day > 28 && !validDate(year, month, day)) day--;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
}

const count = (token) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token] ?? null);

/** ISO day for `text` relative to `base` (YYYY-MM-DD), or null. */
export function resolveDue(text, base) {
  if (!text || !String(text).trim() || !/^\d{4}-\d{2}-\d{2}$/.test(base || "")) return null;
  const words = fold(String(text));
  let m;

  if ((m = words.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = words.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/))) {
    const year = Number(m[3]) < 100 ? Number(m[3]) + 2000 : Number(m[3]);
    return validDate(year, Number(m[2]), Number(m[1]));
  }
  if ((m = words.match(/\b(\d{1,2})[/-](\d{1,2})\b/))) return nextOnOrAfter(base, Number(m[2]), Number(m[1]));

  const names = Object.keys(MONTHS).join("|");
  let day = null, monthName = null, yearText = null;
  if ((m = words.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(${names})\\b(?:\\s+(?:de\\s+|of\\s+)?(\\d{4}))?`)))) {
    [day, monthName, yearText] = [Number(m[1]), m[2], m[3]];
  } else if ((m = words.match(new RegExp(`\\b(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`)))) {
    [day, monthName, yearText] = [Number(m[2]), m[1], m[3]];
  }
  if (day !== null) {
    const month = MONTHS[monthName];
    return yearText ? validDate(Number(yearText), month, day) : nextOnOrAfter(base, month, day);
  }

  // "por la mañana" is a time of day, not "tomorrow".
  const cleaned = words.replace(/\b(?:por|de|en|esta|la|a la)\s+(?:la\s+)?manana\b/g, " ");

  if ((m = cleaned.match(/\b(?:en|dentro de|in)\s+(\d+|[a-z]+)\s+(dias?|days?|semanas?|weeks?|meses|mes|months?)\b/))) {
    const amount = count(m[1]);
    if (amount !== null && amount > 0 && amount <= 366) {
      if (/^(dia|day)/.test(m[2])) return addDays(base, amount);
      if (/^(semana|week)/.test(m[2])) return addDays(base, amount * 7);
      return addMonths(base, amount);
    }
  }
  if (/\bpasado manana\b|\bday after tomorrow\b/.test(cleaned)) return addDays(base, 2);
  if (/\bmanana\b|\btomorrow\b/.test(cleaned)) return addDays(base, 1);
  if (/\bhoy\b|\btoday\b|\besta noche\b|\btonight\b/.test(cleaned)) return base;

  if ((m = cleaned.match(new RegExp(`\\b(${Object.keys(WEEKDAYS).join("|")})\\b`)))) {
    const ahead = ((WEEKDAYS[m[1]] - weekdayOf(base) + 7) % 7) || 7;
    return addDays(base, ahead);
  }
  if (/\b(?:a\s+)?(?:fin|final|finales)\s+de\s+mes\b|\bend of (?:the )?month\b/.test(cleaned)) {
    const [y, mo] = base.split("-").map(Number);
    return addDays(addMonths(`${y}-${pad(mo)}-01`, 1), -1);
  }
  return null;
}
