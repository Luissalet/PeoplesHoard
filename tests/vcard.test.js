import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { exportPeopleVcard } from "../server/vcard.js";
import { db } from "../server/db.js";

let s, a, b;
before(async () => {
  s = await bootServer();
  a = (await s.call("POST", "/api/people", { name: "Ángela, Norte; " + "🦋".repeat(30), nickname: "A\\B\nC", birthday: "--02-29", location: "Sevilla; Centro", circles: ["familia,amigos", "trabajo"], notes: "PRIVATE-NOTE" })).body;
  b = (await s.call("POST", "/api/people", { name: "Contacto ficticio", birthday: "1990-03-14" })).body;
  for (const [kind, value] of [["phone", "+34 600 111 222"], ["phone", "+34 900 333 444 ext 2"], ["email", "angela@example.test"], ["email", "angela@another.test"], ["whatsapp", "Nombre WhatsApp ficticio"]]) {
    await s.call("POST", `/api/people/${a.id}/aliases`, { kind, value });
  }
});
after(async () => { await s.stop(); });

test("vCard preserves stored contact fields, escapes/folds UTF8 and stays read-only", () => {
  const before = db().prepare("SELECT * FROM people ORDER BY id").all();
  const result = exportPeopleVcard({ person_ids: [a.id, b.id, a.id] });
  assert.equal(result.count, 2);
  assert.deepEqual(result.person_ids, [a.id, b.id]);
  const unfolded = result.text.replace(/\r\n[ \t]/g, "");
  assert.ok(unfolded.includes(`FN:Ángela\\, Norte\\; ${"🦋".repeat(30)}`));
  assert.ok(unfolded.includes("NICKNAME:A\\\\B\\nC"));
  assert.ok(unfolded.includes("BDAY:--0229\r\n") && unfolded.includes("BDAY:19900314\r\n"));
  assert.ok(unfolded.includes("ADR:;;;Sevilla\\; Centro;;;\r\n"));
  assert.ok(unfolded.includes("CATEGORIES:familia\\,amigos,trabajo\r\n"));
  assert.equal((unfolded.match(/^TEL;VALUE=text:/gm) || []).length, 2);
  assert.equal((unfolded.match(/^EMAIL:/gm) || []).length, 2);
  assert.ok(!unfolded.includes("PRIVATE-NOTE") && !unfolded.includes("Nombre WhatsApp ficticio"));
  for (const line of result.text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
  assert.ok(!result.text.includes("�"));
  assert.equal(exportPeopleVcard({ person_ids: [a.id, b.id] }).text, result.text);
  assert.deepEqual(db().prepare("SELECT * FROM people ORDER BY id").all(), before);
});

test("single and selected downloads match the native MCP tool and never partly export a missing selection", async () => {
  const selection = { person_ids: [b.id, a.id, b.id] };
  const expected = exportPeopleVcard(selection);
  const response = await fetch(s.base + "/api/people/vcard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/vcard; charset=utf-8/);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="contactos.vcf"/);
  assert.equal(await response.text(), expected.text);
  const tool = await s.agent("export_people_vcard", selection);
  assert.equal(tool.status, 200);
  assert.deepEqual(tool.body, expected);
  const single = await fetch(s.base + `/api/people/${a.id}/vcard`);
  assert.equal(await single.text(), exportPeopleVcard({ person_ids: [a.id] }).text);
  assert.equal((await s.call("POST", "/api/people/vcard", { person_ids: [] })).status, 400);
  assert.equal((await s.call("POST", "/api/people/vcard", { person_ids: [a.id, "missing"] })).status, 404);
});
