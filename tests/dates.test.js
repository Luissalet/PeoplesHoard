import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBirthday, isValidBirthday, nextBirthday, daysSince, addDays } from "../server/dates.js";
import { fold, ftsPrefixQuery } from "../server/text.js";

test("parseBirthday accepts full dates and --MM-DD, rejects invalid ones", () => {
  assert.deepEqual(parseBirthday("1990-03-14"), { year: 1990, month: 3, day: 14 });
  assert.deepEqual(parseBirthday("--03-14"), { year: null, month: 3, day: 14 });
  assert.equal(parseBirthday("--02-30"), null, "Feb 30 does not exist");
  assert.equal(parseBirthday("1990-13-01"), null, "month 13 does not exist");
  assert.equal(parseBirthday("not-a-date"), null);
  assert.equal(parseBirthday(null), null);
  assert.equal(isValidBirthday("--02-29"), true, "Feb 29 is valid as a partial date (leap year unknown)");
  assert.equal(isValidBirthday("1990-02-29"), false, "1990 was not a leap year");
  assert.equal(isValidBirthday("1988-02-29"), true, "1988 was a leap year");
});

test("nextBirthday crosses the Dec→Jan year boundary", () => {
  const nb = nextBirthday("--01-03", "2026-12-30");
  assert.equal(nb.date, "2027-01-03");
  assert.equal(nb.daysUntil, 4);
  assert.equal(nb.turningAge, null, "year unknown");
});

test("nextBirthday within the same year, with a known year computing age", () => {
  const nb = nextBirthday("1990-03-14", "2026-01-01");
  assert.equal(nb.date, "2026-03-14");
  assert.equal(nb.daysUntil, 31 + 28 + 13);
  assert.equal(nb.turningAge, 36);
});

test("nextBirthday today counts as 0 days, not a year away", () => {
  const nb = nextBirthday("--06-15", "2026-06-15");
  assert.equal(nb.date, "2026-06-15");
  assert.equal(nb.daysUntil, 0);
});

test("nextBirthday rolls Feb 29 back to Feb 28 in a non-leap target year", () => {
  const nb = nextBirthday("--02-29", "2026-01-01"); // 2026 is not a leap year
  assert.equal(nb.date, "2026-02-28");
});

test("daysSince and addDays", () => {
  assert.equal(daysSince("2026-09-01T10:00:00.000Z", "2026-09-10"), 9);
  assert.equal(daysSince(null), null);
  assert.equal(addDays("2026-01-30", 5), "2026-02-04");
  assert.equal(addDays("2026-12-30", 5), "2027-01-04");
});

test("fold strips accents, case and surrounding space", () => {
  assert.equal(fold("José Ramírez"), "jose ramirez");
  assert.equal(fold("  Ñoño  "), "nono");
  assert.equal(fold(undefined), "");
});

test("ftsPrefixQuery builds a quoted, AND-ed prefix query", () => {
  assert.equal(ftsPrefixQuery("jose ramirez"), '"jose"* "ramirez"*');
  assert.equal(ftsPrefixQuery('weird "quote"'), '"weird"* "quote"*');
  assert.equal(ftsPrefixQuery("   "), null);
  assert.equal(ftsPrefixQuery(""), null);
});
