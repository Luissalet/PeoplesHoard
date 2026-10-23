// Date fields describe complete browser-local calendar days, including DST days.
export function historyQuery(form) {
  const result = { q: form.q.trim(), include_archived: form.include_archived, limit: Number(form.limit), offset: 0 };
  if (form.person_id) result.person_id = form.person_id;
  if (form.channel) result.channel = form.channel;
  for (const key of ["from", "to"]) {
    if (!form[key]) continue;
    const [year, month, day] = form[key].split("-").map(Number);
    const start = new Date(year, month - 1, day);
    if (Number.isNaN(start.getTime()) || start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
      throw new Error("La fecha no es válida.");
    }
    result[key] = (key === "to" ? new Date(new Date(year, month - 1, day + 1).getTime() - 1) : start).toISOString();
  }
  if (result.from && result.to && result.from > result.to) throw new Error("Desde no puede ser posterior a hasta.");
  return result;
}
