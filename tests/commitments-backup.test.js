// The backup file carries commitments (with who and why) and a restore into an empty book brings them back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";

test("export carries commitments and import restores them with their people and status", async () => {
  const source = await bootServer();
  const marta = (await source.call("POST", "/api/people", { name: "Marta Lozano" })).body;
  await source.call("POST", "/api/commitments", { direction: "i_owe", person_id: marta.id, text: "Mandarle las fotos", due: "2031-05-02", source_kind: "text", source_ref: "x", source_quote: "te las mando" });
  const done = (await source.call("POST", "/api/commitments", { direction: "owed_to_me", person_id: marta.id, text: "Devolverme el libro" })).body.commitment;
  await source.call("PATCH", `/api/commitments/${done.id}`, { status: "done" });
  await source.call("POST", "/api/commitments", { direction: "i_owe", person_name_raw: "El del taller", text: "Pagar la factura" });
  const backup = (await source.call("GET", "/api/export")).body;
  assert.equal(backup.commitments.length, 3);
  await source.stop();

  const fresh = await bootServer();
  try {
    const result = await fresh.call("POST", "/api/import", backup);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.commitments, 3);
    const restored = (await fresh.call("GET", "/api/commitments?status=all")).body.commitments;
    assert.equal(restored.length, 3);
    const photos = restored.find((c) => c.text === "Mandarle las fotos");
    assert.equal(photos.person_name, "Marta Lozano");
    assert.equal(photos.due, "2031-05-02");
    assert.deepEqual(photos.source, { kind: "text", ref: "x", quote: "te las mando" });
    assert.equal(restored.find((c) => c.text === "Devolverme el libro").status, "done");
    assert.equal(restored.find((c) => c.text === "Pagar la factura").person_name, "El del taller");
    // an old backup without commitments still imports
    const { commitments, ...old } = backup;
    assert.equal((await fresh.call("POST", "/api/import", old)).status, 200);
  } finally {
    await fresh.stop();
  }
});
