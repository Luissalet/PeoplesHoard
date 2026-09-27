import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { calendarFeed } from "../server/calendar.js";

let s;
before(async () => { s = await bootServer(); });
after(async () => { await s.stop(); });

test("calendar exports recurring birthdays and dated open reminders", async () => {
  const ana = (await s.call("POST", "/api/people", { name: "Ana, García; Norte", birthday: "1990-10-02" })).body;
  await s.call("POST", "/api/people", { name: "Berta", birthday: "--11-03" });
  await s.call("POST", "/api/people", { name: "Leo", birthday: "--02-29" });
  await s.call("POST", "/api/people", { name: "Archivada", birthday: "--10-04", archived: true });
  await s.call("POST", `/api/people/${ana.id}/reminders`, { due: "2026-10-02", text: "Llamar, confirmar;\nlugar" });
  const done = (await s.call("POST", "/api/reminders", { due: "2026-10-04", text: "Hecho" })).body;
  await s.call("PATCH", `/api/reminders/${done.id}`, { done: true });
  const { text, birthdays, reminders } = calendarFeed({ from: "2026-09-27", generatedAt: new Date("2026-09-27T12:00:00Z") });
  assert.equal(birthdays, 3);
  assert.equal(reminders, 1);
  assert.equal((text.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.equal((text.match(/RRULE:FREQ=YEARLY/g) || []).length, 3);
  assert.match(text, /DTSTART;VALUE=DATE:20261002/);
  assert.match(text, /DTSTART;VALUE=DATE:20280229/);
  assert.match(text, /SUMMARY:Cumpleaños de Ana\\, García\\; Norte/);
  assert.match(text, /SUMMARY:Llamar\\, confirmar\\;\\nlugar/);
  assert.doesNotMatch(text, /Archivada|Hecho|Abandonados/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(text.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  const response = await fetch(`${s.base}/api/calendar.ics`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/calendar/);
  assert.match(response.headers.get("content-disposition"), /peoples-hoard-calendar\.ics/);
  assert.match(await response.text(), /BEGIN:VCALENDAR/);
});
